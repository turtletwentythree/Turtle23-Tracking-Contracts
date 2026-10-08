// Data layer: one interface, two back ends.
//  - SupabaseStore: real database + Supabase Auth (when APP_CONFIG has a URL and anon key)
//  - LocalStore:    demo mode, seeded from SEED_DATA and kept in localStorage
(function () {
  const TABLES = ["contracts", "contract_logs", "departments", "people", "contract_types", "action_sla", "due_date_requests", "user_access", "profiles", "entra_role_mappings", "access_audit"];
  const KEYS = {
    contracts: "id", contract_logs: "id", departments: "name", people: "name",
    contract_types: "id", action_sla: "action", due_date_requests: "id",
    user_access: "email", profiles: "id", entra_role_mappings: "claim_value", access_audit: "id",
    contract_templates: "id", log_view_columns: "section,key", master_audit: "id"
  };
  // Loaded when the database has them (005, 007, 008); without them the app keeps working
  const OPTIONAL = ["contract_templates", "log_view_columns", "master_audit"];
  const BUCKET = "attachments";
  // Master tables and logs that remember hand edits (008_master_data.sql, 009_log_edit.sql): locked rows are skipped by Import
  const TRACKED = ["departments", "people", "contract_types", "action_sla", "contract_templates", "log_view_columns", "contract_logs"];
  // A row's key as text; "section,key" style keys join their parts
  const keyOf = (table, r) => KEYS[table].split(",").map(k => String(r[k] ?? "")).join("|");
  const matchKey = (table, key) => typeof key === "object" ? key : { [KEYS[table]]: key };
  const ROLES = {
    viewer: { level: 1, label: "Viewer", nameEn: "Contract Viewer", nameTh: "ผู้ดูข้อมูลสัญญา" },
    user: { level: 2, label: "User", nameEn: "Contract User", nameTh: "ผู้ดำเนินการสัญญา" },
    confidential: { level: 3, label: "Confidential", nameEn: "Confidential User", nameTh: "ผู้ดำเนินการสัญญาลับ" },
    admin: { level: 4, label: "Admin", nameEn: "System Administrator", nameTh: "ผู้ดูแลระบบ" },
    root: { level: 5, label: "Root", nameEn: "Root System Administrator", nameTh: "ผู้ดูแลระบบสูงสุด" }
  };

  function safeStorage() {
    try { const k = "__t"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return localStorage; }
    catch (e) { const mem = {}; return { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } }; }
  }
  const storage = safeStorage();

  // ───────────── Demo / local store ─────────────
  class LocalStore {
    constructor() { this.mode = "demo"; this.key = "ct-demo-db-v5"; this.sessionKey = "ct-demo-session-v1"; }
    async init() {
      const raw = storage.getItem(this.key);
      this.db = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(window.SEED_DATA));
      [...TABLES, ...OPTIONAL].forEach(t => { this.db[t] = this.db[t] || []; });
      this.db.contract_logs.forEach((r, i) => { if (r.id == null) r.id = i + 1; });
      this.persist();
    }
    persist() { storage.setItem(this.key, JSON.stringify(this.db)); }
    nextId(table) { return this.db[table].reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1; }
    async signIn(username, password) {
      // Demo: any email listed in Users & Roles can sign in; its Access Level decides the rights
      let email = String(username || "").trim().toLowerCase();
      if (email && !email.includes("@")) email = `${email}@${(window.APP_CONFIG || {}).EMAIL_DOMAIN || "turtle23.com"}`;
      const acc = this.db.user_access.find(a => a.email === email);
      if (!acc) throw new Error(`ไม่พบบัญชี ${email} ใน Users & Roles`);
      if (acc.active === false) throw new Error(`บัญชี ${email} ถูกระงับสิทธิ์ กรุณาติดต่อผู้ดูแลระบบ`);
      if (password !== "demo1234") throw new Error("รหัสผ่านไม่ถูกต้อง (โหมดสาธิตใช้ demo1234)");
      const user = { id: email, email, username: email, display_name: acc.display_name || email, role: acc.role };
      storage.setItem(this.sessionKey, JSON.stringify(user));
      return user;
    }
    async signInMicrosoft() { throw new Error("โหมดสาธิตยังไม่ได้เชื่อม Microsoft 365 กรุณาใช้บัญชีทดลองด้านล่าง"); }
    async currentUser() {
      const raw = storage.getItem(this.sessionKey); if (!raw) return null;
      const u = JSON.parse(raw), acc = this.db.user_access.find(a => a.email === u.email);
      if (!acc || acc.active === false) { storage.removeItem(this.sessionKey); return null; }
      return { ...u, role: acc.role, display_name: acc.display_name || u.display_name };
    }
    async signOut() { await this.leavePresence(); storage.removeItem(this.sessionKey); }
    async loadAll() { return JSON.parse(JSON.stringify(this.db)); }
    async insert(table, row) {
      const r = { ...row };
      if (KEYS[table] === "id" && r.id == null) r.id = this.nextId(table);
      (this.db[table] = this.db[table] || []).push(r); this.persist(); return r;
    }
    async accessToken() { return ""; }
    // Demo: attachments stay in this browser tab only (nothing is uploaded)
    async uploadAttachment(path, file) { (this.files = this.files || {})[path] = file; return { path, demo: true }; }
    async signedUrl(path) { const f = (this.files || {})[path]; return f ? URL.createObjectURL(f) : ""; }
    // Demo: nothing is sent; the request is kept so the page can be checked
    async sendEmail(payload) {
      (this.outbox = this.outbox || {});
      if (this.outbox[payload.requestId]) return { ...this.outbox[payload.requestId], duplicate: true };
      return (this.outbox[payload.requestId] = { success: true, state: "done", sent: true, demo: true, sentAt: new Date().toISOString() });
    }
    // Admins (Level 4-5) who approve Due Date requests
    // On/Off switches (015_app_switch.sql); demo keeps them in the browser
    // Online users (017_user_presence.sql); demo keeps heartbeats in this browser, so other demo tabs show up too
    presence() { try { return JSON.parse(storage.getItem("t23-demo-presence") || "{}"); } catch (e) { return {}; } }
    async touchPresence(page) {
      const me = await this.currentUser(); if (!me) return false;
      const lv = (window.ROLES[me.role] || {}).level || 1, open = (await this.appStatus()).app_open !== false;
      const all = this.presence(), now = new Date().toISOString(), old = all[me.email];
      if (lv < 4 && !open) { delete all[me.email]; storage.setItem("t23-demo-presence", JSON.stringify(all)); return false; }
      all[me.email] = { page, last_seen_at: now, started_at: old && Date.now() - new Date(old.last_seen_at) < 600000 ? old.started_at : now };
      storage.setItem("t23-demo-presence", JSON.stringify(all)); return true;
    }
    async leavePresence() {
      const email = JSON.parse(storage.getItem(this.sessionKey) || "{}").email; if (!email) return;
      const all = this.presence(); delete all[email]; storage.setItem("t23-demo-presence", JSON.stringify(all));
    }
    async onlineUsers(minutes = 3) {
      const open = (await this.appStatus()).app_open !== false, since = Date.now() - minutes * 60000;
      return Object.entries(this.presence()).map(([email, p]) => ({ email, ...p, acc: this.db.user_access.find(a => a.email === email) }))
        .filter(x => x.acc && x.acc.active !== false && new Date(x.last_seen_at) > since && (open || ((window.ROLES[x.acc.role] || {}).level || 1) >= 4))
        .map(x => ({ email: x.email, display_name: x.acc.display_name, role: x.acc.role, department: x.acc.department, page: x.page, last_sign_in_at: null, started_at: x.started_at, last_seen_at: x.last_seen_at }))
        .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
    }
    async appStatus() { return { app_open: true, ...(this.db.app_settings || [])[0] }; }
    async setAppOpen(open, message) {
      this.db.app_settings = [{ app_open: open, closed_message: open ? null : (message || null), changed_by: JSON.parse(storage.getItem(this.sessionKey) || "{}").email, changed_at: new Date().toISOString() }];
      this.persist();
    }
    async lineAutoStatus() { return { auto_enabled: false, sending_enabled: true, ...(this.db.line_settings || [])[0] }; }
    async setLineSending(enabled) {
      this.db.line_settings = [{ ...(this.db.line_settings || [])[0], sending_enabled: enabled, sending_changed_by: JSON.parse(storage.getItem(this.sessionKey) || "{}").email, sending_changed_at: new Date().toISOString() }];
      this.persist();
    }
    async setLineAuto(enabled) {
      this.db.line_settings = [{ ...(this.db.line_settings || [])[0], auto_enabled: enabled, auto_changed_by: JSON.parse(storage.getItem(this.sessionKey) || "{}").email, auto_changed_at: new Date().toISOString() }];
      this.persist();
    }
    async approvers() { return this.db.user_access.filter(u => u.active !== false && (u.role === "admin" || u.role === "root")).map(u => ({ email: u.email, display_name: u.display_name })); }
    async update(table, key, patch) {
      const k = KEYS[table];
      const r = this.db[table].find(x => String(x[k]) === String(key));
      if (!r) throw new Error("ไม่พบข้อมูล");
      Object.assign(r, patch); this.persist(); return r;
    }
    // Demo stand-in for the database triggers in 003_entra_roles.sql: audit trail,
    // "manual" source on admin edits, and never losing the last active Admin.
    guardAccess(before, change) {
      const snapshot = JSON.parse(JSON.stringify(before));
      change();
      const isAdmin = u => (u.role === "admin" || u.role === "root") && u.active !== false;
      if (snapshot.some(isAdmin) && !this.db.user_access.some(isAdmin)) {
        this.db.user_access = snapshot;
        throw new Error("ต้องมี Admin (Level 4 หรือ 5) ที่ใช้งานอยู่อย่างน้อย 1 บัญชี");
      }
      // Only Level 5 grants or removes Level 5 (until the first Root exists), like guard_root_role() in 006
      const me = snapshot.find(u => u.email === (JSON.parse(storage.getItem(this.sessionKey) || "{}").email));
      const rootBefore = snapshot.some(u => u.role === "root" && u.active !== false);
      const touched = this.db.user_access.filter(n => { const o = snapshot.find(x => x.email === n.email); return (n.role === "root" || o?.role === "root") && JSON.stringify(o) !== JSON.stringify(n); })
        .concat(snapshot.filter(o => o.role === "root" && !this.db.user_access.some(n => n.email === o.email)));
      if (touched.length && rootBefore && me?.role !== "root") {
        this.db.user_access = snapshot;
        throw new Error("เฉพาะ Root System Administrator (Level 5) เท่านั้นที่ให้หรือถอดสิทธิ์ Level 5 ได้");
      }
      const by = (JSON.parse(storage.getItem(this.sessionKey) || "{}").email) || "system";
      const now = new Date().toISOString();
      const log = r => this.db.access_audit.push({ id: this.nextId("access_audit"), changed_by: by, changed_at: now, ...r });
      const after = this.db.user_access;
      after.forEach(n => {
        const o = snapshot.find(x => x.email === n.email);
        if (!o) log({ email: n.email, action: "added", new_role: n.role, new_active: n.active !== false, source: n.source || "manual" });
        else if (o.role !== n.role || (o.active !== false) !== (n.active !== false)) {
          n.source = "manual";
          log({ email: n.email, action: "changed", old_role: o.role, new_role: n.role, old_active: o.active !== false, new_active: n.active !== false, source: "manual" });
        }
      });
      snapshot.filter(o => !after.some(n => n.email === o.email)).forEach(o => log({ email: o.email, action: "removed", old_role: o.role, old_active: o.active !== false, source: o.source }));
    }
    async remove(table, key) {
      const k = KEYS[table];
      if (table === "user_access") {
        this.guardAccess(this.db.user_access, () => { this.db.user_access = this.db.user_access.filter(x => x.email !== key); });
        return this.persist();
      }
      const m = matchKey(table, key);
      const gone = this.db[table].filter(x => Object.entries(m).every(([f, v]) => String(x[f]) === String(v)));
      this.db[table] = this.db[table].filter(x => !gone.includes(x));
      if (TRACKED.includes(table)) gone.forEach(r => this.audit(table, "delete", r, null));
      if (table === "contracts") {
        this.db.contract_logs = this.db.contract_logs.filter(x => x.contract_id !== key);
        this.db.due_date_requests = this.db.due_date_requests.filter(x => x.contract_id !== key);
      }
      this.persist();
    }
    async upsertMany(table, rows) {
      const k = KEYS[table];
      if (table === "user_access") {
        this.guardAccess(this.db.user_access, () => { this.db.user_access = JSON.parse(JSON.stringify(this.db.user_access)); this.applyRows(table, k, rows); });
        return this.persist();
      }
      this.applyRows(table, k, rows);
      this.persist();
    }
    applyRows(table, k, rows) {
      this.db[table] = this.db[table] || [];
      rows.forEach(row => {
        let r = { ...row };
        if (k === "id" && (r.id == null || r.id === "")) r.id = this.nextId(table);
        const i = this.db[table].findIndex(x => keyOf(table, x) === keyOf(table, r));
        const old = i >= 0 ? this.db[table][i] : null;
        r = { ...(old || {}), ...r };
        if (TRACKED.includes(table)) {
          // Same rule as master_track() in 008: a hand edit locks the row; changing only the lock keeps it as set
          const strip = o => { const { locked, edited_by, edited_at, ...rest } = o || {}; return JSON.stringify(rest); };
          if (old && strip(old) === strip(r)) { if (Boolean(old.locked) === Boolean(r.locked)) return; }
          else {
            r.edited_by = this.who(); r.edited_at = new Date().toISOString();
            if (!old || Boolean(old.locked) === Boolean(r.locked)) r.locked = true;
          }
          this.audit(table, old ? "update" : "insert", old, r);
        }
        if (i >= 0) this.db[table][i] = r; else this.db[table].push(r);
      });
    }
    who() { try { return JSON.parse(storage.getItem(this.sessionKey) || "{}").email || "demo"; } catch (e) { return "demo"; } }
    audit(table, action, before, after, source = "manual") {
      this.db.master_audit = this.db.master_audit || [];
      this.db.master_audit.unshift({ id: this.nextId("master_audit"), table_name: table, row_key: keyOf(table, after || before), action, source,
        changed_by: this.who(), changed_at: new Date().toISOString(), before, after });
      this.db.master_audit.length = Math.min(this.db.master_audit.length, 500);
    }
    // Demo stand-in for import_snapshot() in 005_snapshot_import.sql: add or update by key, never delete
    async importSnapshot(data) {
      const keyOf = {
        contracts: r => r.id, contract_logs: r => `${r.contract_id}#${r.log_no}`, departments: r => r.name, people: r => r.name,
        contract_types: r => `${r.classification}|${r.type}|${r.sub_type || ""}`, action_sla: r => r.action,
        contract_templates: r => r.selection_label, due_date_requests: r => r.details?.requestId || `${r.contract_id}|${r.requested_due}`
      };
      let kept = 0;
      Object.entries(keyOf).forEach(([t, key]) => {
        this.db[t] = this.db[t] || [];
        (data[t] || []).forEach(row => {
          const i = this.db[t].findIndex(x => key(x) === key(row));
          if (i >= 0 && this.db[t][i].locked) { kept++; return; } // edited by hand in Master Data: keep it
          if (i >= 0) { if (t !== "due_date_requests") this.db[t][i] = { ...this.db[t][i], ...row }; }
          else this.db[t].push(t === "contracts" ? { ...row } : { id: this.nextId(t), ...row });
        });
      });
      let added = 0;
      this.guardAccess(this.db.user_access, () => {
        this.db.user_access = JSON.parse(JSON.stringify(this.db.user_access));
        this.db.people.filter(p => p.email && p.email.includes("@") && !this.db.user_access.some(u => u.email === p.email)).forEach(p => {
          this.db.user_access.push({ email: p.email, display_name: p.name, department: p.department, role: "viewer", active: true, source: "manual" }); added++;
        });
      });
      this.persist();
      return { imported_contracts: (data.contracts || []).length, imported_logs: (data.contract_logs || []).length,
        contracts: this.db.contracts.length, contract_logs: this.db.contract_logs.length, new_users: added, locked_kept: kept };
    }
    async resetDemo() { storage.removeItem(this.key); await this.init(); }
  }

  // ───────────── Supabase store ─────────────
  class SupabaseStore {
    constructor(cfg) {
      this.mode = "supabase";
      this.cfg = cfg;
      this.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        // "Remember me" off (default): session lives only in this tab (sessionStorage), closing it signs the user out.
        // "Remember me" on: session kept in localStorage, so returning to the site skips the Microsoft sign-in.
        auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, storage: this.authStorage() }
      });
    }
    async init() {}
    authStorage() {
      const ls = window.localStorage, ss = window.sessionStorage, on = () => this.remembered().on;
      return {
        getItem: k => ss.getItem(k) ?? ls.getItem(k),
        setItem: (k, v) => { (on() ? ls : ss).setItem(k, v); (on() ? ss : ls).removeItem(k); },
        removeItem: k => { ss.removeItem(k); ls.removeItem(k); }
      };
    }
    remembered() {
      try { return { on: localStorage.getItem("ct-remember") === "1", email: localStorage.getItem("ct-remember-email") || "" }; }
      catch (e) { return { on: false, email: "" }; }
    }
    setRemember(on, email) {
      try {
        if (on) { localStorage.setItem("ct-remember", "1"); localStorage.setItem("ct-remember-email", email || ""); }
        else { localStorage.removeItem("ct-remember"); localStorage.removeItem("ct-remember-email"); }
      } catch (e) { /* storage blocked: behaves as not remembered */ }
    }
    toEmail(username) {
      const u = String(username || "").trim();
      return u.includes("@") ? u : `${u}@${this.cfg.EMAIL_DOMAIN}`;
    }
    // Role comes from public.user_access (matched by the Microsoft 365 email)
    async profileFor(authUser) {
      const { data, error } = await this.client.rpc("my_access");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.active) {
        await this.client.auth.signOut();
        throw new Error(`บัญชี ${authUser.email} ยังไม่ได้รับสิทธิ์ใช้งาน หรือถูกระงับ กรุณาติดต่อผู้ดูแลระบบ`);
      }
      return { id: authUser.id, email: row.email, username: row.email, display_name: row.display_name || row.email, role: row.role };
    }
    async signInMicrosoft(email) {
      const redirectTo = window.location.origin + window.location.pathname;
      const { error } = await this.client.auth.signInWithOAuth({
        provider: "azure",
        // prompt=login (Remember me off): Microsoft always asks for the password, even if already signed in to M365.
        // login_hint pre-fills the Turtle23 email typed on our page (tenant is locked by the Azure provider's Tenant URL).
        options: { scopes: "openid email profile offline_access", redirectTo,
          queryParams: this.remembered().on ? { login_hint: email || "" } : { prompt: "login", login_hint: email || "" } }
      });
      if (error) throw error; // on success the browser leaves for login.microsoftonline.com
    }
    async signIn(username, password) {
      const { data, error } = await this.client.auth.signInWithPassword({ email: this.toEmail(username), password });
      if (error) throw new Error("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      return this.profileFor(data.user);
    }
    async currentUser() {
      // Error sent back by Microsoft / Supabase after the redirect (e.g. domain not allowed)
      const params = new URLSearchParams(window.location.search + "&" + window.location.hash.replace(/^#/, ""));
      const oauthError = params.get("error_description");
      const { data } = await this.client.auth.getSession();
      if (window.location.search) history.replaceState(null, "", window.location.pathname + window.location.hash.replace(/^#(?!\/).*/, ""));
      if (oauthError) throw new Error(/not allowed|saving new user/i.test(oauthError)
        ? "บัญชี Microsoft นี้ไม่ได้อยู่ในโดเมนที่อนุญาต กรุณาติดต่อผู้ดูแลระบบ" : oauthError);
      return data.session ? this.profileFor(data.session.user) : null;
    }
    async signOut() { await this.leavePresence(); await this.client.auth.signOut(); }
    // Online users (017_user_presence.sql). Before 017 runs, the heartbeat is skipped quietly and the list says so.
    async touchPresence(page) {
      const { data, error } = await this.client.rpc("touch_presence", { p_page: page });
      return error ? null : data !== false;
    }
    async leavePresence() { try { await this.client.rpc("leave_presence"); } catch (e) { /* signing out anyway */ } }
    async onlineUsers(minutes = 3) {
      const { data, error } = await this.client.rpc("online_users", { p_minutes: minutes });
      if (error) throw new Error(/online_users/.test(error.message) ? "ยังไม่ได้รัน SQL 017_user_presence.sql" : error.message);
      return data || [];
    }
    async loadAll() {
      const out = {};
      await Promise.all(TABLES.map(async t => {
        const { data, error } = await this.client.from(t).select("*").limit(10000);
        if (error) throw error;
        out[t] = data;
      }));
      // Templates (005), Log View headers (007) and master history (008, Level 4+); skipped when the table is missing
      await Promise.all(OPTIONAL.map(async t => {
        let q = this.client.from(t).select("*");
        q = t === "master_audit" ? q.order("changed_at", { ascending: false }).limit(500) : q.limit(10000);
        const { data, error } = await q;
        if (!error) out[t] = data;
      }));
      return out;
    }
    async accessToken() { const { data } = await this.client.auth.getSession(); return data.session?.access_token || ""; }
    // Attachments live in the private Storage bucket "attachments" (011_storage_attachments.sql).
    // Storage itself refuses files over 20 MB or of other types; links are signed and expire after 5 minutes.
    async uploadAttachment(path, file, contentType) {
      const { error } = await this.client.storage.from(BUCKET).upload(path, file, { contentType, upsert: false, cacheControl: "3600" });
      if (error && !/exists|duplicate/i.test(error.message)) throw new Error(/bucket not found/i.test(error.message) ? "ยังไม่ได้รัน SQL 011_storage_attachments.sql" : error.message);
      return { path };
    }
    async signedUrl(path, downloadName) {
      const { data, error } = await this.client.storage.from(BUCKET).createSignedUrl(path, 300, downloadName ? { download: downloadName } : undefined);
      if (error) throw new Error(/not found/i.test(error.message) ? "ไม่พบไฟล์ หรือบัญชีนี้ไม่มีสิทธิ์เปิดไฟล์นี้" : error.message);
      return data.signedUrl;
    }
    // Status email through the Edge Function "send-email" (012_email_outbox.sql + supabase/functions/send-email)
    async sendEmail(payload) {
      const { data, error } = await this.client.functions.invoke("send-email", { body: payload });
      if (!error) return data;
      let message = error.message;
      try { const j = await error.context.json(); message = j.error || message; } catch (e) { /* no JSON reply */ }
      if (/Failed to send a request|not found|404/i.test(message)) message = `ยังไม่ได้ติดตั้งระบบส่งอีเมล (Edge Function send-email) หรือเชื่อมต่อไม่ได้: ${message}`;
      throw new Error(message);
    }
    // LINE Notification through the Edge Function "line-notify" (014_line_notify.sql + supabase/functions/line-notify)
    async lineNotify(body) {
      const { data, error } = await this.client.functions.invoke("line-notify", { body });
      if (!error) return data;
      let message = error.message;
      try { const j = await error.context.json(); message = j.error || message; } catch (e) { /* no JSON reply */ }
      if (/Failed to send a request|not found|404/i.test(message)) message = `ยังไม่ได้ติดตั้ง Edge Function line-notify หรือเชื่อมต่อไม่ได้: ${message}`;
      if (/line_settings/.test(message)) message = `ยังไม่ได้รัน SQL 014_line_notify.sql (${message})`;
      throw new Error(message);
    }
    // On/Off switches (015_app_switch.sql). Before 015 is run the web app counts as open.
    async appStatus() {
      const { data, error } = await this.client.rpc("app_status");
      if (error) return { app_open: true, missing: true };
      return (Array.isArray(data) ? data[0] : data) || { app_open: true };
    }
    async setAppOpen(open, message) {
      const { error } = await this.client.rpc("set_app_open", { open, message: message || null });
      if (error) throw new Error(/set_app_open/.test(error.message) ? "ยังไม่ได้รัน SQL 015_app_switch.sql" : error.message);
    }
    async lineAutoStatus() {
      const { data, error } = await this.client.rpc("line_auto_status");
      if (error) return null;
      return (Array.isArray(data) ? data[0] : data) || null;
    }
    async setLineAuto(enabled) {
      const { error } = await this.client.rpc("set_line_auto", { enabled });
      if (error) throw new Error(/set_line_auto/.test(error.message) ? "ยังไม่ได้รัน SQL 015_app_switch.sql" : error.message);
    }
    async setLineSending(enabled) {
      const { error } = await this.client.rpc("set_line_sending", { enabled });
      if (error) throw Object.assign(new Error(/set_line_sending/.test(error.message) ? "ยังไม่ได้รัน SQL 016_line_sending.sql" : error.message), { missing: /set_line_sending/.test(error.message) });
    }
    async approvers() {
      const { data, error } = await this.client.rpc("approver_emails");
      if (error) throw new Error(/approver_emails/.test(error.message) ? "ยังไม่ได้รัน SQL 010_email_attachments.sql" : error.message);
      return data || [];
    }
    async insert(table, row) {
      const r = { ...row };
      if (KEYS[table] === "id" && table !== "contracts") delete r.id;
      const { data, error } = await this.client.from(table).insert(r).select().single();
      if (error) throw error;
      return data;
    }
    async update(table, key, patch) {
      const { data, error } = await this.client.from(table).update(patch).eq(KEYS[table], key).select().single();
      if (error) throw error;
      return data;
    }
    async remove(table, key) {
      const { error } = await this.client.from(table).delete().match(matchKey(table, key));
      if (error) throw error;
    }
    // One transaction on the server (005_snapshot_import.sql); Admin only; adds or updates, never deletes
    async importSnapshot(data) {
      const { data: counts, error } = await this.client.rpc("import_snapshot", { p: data });
      if (error) {
        if (/import_snapshot/.test(error.message) && /find|exist|schema cache/i.test(error.message))
          throw new Error("ฐานข้อมูลยังไม่มีคำสั่งนำเข้า กรุณารัน supabase/migrations/005_snapshot_import.sql ใน Supabase SQL Editor ก่อน");
        throw error;
      }
      return counts;
    }
    async upsertMany(table, rows) {
      const k = KEYS[table];
      const withKey = rows.filter(r => !(k === "id" && (r.id == null || r.id === "")));
      const fresh = rows.filter(r => k === "id" && (r.id == null || r.id === "")).map(({ id, ...rest }) => rest);
      if (withKey.length) { const { error } = await this.client.from(table).upsert(withKey, { onConflict: k }); if (error) throw error; }
      if (fresh.length) { const { error } = await this.client.from(table).insert(fresh); if (error) throw error; }
    }
  }

  const cfg = window.APP_CONFIG || {};
  const useSupabase = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  window.Store = useSupabase ? new SupabaseStore(cfg) : new LocalStore();
  window.ROLES = ROLES;
  window.TABLE_KEYS = KEYS;
})();
