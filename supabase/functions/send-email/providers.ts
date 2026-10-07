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

// Microsoft Graph sendMail: an Entra app with the Mail.Send application permission (admin consent),
// MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, and MS_SENDER (the mailbox that sends, e.g. contract@turtle23.com)
export function graph(env: Env, http: typeof fetch = fetch): Provider {
  return {
    name: "graph",
    maxAttachBytes: 3 * 1024 * 1024, // one sendMail request is limited to about 4 MB
    async send(m: Mail) {
      const tokenRes = await http(`https://login.microsoftonline.com/${encodeURIComponent(need(env, "MS_TENANT_ID"))}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: need(env, "MS_CLIENT_ID"), client_secret: need(env, "MS_CLIENT_SECRET"),
          scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" })
      });
      if (!tokenRes.ok) throw new Error(`Microsoft sign-in ${tokenRes.status}: ${await failText(tokenRes)}`);
      const { access_token } = await tokenRes.json();
      const addr = (address: string) => ({ emailAddress: { address } });
      const res = await http(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(need(env, "MS_SENDER"))}/sendMail`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ saveToSentItems: true, message: {
          subject: m.subject, body: { contentType: "HTML", content: m.html },
          toRecipients: [addr(m.to)], ccRecipients: m.cc.map(addr), ...(m.replyTo ? { replyTo: [addr(m.replyTo)] } : {}),
          attachments: m.attachments.map(a => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.fileName, contentType: a.mimeType, contentBytes: toBase64(a.content) }))
        } })
      });
      if (res.status !== 202 && !res.ok) throw new Error(`Microsoft Graph ${res.status}: ${await failText(res)}`);
      return { id: res.headers.get("request-id") || "" };
    }
  };
}

export function pickProvider(env: Env, http: typeof fetch = fetch): Provider {
  const name = String(env("EMAIL_PROVIDER") || "resend").toLowerCase();
  if (name === "graph") return graph(env, http);
  if (name === "resend") return resend(env, http);
  throw new Error(`Unknown EMAIL_PROVIDER: ${name}`);
}
