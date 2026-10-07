// Talks to the Google Apps Script web app (apps-script/Code.gs) that sends the status emails through Gmail.
// Attachments are not stored by the script: they live in Supabase Storage, and the email carries copies
// (Base64) or, when they are too large for Gmail, links back to the system.
//  - APP_CONFIG.APPS_SCRIPT_URL is the web app's /exec URL (set from the APPS_SCRIPT_URL repository secret).
//  - Each call carries the signed-in user's session token; the script checks it with Supabase (Level 2+).
//  - Every request has a requestId: sending the same request again returns the first result instead of redoing it.
//  - The reply is read directly when the browser allows it; otherwise the result is fetched with a status lookup.
(function () {
  const url = () => {
    const u = String((window.APP_CONFIG || {}).APPS_SCRIPT_URL || "").trim();
    return /^https:\/\/script\.google(usercontent)?\.com\//.test(u) ? u : "";
  };
  const demo = () => window.Store?.mode === "demo" && !url();
  const newId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.toUpperCase();

  function blobToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error(`อ่านไฟล์ไม่สำเร็จ: ${file.name || "attachment"}`));
      reader.readAsDataURL(file);
    });
  }

  function jsonp(params, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const cb = `t23cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const done = () => { clearTimeout(timer); delete window[cb]; script.remove(); };
      const timer = setTimeout(() => { done(); reject(new Error("timeout")); }, timeoutMs);
      window[cb] = data => { done(); resolve(data || {}); };
      script.onerror = () => { done(); reject(new Error("network")); };
      script.src = `${url()}?${new URLSearchParams({ ...params, callback: cb, t: Date.now() })}`;
      document.head.appendChild(script);
    });
  }

  async function waitForResult(requestId, timeoutMs = 180000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const r = await jsonp({ mode: "status", requestId }).catch(() => null);
      if (r && (r.state === "done" || r.state === "failed" || r.success === false)) return r;
      await new Promise(res => setTimeout(res, 1500));
    }
    throw new Error("ไม่ได้รับผลยืนยันจาก Apps Script กรุณากดลองใหม่ (ระบบจะไม่ส่งซ้ำ)");
  }

  async function post(body) {
    if (!url()) throw new Error("ยังไม่ได้ตั้งค่า Apps Script (APPS_SCRIPT_URL) จึงส่งอีเมลไม่ได้");
    body = { ...body, accessToken: await window.Store.accessToken() };
    const text = JSON.stringify(body);
    let result = null;
    try {
      // text/plain keeps this a simple request (no preflight), which Apps Script accepts
      const res = await fetch(url(), { method: "POST", body: text, headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow" });
      result = await res.json();
    } catch (e) {
      // The reply could not be read (blocked by the browser or a lost connection): send again without reading,
      // the script answers a repeated requestId from its record instead of doing the work twice
      await fetch(url(), { method: "POST", mode: "no-cors", body: text, headers: { "Content-Type": "text/plain;charset=utf-8" } }).catch(() => {});
    }
    // Anything that is not a finished answer is looked up by requestId
    if (!result || (result.state !== "done" && result.success !== false)) result = await waitForResult(body.requestId);
    if (!result || result.success === false) throw new Error(result?.error || "Apps Script error");
    return result;
  }

  window.Mailer = {
    configured: () => Boolean(url()) || demo(),
    isDemo: demo,
    newId,
    health: () => url() ? jsonp({ mode: "health" }).catch(() => ({ state: "unreachable" })) : Promise.resolve({ state: demo() ? "demo" : "not-configured" }),
    blobToBase64,
    async sendEmail(payload) {
      if (demo()) return { sent: true, demo: true, sentAt: new Date().toISOString() };
      return post({ mode: "sendStatusEmail", ...payload });
    }
  };
})();
