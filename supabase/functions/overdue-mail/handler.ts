// overdue-mail: a daily email to each person holding R = Overdue contracts, asking them to follow up and Update Status.
// Requests:
//   { mode: "status" | "preview" | "sendTest" | "send" | "setAuto", enabled? }  from Admin Tools (Level 4-5, signed in)
//   { mode: "scheduled" } + header x-cron-key                                 from pg_cron, Mon-Fri 09:00 Asia/Bangkok
// Rules:
//   * The list is "5. Longest pending on hand" of the Dashboard: every open contract whose Status Update is R today,
//     from the shared SLA engine (the same file the website uses)
//   * To = the Station Owner (the person holding the case: To of the newest log, else Station To, else Contract Owner);
//     CC = the Contract Owner when that is someone else (overdue_mail_settings.cc_contract_owner). Emails come from People.
//   * One email per person per day listing all their R contracts, longest pending first, with a link to the website
//   * Confidential contracts show only the Contract ID
//   * Scheduled run: only when Automatic is On, Mon-Fri, not on a holiday; a person is emailed at most once a day
//     (email_outbox request_id overdue:<date>:<email>). Admin Send Now sends again. Send Test sends one sample to the Admin only.
//   * One run at a time (overdue_mail_settings.run_lock_until). Every email is recorded in email_outbox (kind overdue_reminder).
// Sends through the same provider as send-email (EMAIL_PROVIDER / EMAIL_FROM and its secrets). No key reaches the browser.
import type { Provider } from "../send-email/handler.ts";

