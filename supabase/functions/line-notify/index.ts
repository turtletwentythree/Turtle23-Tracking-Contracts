// Supabase Edge Function "line-notify". Deploy: supabase functions deploy line-notify --no-verify-jwt
// (Admin Tools sends the signed-in session, pg_cron sends x-cron-key, LINE sends ?key=; each is checked inside).
// Secrets: LINE_CHANNEL_ACCESS_TOKEN, LINE_GROUP_ID (or captured by the webhook), LINE_WEBHOOK_KEY; optional ALLOWED_ORIGIN.
// Setup: README-TH.md. The Y / R rules come from ../_shared/sla-engine.js, the same file the website uses.
import { createClient } from "jsr:@supabase/supabase-js@2";
import "../_shared/sla-engine.js";
import { handle, HttpError } from "./handler.ts";

const env = (name: string) => Deno.env.get(name);
const url = env("SUPABASE_URL")!;
const firstKey = (json?: string) => { try { const o = JSON.parse(json || "{}"); return o.default || Object.values(o)[0] as string; } catch (_) { return undefined; } };
const anonKey = env("SUPABASE_ANON_KEY") || firstKey(env("SUPABASE_PUBLISHABLE_KEYS"))!;
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") || firstKey(env("SUPABASE_SECRET_KEYS"))!;

function cors(req: Request) {
  const allowed = (env("ALLOWED_ORIGIN") || "https://turtletwentythree.github.io").split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

Deno.serve(async req => {
  const headers = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ success: false, error: "POST only" }), { status: 405, headers });
  try {
    const payload = await req.json().catch(() => { throw new HttpError(400, "Body must be JSON."); });
    const out = await handle(payload, {
      auth: req.headers.get("Authorization") || "",
      cronKey: req.headers.get("x-cron-key") || "",
      webhookKey: new URL(req.url).searchParams.get("key") || ""
    }, {
      env,
      userClient: auth => createClient(url, anonKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }),
      adminClient: () => createClient(url, serviceKey, { auth: { persistSession: false } }),
      // deno-lint-ignore no-explicit-any
      createEngine: getDb => (globalThis as any).SlaEngine.create(getDb, { warn: () => {} }),
      fetch
    });
    return new Response(JSON.stringify(out), { headers });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }), { status, headers });
  }
});
