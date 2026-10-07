// Sends the status emails through the Supabase Edge Function "send-email" (supabase/functions/send-email).
// The page never holds an email key: the function checks the signed-in user (Level 2+), reads the attachments
// from Storage as that user, and sends through the provider set in Supabase secrets.
//  - Every email has a requestId made when the dialog opens. Sending it again (Retry, double click, lost reply)
//    returns the first result from public.email_outbox instead of sending a second email.
//  - Demo mode (no Supabase) only simulates the send.
(function () {
  const newId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
  const demo = () => window.Store?.mode === "demo";
  window.Mailer = {
    configured: () => Boolean(window.Store),
    isDemo: demo,
    newId,
    async sendEmail(payload) {
      const r = await window.Store.sendEmail({ mode: "sendStatusEmail", ...payload });
      if (!r || r.success === false) throw new Error(r?.error || "Send failed");
      return r;
    }
  };
})();
