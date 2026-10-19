// Supabase Edge Function "user-password". Deploy: supabase functions deploy user-password --no-verify-jwt
// (the signed-in Admin session is checked inside). Optional secrets: EMAIL_DOMAIN (staff domain, default turtle23.com),
// ALLOWED_ORIGIN. Setup: README-TH.md.
import { createClient } from "jsr:@supabase/supabase-js@2";
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
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") || "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

Deno.serve(async req => {
  const headers = { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ success: false, error: "POST only" }), { status: 405, headers });
  try {
    const payload = await req.json().catch(() => { throw new HttpError(400, "Body must be JSON."); });
    const out = await handle(payload, { auth: req.headers.get("Authorization") || "" }, {
      env,
      userClient: auth => createClient(url, anonKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }),
      adminClient: () => createClient(url, serviceKey, { auth: { persistSession: false } })
    });
    return new Response(JSON.stringify(out), { headers });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }), { status, headers });
  }
});
