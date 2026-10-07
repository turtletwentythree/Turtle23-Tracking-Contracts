// send-email: the only place that sends the status emails of User Case Action.
// The website calls it with the signed-in user's session; this function
//   1. checks the session and the user's Access Level (Level 2+ may send),
//   2. checks To / CC / subject / attachments again (never trusts the page),
//   3. records the email in public.email_outbox under its requestId, so a Retry or double click never sends twice,
//   4. reads the attachments from the private Storage bucket AS THE USER (Storage rules decide what they may attach),
//   5. sends through the configured provider (Resend by default, Microsoft Graph possible) and stores the result.
// No key is ever sent to the browser: provider keys are Supabase secrets.
// Kept free of Deno and npm imports so it can be tested on its own; index.ts wires in the real clients.

export type Env = (name: string) => string | undefined;
export interface Attachment { fileName: string; mimeType: string; content: Uint8Array }
export interface Mail {
  from: string; to: string; cc: string[]; replyTo?: string; subject: string; text: string; html: string;
  attachments: Attachment[]; idempotencyKey: string;
}
export interface Provider { name: string; maxAttachBytes: number; send(mail: Mail): Promise<{ id: string }> }
export interface Deps {
  env: Env;
  // user: a client that acts as the caller (their session); admin: service-role client for email_outbox
  userClient(authHeader: string): any;
  adminClient(): any;
  provider: Provider;
  now?: () => Date;
}

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const CASE_ROLES = ["user", "confidential", "admin", "root"]; // Level 2 and up
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const PATH_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}$/; // <contract folder>/<random id>.<ext>, no "." or ".." segments
const ID_RE = /^[A-Za-z0-9_-]{6,120}$/;
const STALE_SENDING_MS = 2 * 60 * 1000;
export const MIME: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png"
};

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const ext = (name: string) => (String(name).split(".").pop() || "").toLowerCase();
const cleanName = (v: unknown) => String(v || "attachment").replace(/[\\/:*?"<>|\r\n\t]+/g, "_").slice(0, 180) || "attachment";
export const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export function htmlBody(text: string) {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${text.split("\n").map(line =>
    escapeHtml(line).replace(/(https:\/\/[^\s<>"']+)/g, url => `<a href="${url}">${url}</a>`)).join("<br>")}</div>`;
}

// Everything the page sends is checked here
export function validate(p: any, env: Env) {
  const requestId = String(p?.requestId || "");
  if (!ID_RE.test(requestId)) throw new HttpError(400, "Missing requestId.");
  const to = String(p.to || "").trim().toLowerCase();
  if (!EMAIL_RE.test(to)) throw new HttpError(400, "Enter a valid email address. / กรุณากรอกอีเมลให้ถูกต้อง (To)");
  const cc: string[] = [];
  for (const item of Array.isArray(p.cc) ? p.cc : []) {
    const e = String(item || "").trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL_RE.test(e)) throw new HttpError(400, `Enter a valid email address. / กรุณากรอกอีเมลให้ถูกต้อง (CC: ${e})`);
    if (e !== to && !cc.includes(e)) cc.push(e);
  }
  if (cc.length > 50) throw new HttpError(400, "Too many CC recipients.");
  const subject = String(p.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 250);
  if (!subject) throw new HttpError(400, "Subject is required.");
  const body = String(p.body || "").slice(0, 20000);
  const list = Array.isArray(p.attachments) ? p.attachments : [];
  if (list.length > MAX_FILES) throw new HttpError(400, "Up to 10 files per email.");
  const attachments = list.map((a: any) => {
    const path = String(a?.path || ""), fileName = cleanName(a?.fileName);
    if (!PATH_RE.test(path)) throw new HttpError(400, `Attachment not found: ${fileName}`);
    const type = MIME[ext(path)];
    if (!type || MIME[ext(fileName)] !== type) throw new HttpError(400, `File type not allowed: ${fileName}`);
    return { path, fileName, mimeType: type };
  });
  if (new Set(attachments.map((a: any) => a.path)).size !== attachments.length) throw new HttpError(400, "The same file is attached twice.");
  // Links in the email may only point back to the website
  const site = String(env("SITE_URL") || "").replace(/\/+$/, "");
  let systemLink = String(p.systemLink || "").trim();
  if (!/^https:\/\/[^\s<>"']{1,500}$/.test(systemLink) || (site && !systemLink.startsWith(site + "/") && systemLink !== site)) systemLink = site;
  return {
    requestId, to, cc, subject, body, attachments, systemLink,
    kind: String(p.kind || "").slice(0, 40) || null, contractId: String(p.contractId || "").slice(0, 120) || null,
    action: String(p.action || "").slice(0, 120) || null
  };
}

async function caller(deps: Deps, authHeader: string) {
  if (!/^Bearer\s+\S+/.test(authHeader || "")) throw new HttpError(401, "Not signed in.");
  const client = deps.userClient(authHeader);
  const { data: u, error: ue } = await client.auth.getUser();
  if (ue || !u?.user) throw new HttpError(401, "Session expired. Please sign in again.");
  const { data: rows, error } = await client.rpc("my_access");
  const me = Array.isArray(rows) ? rows[0] : rows;
  if (error || !me || me.active === false || !CASE_ROLES.includes(String(me.role))) throw new HttpError(403, "This account may not send case emails (Level 2 required).");
  return { id: u.user.id as string, email: String(me.email || u.user.email || "").toLowerCase(), client };
}

const result = (row: any, extra: Record<string, unknown> = {}) => ({
  success: true, state: "done", sent: true, requestId: row.request_id, sentAt: row.sent_at, to: row.to_email, cc: row.cc,
  delivery: row.delivery, provider: row.provider, ...extra
});

export async function handle(payload: any, authHeader: string, deps: Deps) {
  const now = deps.now || (() => new Date());
  const who = await caller(deps, authHeader);
  const m = validate(payload, deps.env);
  const db = deps.adminClient();

  // 1. Same requestId again: answer from the outbox instead of sending again
  const { data: found, error: fe } = await db.from("email_outbox").select("*").eq("request_id", m.requestId).maybeSingle();
  if (fe) throw new HttpError(500, `email_outbox: ${fe.message} (run 012_email_outbox.sql)`);
  if (found && found.sent_by && found.sent_by !== who.id) throw new HttpError(409, "This request belongs to another user.");
  if (found?.status === "sent") return result(found, { duplicate: true });
  if (!found) {
    const { error } = await db.from("email_outbox").insert({
      request_id: m.requestId, kind: m.kind, contract_id: m.contractId, action: m.action, to_email: m.to, cc: m.cc,
      subject: m.subject, body: m.body, attachments: m.attachments, status: "queued", sent_by: who.id, sent_by_email: who.email
    });
    if (error && !/duplicate|unique/i.test(error.message)) throw new HttpError(500, `email_outbox: ${error.message}`);
  }
  // 2. Claim the row: only one call may be sending it at a time (a stuck "sending" is released after 2 minutes)
  const stale = new Date(now().getTime() - STALE_SENDING_MS).toISOString();
  const { data: claimed, error: ce } = await db.from("email_outbox")
    .update({ status: "sending", updated_at: now().toISOString(), to_email: m.to, cc: m.cc, subject: m.subject, body: m.body, attachments: m.attachments, error: null })
    .eq("request_id", m.requestId)
    .or(`status.eq.queued,status.eq.failed,and(status.eq.sending,updated_at.lt.${stale})`)
    .select("*");
  if (ce) throw new HttpError(500, `email_outbox: ${ce.message}`);
  if (!claimed?.length) {
    const { data: again } = await db.from("email_outbox").select("*").eq("request_id", m.requestId).maybeSingle();
    if (again?.status === "sent") return result(again, { duplicate: true });
    throw new HttpError(409, "This email is being sent. Please wait a moment and press Retry. / อีเมลนี้กำลังส่งอยู่ กรุณารอสักครู่แล้วกดส่งอีกครั้ง");
  }
  const row = claimed[0];
  await db.from("email_outbox").update({ attempts: (row.attempts || 0) + 1 }).eq("request_id", m.requestId);

  try {
    // 3. Files are read as the caller: Storage only returns files of contracts they can see
    const files: Attachment[] = [];
    let total = 0;
    const meta: any[] = [];
    for (const a of m.attachments) {
      const { data, error } = await who.client.storage.from("attachments").download(a.path);
      if (error || !data) throw new HttpError(403, `Attachment not found or not allowed: ${a.fileName}`);
      const content = new Uint8Array(await data.arrayBuffer());
      if (!content.length) throw new HttpError(400, `Empty file: ${a.fileName}`);
      if (content.length > MAX_FILE_BYTES) throw new HttpError(400, `File is over 20 MB: ${a.fileName}`);
      total += content.length;
      files.push({ fileName: a.fileName, mimeType: a.mimeType, content });
      meta.push({ ...a, fileSize: content.length });
    }
    // 4. Too large for the provider: no files, a link to the contract in the system instead
    const limit = Math.min(deps.provider.maxAttachBytes, (Number(deps.env("MAX_ATTACH_MB")) || Infinity) * 1024 * 1024);
    const asLinks = files.length > 0 && total > limit;
    let text = m.body;
    if (asLinks) {
      text += "\n\nFiles are too large to attach. Open them in the system: / ไฟล์มีขนาดใหญ่เกินกว่าจะแนบในอีเมล กรุณาเปิดในระบบ:";
      files.forEach((f, i) => { text += `\n${i + 1}. ${f.fileName}`; });
      if (m.systemLink) text += `\n${m.systemLink}`;
    }
    const from = deps.env("EMAIL_FROM") || "";
    if (!from) throw new HttpError(500, "EMAIL_FROM secret is not set.");
    const sent = await deps.provider.send({
      from, to: m.to, cc: m.cc, replyTo: who.email || undefined, subject: m.subject, text, html: htmlBody(text),
      attachments: asLinks ? [] : files, idempotencyKey: m.requestId
    });
    const done = {
      status: "sent", delivery: !files.length ? "none" : asLinks ? "links" : "attached", provider: deps.provider.name,
      provider_message_id: sent.id || null, attachments: meta, sent_at: now().toISOString(), updated_at: now().toISOString(), error: null
    };
    await db.from("email_outbox").update(done).eq("request_id", m.requestId);
    console.log(JSON.stringify({ event: "email_sent", requestId: m.requestId, contractId: m.contractId, by: who.email, to: m.to, cc: m.cc.length, files: files.length, delivery: done.delivery }));
    return result({ ...row, ...done, to_email: m.to, cc: m.cc });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("email_outbox").update({ status: "failed", error: message.slice(0, 1000), updated_at: now().toISOString() }).eq("request_id", m.requestId);
    console.error(JSON.stringify({ event: "email_failed", requestId: m.requestId, by: who.email, error: message }));
    throw e instanceof HttpError ? e : new HttpError(502, `Send failed: ${message}`);
  }
}