export type Env = (name: string) => string | undefined;
export interface Deps {
  env: Env;
  userClient(authHeader: string): any;
  adminClient(): any;
  createEngine(getDb: () => any): any;
  provider(): Provider;
  now?: () => Date;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const ADMIN_ROLES = ["admin", "root"];
const LOCK_MS = 5 * 60 * 1000;
export const KIND = "overdue_reminder";
export const DEFAULT_SITE = "https://turtletwentythree.github.io/Turtle23-Tracking-Contracts/";
export const MASK = "Confidential Contract / สัญญาลับ";
const bkk = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
const bkkWeekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", weekday: "short" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (s: unknown) => { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "-"; };
const isConfidential = (c: any) => c.access_level === "Confidential" || /^confidential/i.test(String(c.classification || ""));
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

async function admin(deps: Deps, authHeader: string) {
  if (!/^Bearer\s+\S+/.test(authHeader || "")) throw new HttpError(401, "Not signed in.");
  const client = deps.userClient(authHeader);
  const { data: u, error: ue } = await client.auth.getUser();
  if (ue || !u?.user) throw new HttpError(401, "Session expired. Please sign in again.");
  const { data: rows, error } = await client.rpc("my_access");
  const me = Array.isArray(rows) ? rows[0] : rows;
  if (error || !me || me.active === false || !ADMIN_ROLES.includes(String(me.role))) throw new HttpError(403, "Overdue Email is for Level 4-5 only.");
  return String(me.email || u.user.email || "").toLowerCase();
}

async function settings(db: any) {
  const { data, error } = await db.from("overdue_mail_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new HttpError(500, `overdue_mail_settings: ${error.message} (run 019_overdue_mail.sql)`);
  if (!data) throw new HttpError(500, "overdue_mail_settings is empty (run 019_overdue_mail.sql)");
  return data;
}

async function loadAll(db: any) {
  // Supabase returns at most 1000 rows per request, so read in pages (ordered by the key) until a short page
  const PAGE = 1000;
  const table = async (name: string, key: string | null, optional = false) => {
    const all: any[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = db.from(name).select("*");
      if (key) q = q.order(key, { ascending: true });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) { if (optional) return []; throw new HttpError(500, `${name}: ${error.message}`); }
      all.push(...(data || []));
      if (!data || data.length < PAGE) return all;
    }
  };
  const [contracts, contract_logs, action_sla, contract_types, holidays, people] = await Promise.all([
    table("contracts", "id"), table("contract_logs", "id"), table("action_sla", "action"), table("contract_types", "id"),
    table("holidays", null, true), table("people", "name")]);
  return { contracts, contract_logs, action_sla, contract_types, holidays, people };
}

export interface Item {
  contractId: string; name: string; vendor: string; confidential: boolean; days: number; totalSla: number | null;
  dueDate: string; action: string; reason: string; department: string; owner: string; station: string;
}
export interface Mail { to: string; toName: string; cc: string[]; ccNames: string[]; items: Item[] }

// The R list of the Dashboard ("5. Longest pending on hand"), grouped into one email per Station Owner
export function plan(data: any, createEngine: Deps["createEngine"], today: string, ccOwner = true) {
  const engine = createEngine(() => data);
  const emailOf = new Map<string, string>();
  (data.people || []).forEach((p: any) => {
    const e = String(p.email || "").trim().toLowerCase();
    if (p.name && EMAIL_RE.test(e) && p.active !== false) emailOf.set(String(p.name).trim(), e);
  });
  const items: Item[] = [];
  const seen = new Set<string>();
  for (const c of data.contracts) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const st = engine.contractState(c, today);
    if (st.kind !== "open" || st.code !== "R") continue;
    const owner = String(c.owner || "").trim();
    const station = String((st.log && st.log.to_person) || c.station_to || c.owner || "").trim();
    const conf = isConfidential(c);
    items.push({
      contractId: c.id, name: conf ? MASK : String(c.name || "-"), vendor: conf ? "-" : String(c.vendor || "-"), confidential: conf,
      days: st.acc, totalSla: st.totalSla ?? null, dueDate: fmtDate(c.due_date), action: st.action || "-",
      reason: conf ? "-" : String(st.reason || "-"), department: String(c.department || "-"), owner: owner || "-", station: station || "-"
    });
  }
  items.sort((a, b) => b.days - a.days || a.contractId.localeCompare(b.contractId));
  const mails = new Map<string, Mail>();
  const missing: { contractId: string; person: string }[] = [];
  for (const it of items) {
    const to = emailOf.get(it.station);
    if (!to) { missing.push({ contractId: it.contractId, person: it.station }); continue; }
    const m = mails.get(to) || { to, toName: it.station, cc: [], ccNames: [], items: [] };
    m.items.push(it);
    const oe = emailOf.get(it.owner);
    if (ccOwner && oe && oe !== to && !m.cc.includes(oe)) { m.cc.push(oe); m.ccNames.push(it.owner); }
    mails.set(to, m);
  }
  return { items, mails: [...mails.values()].sort((a, b) => b.items.length - a.items.length || a.toName.localeCompare(b.toName)), missing };
}

