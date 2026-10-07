// Email providers behind one small interface (see Provider in handler.ts).
// EMAIL_PROVIDER secret picks one: "resend" (default) or "graph" (Microsoft 365, sends as a company mailbox).
import type { Env, Mail, Provider } from "./handler.ts";

export function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const need = (env: Env, name: string) => {
  const v = env(name);
  if (!v) throw new Error(`${name} secret is not set.`);
  return v;
};
async function failText(res: Response) {
  const t = await res.text().catch(() => "");
  try { const j = JSON.parse(t); return j.message || j.error?.message || j.error || t; } catch (_) { return t || res.statusText; }
}

// Resend (https://resend.com): needs RESEND_API_KEY and a verified sending domain (EMAIL_FROM must use it)
export function resend(env: Env, http: typeof fetch = fetch): Provider {
  return {
    name: "resend",
    maxAttachBytes: 15 * 1024 * 1024, // Resend allows 40 MB per email after Base64; keep a margin
    async send(m: Mail) {
      const res = await http("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${need(env, "RESEND_API_KEY")}`, "Content-Type": "application/json", "Idempotency-Key": m.idempotencyKey },
        body: JSON.stringify({
          from: m.from, to: [m.to], ...(m.cc.length ? { cc: m.cc } : {}), ...(m.replyTo ? { reply_to: m.replyTo } : {}),
          subject: m.subject, text: m.text, html: m.html,
          ...(m.attachments.length ? { attachments: m.attachments.map(a => ({ filename: a.fileName, content: toBase64(a.content), content_type: a.mimeType })) } : {})
        })
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await failText(res)}`);
      const j = await res.json().catch(() => ({}));
      return { id: String(j.id || "") };
    }
  };
}

// Microsoft 365 through Microsoft Graph, sending as one company mailbox. Needs an Entra app with the
// Mail.Send application permission (admin consent) and the secrets MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET.
// The mailbox is MS_SENDER, or the address in EMAIL_FROM. No DNS change: Microsoft 365 already sends for the domain.
// Without files: one sendMail call. With files: draft -> attachments (large ones in an upload session) -> send,
// so up to 15 MB in total works (sendMail alone stops at about 4 MB).
const GRAPH = "https://graph.microsoft.com/v1.0";
const SMALL_ATTACHMENT = 3 * 1024 * 1024;
const CHUNK = 10 * 320 * 1024; // upload chunks must be multiples of 320 KiB and under 4 MB
export function graphSender(env: Env) {
  const direct = String(env("MS_SENDER") || "").trim();
  const fromAddr = (String(env("EMAIL_FROM") || "").match(/<([^>]+)>/)?.[1] || String(env("EMAIL_FROM") || "")).trim();
  const sender = (direct || fromAddr).toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender)) throw new Error("MS_SENDER (or EMAIL_FROM) must be the mailbox that sends, e.g. contract@turtle23.com");
  return sender;
}
export function graph(env: Env, http: typeof fetch = fetch): Provider {
  return {
    name: "graph",
    maxAttachBytes: 15 * 1024 * 1024,
    async send(m: Mail) {
      const sender = graphSender(env);
      const tokenRes = await http(`https://login.microsoftonline.com/${encodeURIComponent(need(env, "MS_TENANT_ID"))}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: need(env, "MS_CLIENT_ID"), client_secret: need(env, "MS_CLIENT_SECRET"),
          scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" })
      });
      if (!tokenRes.ok) throw new Error(`Microsoft sign-in ${tokenRes.status}: ${await failText(tokenRes)}`);
      const { access_token } = await tokenRes.json();
      const auth = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };
      const user = `${GRAPH}/users/${encodeURIComponent(sender)}`;
      const addr = (address: string) => ({ emailAddress: { address } });
      const message = {
        subject: m.subject, body: { contentType: "HTML", content: m.html },
        toRecipients: [addr(m.to)], ccRecipients: m.cc.map(addr), ...(m.replyTo ? { replyTo: [addr(m.replyTo)] } : {}),
        internetMessageHeaders: [{ name: "X-T23-Request-Id", value: m.idempotencyKey }]
      };
      const call = async (url: string, init: RequestInit, what: string) => {
        const res = await http(url, init);
        if (!res.ok) throw new Error(`Microsoft Graph ${what} ${res.status}: ${await failText(res)}`);
        return res;
      };
      if (!m.attachments.length) {
        const res = await call(`${user}/sendMail`, { method: "POST", headers: auth, body: JSON.stringify({ message, saveToSentItems: true }) }, "sendMail");
        return { id: res.headers.get("request-id") || "" };
      }
      const draft = await (await call(`${user}/messages`, { method: "POST", headers: auth, body: JSON.stringify(message) }, "draft")).json();
      const msg = `${user}/messages/${encodeURIComponent(draft.id)}`;
      try {
        for (const a of m.attachments) {
          if (a.content.length < SMALL_ATTACHMENT) {
            await call(`${msg}/attachments`, { method: "POST", headers: auth, body: JSON.stringify({
              "@odata.type": "#microsoft.graph.fileAttachment", name: a.fileName, contentType: a.mimeType, contentBytes: toBase64(a.content) }) }, "attachment");
            continue;
          }
          const session = await (await call(`${msg}/attachments/createUploadSession`, { method: "POST", headers: auth, body: JSON.stringify({
            AttachmentItem: { attachmentType: "file", name: a.fileName, size: a.content.length, contentType: a.mimeType } }) }, "upload session")).json();
          for (let start = 0; start < a.content.length; start += CHUNK) {
            const part = a.content.subarray(start, Math.min(start + CHUNK, a.content.length));
            // The upload URL carries its own token: no Authorization header here
            await call(session.uploadUrl, { method: "PUT", body: part as unknown as BodyInit, headers: {
              "Content-Type": "application/octet-stream", "Content-Length": String(part.length),
              "Content-Range": `bytes ${start}-${start + part.length - 1}/${a.content.length}` } }, "upload");
          }
        }
        await call(`${msg}/send`, { method: "POST", headers: auth }, "send");
      } catch (e) {
        await http(msg, { method: "DELETE", headers: auth }).catch(() => {}); // leave no half-made draft behind
        throw e;
      }
      return { id: String(draft.internetMessageId || draft.id || "") };
    }
  };
}

export function pickProvider(env: Env, http: typeof fetch = fetch): Provider {
  const name = String(env("EMAIL_PROVIDER") || "resend").toLowerCase();
  if (name === "graph") return graph(env, http);
  if (name === "resend") return resend(env, http);
  throw new Error(`Unknown EMAIL_PROVIDER: ${name}`);
}
