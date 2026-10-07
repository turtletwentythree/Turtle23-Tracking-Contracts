// Supabase Edge Function "send-email". Deploy: supabase functions deploy send-email --no-verify-jwt
// (the session is checked inside, which also works with the new publishable / secret API keys).
// Secrets: EMAIL_FROM + RESEND_API_KEY, or EMAIL_PROVIDER=graph + MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER;
// optional SITE_URL, ALLOWED_ORIGIN, MAX_ATTACH_MB. Setup: README-TH.md (Resend) or MS365-SETUP-TH.md (Microsoft 365).
// SUPABASE_URL and the project keys are provided by Supabase automatically.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle, HttpError } from "./handler.ts";
import { pickProvider } from "./providers.ts";

const env = (name: string) => Deno.env.get(name);
const url = env("SUPABASE_URL")!;
// Legacy anon / service_role keys, or the new publishable / secret keys when the legacy ones are turned off
const firstKey = (json?: string) => { try { const o = JSON.parse(json || "{}"); return o.default || Object.values(o)[0] as string; } catch (_) { return undefined; } };
const anonKey = env("SUPABASE_ANON_KEY") || firstKey(env("SUPABASE_PUBLISHABLE_KEYS"))!;
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") || firstKey(env("SUPABASE_SECRET_KEYS"))!;

function cors(req: Request) {
  const allowed = (env("ALLOWED_ORIGIN") || "https://turtletwentythree.github.io").split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const out = await handle(payload, req.headers.get("Authorization") || "", {
      env,
      userClient: auth => createClient(url, anonKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }),
      adminClient: () => createClient(url, serviceKey, { auth: { persistSession: false } }),
      provider: pickProvider(env)
    });
    return new Response(JSON.stringify(out), { headers });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return new Response(JSON.stringify({ success: false, state: "failed", error: e instanceof Error ? e.message : String(e) }), { status, headers });
  }
});