export function compose(m: Mail, site: string, today: string) {
  const base = site.replace(/\/*$/, "/"), link = base + "#/user";
  // each Contract ID opens that contract in the system (confidential ones on the Confidential page, sign-in decides access)
  const open = (it: Item) => `${base}#/${it.confidential ? "confidential" : "contracts"}/${encodeURIComponent(it.contractId)}`;
  const n = m.items.length;
  const subject = `[R = Overdue] ${n} contract${n > 1 ? "s" : ""} waiting for your update / สัญญาเกินกำหนด ${n} รายการ รอการอัปเดต (${fmtDate(today)})`;
  const lines = [
    `Dear ${m.toName},`, "",
    `You are the Station Owner of ${n} contract${n > 1 ? "s" : ""} with Status Update R = Overdue. Please follow up and update the status in the system.`,
    `เรียน คุณ${m.toName} มีสัญญาสถานะ R = Overdue (เกินกำหนด) ที่อยู่กับท่าน ${n} รายการ กรุณาติดตามและเข้าไป Update Status ในระบบ`, ""
  ];
  m.items.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.contractId} · ${it.name} · ${it.days} working days${it.totalSla ? ` (SLA ${it.totalSla})` : ""} · Due ${it.dueDate}`);
    lines.push(`   Latest Action: ${it.action} · Contract Owner: ${it.owner}${it.vendor !== "-" ? ` · Vendor: ${it.vendor}` : ""}`);
    lines.push(`   Open: ${open(it)}`);
  });
  lines.push("", `Update Status / อัปเดตสถานะ: ${link}`, "", "This email is sent automatically Monday to Friday while the contract is Overdue. / อีเมลนี้ส่งอัตโนมัติทุกวันจันทร์–ศุกร์ จนกว่าสัญญาจะไม่อยู่ในสถานะ Overdue");
  const rows = m.items.map(it => `<tr>
    <td style="padding:8px;border-bottom:1px solid #eceeef;vertical-align:top"><a href="${esc(open(it))}" style="color:#1667a8;font-weight:bold">${esc(it.contractId)}</a><br>
      <span style="color:#202124">${esc(it.name)}</span>${it.vendor !== "-" ? `<br><span style="color:#6f7478;font-size:12px">Vendor: ${esc(it.vendor)}</span>` : ""}</td>
    <td style="padding:8px;border-bottom:1px solid #eceeef;vertical-align:top;font-size:13px">${esc(it.action)}${it.reason !== "-" ? `<br><span style="color:#6f7478;font-size:12px">${esc(it.reason)}</span>` : ""}</td>
    <td style="padding:8px;border-bottom:1px solid #eceeef;vertical-align:top;font-size:13px">${esc(it.owner)}<br><span style="color:#6f7478;font-size:12px">${esc(it.department)}</span></td>
    <td style="padding:8px;border-bottom:1px solid #eceeef;vertical-align:top;text-align:right;white-space:nowrap"><b style="color:#c62828">${it.days} D</b>${it.totalSla ? `<br><span style="color:#6f7478;font-size:12px">SLA ${it.totalSla}</span>` : ""}</td>
    <td style="padding:8px;border-bottom:1px solid #eceeef;vertical-align:top;white-space:nowrap;font-size:13px">${esc(it.dueDate)}</td></tr>`).join("");
  const th = (t: string, right = false) => `<th style="padding:8px;text-align:${right ? "right" : "left"};font-size:11px;color:#777c80;background:#f5f6f7;border-bottom:2px solid #dde1e4">${t}</th>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#202124;max-width:820px">
  <div style="background:#fff0f0;border-left:5px solid #c62828;padding:12px 16px;margin-bottom:16px">
    <div style="font-size:18px;font-weight:bold;color:#c62828">[R] Overdue Contracts · ${n} รายการ</div>
    <div style="color:#c62828;font-size:13px">สัญญาที่เกินกำหนด รอการอัปเดตสถานะจากท่าน</div></div>
  <p>Dear ${esc(m.toName)},<br>You are the Station Owner of the contracts below with Status Update <b>R = Overdue</b>. Please follow up and update the status in the system.</p>
  <p>เรียน คุณ${esc(m.toName)}<br>สัญญาด้านล่างอยู่กับท่านและมีสถานะ <b>R = Overdue (เกินกำหนด)</b> กรุณาติดตามและเข้าไป Update Status ในระบบ</p>
  <table style="border-collapse:collapse;width:100%;margin:12px 0"><thead><tr>${th("CONTRACT")}${th("LATEST ACTION")}${th("CONTRACT OWNER")}${th("DAYS", true)}${th("DUE DATE")}</tr></thead><tbody>${rows}</tbody></table>
  <p style="margin:20px 0"><a href="${esc(link)}" style="background:#b8d433;color:#111;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Update Status / อัปเดตสถานะ</a></p>
  <p style="color:#777c80;font-size:12px">This email is sent automatically Monday to Friday while the contract is Overdue. Confidential contracts show only the Contract ID.<br>
  อีเมลนี้ส่งอัตโนมัติทุกวันจันทร์–ศุกร์ จนกว่าสัญญาจะไม่อยู่ในสถานะ Overdue · สัญญาลับแสดงเฉพาะ Contract ID</p></div>`;
  return { subject, text: lines.join("\n"), html };
}

async function withLock<T>(deps: Deps, db: any, fn: () => Promise<T>): Promise<T | null> {
  const now = (deps.now || (() => new Date()))();
  const { data, error } = await db.from("overdue_mail_settings")
    .update({ run_lock_until: new Date(now.getTime() + LOCK_MS).toISOString() })
    .eq("id", 1).or(`run_lock_until.is.null,run_lock_until.lt.${now.toISOString()}`).select("id");
  if (error) throw new HttpError(500, `overdue_mail_settings: ${error.message}`);
  if (!data?.length) return null;
  try { return await fn(); }
  finally { await db.from("overdue_mail_settings").update({ run_lock_until: null }).eq("id", 1); }
}

const siteOf = (deps: Deps) => String(deps.env("SITE_URL") || DEFAULT_SITE);

async function deliver(deps: Deps, db: any, m: Mail, requestId: string, today: string, by: string, to = m.to, cc = m.cc) {
  const from = String(deps.env("EMAIL_FROM") || "");
  if (!from) throw new Error("EMAIL_FROM secret is not set.");
  const { subject, text, html } = compose(m, siteOf(deps), today);
  const now = (deps.now || (() => new Date()))().toISOString();
  const row = { request_id: requestId, kind: KIND, to_email: to, cc, subject, body: text, attachments: [], delivery: "none",
    status: "sending", attempts: 1, sent_by_email: by, updated_at: now };
  const { error: ie } = await db.from("email_outbox").insert(row);
  if (ie) throw new Error(`email_outbox: ${ie.message}`);
  try {
    const provider = deps.provider();
    const r = await provider.send({ from, to, cc, subject, text, html, attachments: [], idempotencyKey: requestId });
    await db.from("email_outbox").update({ status: "sent", provider: provider.name, provider_message_id: r.id || null, sent_at: now, updated_at: now }).eq("request_id", requestId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("email_outbox").update({ status: "failed", error: msg.slice(0, 1000), updated_at: now }).eq("request_id", requestId);
    throw e;
  }
}

async function run(deps: Deps, db: any, source: "scheduled" | "admin", by: string) {
  const now = (deps.now || (() => new Date()))();
  const today = bkk.format(now);
  const s = await settings(db);
  const result = await withLock(deps, db, async () => {
    const { items, mails, missing } = plan(await loadAll(db), deps.createEngine, today, s.cc_contract_owner !== false);
    let list = mails;
    if (source === "scheduled") {
      const ids = mails.map(m => `overdue:${today}:${m.to}`);
      const { data } = ids.length ? await db.from("email_outbox").select("request_id").in("request_id", ids) : { data: [] };
      const done = new Set((data || []).map((r: any) => r.request_id));
      list = mails.filter(m => !done.has(`overdue:${today}:${m.to}`));
    }
    let sent = 0, failed = 0; const errors: string[] = [];
    let stop = "";
    for (const m of list) {
      if (stop) { failed++; continue; }
      const id = source === "scheduled" ? `overdue:${today}:${m.to}` : `overdue:${today}:${m.to}:admin:${now.getTime()}`;
      try { await deliver(deps, db, m, id, today, by); sent++; }
      catch (e) {
        failed++; const msg = e instanceof Error ? e.message : String(e); errors.push(`${m.to}: ${msg}`.slice(0, 600));
        // The provider refused the sign-in or the secrets are missing: every next email would fail the same way
        if (/secret is not set|sign-in|401|403/i.test(msg)) stop = msg;
      }
    }
    const summary = { source, today, overdue: items.length, emails: mails.length, sent, skipped: mails.length - list.length, failed,
      noEmail: missing.length, missing: missing.slice(0, 50), errors, runAt: now.toISOString(), by };
    await db.from("overdue_mail_settings").update({ last_run_at: now.toISOString(), last_run: summary }).eq("id", 1);
    console.log(JSON.stringify({ event: "overdue_mail", ...summary, missing: undefined }));
    return summary;
  });
  if (!result) throw new HttpError(409, "Overdue emails are being sent. Please wait a moment. / กำลังส่งอยู่ กรุณารอสักครู่");
  return { success: result.failed === 0, ...result };
}

export async function handle(payload: any, req: { auth: string; cronKey: string }, deps: Deps) {
  const db = deps.adminClient();
  const mode = String(payload?.mode || "");
  const now = (deps.now || (() => new Date()))();
  const today = bkk.format(now);

  if (mode === "scheduled") {
    const s = await settings(db);
    if (!req.cronKey || req.cronKey !== s.cron_key) throw new HttpError(401, "Invalid schedule key.");
    if (/Sat|Sun/.test(bkkWeekday.format(now))) return { success: true, skipped: "weekend" };
    if (!s.auto_enabled) return { success: true, skipped: "automatic is off" };
    const { data: hol } = await db.from("holidays").select("*").limit(1000);
    if ((hol || []).some((h: any) => h.active !== false && String(h.date || h.holiday_date || "").slice(0, 10) === today)) return { success: true, skipped: "holiday" };
    return run(deps, db, "scheduled", "schedule 09:00");
  }

  const by = await admin(deps, req.auth);
  if (mode === "status") {
    const s = await settings(db);
    return { success: true, autoEnabled: Boolean(s.auto_enabled), autoChangedBy: s.auto_changed_by, autoChangedAt: s.auto_changed_at,
      ccContractOwner: s.cc_contract_owner !== false, emailReady: Boolean(deps.env("EMAIL_FROM")),
      provider: String(deps.env("EMAIL_PROVIDER") || "resend").toLowerCase(), lastRunAt: s.last_run_at, lastRun: s.last_run };
  }
  if (mode === "preview") {
    const s = await settings(db);
    const { items, mails, missing } = plan(await loadAll(db), deps.createEngine, today, s.cc_contract_owner !== false);
    const { data: sentRows } = mails.length ? await db.from("email_outbox").select("request_id, status")
      .in("request_id", mails.map(m => `overdue:${today}:${m.to}`)) : { data: [] };
    const sentToday = new Set((sentRows || []).filter((r: any) => r.status === "sent").map((r: any) => r.request_id));
    return { success: true, dryRun: true, today, overdue: items.length, missing,
      emails: mails.map(m => ({ ...m, ...compose(m, siteOf(deps), today), sentToday: sentToday.has(`overdue:${today}:${m.to}`) })) };
  }
  if (mode === "sendTest") {
    // One sample to the Admin only: the first email of today's list, addressed to the Admin, with no CC
    const s = await settings(db);
    const { mails } = plan(await loadAll(db), deps.createEngine, today, s.cc_contract_owner !== false);
    if (!mails.length) throw new HttpError(400, "No R = Overdue contract with a Station Owner email today.");
    const pick = mails.find(m => m.to === String(payload.to || "").toLowerCase()) || mails[0];
    await deliver(deps, db, pick, `overdue:${today}:test:${by}:${now.getTime()}`, today, by, by, []);
    return { success: true, sentTo: by, sample: pick.to, contracts: pick.items.length };
  }
  if (mode === "send") return run(deps, db, "admin", by);
  if (mode === "setAuto") {
    const enabled = payload.enabled === true;
    const { error } = await db.from("overdue_mail_settings").update({ auto_enabled: enabled, auto_changed_by: by, auto_changed_at: now.toISOString() }).eq("id", 1);
    if (error) throw new HttpError(500, `overdue_mail_settings: ${error.message}`);
    return { success: true, autoEnabled: enabled };
  }
  if (mode === "setCcOwner") {
    const { error } = await db.from("overdue_mail_settings").update({ cc_contract_owner: payload.enabled === true }).eq("id", 1);
    if (error) throw new HttpError(500, `overdue_mail_settings: ${error.message}`);
    return { success: true, ccContractOwner: payload.enabled === true };
  }
  throw new HttpError(400, "Unknown mode.");
}
