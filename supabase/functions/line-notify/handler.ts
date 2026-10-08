// line-notify: LINE notification of Y=Delayed and R=Overdue contracts to the group "T23_Tracking Contract".
// Requests:
//   { mode: "status" | "preview" | "send" | "setAuto", enabled? }  from Admin Tools (Level 4-5, signed in)
//   { mode: "scheduled" } + header x-cron-key                       from pg_cron, Mon-Fri 09:30 Asia/Bangkok
//   LINE webhook (body has "events", URL has ?key=LINE_WEBHOOK_KEY)   remembers the group id when the bot is in a group
// Rules (same as the Production system):
//   * Status Update from the shared SLA engine (Total SLA vs working days since Add Case Date); only Y and R are sent,
//     so the queue is exactly the Y + R of the Admin Dashboard
//   * Scheduled run: a contract is sent at most once per day (line_notifications), and only when Automatic is On
//   * Admin Send Now: sends every Y / R again (resend allowed)
//   * One run at a time (line_settings.run_lock_until)
// No token is ever sent to the browser: LINE_CHANNEL_ACCESS_TOKEN, LINE_GROUP_ID, LINE_WEBHOOK_KEY are Supabase secrets.
import { buildPushes, shown, type Candidate } from "./flex.ts";

export type Env = (name: string) => string | undefined;
export interface Deps {
  env: Env;
  userClient(authHeader: string): any;
  adminClient(): any;
  createEngine(getDb: () => any): any;
  fetch: typeof fetch;
  now?: () => Date;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export const GROUP_NAME = "T23_Tracking Contract";
const ADMIN_ROLES = ["admin", "root"];
const LOCK_MS = 3 * 60 * 1000;
const bkk = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
const bkkWeekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", weekday: "short" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (s: unknown) => { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "-"; };
const isConfidential = (c: any) => c.access_level === "Confidential" || /^confidential/i.test(String(c.classification || ""));

async function admin(deps: Deps, authHeader: string) {
  if (!/^Bearer\s+\S+/.test(authHeader || "")) throw new HttpError(401, "Not signed in.");
  const client = deps.userClient(authHeader);
  const { data: u, error: ue } = await client.auth.getUser();
  if (ue || !u?.user) throw new HttpError(401, "Session expired. Please sign in again.");
  const { data: rows, error } = await client.rpc("my_access");
  const me = Array.isArray(rows) ? rows[0] : rows;
  if (error || !me || me.active === false || !ADMIN_ROLES.includes(String(me.role))) throw new HttpError(403, "LINE Notification is for Level 4-5 only.");
  return String(me.email || u.user.email || "").toLowerCase();
}

async function settings(db: any) {
  const { data, error } = await db.from("line_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new HttpError(500, `line_settings: ${error.message} (run 014_line_notify.sql)`);
  if (!data) throw new HttpError(500, "line_settings is empty (run 014_line_notify.sql)");
  return data;
}

const groupId = (deps: Deps, s: any) => String(deps.env("LINE_GROUP_ID") || s.group_id || "").trim();

async function loadAll(db: any) {
  const table = async (name: string, optional = false) => {
    const { data, error } = await db.from(name).select("*").limit(20000);
    if (error) { if (optional) return []; throw new HttpError(500, `${name}: ${error.message}`); }
    return data || [];
  };
  const [contracts, contract_logs, action_sla, contract_types, holidays] = await Promise.all([
    table("contracts"), table("contract_logs"), table("action_sla"), table("contract_types"), table("holidays", true)]);
  return { contracts, contract_logs, action_sla, contract_types, holidays };
}

// Every open contract whose Status Update is Y or R today, from the same engine as the Dashboard
export function queue(data: any, createEngine: Deps["createEngine"], today: string) {
  const engine = createEngine(() => data);
  const out: Candidate[] = [];
  const counts = { G: 0, Y: 0, R: 0, C: 0, X: 0, N: 0 } as Record<string, number>;
  const seen = new Set<string>();
  for (const c of data.contracts) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const st = engine.contractState(c, today);
    counts[st.code] = (counts[st.code] || 0) + 1;
    if (st.code !== "Y" && st.code !== "R") continue;
    out.push({
      contractId: c.id, statusCode: st.code, ownerName: String(c.owner || "").trim() || "Unassigned",
      contractName: c.name || "", confidential: isConfidential(c), pendingDays: st.acc, totalSla: st.totalSla,
      dueDate: fmtDate(c.due_date), vendor: c.vendor || "", action: st.action || "-", reason: st.reason || ""
    });
  }
  out.sort((a, b) => (a.statusCode === b.statusCode ? 0 : a.statusCode === "R" ? -1 : 1) || b.pendingDays - a.pendingDays || a.contractId.localeCompare(b.contractId));
  return { candidates: out, counts };
}

async function sentToday(db: any, today: string) {
  const { data, error } = await db.from("line_notifications").select("contract_id, source, sent_at").eq("sent_on", today);
  if (error) throw new HttpError(500, `line_notifications: ${error.message}`);
  return data || [];
}

// Rows for the Admin window (no LINE call)
function previewRows(candidates: Candidate[], sent: any[]) {
  const auto = new Set(sent.filter(r => r.source === "scheduled").map(r => r.contract_id));
  return candidates.map(c => {
    const s = shown(c);
    return {
      contractId: c.contractId, contractName: s.name, owner: c.ownerName, target: GROUP_NAME, statusCode: c.statusCode,
      day: c.pendingDays, totalSla: c.totalSla, dueDate: c.dueDate, action: c.action, confidential: c.confidential,
      message: `[${c.statusCode}] ${c.statusCode === "R" ? "Overdue" : "Delayed"} · ${c.pendingDays} working days${c.totalSla ? ` (SLA ${c.totalSla})` : ""}`,
      sentToday: auto.has(c.contractId)
    };
  });
}

async function push(deps: Deps, to: string, messages: unknown[]) {
  const token = String(deps.env("LINE_CHANNEL_ACCESS_TOKEN") || "").trim();
  if (!token) throw new HttpError(500, "LINE_CHANNEL_ACCESS_TOKEN secret is not set.");
  const res = await deps.fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages })
  });
  if (!res.ok) throw new Error(`LINE Messaging API returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function withLock<T>(deps: Deps, db: any, fn: () => Promise<T>): Promise<T | null> {
  const now = (deps.now || (() => new Date()))();
  const { data, error } = await db.from("line_settings")
    .update({ run_lock_until: new Date(now.getTime() + LOCK_MS).toISOString() })
    .eq("id", 1).or(`run_lock_until.is.null,run_lock_until.lt.${now.toISOString()}`).select("id");
  if (error) throw new HttpError(500, `line_settings: ${error.message}`);
  if (!data?.length) return null;
  try { return await fn(); }
  finally { await db.from("line_settings").update({ run_lock_until: null }).eq("id", 1); }
}

async function run(deps: Deps, db: any, source: "scheduled" | "admin", by: string) {
  const now = (deps.now || (() => new Date()))();
  const today = bkk.format(now);
  const s = await settings(db);
  const to = groupId(deps, s);
  if (!to) throw new HttpError(400, "No LINE group yet: set LINE_GROUP_ID, or add the bot to the group and send a message there.");
  const result = await withLock(deps, db, async () => {
    const { candidates, counts } = queue(await loadAll(db), deps.createEngine, today);
    const already = new Set((await sentToday(db, today)).filter(r => r.source === "scheduled").map(r => r.contract_id));
    // Scheduled: at most once per contract per day; Admin Send Now: everything again
    const list = source === "scheduled" ? candidates.filter(c => !already.has(c.contractId)) : candidates;
    let sent = 0, failed = 0; const errors: string[] = [];
    for (const p of buildPushes(list)) {
      try {
        await push(deps, to, p.messages);
        sent += p.items.length;
        const rows = p.items.map(c => ({ contract_id: c.contractId, sent_on: today, status_code: c.statusCode, source, sent_by: by }));
        const { error } = await db.from("line_notifications").insert(rows);
        if (error) errors.push(`line_notifications: ${error.message}`);
      } catch (e) {
        failed += p.items.length; errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    const summary = { source, today, queue: candidates.length, y: counts.Y, r: counts.R, sent, skipped: candidates.length - list.length, failed, errors, runAt: now.toISOString(), by };
    await db.from("line_settings").update({ last_run_at: now.toISOString(), last_run: summary }).eq("id", 1);
    console.log(JSON.stringify({ event: "line_notify", ...summary }));
    return summary;
  });
  if (!result) throw new HttpError(409, "A LINE notification is being sent. Please wait a moment. / กำลังส่งอยู่ กรุณารอสักครู่");
  return { success: result.failed === 0, ...result };
}

async function webhook(deps: Deps, db: any, payload: any, key: string) {
  const expected = String(deps.env("LINE_WEBHOOK_KEY") || "").trim();
  if (!expected || key !== expected) throw new HttpError(401, "Invalid LINE webhook key.");
  const ids = (payload.events || []).map((e: any) => e?.source?.type === "group" ? String(e.source.groupId || "") : "").filter(Boolean);
  if (ids.length) await db.from("line_settings").update({ group_id: ids[ids.length - 1], group_captured_at: new Date().toISOString() }).eq("id", 1);
  return { success: true, received: (payload.events || []).length, groupCaptured: ids.length > 0 };
}

export async function handle(payload: any, req: { auth: string; cronKey: string; webhookKey: string }, deps: Deps) {
  const db = deps.adminClient();
  if (payload && Array.isArray(payload.events)) return webhook(deps, db, payload, req.webhookKey);
  const mode = String(payload?.mode || "");

  if (mode === "scheduled") {
    const s = await settings(db);
    if (!req.cronKey || req.cronKey !== s.cron_key) throw new HttpError(401, "Invalid schedule key.");
    const now = (deps.now || (() => new Date()))();
    if (/Sat|Sun/.test(bkkWeekday.format(now))) return { success: true, skipped: "weekend" };
    if (!s.auto_enabled) return { success: true, skipped: "automatic is off" };
    return run(deps, db, "scheduled", "schedule 09:30");
  }

  const by = await admin(deps, req.auth);
  if (mode === "status") {
    const s = await settings(db);
    return {
      success: true, groupName: GROUP_NAME, tokenSet: Boolean(deps.env("LINE_CHANNEL_ACCESS_TOKEN")),
      groupSet: Boolean(groupId(deps, s)), groupSource: deps.env("LINE_GROUP_ID") ? "secret" : s.group_id ? "webhook" : "none",
      groupCapturedAt: s.group_captured_at, webhookKeySet: Boolean(deps.env("LINE_WEBHOOK_KEY")),
      autoEnabled: Boolean(s.auto_enabled), lastRunAt: s.last_run_at, lastRun: s.last_run
    };
  }
  if (mode === "preview") {
    const today = bkk.format((deps.now || (() => new Date()))());
    const { candidates, counts } = queue(await loadAll(db), deps.createEngine, today);
    return { success: true, dryRun: true, today, counts, queue: candidates.length, rows: previewRows(candidates, await sentToday(db, today)),
      // The exact LINE messages a send would push now (already masked); drawn by assets/line-flex-view.js
      messages: buildPushes(candidates).map(p => p.messages) };
  }
  if (mode === "send") return run(deps, db, "admin", by);
  if (mode === "setAuto") {
    const { error } = await db.from("line_settings").update({ auto_enabled: payload.enabled === true }).eq("id", 1);
    if (error) throw new HttpError(500, error.message);
    return { success: true, autoEnabled: payload.enabled === true };
  }
  throw new HttpError(400, "Unknown mode.");
}
