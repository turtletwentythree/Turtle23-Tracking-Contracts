// Data layer: one interface, two back ends.
//  - SupabaseStore: real database + Supabase Auth (when APP_CONFIG has a URL and anon key)
//  - LocalStore:    demo mode, seeded from SEED_DATA and kept in localStorage
(function () {
  const TABLES = ["contracts", "contract_logs", "departments", "people", "contract_types", "action_sla", "due_date_requests", "user_access", "profiles", "entra_role_mappings", "access_audit"];
  const KEYS = {
    contracts: "id", contract_logs: "id", departments: "name", people: "name",
    contract_types: "id", action_sla: "action", due_date_requests: "id",
    user_access: "email", profiles: "id", entra_role_mappings: "claim_value", access_audit: "id"
  };
  const ROLES = {
    viewer: { level: 1, label: "Viewer", nameEn: "Contract Viewer", nameTh: "ผู้ดูข้อมูลสัญญา" },
    user: { level: 2, label: "User", nameEn: "Contract User", nameTh: "ผู้ดำเนินการสัญญา" },
    confidential: { level: 3, label: "Confidential", nameEn: "Confidential User", nameTh: "ผู้ดำเนินการสัญญาลับ" },
    admin: { level: 4, label: "Admin", nameEn: "System Administrator", nameTh: "ผู้ดูแลระบบ" }
  };

  function safeStorage() {
    try { const k = "__t"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return localStorage; }
    catch (e) { const mem = {}; return { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } }; }
  }
  const storage = safeStorage();

  // ───────────── Demo / local store ─────────────
  class LocalStore {
    constructor() { this.mode = "demo"; this.key = "ct-demo-db-v4"; this.sessionKey = "ct-demo-session-v1"; }
    async init() {
      const raw = storage.getItem(this.key);
      this.db = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(window.SEED_DATA));
      TABLES.forEach(t => { this.db[t] = this.db[t] || []; });
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
    async signOut() { storage.removeItem(this.sessionKey); }
    async loadAll() { return JSON.parse(JSON.stringify(this.db)); }
    async insert(table, row) {
      const r = { ...row };
      if (KEYS[table] === "id" && r.id == null) r.id = this.nextId(table);
      this.db[table].push(r); this.persist(); return r;
    }
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
      if (snapshot.some(u => u.role === "admin" && u.active !== false) && !this.db.user_access.some(u => u.role === "admin" && u.active !== false)) {
        this.db.user_access = snapshot;
        throw new Error("ต้องมี Admin ที่ใช้งานอยู่อย่างน้อย 1 บัญชี");
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
      this.db[table] = this.db[table].filter(x => String(x[k]) !== String(key));
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
      rows.forEach(row => {
        const r = { ...row };
        if (k === "id" && (r.id == null || r.id === "")) r.id = this.nextId(table);
        const i = this.db[table].findIndex(x => String(x[k]) === String(r[k]));
        if (i >= 0) this.db[table][i] = { ...this.db[table][i], ...r }; else this.db[table].push(r);
      });
    }
    async resetDemo() { storage.removeItem(this.key); await this.init(); }
  }

  // ───────────── Supabase store ─────────────
  class SupabaseStore {
    constructor(cfg) {
      this.mode = "supabase";
      this.cfg = cfg;
      this.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        // Session lives only in this browser tab (sessionStorage): closing the tab signs the user out,
        // so every new visit starts at the Microsoft 365 email sign-in.
        auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, storage: window.sessionStorage }
      });
    }
    async init() {}
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
        // prompt=login: Microsoft always asks for the password, even if already signed in to M365.
        // login_hint pre-fills the Turtle23 email typed on our page (tenant is locked by the Azure provider's Tenant URL).
        options: { scopes: "openid email profile offline_access", redirectTo, queryParams: { prompt: "login", login_hint: email || "" } }
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
    async signOut() { await this.client.auth.signOut(); }
    async loadAll() {
      const out = {};
      await Promise.all(TABLES.map(async t => {
        const { data, error } = await this.client.from(t).select("*").limit(10000);
        if (error) throw error;
        out[t] = data;
      }));
      return out;
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
      const { error } = await this.client.from(table).delete().eq(KEYS[table], key);
      if (error) throw error;
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
