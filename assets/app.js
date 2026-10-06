// Contract Tracking System — single-page app (no build step).
(function () {
  "use strict";

  // ───────────── State ─────────────
  const S = {
    user: null,
    db: { contracts: [], contract_logs: [], departments: [], people: [], contract_types: [], action_sla: [], due_date_requests: [] },
    view: "dashboard",
    filters: {},          // contracts table column filters, per view
    search: {},
    dash: { department: "", classification: "" },
    caseStep: "add",
    addForm: { classification: "Day-to-day Work / งานดำเนินงานทั่วไป" },
    masterTab: "contracts",
    masterDraft: null,
    adminTab: "user_access"
  };

  const VIEWS = [
    { id: "dashboard", icon: "▦", label: "Dashboard", title: "Tracking Contracts Dashboard", min: 1 },
    { id: "contracts", icon: "≡", label: "Contracts", title: "Contract Status", sub: "ติดตาม Contract Owner, cycle, return และสถานะล่าสุด", min: 1 },
    { id: "confidential", icon: "◆", label: "Confidential", title: "Confidential Contracts", sub: "สัญญาลับ เฉพาะผู้มีสิทธิ์ระดับ Confidential ขึ้นไป", min: 3 },
    { id: "user", icon: "✎", label: "User Case Action", title: "User Case Action", sub: "เพิ่มเคส อัปเดตสถานะ และปิดเคสจาก Contract Status / Log View", min: 2 },
    { id: "master", icon: "▤", label: "Master Data", title: "Master Data", sub: "แก้ไขข้อมูลหลักทุกตารางโดยตรง และบันทึกกลับฐานข้อมูล", min: 5 },
    { id: "admin", icon: "⚙", label: "Admin Tools", title: "Admin Tools", sub: "อนุมัติ Due Date จัดการสิทธิ์ผู้ใช้ และแจ้งเตือนสถานะ", min: 4 }
  ];

  const CLASS_DAY = "Day-to-day Work / งานดำเนินงานทั่วไป";
  const CLASS_CONF = "Confidential / สัญญาลับ";
  const STAGE_BY_ACTION = { "Submit to Review": "Under Review", "Return": "Returned", "Resubmit": "Resubmitted", "Forward": "Forwarded" };

  // ───────────── Helpers ─────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const level = () => (S.user ? window.ROLES[S.user.role]?.level || 1 : 0);
  const can = min => level() >= min;
  const uniq = arr => Array.from(new Set(arr.filter(v => v !== "" && v != null)));
  const short = v => String(v || "").split(" / ")[0];

  // Dates are YYYY-MM-DD in Asia/Bangkok, whatever the time zone of the computer
  const TZ = "Asia/Bangkok";
  const bkkDate = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  function todayISO() { return bkkDate.format(new Date()); }
  function dateOf(ts) { if (!ts) return null; const t = Date.parse(ts); return /^\d{4}-\d{2}-\d{2}$/.test(String(ts)) || isNaN(t) ? String(ts).slice(0, 10) : bkkDate.format(new Date(t)); }
  function parseDate(s) { if (!s) return null; const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function fmtDate(s) {
    const d = parseDate(s); if (!d) return "-";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  // Working days: Mon–Fri, minus the Holiday Master when the database has one (table holidays, column date).
  // The start day is not counted: start Monday → Tuesday = 1, Wednesday = 2. Counted on calendar dates (UTC), so no time-zone drift.
  const utcDay = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  function holidaySet() {
    const rows = S.db.holidays || [];
    if (S._holKey !== rows) { S._holKey = rows; S._hol = new Set(rows.filter(h => h.active !== false).map(h => String(h.date || h.holiday_date || "").slice(0, 10))); }
    return S._hol;
  }
  const isWorkday = t => { const d = new Date(t), w = d.getUTCDay(); return w !== 0 && w !== 6 && !holidaySet().has(d.toISOString().slice(0, 10)); };
  function workdays(from, to) {
    if (!from || !to) return 0;
    const a = utcDay(from), b = utcDay(to);
    if (!(b > a)) return 0;
    let n = 0;
    for (let t = a + 864e5; t <= b; t += 864e5) if (isWorkday(t)) n++;
    return n;
  }
  function addWorkdays(from, days) {
    let t = utcDay(from || todayISO()), n = 0;
    while (n < days) { t += 864e5; if (isWorkday(t)) n++; }
    return new Date(t).toISOString().slice(0, 10);
  }

  function toast(msg, err = false) {
    $$(".toast").forEach(t => t.remove());
    const el = document.createElement("div");
    el.className = "toast" + (err ? " err" : "");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // Two-step confirm inside the page (works where window.confirm is unavailable)
  function armed(btn, label) {
    if (btn.dataset.armed === "1") return true;
    btn.dataset.armed = "1"; btn.dataset.label = btn.textContent; btn.textContent = label;
    setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ""; btn.textContent = btn.dataset.label; } }, 4000);
    return false;
  }

  async function guard(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); }
    catch (e) { console.error(e); toast(e.message || String(e), true); }
  }

  // ───────────── Derived contract metrics ─────────────
  // ───────────── SLA engine (spec 2026-10-06) ─────────────
  // Two separate clocks, never mixed:
  //  - Alert         = Days on Hand (working days in the current Action) vs Action SLA (Action SLA Master)
  //  - Status Update = Accumulated Days (working days since Add Case Date) vs Total SLA (Type of Contract Master)
  // The real state is the Latest Action of the newest log; Contract Stage is used only when there is no log.
  const CLOSED_ACTION = /^(signed|signed\s*\/\s*completed|completed)$/i;
  const CANCELLED_ACTION = /^cancel/i;
  const FORWARD_ACTION = /^forward$/i;
  const NOT_AN_ACTION = /^due date /i; // Due Date request/approval notes do not change the station
  const STATUS_LABEL = { G: "G=On Track", Y: "Y=Delayed", R: "R=Overdue", C: "B=Completed", X: "B=Cancelled", N: "Configuration Required" };
  const STATUS_TAG = { G: "tag-green", Y: "tag-amber", R: "tag-red", C: "tag-dark", X: "tag-dark", N: "tag-grey" };
  const ALERT_LABEL = { G: "G=On Track", Y: "Y=Delayed", R: "R=At Risk", U: "U=Uncontrol", C: "B=Completed", X: "B=Cancelled", N: "Configuration Required" };
  const ALERT_TAG = { ...STATUS_TAG, U: "tag-grey" };
  const statusTag = code => `<span class="tag status-dot ${STATUS_TAG[code]}">${STATUS_LABEL[code]}</span>`;
  const alertTag = code => `<span class="tag status-dot ${ALERT_TAG[code]}">${ALERT_LABEL[code]}</span>`;

  function logsOf(id) { return S.db.contract_logs.filter(l => l.contract_id === id).sort((a, b) => a.log_no - b.log_no); }
  // Newest log: Updated Date and Time, then Log No, then the order in the database
  function newer(a, b) {
    const ta = Date.parse(a.updated_at) || 0, tb = Date.parse(b.updated_at) || 0;
    if (ta !== tb) return ta > tb;
    if ((a.log_no || 0) !== (b.log_no || 0)) return (a.log_no || 0) > (b.log_no || 0);
    return (Number(a.id) || 0) > (Number(b.id) || 0);
  }
  function latestLog(id) {
    let last = null;
    S.db.contract_logs.forEach(l => { if (l.contract_id === id && !NOT_AN_ACTION.test(l.action || "") && (!last || newer(l, last))) last = l; });
    return last;
  }

  // Missing settings are reported once in the console, never treated as 0
  const configWarned = new Set();
  function configMissing(what) { if (!configWarned.has(what)) { configWarned.add(what); console.warn(`[SLA] Configuration Required: ${what}`); } }
  function actionSla(action) {
    const a = String(action || "").trim().toLowerCase();
    const row = (S.db.action_sla || []).find(r => String(r.action || "").trim().toLowerCase() === a);
    const n = row && row.sla !== "" && row.sla != null ? Number(row.sla) : NaN;
    if (!Number.isFinite(n)) { configMissing(`Action SLA for "${action}"`); return null; }
    return n;
  }
  // Total SLA: Classification + Type of Contract + Sub Type in the Type of Contract Master (Classification must match too);
  // when the master has no matching row, the Total SLA saved on the contract at Add Case
  function totalSla(c) {
    const cls = short(c.classification || (c.access_level === "Confidential" ? "Confidential" : "Day-to-day Work")).toLowerCase();
    const rows = (S.db.contract_types || []).filter(t => short(t.classification).toLowerCase() === cls && short(t.type).toLowerCase() === short(c.type).toLowerCase());
    const sub = short(c.sub_type).toLowerCase();
    const row = rows.find(t => sub && short(t.sub_type).toLowerCase() === sub) || rows.find(t => !t.sub_type);
    const n = row && row.sla != null && row.sla !== "" ? Number(row.sla) : c.total_sla != null && c.total_sla !== "" ? Number(c.total_sla) : NaN;
    if (!Number.isFinite(n) || n <= 0) { configMissing(`Total SLA for ${c.id}`); return null; }
    return n;
  }

  function contractState(c, today = todayISO()) {
    const log = latestLog(c.id);
    const action = (log && log.action) || c.stage || "";
    const kind = CLOSED_ACTION.test(action) ? "completed" : CANCELLED_ACTION.test(action) ? "cancelled" : "open";
    const closeDate = kind === "open" ? null : (log ? log.in_date || dateOf(log.updated_at) : null) || c.closed_at || today;
    const end = closeDate || today;
    // Status Update: Accumulated Days vs Total SLA
    const acc = workdays(c.add_case_date, end);
    const sla = totalSla(c);
    const code = kind === "completed" ? "C" : kind === "cancelled" ? "X" : sla == null ? "N" : acc < sla ? "G" : acc < sla + 5 ? "Y" : "R";
    // Alert: Days on Hand of the current Action vs Action SLA
    const forward = kind === "open" && FORWARD_ACTION.test(action);
    const inDate = (log && log.in_date) || c.station_in || null;
    const onHand = forward || !inDate ? null : workdays(inDate, kind !== "open" ? end : (log && log.out_date) || today);
    const aSla = kind === "open" && !forward ? actionSla(action) : null;
    const alert = kind === "completed" ? "C" : kind === "cancelled" ? "X" : forward ? "U" : aSla == null || onHand == null ? "N"
      : onHand < aSla - 1 ? "G" : onHand <= aSla ? "Y" : "R";
    return { c, log, action, reason: (log && log.reason) || "", kind, closeDate, acc, used: acc, totalSla: sla, balance: sla == null ? null : sla - acc,
      code, onHand, actionSla: aSla, alert };
  }
  const metrics = c => contractState(c);
  const isOpen = c => contractState(c).kind === "open";
  const dayText = v => v == null ? "-" : v;
  // Read-only access for checks in the browser console (e.g. ContractSLA.state("CT-N-ADMIN-001"))
  window.ContractSLA = { workdays, addWorkdays, todayISO, state: (id, today) => { const c = S.db.contracts.find(x => x.id === id); return c ? contractState(c, today) : null; } };

  function visibleContracts() {
    return S.db.contracts.filter(c => c.access_level !== "Confidential" || can(3));
  }
  function contractsFor(view) {
    if (view === "confidential") return S.db.contracts.filter(c => c.access_level === "Confidential" && can(3));
    return S.db.contracts.filter(c => c.access_level !== "Confidential");
  }
  function activeTypes() { return S.db.contract_types.filter(t => t.active !== false); }
  function activePeople(dept) { return S.db.people.filter(p => p.active !== false && (!dept || p.department === dept)); }
  // People dropdown grouped by department (one <optgroup> each, names A–Z); key = "name" or "email"
  function peopleByDept(selected, key = "name", list = activePeople()) {
    const groups = {};
    list.filter(p => p[key]).forEach(p => { (groups[p.department || "Other"] = groups[p.department || "Other"] || []).push(p); });
    return Object.keys(groups).sort((a, b) => a.localeCompare(b)).map(d => `<optgroup label="${esc(d)}">${groups[d].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .map(p => `<option value="${esc(p[key])}" ${p[key] === selected ? "selected" : ""}>${esc(key === "email" ? `${p.name} · ${p.email}` : p.name)}</option>`).join("")}</optgroup>`).join("");
  }

  // ───────────── Data loading ─────────────
  async function reload() {
    const db = await window.Store.loadAll();
    Object.assign(S.db, db);
    S.db.contracts.sort((a, b) => a.id.localeCompare(b.id));
    S.loadedAt = Date.now();
    if (!S.masterDraft?.dirty) S.masterDraft = null;
  }
  // Rows added in Supabase (SQL Editor, another user) show up without a hard refresh:
  // data older than 30 seconds is reloaded when the page changes or the tab comes back.
  async function refreshIfStale() {
    if (window.Store.mode !== "supabase" || !S.user || Date.now() - (S.loadedAt || 0) < 30000) return false;
    try { await reload(); return true; } catch (e) { console.warn("Refresh failed", e); return false; }
  }

  // ───────────── Auth ─────────────
  function showLoginError(msg) { const el = $("#loginError"); el.textContent = msg || ""; el.classList.toggle("show", Boolean(msg)); }

  async function doLogin(username, password) {
    const btn = $("#loginSubmit");
    btn.disabled = true; btn.textContent = "Signing in...";
    try {
      S.user = await window.Store.signIn(username, password);
      await enterApp();
    } catch (e) {
      showLoginError(e.message || "Sign in failed");
    } finally {
      btn.disabled = false; btn.textContent = "Sign In";
    }
  }

  async function enterApp() {
    showLoginError("");
    try { await reload(); } catch (e) { toast("โหลดข้อมูลไม่สำเร็จ: " + e.message, true); }
    document.body.classList.add("auth-ready");
    const r = window.ROLES[S.user.role] || window.ROLES.viewer;
    $("#profileName").textContent = S.user.display_name || S.user.username;
    $("#profileRole").textContent = `${r.label} · ${r.nameEn}`;
    $("#profileAvatar").textContent = (S.user.display_name || S.user.username || "?").charAt(0).toUpperCase();
    $("#profileDetail").innerHTML = `${esc(S.user.email || S.user.username)}<br>${esc(r.nameEn)} · ${esc(r.nameTh)} (Level ${r.level})<br>${window.Store.mode === "supabase" ? "Signed in with Microsoft 365" : "Demo account"}`;
    const live = window.Store.mode === "supabase";
    $("#syncDot").classList.toggle("live", live);
    $("#syncText").textContent = live ? "Connected to Supabase" : "Demo mode · ข้อมูลในเบราว์เซอร์";
    route();
  }

  function initLogin() {
    const demo = window.Store.mode === "demo";
    const passwordAllowed = demo || Boolean(window.APP_CONFIG?.ALLOW_PASSWORD_LOGIN);
    $("#demoAccountSection").hidden = !demo;
    $("#loginForm").hidden = !passwordAllowed;
    $("#loginDivider").hidden = !passwordAllowed;
    // "Remember me": stay signed in on this browser and pre-fill the email next time
    const rem = window.Store.remembered?.();
    if (rem) { $("#msRemember").checked = rem.on; if (rem.email) $("#msEmail").value = rem.email; }
    $("#msForm").addEventListener("submit", async e => {
      e.preventDefault();
      const domain = (window.APP_CONFIG?.EMAIL_DOMAIN || "turtle23.com").toLowerCase();
      let email = $("#msEmail").value.trim().toLowerCase();
      if (email && !email.includes("@")) email = `${email}@${domain}`;
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) return showLoginError("กรุณากรอกอีเมลบริษัท เช่น name@" + domain);
      if (!email.endsWith("@" + domain)) return showLoginError(`ใช้ได้เฉพาะอีเมล @${domain} ของ Turtle23 เท่านั้น`);
      showLoginError("");
      window.Store.setRemember?.($("#msRemember").checked, email);
      const b = $("#msLogin");
      b.disabled = true; $("#msLoginText").textContent = "Redirecting to Microsoft...";
      try { await window.Store.signInMicrosoft(email); }
      catch (err) { showLoginError(err.message); b.disabled = false; $("#msLoginText").textContent = "Sign in with Microsoft 365"; }
    });
    $("#passwordToggle").addEventListener("click", e => {
      const i = $("#loginPassword"); const show = i.type === "password";
      i.type = show ? "text" : "password"; e.currentTarget.textContent = show ? "Hide" : "Show";
    });
    $("#loginClear").addEventListener("click", () => { $("#loginForm").reset(); showLoginError(""); });
    $$("[data-demo-account]").forEach(b => b.addEventListener("click", () => {
      if (b.dataset.demoAccount.includes("@")) { $("#loginUsername").value = b.dataset.demoAccount; $("#loginPassword").value = "demo1234"; return doLogin(b.dataset.demoAccount, "demo1234"); }
      $("#loginUsername").value = b.dataset.demoAccount;
      $("#loginPassword").value = "demo1234";
      doLogin(b.dataset.demoAccount, "demo1234");
    }));
    $("#loginForm").addEventListener("submit", e => {
      e.preventDefault();
      const u = $("#loginUsername").value.trim(), p = $("#loginPassword").value;
      if (!u || !p) return showLoginError("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน / Username and password are required.");
      doLogin(u, p);
    });
  }

  // ───────────── Router & shell ─────────────
  function route() {
    const id = (location.hash.match(/^#\/(\w+)/) || [])[1] || "dashboard";
    const v = VIEWS.find(x => x.id === id && can(x.min)) || VIEWS[0];
    if (v.id !== id) {
      // Pages above the user's level are not just hidden from the menu: a typed URL lands on the Dashboard
      if (VIEWS.some(x => x.id === id)) toast("บัญชีนี้ไม่มีสิทธิ์เข้าหน้านี้");
      history.replaceState(null, "", `#/${v.id}`);
    }
    S.view = v.id;
    renderNav();
    $("#pageHeading").textContent = v.title;
    $("#pageSubheading").textContent = v.id === "dashboard" ? `As of Date ${todayISO()}` : v.sub || "";
    render();
  }

  function renderNav() {
    // Sidebar counts open contracts only; Completed and Cancelled are listed at the bottom of the page
    const counts = { contracts: contractsFor("contracts").filter(isOpen).length, confidential: contractsFor("confidential").filter(isOpen).length };
    $("#nav").innerHTML = VIEWS.filter(v => can(v.min)).map(v => `
      <button class="nav-button ${S.view === v.id ? "active" : ""}" data-view="${v.id}" title="${esc(v.label)}">
        <span class="nav-icon">${v.icon}</span><span class="nav-label">${esc(v.label)}</span>
        ${counts[v.id] != null ? `<span class="nav-count">${counts[v.id]}</span>` : ""}
      </button>`).join("");
  }

  function render() {
    const view = $("#view");
    const fn = { dashboard: renderDashboard, contracts: () => renderContracts("contracts"), confidential: () => renderContracts("confidential"),
      user: renderUserCase, master: renderMaster, admin: renderAdmin }[S.view];
    view.innerHTML = fn();
    bindView(view);
  }

  // ───────────── Dashboard ─────────────
  // Dashboard rules (spec 2026-10-06):
  //  - real state = Latest Action from the contract's log, Contract Stage only when there is no log
  //  - Accumulated Days = working days (Mon–Fri) after Add Case Date up to today, or up to the Close Date once closed
  //  - Status Update from Accumulated Days vs Total SLA only: < SLA = G, < SLA + 5 = Y, otherwise R; closed = B
  //  - Status Update and Alert come from contractState() (SLA engine above), the same values as the Contracts page
  const DASH_LABEL = STATUS_LABEL;
  const DASH_TAG = STATUS_TAG;
  const isConfidential = c => c.access_level === "Confidential" || /^confidential/i.test(String(c.classification || ""));
  const dashState = (c, today) => contractState(c, today);
  // Level 1-2: Day-to-day Work only · Level 3: Day-to-day Work + Confidential · Level 4: everything
  function dashboardContracts() {
    return S.db.contracts.filter(c => level() >= 4 || (level() >= 3 ? true : !isConfidential(c)));
  }

  function renderDashboard() {
    const today = todayISO();
    const scope = dashboardContracts();
    const seen = new Set();
    const rows = scope.filter(c => !seen.has(c.id) && seen.add(c.id)).filter(c =>
      (!S.dash.department || c.department === S.dash.department) &&
      (!S.dash.classification || (isConfidential(c) ? "Confidential" : "Day-to-day Work") === S.dash.classification))
      .map(c => dashState(c, today));
    const open = rows.filter(x => x.kind === "open");
    const since = iso(new Date(parseDate(today).getTime() - 30 * 864e5));
    const completed30 = rows.filter(x => x.kind === "completed" && x.closeDate && x.closeDate >= since && x.closeDate <= today);
    const avgComplete = completed30.length ? completed30.reduce((s, x) => s + x.acc, 0) / completed30.length : 0;
    const overdue = open.filter(x => x.code === "R").sort((a, b) => b.acc - a.acc || a.c.id.localeCompare(b.c.id));

    const depts = uniq(scope.map(c => c.department)).sort();
    // Widget 6: every contract the user may see (open and completed; cancelled is left out), days stop at the Close Date
    const byDept = {};
    rows.filter(x => x.kind !== "cancelled").forEach(x => { const d = x.c.department || "-"; (byDept[d] = byDept[d] || []).push(x.acc); });
    const avgRows = Object.entries(byDept).map(([d, a]) => [d, a.reduce((s, v) => s + v, 0) / a.length]).sort((a, b) => b[1] - a[1]);
    const late = open.filter(x => x.code === "Y" || x.code === "R");

    return `
      <div class="dash-filters">
        <select class="select" data-dash="department"><option value="">ทุกแผนก / All Departments</option>
          ${depts.map(d => `<option ${S.dash.department === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>
        <select class="select" data-dash="classification"><option value="">ทุกกลุ่มสัญญา / All Classifications</option>
          ${["Day-to-day Work", ...(can(3) ? ["Confidential"] : [])].map(d => `<option ${S.dash.classification === d ? "selected" : ""}>${d}</option>`).join("")}</select>
      </div>
      <div class="kpi-grid">
        <div class="kpi" data-kpi="pending"><div class="kpi-label">1. Total Pending Contracts</div><div class="kpi-value">${open.length}</div><div class="kpi-note">Is Pending</div></div>
        <div class="kpi" data-kpi="completed30"><div class="kpi-label">2. Completed Last 30 Days</div><div class="kpi-value">${completed30.length}</div><div class="kpi-note">ย้อนหลัง 30 วัน / Rolling 30 days</div></div>
        <div class="kpi" data-kpi="avg"><div class="kpi-label">3. Avg Complete Day</div><div class="kpi-value">${completed30.length ? avgComplete.toFixed(1) : 0}</div><div class="kpi-note">Total Spending Days</div></div>
        <div class="kpi" data-kpi="overdue"><div class="kpi-label">4. Overdue Contracts</div><div class="kpi-value">${overdue.length}</div><div class="kpi-note">R = Overdue</div></div>
      </div>
      <div class="dash-grid" style="grid-template-columns:minmax(0,1fr)"><!-- widget 6 on its own row -->
        <section class="panel">
          <div class="panel-head"><div><h2>5. Longest pending on hand</h2><p>R = Overdue · Highest accumulated working days first</p></div></div>
          <div class="table-wrap" style="max-height:760px">
            <table class="grid compact longest-table" data-widget="longest">
              <colgroup><col class="c-details"><col class="c-owner"><col class="c-day"></colgroup>
              <thead><tr><th>Contract Details</th><th>Ownership</th><th class="num">Day</th></tr></thead>
              <tbody>${overdue.map(x => `<tr class="pending-item" data-row="${esc(x.c.id)}">
                  <td class="cd"><button class="id-link" data-goto="${esc(x.c.id)}">${esc(x.c.id)}</button> <span class="tag ${DASH_TAG[x.code]}">${DASH_LABEL[x.code]}</span>
                    <strong>${esc(x.c.name)}</strong>
                    <div class="mini"><b>Type:</b> ${esc(x.c.type)}<br><b>Vendor:</b> ${esc(x.c.vendor || "-")}<br>
                    <b>Latest Action / การดำเนินการล่าสุด:</b> ${esc(x.action || "-")}<br><b>Reason / เหตุผล:</b> ${esc(x.reason || "-")}</div></td>
                  <td><div class="owner-block">Department</div><div class="owner-name">${esc(x.c.department)}</div>
                    <div class="owner-block">Contract Owner</div><div class="owner-name">${esc(x.c.owner)}</div>
                    <div class="owner-block">Station Owner</div><div class="owner-name">${esc((x.log && x.log.to_person) || x.c.station_to || x.c.owner)}</div></td>
                  <td class="num"><span class="day-badge">${x.acc}D</span></td></tr>`).join("") || `<tr><td colspan="3" class="empty">No overdue contracts</td></tr>`}</tbody>
            </table>
          </div>
          <div class="panel-body" style="padding-top:12px;text-align:right"><span class="tag tag-red">R = Overdue</span> <span class="small muted">${overdue.length} Contracts</span></div>
        </section>
        <section class="panel">
          <div class="panel-head"><div><h2>6. Avg Spending Time at Station by Dept</h2><p>Department · Average accumulated working days (all contracts you can see, open and completed)</p></div></div>
          <div class="table-wrap"><table class="grid compact" data-widget="dept-avg">
            <thead><tr><th>Department / Restaurant</th><th class="num">Avg. Days</th></tr></thead>
            <tbody>${avgRows.map(([d, a]) => `<tr><td><b>${esc(d)}</b></td><td class="num"><b>${Math.round(a * 10) / 10}</b> D</td></tr>`).join("") || `<tr><td colspan="2" class="empty">-</td></tr>`}</tbody>
          </table></div>
          <div class="panel-body small muted" style="padding-top:10px;text-align:right">${avgRows.length} Departments · Highest average first</div>
        </section>
      </div>
      ${barPanel("7. By Person — Station Owner Status Summary", "by-person", late, x => x.c.owner, true)}
      ${barPanel("8. By Dept — Station Owner Status Summary", "by-dept", late, x => x.c.department, false)}`;
  }

  // Horizontal stacked bars: Y=Delayed and R=Overdue of open contracts only
  function barPanel(title, id, late, keyFn, withActions) {
    const groups = {};
    late.forEach(x => { const k = keyFn(x) || "-"; (groups[k] = groups[k] || []).push(x); });
    // Delayed + Overdue first, then more Overdue, then (By Person) more Delayed, then the name
    const cnt = (items, code) => items.filter(x => x.code === code).length;
    const rows = Object.entries(groups).sort((a, b) => b[1].length - a[1].length || cnt(b[1], "R") - cnt(a[1], "R")
      || (withActions ? cnt(b[1], "Y") - cnt(a[1], "Y") : 0) || a[0].localeCompare(b[0]));
    const max = Math.max(1, ...rows.map(r => r[1].length));
    return `<section class="panel" data-widget="${id}"><div class="panel-head"><div><h2>${esc(title)}</h2><p>เฉพาะสัญญาที่ยังเปิดและเป็น Y=Delayed หรือ R=Overdue</p></div></div>
      <div class="panel-body"><div class="bar-list">${rows.map(([k, items]) => {
        const n = { Y: 0, R: 0 }; items.forEach(x => { n[x.code]++; });
        const segs = ["R", "Y"].filter(c => n[c]).map(c => `<div class="bar-seg ${c.toLowerCase()}" data-seg="${c}" style="width:${(n[c] / max) * 100}%" title="${DASH_LABEL[c]}">${n[c]}</div>`).join("");
        const actions = withActions ? `<div class="stage-strip" style="width:${(items.length / max) * 100}%">${[...items].sort((a, b) => b.acc - a.acc)
          .map(x => `<span class="stage-chip" title="${esc(x.c.id)} · ${DASH_LABEL[x.code]}">${esc(x.action || "-")}</span>`).join("")}</div><span></span>` : "";
        return `<div class="bar-row"><div class="bar-name">${esc(k)}</div><div class="bar-track">${segs}</div><div class="bar-total">${items.length}</div>${withActions ? `<span></span>${actions}` : ""}</div>`;
      }).join("") || `<div class="empty">ไม่มีสัญญาที่ Delayed หรือ Overdue</div>`}</div>
      <div class="legend"><span class="y">Y = Delayed</span><span class="r">R = Overdue</span></div></div></section>`;
  }

  // ───────────── Contracts table ─────────────
  // Columns, order and layout follow the original Contract Status table (Project-Contract-tracking)
  const CONTRACT_COLS = [
    { k: "id", label: "Contract ID", filter: true },
    { k: "name", label: "Contract Name" },
    { k: "department", label: "Department / Restaurant", filter: true },
    { k: "owner", label: "Contract Owner", filter: true },
    { k: "type", label: "Type of Contract", filter: true },
    { k: "vendor", label: "Vendor / Counter party" },
    { k: "_log", label: "Log View" },
    { k: "stage", label: "Stage", filter: true, all: "All stages" },
    { k: "cycle", label: "Total No. of Cycle" },
    { k: "returns", label: "Total No. of Return" },
    { k: "_status", label: "Status Update", filter: true },
    { k: "_stationOwner", label: "Station Owner", filter: true },
    { k: "due_date", label: "Due date", dateRange: true }
  ];
  const CONTRACT_STATUS_LABEL = { ...STATUS_LABEL, C: "B=Completed", X: "B=Cancelled" };
  const contractStatusTag = code => `<span class="tag status-dot ${code === "C" || code === "X" ? "tag-dark" : STATUS_TAG[code]}">${CONTRACT_STATUS_LABEL[code]}</span>`;
  function cellValue(c, m, k) {
    const last = k === "_log" || k === "_stationOwner" ? latestLog(c.id) : null;
    if (k === "_status") return CONTRACT_STATUS_LABEL[m.code];
    if (k === "_log") return last ? `From ${last.from_person || "-"} / To ${last.to_person || "-"}` : `From ${c.station_from || "-"} >> To ${c.station_to || "-"}`;
    if (k === "_stationOwner") return (last && last.to_person) || c.station_to || "";
    return c[k] ?? "";
  }

  const SECTION_ORDER = { open: 0, completed: 1, cancelled: 2 };
  function renderContracts(view) {
    if (view === "confidential" && !can(3)) return lockedPanel("Confidential access required", "ต้องมีสิทธิ์ระดับ Confidential ขึ้นไป");
    const f = S.filters[view] = S.filters[view] || {};
    const q = (S.search[view] || "").toLowerCase();
    const rows = contractsFor(view).map(c => ({ c, m: metrics(c) }));
    const shown = rows.filter(({ c, m }) =>
      CONTRACT_COLS.every(col => col.dateRange || !f[col.k] || String(cellValue(c, m, col.k)) === f[col.k]) &&
      (!f.dueFrom || (c.due_date || "") >= f.dueFrom) && (!f.dueTo || (c.due_date && c.due_date <= f.dueTo)) &&
      (!q || [c.id, c.name, c.vendor, c.owner, c.department, c.remark].join(" ").toLowerCase().includes(q)))
      // Open contracts by department first, then B=Completed and B=Cancelled as their own sections at the bottom
      .sort((a, b) => SECTION_ORDER[a.m.kind] - SECTION_ORDER[b.m.kind] || (a.c.department || "Unassigned").localeCompare(b.c.department || "Unassigned") || a.c.id.localeCompare(b.c.id));
    const groupOf = ({ c, m }) => m.kind === "completed" ? "B=Completed" : m.kind === "cancelled" ? "B=Cancelled" : c.department || "Unassigned";
    const deptCount = {};
    shown.forEach(x => { const d = groupOf(x); deptCount[d] = (deptCount[d] || 0) + 1; });
    const head = col => {
      if (col.dateRange) return `<th class="filter-th"><details data-filter-menu><summary class="${f.dueFrom || f.dueTo ? "on" : ""}">${esc(col.label)}</summary>
        <div class="th-filter-popover"><label class="range-row"><span>From / จากวันที่</span><input class="input" type="date" data-due-range="dueFrom" data-view-name="${view}" value="${esc(f.dueFrom || "")}"></label>
          <label class="range-row"><span>To / ถึงวันที่</span><input class="input" type="date" data-due-range="dueTo" data-view-name="${view}" value="${esc(f.dueTo || "")}"></label>
          <button class="btn" type="button" data-due-clear="${view}">Clear</button></div></details></th>`;
      if (!col.filter) return `<th>${esc(col.label)}</th>`;
      const opts = uniq(rows.map(({ c, m }) => String(cellValue(c, m, col.k))).filter(Boolean)).sort();
      return `<th class="filter-th"><details data-filter-menu><summary class="${f[col.k] ? "on" : ""}">${esc(col.label)}</summary>
        <div class="th-filter-popover"><select class="select" data-col-filter="${col.k}" data-view-name="${view}" aria-label="Filter ${esc(col.label)}">
          <option value="">${esc(col.all || `All ${col.label}`)}</option>${opts.map(o => `<option ${f[col.k] === o ? "selected" : ""} value="${esc(o)}">${esc(o)}</option>`).join("")}</select></div></details></th>`;
    };
    let prevDept = null;
    const body = shown.map(({ c, m }) => {
      const dept = groupOf({ c, m });
      const group = dept !== prevDept ? `<tr class="contract-department-group${m.kind !== "open" ? " closed-group" : ""}"><td colspan="${CONTRACT_COLS.length}"><strong>${esc(dept)}</strong><span>${deptCount[dept]} contract(s)</span></td></tr>` : "";
      prevDept = dept;
      return `${group}<tr>${CONTRACT_COLS.map(col => {
        const v = cellValue(c, m, col.k);
        if (col.k === "id") return `<td><button class="id-link" data-open="${esc(c.id)}">${esc(v)}</button></td>`;
        if (col.k === "_log") return `<td style="min-width:190px"><button class="log-link" data-log-view="${esc(c.id)}" title="Open Log View Detail">${esc(v)}</button></td>`;
        if (col.k === "_status") return `<td>${contractStatusTag(m.code)}</td>`;
        if (col.k === "due_date") return `<td style="white-space:nowrap">${fmtDate(v)}</td>`;
        if (col.k === "name") return `<td style="min-width:200px">${esc(v)}</td>`;
        return `<td>${esc(v)}</td>`;
      }).join("")}</tr>`;
    }).join("");
    return `<section class="panel">
      <div class="panel-head">
        <div><h2>${view === "confidential" ? "Confidential Contract Status" : "Contract Status"}</h2><p>ติดตาม Contract Owner, cycle, return และสถานะล่าสุด · ${shown.length} / ${rows.length} รายการ</p></div>
        <div class="toolbar">
          <input class="input search" type="search" placeholder="ค้นหา ID, ชื่อสัญญา, Vendor..." value="${esc(S.search[view] || "")}" data-search="${view}">
          ${Object.values(f).some(Boolean) ? `<button class="btn" data-clear-filters="${view}">ล้างตัวกรอง</button>` : ""}
          <button class="btn" data-export="${view}">Export CSV</button>
        </div>
      </div>
      <div class="table-wrap" style="max-height:calc(100vh - 230px)">
        <table class="grid contract-status">
          <thead><tr>${CONTRACT_COLS.map(head).join("")}</tr></thead>
          <tbody>${body || `<tr><td colspan="${CONTRACT_COLS.length}" class="empty">ไม่พบสัญญา</td></tr>`}</tbody>
        </table>
      </div></section>`;
  }

  function lockedPanel(title, sub) {
    return `<section class="panel locked"><h3>🔒 ${esc(title)}</h3><p class="muted">${esc(sub)}</p></section>`;
  }

  function exportCsv(filename, header, rows) {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "﻿" + [header.map(q).join(","), ...rows.map(r => r.map(q).join(","))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function parseCsv(text) {
    const rows = []; let row = [], cur = "", inQ = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => x !== ""));
  }

  // ───────────── Log View Detail (same windows as the original Contract Tracking app) ─────────────
  // Headers and rows come from public.log_view_columns (007_log_view.sql); these are the same defaults
  const LOG_VIEW_DEFAULT = [
    ["table", "contract_id", "Contract ID", "รหัสสัญญา"], ["table", "log_view", "Log View", "เส้นทาง"], ["table", "from_person", "From", "จาก"],
    ["table", "to_person", "To", "ถึง"], ["table", "in_date", "In", "วันที่รับ"], ["table", "out_date", "Out", "วันที่ส่งต่อ"], ["table", "sla", "SLA", "SLA"],
    ["table", "days_on_hand", "Days on Hand (Mon–Fri)", "วันที่ถืองาน (จ.–ศ.)"], ["table", "alert", "Alert", "การแจ้งเตือน"],
    ["table", "delay_reason", "Delay Reason", "เหตุผลที่ล่าช้า"], ["table", "action", "Action", "การดำเนินการ"],
    ["detail", "action", "Action", "การดำเนินการ"], ["detail", "alert", "Alert", "การแจ้งเตือน"], ["detail", "status_update", "Status Update", "สถานะปัจจุบัน"],
    ["detail", "description", "Description", "คำอธิบาย"], ["detail", "reason_type", "Reason Type", "ประเภทเหตุผล"], ["detail", "reason", "Reason", "เหตุผล"],
    ["detail", "delay_reason", "Delay Reason", "เหตุผลที่ล่าช้า"], ["detail", "approval", "Approval", "การอนุมัติ"],
    ["detail", "corrective_action", "Corrective Action", "การแก้ไข"], ["detail", "sla", "SLA", "ระยะเวลาดำเนินการ"],
    ["detail", "updated_by", "Updated By", "ผู้บันทึก"], ["detail", "attachments", "Attachments", "ไฟล์แนบ"], ["detail", "cc_recipients", "CC Recipients", "ผู้รับสำเนา"]
  ].map(([section, key, label_en, label_th], i) => ({ section, key, label_en, label_th, position: i, visible: true }));
  function logViewCols(section) {
    const all = S.db.log_view_columns && S.db.log_view_columns.length ? S.db.log_view_columns : LOG_VIEW_DEFAULT;
    return all.filter(r => r.section === section && r.visible !== false).sort((a, b) => a.position - b.position);
  }
  // A log field: its own column (007_log_view.sql) or, before that migration, the snapshot column kept in `details`
  const LOG_DETAIL_KEY = {
    log_view: "Log View", days_on_hand: "Days on Hand", alert: "Alert", delay_reason: "Delay Reason", action_reason: "Action Reason",
    corrective_action: "Corrective Action", action_reason_type: "Action Reason Type", action_reason_detail: "Action Reason Detail",
    approval_type: "Approval Type", approval_conditions: "Approval Conditions", corrective_action_detail: "Corrective Action Detail",
    action_code: "Action Code", action_name_th: "Action Name TH", action_name_en: "Action Name EN", action_description_th: "Action Description TH",
    action_description_en: "Action Description EN", action_sla: "Action SLA", action_reason_type_th: "Action Reason Type TH", action_reason_type_en: "Action Reason Type EN"
  };
  function lf(l, k) {
    const v = l[k];
    if (Array.isArray(v) ? v.length : v !== undefined && v !== null && v !== "") return v;
    const d = l.details || {};
    if (k === "attachments" || k === "cc_recipients") return Array.isArray(d[k]) ? d[k] : [];
    return d[LOG_DETAIL_KEY[k]] ?? "";
  }
  function alertBadge(text) {
    const t = String(text || "");
    if (!t) return "-";
    const code = /Black|(^|[^A-Z])B\s*=/.test(t) ? "tag-dark" : /Red|(^|[^A-Z])R\s*=/.test(t) ? "tag-red" : /Yellow|(^|[^A-Z])Y\s*=/.test(t) ? "tag-amber"
      : /Gray|(^|[^A-Z])U\s*=/.test(t) ? "tag-grey" : "tag-green";
    return `<span class="tag status-dot ${code}">${esc(t.split(">>").pop().trim())}</span>`;
  }
  const logRoute = l => `From ${l.from_person || "-"} / To ${l.to_person || "-"}`;
  // The current Action of an open contract shows live Days on Hand and Alert; earlier logs keep their saved values
  function liveLog(l) {
    if (l.out_date) return null;
    const c = S.db.contracts.find(x => x.id === l.contract_id); if (!c) return null;
    const st = contractState(c);
    return st.kind === "open" && st.log === l ? st : null;
  }
  function logCell(l, key) {
    switch (key) {
      case "contract_id": return `<span class="log-cid">${esc(l.contract_id)}</span>`;
      case "log_view": return `<span class="log-route">${esc(logRoute(l))}</span>`;
      case "in_date": case "out_date": return l[key] ? fmtDate(l[key]) : "";
      case "days_on_hand": { const st = liveLog(l); if (st) return dayText(st.onHand); const v = lf(l, key); return esc(v !== "" && v != null ? v : workdays(l.in_date, l.out_date || todayISO())); }
      case "alert": { const st = liveLog(l); return st ? alertTag(st.alert) : alertBadge(lf(l, "alert")); }
      case "delay_reason": return esc(lf(l, key) || "-");
      case "action": return `<button class="log-action-btn" data-log-action="${esc(l.contract_id)}#${esc(l.log_no)}" title="View reason / ดูเหตุผล">${esc(lf(l, "action_name_en") || l.action || "-")}</button>`;
      default: { const v = lf(l, key); return esc(typeof v === "object" ? JSON.stringify(v) : v); }
    }
  }
  function logDetailValue(l, key, c) {
    const fmtDT = v => { const d = new Date(v); return isNaN(d) ? String(v || "") : d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }); };
    switch (key) {
      case "action": return [lf(l, "action_name_en") || l.action, lf(l, "action_name_th")];
      case "alert": { const st = liveLog(l); return [st ? ALERT_LABEL[st.alert] : String(lf(l, "alert")).split(">>").pop().trim()]; }
      case "status_update": return [c ? CONTRACT_STATUS_LABEL[metrics(c).code] : ""];
      case "description": return [lf(l, "action_description_en"), lf(l, "action_description_th")];
      case "reason_type": return [lf(l, "action_reason_type_en") || lf(l, "action_reason_type"), lf(l, "action_reason_type_th")];
      case "reason": return [lf(l, "action_reason_detail") || lf(l, "action_reason") || l.reason];
      case "delay_reason": return [lf(l, "delay_reason")];
      case "approval": return [[lf(l, "approval_type"), l.approval, lf(l, "approval_conditions")].filter(Boolean).join(" · ")];
      case "corrective_action": return [lf(l, "corrective_action_detail") || lf(l, "corrective_action")];
      case "sla": return [lf(l, "action_sla") !== "" ? `${lf(l, "action_sla")} วันทำการ` : l.sla != null ? `${l.sla} วันทำการ` : ""];
      case "updated_by": return [l.updated_by, l.updated_at ? fmtDT(l.updated_at) : ""];
      case "attachments": return [logFiles(l), "", true];
      case "cc_recipients": return [lf(l, "cc_recipients").map(x => typeof x === "string" ? x : x.name || x.email || "").filter(Boolean).join(", ")];
      default: { const v = lf(l, key); return [typeof v === "object" ? JSON.stringify(v) : v]; }
    }
  }
  function openModal(slot, title, subtitle, body, wide) {
    let root = $(`#${slot}`);
    if (!root) { root = document.createElement("div"); root.id = slot; document.body.appendChild(root); }
    root.innerHTML = `<div class="modal-backdrop" data-close-modal>
      <section class="modal${wide ? " modal-wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="modal-head"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="icon-button" data-close-modal aria-label="Close">✕</button></header>
        <div class="modal-body">${body}</div></section></div>`;
    $$("[data-close-modal]", root).forEach(el => el.addEventListener("click", e => { if (e.target === el) root.innerHTML = ""; }));
    return root;
  }
  function openLogView(id) {
    const c = visibleContracts().find(x => x.id === id);
    if (!c) return toast("ไม่มีสิทธิ์ดูสัญญานี้", true);
    const cols = logViewCols("table");
    const logs = logsOf(id).slice().reverse();
    const body = `<div class="table-wrap" style="max-height:calc(100vh - 220px)"><table class="grid compact log-view-table">
      <thead><tr>${cols.map(col => `<th title="${esc(col.label_th || "")}">${esc(col.label_en)}</th>`).join("")}</tr></thead>
      <tbody>${logs.map(l => `<tr>${cols.map(col => `<td>${logCell(l, col.key)}</td>`).join("")}</tr>`).join("")
        || `<tr><td colspan="${cols.length}" class="empty">No Log View Detail found.</td></tr>`}</tbody></table></div>`;
    const root = openModal("logViewRoot", "Log View Detail", `${c.id} - ${c.name}`, body, true);
    $$("[data-log-action]", root).forEach(b => b.addEventListener("click", () => openLogAction(b.dataset.logAction)));
  }
  function openLogAction(ref) {
    const [cid, no] = ref.split("#");
    const c = visibleContracts().find(x => x.id === cid);
    const l = c && S.db.contract_logs.find(x => x.contract_id === cid && String(x.log_no) === no);
    if (!l) return;
    const rows = logViewCols("detail").map(col => ({ col, v: logDetailValue(l, col.key, c) })).filter(({ v }) => String(v[0] || "").trim() || String(v[1] || "").trim());
    const body = `<div class="reason-grid">${rows.map(({ col, v }) => `<div class="reason-row">
        <div class="reason-label"><strong>${esc(col.label_en)}</strong><span>${esc(col.label_th || "")}</span></div>
        <div class="reason-value">${v[2] ? v[0] : `<strong>${esc(v[0] || "-")}</strong>`}${v[1] ? `<span>${esc(v[1])}</span>` : ""}</div></div>`).join("")
      || `<p class="muted">No reason recorded.<br>ไม่มีการบันทึกเหตุผล</p>`}</div>`;
    openModal("logActionRoot", "Action Reason", `${cid} · Log ${l.log_no} · Cycle ${l.cycle}`, body);
  }

  // ───────────── Contract detail drawer ─────────────
  // Attachments of a log (from the Production Snapshot): each link opens the file in Google Drive,
  // or its Drive folder when the snapshot has no link to the file itself
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === "https:" && /(^|\.)google\.com$/.test(x.hostname) ? x.href : ""; } catch (e) { return ""; } };
  function logFiles(l) {
    const files = (l.details?.attachments || []).map(a => {
      const file = safeUrl(a.url || a.downloadUrl);
      return { name: a.originalFileName || a.fileName || "File", url: file || safeUrl(a.cloudFolderUrl), folder: !file };
    }).filter(a => a.url);
    return files.length ? `<div class="log-files">${files.map(f => `<a class="log-file" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer"
      title="${f.folder ? "เปิดโฟลเดอร์ใน Google Drive" : "เปิดไฟล์ใน Google Drive"}">${f.folder ? "📁" : "📎"} ${esc(f.name)}</a>`).join("")}</div>` : "";
  }
  function openDrawer(id) {
    const c = S.db.contracts.find(x => x.id === id);
    if (!c) return;
    const m = metrics(c);
    const logs = logsOf(id);
    const reqs = S.db.due_date_requests.filter(r => r.contract_id === id);
    const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><strong>${v}</strong></div>`;
    $("#drawerRoot").innerHTML = `<div class="drawer-backdrop" data-close-drawer>
      <aside class="drawer" role="dialog" aria-label="${esc(c.id)}">
        <div class="drawer-head"><div><span class="muted small">${esc(c.access_level === "Confidential" ? "Confidential Contract" : "Day-to-day Work")}</span>
          <h2>${esc(c.id)} · ${esc(c.name)}</h2><div style="margin-top:6px">${statusTag(m.code)} ${alertTag(m.alert)} <span class="tag tag-grey">${esc(m.action || c.stage)}</span></div></div>
          <button class="icon-button" data-close-drawer aria-label="Close">✕</button></div>
        <div class="drawer-body">
          <div class="kv-grid">
            ${kv("Department", esc(c.department))}${kv("Contract Owner", esc(c.owner))}${kv("Station Owner", esc(c.station_to || "-"))}
            ${kv("Type of Contract", esc(c.type))}${kv("Sub Type / Work Type", esc(c.sub_type || "-"))}${kv("Vendor / Counter party", esc(c.vendor || "-"))}
            ${kv("Add Case Date", fmtDate(c.add_case_date))}${kv("Due Date", fmtDate(c.due_date))}${kv("System Due", fmtDate(c.system_due))}
            ${kv("Total SLA", m.totalSla == null ? "Configuration Required" : `${m.totalSla} วันทำการ`)}${kv("Accumulated Days", m.acc)}
            ${kv("Days on Hand", dayText(m.onHand))}${kv("Action SLA", m.actionSla == null ? (m.alert === "N" ? "Configuration Required" : "-") : `${m.actionSla} วันทำการ`)}
            ${kv("Balance", m.balance == null ? "-" : `<span style="color:${m.balance < 0 ? "var(--red)" : "inherit"}">${m.balance}</span>`)}${kv("Cycle / Returns", `${c.cycle} / ${c.returns}`)}${kv("Closed", c.closed_at ? `${fmtDate(c.closed_at)} · ${esc(c.close_reason || "")}` : "-")}
          </div>
          ${c.remark ? `<div><p class="section-title">Remark</p><div class="current-card small">${esc(c.remark)}</div></div>` : ""}
          <div><p class="section-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px">Log View · ประวัติการดำเนินการ (${logs.length})<button class="btn" data-log-view="${esc(c.id)}">Log View Detail</button></p>
            <div class="timeline">${logs.map(l => `<div class="tl-item"><strong>#${l.log_no} ${esc(l.action || "-")}</strong> <span class="small muted">Cycle ${l.cycle} · SLA ${l.sla ?? "-"} วัน</span>
              <div class="small">From <b>${esc(l.from_person || "-")}</b> → To <b>${esc(l.to_person || "-")}</b></div>
              <div class="small muted">In ${fmtDate(l.in_date)} · Out ${l.out_date ? fmtDate(l.out_date) : "-"} · by ${esc(l.updated_by || "-")}</div>
              ${l.reason ? `<div class="small">${esc(l.reason)}</div>` : ""}${logFiles(l)}</div>`).join("") || `<div class="muted">No log</div>`}</div></div>
          ${reqs.length ? `<div><p class="section-title">Due Date Requests</p><table class="grid compact"><thead><tr><th>Requested</th><th>Reason</th><th>Status</th></tr></thead><tbody>
            ${reqs.map(r => `<tr><td>${fmtDate(r.requested_due)}</td><td>${esc(r.reason)}</td><td>${esc(r.status)}</td></tr>`).join("")}</tbody></table></div>` : ""}
          ${can(2) && m.kind === "open" ? `<div class="form-actions"><button class="btn" data-goto-step="update" data-cid="${esc(c.id)}">Update Status</button>
            <button class="btn" data-goto-step="due" data-cid="${esc(c.id)}">Request Due Date</button><button class="btn btn-primary" data-goto-step="close" data-cid="${esc(c.id)}">Close Case</button></div>` : ""}
        </div></aside></div>`;
    $$("[data-close-drawer]", $("#drawerRoot")).forEach(el => el.addEventListener("click", e => { if (e.target === el) closeDrawer(); }));
    $$("[data-log-view]", $("#drawerRoot")).forEach(b => b.addEventListener("click", () => openLogView(b.dataset.logView)));
    $$("[data-goto-step]", $("#drawerRoot")).forEach(b => b.addEventListener("click", () => {
      S.caseStep = b.dataset.gotoStep; S.selectedContract = b.dataset.cid; closeDrawer(); location.hash = "#/user";
      if (S.view === "user") render();
    }));
  }
  function closeDrawer() { $("#drawerRoot").innerHTML = ""; }

  // ───────────── User Case Action ─────────────
  function renderUserCase() {
    if (!can(2)) return lockedPanel("Contract User access required", "ต้องมีสิทธิ์ระดับ User ขึ้นไป");
    const steps = [
      ["add", "Add Case", "สร้างรายการและกำหนด SLA"], ["update", "Update Status", "ส่งต่องานและแจ้งอีเมล"],
      ["close", "Close Case", "ปิดงานหรือยกเลิก"], ["due", "Request Due Date", "ขออนุมัติเมื่อจำเป็น"]];
    const body = { add: renderAddCase, update: renderUpdateCase, close: renderCloseCase, due: renderDueCase }[S.caseStep]();
    return `<section class="panel">
      <div class="panel-head"><div><h2 style="font-size:20px">User Case Action</h2><p>ลำดับการทำงาน: Add Case → Update Status → Close Case → Request Due Date ระบบแสดงแบบฟอร์มครั้งละหนึ่งขั้นตอน</p></div>
        <span class="tag tag-dark" style="padding:6px 12px">Contract workflow · Monday-Friday SLA</span></div>
      <div class="steps">${steps.map(([k, t, s], i) => `<button class="step ${S.caseStep === k ? "active" : ""}" data-step="${k}"><span class="n">${i + 1}</span><span><strong>${t}</strong><span>${s}</span></span></button>`).join("")}</div>
    </section>${body}`;
  }

  function renderAddCase() {
    const F = S.addForm;
    const isConf = F.classification === CLASS_CONF;
    const types = uniq(activeTypes().filter(t => t.classification === F.classification).map(t => t.type));
    const subs = activeTypes().filter(t => t.classification === F.classification && t.type === F.type && t.sub_type);
    const match = activeTypes().find(t => t.classification === F.classification && t.type === F.type && (t.sub_type || "") === (F.sub_type || ""))
      || activeTypes().find(t => t.classification === F.classification && t.type === F.type);
    const sla = match ? match.sla : null;
    const start = F.add_case_date || todayISO();
    const due = sla ? addWorkdays(start, sla) : null;
    const depts = S.db.departments.filter(d => d.active !== false);
    const people = activePeople(F.department);
    const opt = (list, val, ph) => `<option value="">${esc(ph)}</option>` + list.map(v => `<option ${v === val ? "selected" : ""} value="${esc(v)}">${esc(v)}</option>`).join("");
    return `<section class="panel form-panel">
      <div class="panel-head"><div><h2 style="font-size:20px">Add Case</h2><p>สร้างเคส · Create a new contract case and calculate the initial SLA.</p></div>
        <span class="tag tag-green" style="padding:5px 10px">${isConf ? "Confidential · Restricted access" : "Normal · Standard access"}</span></div>
      <div class="panel-body" style="display:grid;gap:16px">
        <div class="toolbar" style="justify-content:space-between"><b><span class="tag tag-green">1</span> Contract classification flow</b>
          <span class="small muted">Contract Classification → Type of Contract → Sub Type → Contract Name → Vendor / Counter party</span></div>
        <div class="flow">
          <div class="flow-card"><h4><span class="n">1</span><span>Contract Classification <span class="req">*</span><br><span class="small muted">กลุ่มสัญญา</span></span></h4>
            <div class="class-options">
              <button type="button" class="class-option ${!isConf ? "on" : ""}" data-class="${esc(CLASS_DAY)}">Day-to-day Work<span>งานดำเนินงานทั่วไป</span></button>
              <button type="button" class="class-option ${isConf ? "on" : ""}" data-class="${esc(CLASS_CONF)}" ${can(3) ? "" : "disabled title='ต้องมีสิทธิ์ Confidential'"}>Confidential<span>สัญญาลับ</span></button>
            </div></div>
          <div class="flow-card"><h4><span class="n">2</span><span>Type of Contract <span class="req">*</span><br><span class="small muted">ประเภทสัญญา</span></span></h4>
            <select class="select" data-add="type">${opt(types, F.type, "Select Type of Contract")}</select>
            <p class="hint">เลือกประเภทสัญญาหลักเพื่อกำหนด SLA</p></div>
          <div class="flow-card"><h4><span class="n">3</span><span>Sub Type of Contract<br><span class="small muted">ประเภทย่อยของสัญญา</span></span></h4>
            <select class="select" data-add="sub_type" ${subs.length ? "" : "disabled"}>${opt(subs.map(s => s.sub_type), F.sub_type, F.type ? (subs.length ? "Select Sub Type" : "No Sub Type") : "Waiting for Type of Contract")}</select>
            <p class="hint">เลือกประเภทย่อยที่ตรงกับสัญญาเมื่อมีตัวเลือก</p></div>
          <div class="flow-card"><h4><span class="n">4</span><span>Contract Name <span class="req">*</span><br><span class="small muted">ชื่อสัญญา</span></span></h4>
            <input class="input" data-add="name" value="${esc(F.name || "")}" placeholder="Enter Contract Name"></div>
          <div class="flow-card"><h4><span class="n">5</span><span>Vendor / Counter party<br><span class="small muted">ผู้ขาย / คู่สัญญา</span></span></h4>
            <input class="input" data-add="vendor" value="${esc(F.vendor || "")}" placeholder="Enter Vendor or Counter party"></div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Department / Restaurant <span class="req">*</span></label><select class="select" data-add="department">${opt(depts.map(d => d.name), F.department, "Select Department")}</select></div>
          <div class="field"><label>Contract Owner <span class="req">*</span></label><select class="select" data-add="owner">${opt(people.map(p => p.name), F.owner, F.department ? "Select Contract Owner" : "Select Department first")}</select></div>
          <div class="field"><label>Send to (Station Owner) / ส่งให้</label><select class="select" data-add="station_to"><option value="">Same as Contract Owner</option>${peopleByDept(F.station_to)}</select></div>
          <div class="field"><label>Add Case Date / วันที่รับเรื่อง</label><input class="input" type="date" data-add="add_case_date" value="${esc(start)}"></div>
          <div class="field full"><label>Remark / หมายเหตุ</label><textarea class="input" rows="2" data-add="remark">${esc(F.remark || "")}</textarea></div>
        </div>
        <div class="summary-grid">
          <div class="kv"><span>Classification</span><strong>${esc(short(F.classification))}</strong></div>
          <div class="kv"><span>Type of Contract</span><strong>${esc(F.type || "-")}</strong></div>
          <div class="kv"><span>Sub Type</span><strong>${esc(F.sub_type || "No Sub Type")}</strong></div>
          <div class="kv"><span>Total SLA - Day / Due Date</span><strong>${sla ? `${sla} วันทำการ · ${fmtDate(due)}` : "-"}</strong></div>
        </div>
        <div class="form-actions"><button class="btn" data-add-reset>Clear</button><button class="btn btn-primary" data-add-submit>Add Case / สร้างเคส</button></div>
      </div></section>`;
  }

  function nextContractId(isConf, department) {
    const code = (S.db.departments.find(d => d.name === department)?.code || "GEN").toUpperCase();
    const prefix = `CT-${isConf ? "C" : "N"}-${code}-`;
    const max = S.db.contracts.filter(c => c.id.startsWith(prefix)).reduce((m, c) => Math.max(m, Number(c.id.slice(prefix.length)) || 0), 0);
    return prefix + String(max + 1).padStart(3, "0");
  }

  async function submitAddCase() {
    const F = S.addForm;
    const missing = [["type", "Type of Contract"], ["name", "Contract Name"], ["department", "Department"], ["owner", "Contract Owner"]].filter(([k]) => !F[k]).map(x => x[1]);
    if (missing.length) return toast("กรุณากรอก: " + missing.join(", "), true);
    const isConf = F.classification === CLASS_CONF;
    const match = activeTypes().find(t => t.classification === F.classification && t.type === F.type && (t.sub_type || "") === (F.sub_type || ""))
      || activeTypes().find(t => t.classification === F.classification && t.type === F.type);
    const start = F.add_case_date || todayISO();
    const sla = match?.sla || 20;
    const due = addWorkdays(start, sla);
    const to = F.station_to || F.owner;
    const id = nextContractId(isConf, F.department);
    const who = S.user.display_name || S.user.username;
    await guard(async () => {
      await window.Store.insert("contracts", {
        id, name: F.name, department: F.department, owner: F.owner, classification: short(F.classification), type: F.type,
        sub_type: short(F.sub_type) || short(F.type), vendor: F.vendor || "", stage: "Draft Created", cycle: 1, returns: 0,
        station_from: F.owner, station_to: to, station_in: start, add_case_date: start, due_date: due, system_due: due,
        total_sla: sla, remark: F.remark || "", access_level: isConf ? "Confidential" : "Normal", status: "Open"
      });
      await window.Store.insert("contract_logs", {
        contract_id: id, log_no: 1, cycle: 1, action: "Draft Created", from_person: F.owner, to_person: to,
        in_date: start, sla, reason: "Add Case", approval: "OK", updated_by: who, updated_at: new Date().toISOString()
      });
      S.addForm = { classification: F.classification };
      await reload(); renderNav(); render(); openDrawer(id);
    }, `สร้างเคส ${id} แล้ว`);
  }

  function contractPicker(attr) {
    const open = visibleContracts().filter(isOpen);
    const sel = S.selectedContract;
    return `<select class="select" data-pick="${attr}"><option value="">เลือกสัญญา / Select contract</option>
      ${open.map(c => `<option value="${esc(c.id)}" ${sel === c.id ? "selected" : ""}>${esc(c.id)} · ${esc(c.name)}</option>`).join("")}</select>`;
  }
  function currentCard(c) {
    if (!c) return `<div class="current-card muted small">ยังไม่ได้เลือกสัญญา</div>`;
    const m = metrics(c);
    return `<div class="current-card"><b>${esc(c.id)} · ${esc(c.name)}</b> ${statusTag(m.code)} ${alertTag(m.alert)}
      <div class="small muted" style="margin-top:4px">Latest Action: <b>${esc(m.action || "-")}</b> · Station: ${esc(c.station_from || "-")} → <b>${esc(c.station_to || "-")}</b> · Due ${fmtDate(c.due_date)} · Days on hand ${dayText(m.onHand)} · Accumulated ${m.acc} · Cycle ${c.cycle} · Returns ${c.returns}</div></div>`;
  }

  function renderUpdateCase() {
    const c = S.db.contracts.find(x => x.id === S.selectedContract && isOpen(x));
    const acts = S.db.action_sla.filter(a => a.active !== false);
    return `<section class="panel form-panel"><div class="panel-head"><div><h2 style="font-size:20px">Update Status</h2><p>อัปเดตสถานะ · ส่งต่อสัญญาไปยังผู้รับผิดชอบลำดับถัดไป</p></div></div>
      <div class="panel-body" style="display:grid;gap:14px">
        <div class="form-grid"><div class="field full"><label>Contract <span class="req">*</span></label>${contractPicker("update")}</div></div>
        ${currentCard(c)}
        <div class="form-grid">
          <div class="field"><label>Action <span class="req">*</span></label><select class="select" id="upAction"><option value="">Select Action</option>
            ${acts.map(a => `<option value="${esc(a.action)}">${esc(a.action)} · ${a.sla} วัน — ${esc(a.description || "")}</option>`).join("")}</select></div>
          <div class="field"><label>Send to / ส่งให้ <span class="req">*</span></label><select class="select" id="upTo"><option value="">Select person</option>
            ${peopleByDept()}</select></div>
          <div class="field"><label>Date / วันที่</label><input class="input" type="date" id="upDate" value="${todayISO()}"></div>
          <div class="field full"><label>Reason / เหตุผล</label><textarea class="input" rows="2" id="upReason" placeholder="รายละเอียดการดำเนินการ"></textarea></div>
          <div class="field full"><label>CC E-Mail / สำเนาถึง</label>
            <div class="cc-row"><select class="select cc-pick" id="upCcPick"><option value="">เลือกตามแผนก / Pick by department</option>${ccByDept()}</select>
            <div class="cc-box"><span data-cc-chips>${ccChips()}</span><input class="cc-input" id="upCc" list="ccOptions" autocomplete="off" placeholder="หรือพิมพ์อีเมลแล้วกด Enter"></div></div>
            <datalist id="ccOptions">${ccOptions().map(o => `<option value="${esc(o.email)}">${esc(o.name)}</option>`).join("")}</datalist></div>
        </div>
        <div class="form-actions"><button class="btn btn-primary" data-update-submit ${c ? "" : "disabled"}>Save Update / บันทึก</button></div>
      </div></section>`;
  }

  // CC E-Mail: emails from People Master plus active users, and any other email typed in
  function ccOptions() {
    const out = new Map();
    activePeople().filter(p => p.email).forEach(p => out.set(p.email.toLowerCase(), { name: p.name, email: p.email.toLowerCase() }));
    (S.db.user_access || []).filter(u => u.active !== false && u.email && !out.has(u.email.toLowerCase()))
      .forEach(u => out.set(u.email.toLowerCase(), { name: u.display_name || u.email, email: u.email.toLowerCase() }));
    return [...out.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }
  // CC options grouped by department: People Master by their department, other active users by theirs
  function ccByDept() {
    const people = ccOptions().map(o => {
      const p = activePeople().find(x => (x.email || "").toLowerCase() === o.email), u = (S.db.user_access || []).find(x => (x.email || "").toLowerCase() === o.email);
      return { name: o.name, email: o.email, department: (p && p.department) || (u && u.department) || "Other" };
    });
    return peopleByDept(null, "email", people);
  }
  const ccChips = () => (S.ccDraft || []).map((r, i) => `<span class="cc-chip" title="${esc(r.email)}">${esc(r.name || r.email)}<button type="button" data-cc-del="${i}" aria-label="Remove">×</button></span>`).join("");
  function addCc(value) {
    const email = String(value || "").trim().replace(/[,;]+$/, "").toLowerCase();
    if (!email) return false;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("อีเมลไม่ถูกต้อง", true); return false; }
    S.ccDraft = S.ccDraft || [];
    if (!S.ccDraft.some(r => r.email === email)) S.ccDraft.push(ccOptions().find(o => o.email === email) || { name: email, email });
    return true;
  }
  function bindCc(root) {
    const input = $("#upCc", root); if (!input) return;
    const draw = () => { $("[data-cc-chips]", root).innerHTML = ccChips(); };
    $("#upCcPick", root)?.addEventListener("change", e => { if (e.target.value && addCc(e.target.value)) draw(); e.target.value = ""; });
    const take = () => { if (addCc(input.value)) { input.value = ""; draw(); } };
    input.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === "," || e.key === ";") { e.preventDefault(); take(); } });
    input.addEventListener("input", e => { if (e.inputType === "insertReplacementText" || ccOptions().some(o => o.email === input.value.trim().toLowerCase())) take(); });
    input.addEventListener("blur", () => { if (input.value.trim()) take(); });
    $("[data-cc-chips]", root).addEventListener("click", e => {
      const b = e.target.closest("[data-cc-del]"); if (!b) return;
      S.ccDraft.splice(Number(b.dataset.ccDel), 1); draw();
    });
  }

  async function submitUpdate() {
    const c = S.db.contracts.find(x => x.id === S.selectedContract);
    const action = $("#upAction").value, to = $("#upTo").value, date = $("#upDate").value || todayISO(), reason = $("#upReason").value.trim();
    if (!c || !action || !to) return toast("กรุณาเลือก Contract, Action และผู้รับ", true);
    if (S.ccDraft === undefined) S.ccDraft = [];
    if ($("#upCc")?.value.trim() && !addCc($("#upCc").value)) return;
    const last = latestLog(c.id);
    const logNo = Math.max(0, ...logsOf(c.id).map(l => Number(l.log_no) || 0)) + 1;
    const cycle = c.cycle + (action === "Resubmit" ? 1 : 0);
    const returns = c.returns + (action === "Return" ? 1 : 0);
    const who = S.user.display_name || S.user.username;
    // The new Action starts today: Days on Hand 0, Alert from the Action SLA Master (Forward = U=Uncontrol)
    const forward = FORWARD_ACTION.test(action), aSla = forward ? null : actionSla(action);
    const onHand = forward ? null : workdays(date, todayISO());
    const alert = forward ? "U" : aSla == null ? "N" : onHand < aSla - 1 ? "G" : onHand <= aSla ? "Y" : "R";
    const cc = (S.ccDraft || []).map(r => ({ name: r.name, email: r.email }));
    await guard(async () => {
      if (last && !last.out_date) await window.Store.update("contract_logs", last.id, { out_date: date });
      await window.Store.insert("contract_logs", {
        contract_id: c.id, log_no: logNo, cycle, action, from_person: c.station_to || c.owner, to_person: to,
        in_date: date, sla: aSla, action_sla: aSla, days_on_hand: onHand, alert: ALERT_LABEL[alert], cc_recipients: cc,
        reason, approval: "OK", updated_by: who, updated_at: new Date().toISOString()
      });
      await window.Store.update("contracts", c.id, {
        stage: STAGE_BY_ACTION[action] || action, cycle, returns, station_from: c.station_to || c.owner, station_to: to, station_in: date
      });
      S.ccDraft = [];
      await reload(); render();
    }, `อัปเดต ${c.id} แล้ว`);
  }

  function renderCloseCase() {
    const c = S.db.contracts.find(x => x.id === S.selectedContract && isOpen(x));
    return `<section class="panel form-panel"><div class="panel-head"><div><h2 style="font-size:20px">Close Case</h2><p>ปิดงานเมื่อสัญญาเสร็จสมบูรณ์ หรือยกเลิกเคส</p></div></div>
      <div class="panel-body" style="display:grid;gap:14px">
        <div class="form-grid"><div class="field full"><label>Contract <span class="req">*</span></label>${contractPicker("close")}</div></div>
        ${currentCard(c)}
        <div class="form-grid">
          <div class="field"><label>Result / ผลลัพธ์ <span class="req">*</span></label><select class="select" id="clResult">
            <option value="Closed">Completed · ลงนามเรียบร้อย</option><option value="Cancelled">Cancelled · ยกเลิก</option></select></div>
          <div class="field"><label>Close Date / วันที่ปิด</label><input class="input" type="date" id="clDate" value="${todayISO()}"></div>
          <div class="field full"><label>Note / หมายเหตุ</label><textarea class="input" rows="2" id="clNote"></textarea></div>
        </div>
        <div class="form-actions"><button class="btn btn-primary" data-close-submit ${c ? "" : "disabled"}>Close Case / ปิดเคส</button></div>
      </div></section>`;
  }

  async function submitClose() {
    const c = S.db.contracts.find(x => x.id === S.selectedContract);
    if (!c) return toast("กรุณาเลือกสัญญา", true);
    const result = $("#clResult").value, date = $("#clDate").value || todayISO(), note = $("#clNote").value.trim();
    const last = latestLog(c.id);
    const logNo = Math.max(0, ...logsOf(c.id).map(l => Number(l.log_no) || 0)) + 1;
    const who = S.user.display_name || S.user.username;
    await guard(async () => {
      if (last && !last.out_date) await window.Store.update("contract_logs", last.id, { out_date: date });
      await window.Store.insert("contract_logs", {
        contract_id: c.id, log_no: logNo, cycle: c.cycle, action: result === "Closed" ? "Completed" : "Cancelled",
        alert: result === "Closed" ? "B=Completed" : "B=Cancelled", days_on_hand: 0,
        from_person: c.station_to, to_person: c.owner, in_date: date, out_date: date, reason: note, approval: "OK", updated_by: who, updated_at: new Date().toISOString()
      });
      await window.Store.update("contracts", c.id, { status: result, stage: result === "Closed" ? "Completed" : "Cancelled", closed_at: date, close_reason: note || (result === "Closed" ? "Completed" : "Cancelled") });
      S.selectedContract = null;
      await reload(); renderNav(); render();
    }, `ปิดเคส ${c.id} แล้ว`);
  }

  function renderDueCase() {
    const c = S.db.contracts.find(x => x.id === S.selectedContract && isOpen(x));
    const mine = S.db.due_date_requests.filter(r => visibleContracts().some(v => v.id === r.contract_id)).sort((a, b) => b.id - a.id).slice(0, 10);
    return `<section class="panel form-panel"><div class="panel-head"><div><h2 style="font-size:20px">Request Due Date</h2><p>ขอขยายวันครบกำหนด ส่งให้ Admin อนุมัติ</p></div></div>
      <div class="panel-body" style="display:grid;gap:14px">
        <div class="form-grid"><div class="field full"><label>Contract <span class="req">*</span></label>${contractPicker("due")}</div></div>
        ${currentCard(c)}
        <div class="form-grid">
          <div class="field"><label>Requested Due Date <span class="req">*</span></label><input class="input" type="date" id="ddDate" value="${c ? esc(c.due_date) : ""}"></div>
          <div class="field" style="grid-column:span 2"><label>Reason / เหตุผล <span class="req">*</span></label><input class="input" id="ddReason" placeholder="เหตุผลที่ขอขยายเวลา"></div>
        </div>
        <div class="form-actions"><button class="btn btn-primary" data-due-submit ${c ? "" : "disabled"}>Submit Request / ส่งคำขอ</button></div>
        ${mine.length ? `<div><p class="section-title">คำขอล่าสุด</p><div class="table-wrap"><table class="grid compact"><thead><tr><th>#</th><th>Contract</th><th>Requested</th><th>Reason</th><th>By</th><th>Status</th></tr></thead><tbody>
          ${mine.map(r => `<tr><td>${r.id}</td><td>${esc(r.contract_id)}</td><td>${fmtDate(r.requested_due)}</td><td>${esc(r.reason)}</td><td>${esc(r.requested_by)}</td><td>${reqTag(r.status)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      </div></section>`;
  }
  const reqTag = s => `<span class="tag ${s === "Approved" ? "tag-green" : s === "Rejected" ? "tag-red" : "tag-amber"}">${esc(s)}</span>`;

  async function submitDue() {
    const c = S.db.contracts.find(x => x.id === S.selectedContract);
    const date = $("#ddDate").value, reason = $("#ddReason").value.trim();
    if (!c || !date || !reason) return toast("กรุณาเลือกสัญญา วันที่ และเหตุผล", true);
    await guard(async () => {
      await window.Store.insert("due_date_requests", {
        contract_id: c.id, requested_due: date, reason, requested_by: S.user.display_name || S.user.username, status: "Pending", created_at: new Date().toISOString()
      });
      await reload(); render();
    }, "ส่งคำขอแล้ว รอ Admin อนุมัติ");
  }

  // ───────────── Master data ─────────────
  // Column kinds: "key" (typed once, on a new row), "ro", "num", "date", "bool", a list of options, or a function returning one
  const deptOptions = () => ["", ...(S.db.departments || []).map(d => d.name)];
  const classOptions = () => uniq([CLASS_DAY, CLASS_CONF, ...(S.db.contract_types || []).map(t => t.classification)]);
  const countWhere = (rows, fn) => (rows || []).filter(fn).length;
  const peopleOptions = () => ["", ...(S.db.people || []).map(p => p.name)];
  const actionOptions = () => uniq(["Draft Created", ...(S.db.action_sla || []).map(a => a.action), "Signed / Completed", "Completed", "Cancelled"]);
  const ALERT_OPTIONS = ["", "Green >>G=On Track", "Yellow >>Y=Delayed", "Red >>R=At Risk", "Gray >>U=Uncontrol", "Black >>B=Completed", "Black >>B=Cancelled"];
  const MASTER = {
    contracts: { title: "Contract Records", sub: "แก้ไขหรือลบเคสที่สร้างผิดจาก Add Case", required: ["id", "name"], cols: [
      ["id", "Contract ID", "ro"], ["name", "Contract Name"], ["department", "Department / Restaurant", deptOptions], ["owner", "Contract Owner"],
      ["type", "Type of Contract"], ["sub_type", "Sub Type"], ["vendor", "Vendor"], ["stage", "Stage"], ["due_date", "Due Date", "date"],
      ["total_sla", "Total SLA", "num"], ["access_level", "Access Level", ["Normal", "Confidential"]], ["status", "Status", ["Open", "Closed", "Cancelled"]], ["remark", "Remark"]] },
    departments: { title: "Departments", sub: "แผนก / ร้านอาหาร", track: true, required: ["name"], unique: [["name"]],
      cols: [["name", "Department / Restaurant", "key"], ["code", "Department Code"], ["active", "Active", "bool"]],
      uses: r => countWhere(S.db.contracts, c => c.department === r.name) + countWhere(S.db.people, p => p.department === r.name)
        + countWhere(S.db.user_access, u => u.department === r.name) + countWhere(S.db.contract_templates, t => t.department === r.name) },
    people: { title: "People", sub: "รายชื่อผู้รับผิดชอบ", track: true, required: ["name"], unique: [["name"], ["email"]],
      cols: [["name", "Name", "key"], ["department", "Department", deptOptions], ["email", "Email"], ["line_user_id", "LINE User ID"], ["active", "Active", "bool"]],
      uses: r => countWhere(S.db.contracts, c => [c.owner, c.station_from, c.station_to].includes(r.name))
        + countWhere(S.db.contract_logs, l => l.from_person === r.name || l.to_person === r.name) },
    contract_types: { title: "Type of Contract", sub: "ประเภทสัญญาและ SLA มาตรฐาน (วันทำการ)", track: true,
      required: ["classification", "type"], unique: [["classification", "type", "sub_type"]],
      cols: [["id", "#", "ro"], ["classification", "Classification", classOptions], ["type", "Type of Contract"], ["sub_type", "Sub Type of Contract"], ["sla", "Fixed SLA", "num"], ["active", "Active", "bool"]],
      // contracts point at the Type of Contract, so a row is in use only when no other row keeps that type
      uses: r => S.db.contract_types.some(t => t.type === r.type && t.id !== r.id) ? 0 : countWhere(S.db.contracts, c => c.type === r.type) },
    contract_templates: { title: "Contract Name Template", sub: "ชื่อสัญญามาตรฐาน (contract_template_master)", track: true,
      required: ["selection_label", "name"], unique: [["selection_label"]], cols: [
        ["id", "#", "ro"], ["selection_label", "Selection Label"], ["name", "Contract Name"], ["classification", "Classification", classOptions],
        ["type_group", "Type Group"], ["sub_type", "Sub Type"], ["type", "Type of Contract"], ["work_type", "Work Type"], ["contract_id", "Contract ID"],
        ["access_level", "Access Level", ["", "Normal", "Confidential"]], ["category", "Category"], ["department", "Department", deptOptions],
        ["vendor", "Vendor"], ["group_name", "Group"], ["fixed_sla", "Fixed SLA", "num"], ["sla_version", "SLA Version"], ["source_row", "Source Row", "num"],
        ["remark", "Remark"], ["active", "Active", "bool"]] },
    action_sla: { title: "Action SLA", sub: "SLA ของแต่ละ Action ใน Update Status", track: true, required: ["action"], unique: [["action"]],
      cols: [["action", "Action", "key"], ["description", "Description / รายละเอียด"], ["sla", "Fixed SLA (Working Days)", "num"], ["rule", "SLA Rule / วิธีนับ"], ["active", "Active", "bool"]],
      uses: r => countWhere(S.db.contract_logs, l => l.action === r.action) },
    contract_logs: { title: "Log View Detail", sub: "แก้ไขข้อมูลใน Log View Detail ของแต่ละสัญญาโดยตรง · เลือกสัญญาก่อน หรือค้นหา", track: true, fixed: true,
      byContract: true, required: ["action"], unique: [["contract_id", "log_no"]], cols: [
        ["contract_id", "Contract ID", "ro"], ["log_no", "Log No", "ro"], ["cycle", "Cycle", "num"], ["from_person", "From", peopleOptions],
        ["to_person", "To", peopleOptions], ["in_date", "In", "date"], ["out_date", "Out", "date"], ["sla", "SLA", "num"],
        ["days_on_hand", "Days on Hand", "num"], ["alert", "Alert", ALERT_OPTIONS], ["delay_reason", "Delay Reason"], ["action", "Action", actionOptions],
        ["action_reason_type", "Reason Type"], ["action_reason", "Action Reason"], ["reason", "Reason / Remark"], ["approval_type", "Approval Type"],
        ["approval", "Approval"], ["corrective_action", "Corrective Action"], ["updated_by", "Updated By"], ["id", "Row", "ro"]] },
    log_view_columns: { title: "Log View Columns", sub: "หัวตาราง Log View Detail (table) และแถวในหน้าต่าง Action (detail) · ซ่อนได้ด้วย Visible", track: true,
      fixed: true, required: ["label_en"], unique: [["section", "key"]],
      cols: [["section", "Section", "ro"], ["key", "Field", "ro"], ["position", "Order", "num"], ["label_en", "Label (EN)"], ["label_th", "Label (TH)"], ["visible", "Visible", "bool"]] },
    user_access: { title: "Users & Roles", sub: "ผู้ใช้ที่เข้าระบบด้วย Microsoft 365 ได้ และระดับสิทธิ์ (จับคู่ด้วยอีเมลบริษัท)", admin: true, required: ["email"], unique: [["email"]], cols: [
      ["email", "Microsoft 365 Email", "key"], ["display_name", "Display Name"], ["department", "Department"],
      ["role", "Access Level", Object.entries(window.ROLES).map(([k, r]) => [k, `${r.level} · ${r.label} — ${r.nameEn}`])], ["active", "Active", "bool"], ["source", "Managed by", "ro"]] },
    entra_role_mappings: { title: "Entra Role Mapping", sub: "App Role (หรือ Group ID) ใน Microsoft Entra → Access Level · มีผลทุกครั้งที่ผู้ใช้เข้าระบบ", admin: true, required: ["claim_value"], unique: [["claim_value"]], cols: [
      ["claim_value", "Entra App Role / Group ID", "key"], ["role", "Access Level", Object.entries(window.ROLES).map(([k, r]) => [k, `${r.level} · ${r.label} — ${r.nameEn}`])], ["note", "Note"]] }
  };
  const MASTER_TABS = Object.keys(MASTER).filter(k => !MASTER[k].admin);

  // The values a row saves (compared with the loaded copy to find what changed)
  function masterValues(def, r) {
    const o = {};
    def.cols.forEach(([k, , kind]) => {
      let v = r[k];
      if (kind === "num") v = v === "" || v == null ? null : Number(v);
      else if (kind === "date") v = v || null;
      else if (kind === "bool") v = v !== false;
      else if (typeof v === "string") v = v.trim();
      if (k === "email") v = v ? String(v).toLowerCase() : null;
      o[k] = v;
    });
    if (def.track) o.locked = Boolean(r.locked);
    return o;
  }
  const masterSig = (def, r) => JSON.stringify(masterValues(def, r));
  const rowChanged = (def, r) => r.__new || masterSig(def, r) !== r.__o;

  function ensureDraft(t) {
    if (!S.masterDraft || S.masterDraft.table !== t) {
      const def = MASTER[t];
      let src = t === "contracts" ? visibleContracts() : S.db[t] || [];
      if (t === "contract_logs") {
        const ids = new Set(visibleContracts().map(c => c.id));
        src = src.filter(l => ids.has(l.contract_id)).sort((a, b) => a.contract_id.localeCompare(b.contract_id) || a.log_no - b.log_no);
      }
      // Log View Columns not saved yet: start from the built-in headers and save them all on the first Save
      const fromDefaults = t === "log_view_columns" && !src.length;
      if (fromDefaults) src = LOG_VIEW_DEFAULT.map(r => ({ ...r, position: LOG_VIEW_DEFAULT.filter(x => x.section === r.section).indexOf(r) + 1 }));
      if (t === "log_view_columns") src = [...src].sort((a, b) => a.section.localeCompare(b.section) || a.position - b.position);
      const rows = JSON.parse(JSON.stringify(src));
      // Logs imported before 007 keep some values only in `details`: show them as Log View does
      if (t === "contract_logs") rows.forEach(r => def.cols.forEach(([k]) => {
        if (r[k] == null || r[k] === "") { const v = lf(r, k); if (v !== "" && v != null && typeof v !== "object") r[k] = v; }
      }));
      rows.forEach(r => { r.__o = masterSig(def, r); });
      S.masterDraft = { table: t, rows, removed: [], dirty: false, problems: [], fromDefaults };
      S.masterQ = ""; S.masterShow = "all";
      if (def.byContract && !rows.some(r => r.contract_id === S.masterContract)) S.masterContract = rows[0]?.contract_id || "";
    }
    return S.masterDraft;
  }

  // Missing required values, duplicate keys and bad numbers or emails
  function masterProblems(t, D) {
    const def = MASTER[t], out = [];
    const label = k => (def.cols.find(c => c[0] === k) || [k, k])[1];
    const rowName = (r, i) => `แถว ${i + 1}${r[def.cols[0][0]] != null && r[def.cols[0][0]] !== "" && def.cols[0][2] !== "ro" ? ` (${r[def.cols[0][0]]})` : ""}`;
    D.rows.forEach((r, i) => {
      (def.required || []).forEach(k => { if (!String(r[k] ?? "").trim()) out.push(`${rowName(r, i)}: กรุณากรอก ${label(k)}`); });
      def.cols.forEach(([k, l, kind]) => {
        if (kind === "num" && r[k] !== "" && r[k] != null && !Number.isFinite(Number(r[k]))) out.push(`${rowName(r, i)}: ${l} ต้องเป็นตัวเลข`);
        if (k === "email" && r[k] && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(r[k]).trim())) out.push(`${rowName(r, i)}: อีเมลไม่ถูกต้อง`);
      });
    });
    (def.unique || []).forEach(ks => {
      const seen = new Map();
      D.rows.forEach((r, i) => {
        const parts = ks.map(k => String(r[k] ?? "").trim().toLowerCase());
        if (parts.every(p => !p)) return;
        const v = parts.join(" | ");
        if (seen.has(v)) out.push(`ข้อมูลซ้ำ ${ks.map(label).join(" + ")}: "${ks.map(k => r[k] ?? "").join(" | ")}" (แถว ${seen.get(v) + 1} และ ${i + 1})`);
        else seen.set(v, i);
      });
    });
    return out;
  }

  // Editable table bound to S.masterDraft (used by Master Data and Admin Tools)
  function renderGrid(t, editable, opts = {}) {
    const def = MASTER[t], D = ensureDraft(t);
    const cell = (r, i, [k, , kind]) => {
      const v = r[k];
      const dis = !editable || kind === "ro" || (kind === "key" && !r.__new) ? "disabled" : "";
      if (kind === "bool") return `<input type="checkbox" data-cell="${i}" data-k="${k}" ${v !== false ? "checked" : ""} ${editable ? "" : "disabled"}>`;
      const list = typeof kind === "function" ? kind() : kind;
      if (Array.isArray(list)) {
        const vals = list.map(o => Array.isArray(o) ? o : [o, o]);
        if (v != null && v !== "" && !vals.some(([val]) => val === v)) vals.push([v, v]); // keep a value that is not in the list
        return `<select class="cell-input" data-cell="${i}" data-k="${k}" ${editable ? "" : "disabled"}>${vals.map(([val, label]) =>
          `<option value="${esc(val)}" ${val === (v ?? "") ? "selected" : ""}>${esc(label || "—")}</option>`).join("")}</select>`;
      }
      return `<input class="cell-input" ${kind === "date" ? 'type="date"' : kind === "num" ? 'type="number" style="min-width:70px"' : ""} data-cell="${i}" data-k="${k}" value="${esc(v ?? "")}" title="${esc(v ?? "")}" ${dis}>`;
    };
    const extra = opts.extraCol;
    const track = def.track, canDel = editable && !def.fixed;
    const edited = r => r.edited_by ? `${esc(r.edited_by)}<br><span class="muted">${esc(String(r.edited_at || "").slice(0, 16).replace("T", " "))}</span>` : `<span class="muted">Import</span>`;
    const changed = D.rows.filter(r => rowChanged(def, r)).length + D.removed.length;
    const showOpts = [["all", "ทั้งหมด"], ["active", def.cols.some(c => c[0] === "visible") ? "Visible" : "Active"], ["inactive", "ปิดใช้งาน"],
      ...(track ? [["locked", "Locked (แก้ไขเอง)"]] : []), ["changed", "ยังไม่บันทึก"]];
    return `<section class="panel">
      <div class="panel-head"><div><h2>${esc(def.title)}</h2><p>${esc(def.sub)} · <span data-master-count>${D.rows.length}</span> rows${changed ? ` · <b style="color:var(--t23-orange-dark)">ยังไม่บันทึก ${changed} แถว</b>` : ""}</p></div>
        <div class="toolbar">
          ${def.byContract ? `<select class="cell-input master-show" data-master-contract><option value="">ทุกสัญญา / All contracts</option>${uniq(D.rows.map(r => r.contract_id)).map(id =>
            `<option ${S.masterContract === id ? "selected" : ""}>${esc(id)}</option>`).join("")}</select>` : ""}
          <input class="cell-input master-search" type="search" data-master-q placeholder="ค้นหา…" value="${esc(S.masterQ || "")}">
          <select class="cell-input master-show" data-master-show>${showOpts.map(([v, l]) => `<option value="${v}" ${S.masterShow === v ? "selected" : ""}>${l}</option>`).join("")}</select>
          ${editable && t !== "contracts" && !def.fixed ? `<button class="btn" data-master-add>+ Add Row</button>` : ""}
          ${editable ? `<label class="btn">Import CSV<input type="file" accept=".csv" data-master-import hidden></label>` : ""}
          <button class="btn" data-master-export>Export</button>
          ${opts.saveLabel && editable ? `<button class="btn btn-primary" data-master-save ${D.dirty ? "" : "disabled"}>${esc(opts.saveLabel)}</button>` : ""}</div></div>
      ${D.problems.length ? `<div class="master-problems"><b>บันทึกไม่ได้ กรุณาแก้ ${D.problems.length} รายการ</b><ul>${D.problems.slice(0, 12).map(p => `<li>${esc(p)}</li>`).join("")}${D.problems.length > 12 ? `<li>…</li>` : ""}</ul></div>` : ""}
      <div class="table-wrap" style="max-height:calc(100vh - 300px)"><table class="grid compact">
        <thead><tr>${def.cols.map(c => `<th>${esc(c[1])}${(def.required || []).includes(c[0]) && c[2] !== "ro" ? ' <span class="req">*</span>' : ""}</th>`).join("")}${extra ? `<th>${esc(extra.label)}</th>` : ""}
          ${track ? `<th title="แถวที่แก้ไขเองจะถูก Lock ไว้ Import จะไม่เขียนทับ · เอาเครื่องหมายออกเพื่อให้ Import อัปเดตได้">Locked</th><th>Edited by</th>` : ""}${canDel ? "<th></th>" : ""}</tr></thead>
        <tbody>${D.rows.map((r, i) => def.byContract && S.masterContract && r.contract_id !== S.masterContract ? "" : `<tr data-ri="${i}" class="${rowChanged(def, r) ? "row-changed" : ""}${r.active === false || r.visible === false ? " row-inactive" : ""}">${def.cols.map(c => `<td>${cell(r, i, c)}</td>`).join("")}${extra ? `<td class="small">${extra.value(r)}</td>` : ""}
          ${track ? `<td class="center"><input type="checkbox" data-cell="${i}" data-k="locked" ${r.locked ? "checked" : ""} ${editable ? "" : "disabled"}></td><td class="small nowrap">${r.__new ? "" : edited(r)}</td>` : ""}
          ${canDel ? `<td><button class="btn btn-sm btn-danger" data-master-del="${i}" title="Delete">Delete</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="${def.cols.length + 4}" class="empty">No rows</td></tr>`}</tbody>
      </table></div></section>${track ? renderMasterHistory(t) : ""}`;
  }

  // Who changed what in this table (public.master_audit, 008_master_data.sql)
  function renderMasterHistory(t) {
    const all = S.db.master_audit;
    const rows = (all || []).filter(a => a.table_name === t).slice(0, 100);
    const skip = ["edited_by", "edited_at", "id", "created_at", "updated_at"];
    const changes = a => {
      if (a.action !== "update") return a.action === "insert" ? "เพิ่มแถว" : "ลบแถว";
      return Object.keys({ ...a.before, ...a.after }).filter(k => !skip.includes(k) && JSON.stringify(a.before?.[k] ?? null) !== JSON.stringify(a.after?.[k] ?? null))
        .map(k => `${k}: ${a.before?.[k] ?? "—"} → ${a.after?.[k] ?? "—"}`).join(" · ");
    };
    return `<details class="panel master-history"><summary><b>History</b> <span class="muted">· ประวัติการแก้ไข ${esc(MASTER[t].title)} ${all ? `(${rows.length} รายการล่าสุด)` : `(แสดงหลังรัน ${t === "contract_logs" ? "009_log_edit.sql" : "008_master_data.sql"})`}</span></summary>
      ${rows.length ? `<div class="table-wrap" style="max-height:360px"><table class="grid compact"><thead><tr><th>When</th><th>By</th><th>Source</th><th>Row</th><th>Change</th></tr></thead><tbody>
        ${rows.map(a => `<tr><td class="nowrap">${esc(String(a.changed_at || "").slice(0, 16).replace("T", " "))}</td><td>${esc(a.changed_by || "")}</td>
          <td>${a.source === "import" ? "Import" : "แก้ไขเอง"}</td><td>${esc(a.row_key || "")}</td><td class="small">${esc(changes(a))}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="muted" style="padding:0 18px 14px">ยังไม่มีประวัติ</p>`}</details>`;
  }

  function renderMaster() {
    const t = MASTER_TABS.includes(S.masterTab) ? S.masterTab : "contracts";
    const editable = can(5);
    const D = ensureDraft(t);
    return `<section class="panel">
      <div class="panel-head"><div><h2>Master Data</h2><p>แก้ไขข้อมูลหลักโดยตรงและบันทึกกลับฐานข้อมูล · แถวที่แก้ไขเองจะ Lock ไว้ ไม่ถูก Import เขียนทับ${editable ? "" : " · อ่านอย่างเดียว (แก้ไขได้เฉพาะ Level 5)"}</p></div>
        ${editable ? `<button class="btn btn-primary" data-master-save ${D.dirty ? "" : "disabled"}>Save Master Data</button>` : ""}</div>
      <div class="tabs">${MASTER_TABS.map(k => `<button class="tab ${k === t ? "on" : ""}" data-mtab="${k}">${esc(MASTER[k].title)}</button>`).join("")}</div>
    </section>${renderGrid(t, editable)}`;
  }

  // Hide rows that do not match the search box or the Show filter (rows keep their index, so edits still land on the right row)
  function applyMasterFilter(root) {
    const D = S.masterDraft; if (!D) return;
    const def = MASTER[D.table], q = (S.masterQ || "").trim().toLowerCase(), show = S.masterShow || "all";
    const cid = def.byContract ? S.masterContract || "" : "";
    let n = 0;
    $$("tr[data-ri]", root).forEach(tr => {
      const r = D.rows[Number(tr.dataset.ri)];
      const on = r.active !== false && r.visible !== false;
      const ok = (!cid || r.contract_id === cid) && (!q || def.cols.map(c => r[c[0]] ?? "").join(" ").toLowerCase().includes(q))
        && (show === "all" || (show === "active" && on) || (show === "inactive" && !on) || (show === "locked" && r.locked) || (show === "changed" && rowChanged(def, r)));
      tr.hidden = !ok; if (ok) n++;
    });
    const c = $("[data-master-count]", root);
    const total = cid ? D.rows.filter(r => r.contract_id === cid).length : D.rows.length;
    if (c) c.textContent = n === total ? String(n) : `${n} / ${total}`;
  }

  async function saveMaster() {
    const D = S.masterDraft, def = MASTER[D.table];
    D.problems = masterProblems(D.table, D);
    if (D.problems.length) { render(); return toast(D.problems[0], true); }
    const changed = D.fromDefaults ? D.rows : D.rows.filter(r => rowChanged(def, r));
    if (!changed.length && !D.removed.length) { D.dirty = false; render(); return toast("ไม่มีการเปลี่ยนแปลง"); }
    const clean = changed.map(r => {
      const o = masterValues(def, r);
      if (def.track && r.__new) o.locked = true;
      return o;
    });
    await guard(async () => {
      for (const k of D.removed) await window.Store.remove(D.table, k);
      if (clean.length) await window.Store.upsertMany(D.table, clean);
      S.masterDraft = null;
      await reload(); renderNav(); render();
    }, D.table === "user_access" ? "บันทึกสิทธิ์ผู้ใช้แล้ว" : D.table === "entra_role_mappings" ? "บันทึกการจับคู่ Role แล้ว"
      : `บันทึกแล้ว ${clean.length} แถว${D.removed.length ? ` · ลบ ${D.removed.length} แถว` : ""}`);
  }

  function importMaster(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result));
      if (rows.length < 2) return toast("ไฟล์ว่าง", true);
      const head = rows[0].map(h => h.trim());
      const t = S.masterDraft.table, def = MASTER[t];
      const idx = def.cols.map(([k, label]) => head.findIndex(h => h === k || h === label));
      if (idx.every(i => i < 0)) return toast("หัวคอลัมน์ไม่ตรงกับตาราง", true);
      // Match an existing row by its key (or by its unique columns, e.g. Classification + Type + Sub Type)
      const keyCols = (window.TABLE_KEYS[t] === "id" ? (def.unique || [])[0] : window.TABLE_KEYS[t].split(",")) || [];
      const sig = r => keyCols.map(k => String(r[k] ?? "").trim().toLowerCase()).join("|");
      let added = 0, updated = 0;
      rows.slice(1).filter(r => r.some(v => String(v).trim())).forEach(r => {
        const o = {};
        def.cols.forEach(([k, , kind], j) => { if (idx[j] < 0 || kind === "ro") return; let v = r[idx[j]]; if (kind === "bool") v = !/^(no|false|0|n)$/i.test(String(v).trim()); o[k] = v; });
        const existing = keyCols.length && S.masterDraft.rows.find(x => sig(x) === sig(o));
        if (existing) { Object.assign(existing, o); updated++; }
        else if (!def.fixed) { S.masterDraft.rows.push({ active: true, ...o, __new: true }); added++; }
      });
      S.masterDraft.dirty = true; render(); toast(`อ่านไฟล์แล้ว: แก้ ${updated} แถว เพิ่ม ${added} แถว (ยังไม่บันทึก กด Save)`);
    };
    reader.readAsText(file, "utf-8");
  }

  // ───────────── Admin tools ─────────────
  function renderAdmin() {
    if (!can(4)) return lockedPanel("Admin only", "ต้องมีสิทธิ์ผู้ดูแลระบบ");
    const reqs = S.db.due_date_requests;
    const pending = reqs.filter(r => r.status === "Pending");
    const history = reqs.filter(r => r.status !== "Pending").sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)));
    const alerts = visibleContracts().map(c => ({ c, m: metrics(c) })).filter(x => x.m.kind === "open" && (x.m.code === "R" || x.m.code === "Y"));
    const msg = ({ c, m }) => `[${m.code}] Contract Status Update: ${m.code === "R" ? "Overdue" : "Delayed"}\nสถานะสัญญา: ${m.code === "R" ? "เกิน SLA รวม" : "ใกล้ครบ SLA"}\n\nContract ID: ${c.id}\nContract Name: ${c.name}\nContract Owner: ${c.owner}\nStation Owner: ${c.station_to}\nDue Date: ${fmtDate(c.due_date)}\n\nPlease update the action plan immediately. / กรุณาอัปเดตแผนดำเนินการทันที`;
    return `<section class="panel"><div class="panel-head"><div><h2>Admin Tools <span class="tag tag-dark">Admin Only</span></h2><p>เครื่องมือสำหรับผู้ดูแลระบบ</p></div>
      ${window.Store.mode === "demo" ? `<button class="btn" data-reset-demo>Reset demo data</button>` : ""}</div></section>
    ${renderImport()}
    <section class="panel"><div class="panel-head"><div><h2>Due Date Approval <span class="tag tag-dark">Admin Only</span></h2><p>อนุมัติการปรับวันครบกำหนด</p></div></div>
      <div class="table-wrap"><table class="grid compact"><thead><tr><th>Request ID</th><th>Contract</th><th>Current Due</th><th>Requested Due Date</th><th>Reason</th><th>Requested By</th><th>Final Due</th><th>Decision</th></tr></thead>
      <tbody>${pending.map(r => { const c = S.db.contracts.find(x => x.id === r.contract_id); return `<tr><td>${r.id}</td><td><button class="id-link" data-open="${esc(r.contract_id)}">${esc(r.contract_id)}</button></td>
        <td>${fmtDate(c?.due_date)}</td><td>${fmtDate(r.requested_due)}</td><td>${esc(r.reason)}</td><td>${esc(r.requested_by)}</td>
        <td><input class="cell-input" type="date" value="${esc(r.requested_due)}" id="final-${r.id}"></td>
        <td style="white-space:nowrap"><button class="btn btn-sm btn-green" data-approve="${r.id}">Approve</button> <button class="btn btn-sm btn-danger" data-reject="${r.id}">Reject</button></td></tr>`; }).join("")
        || `<tr><td colspan="8">No Due Date requests</td></tr>`}</tbody></table></div>
      <div class="table-wrap"><table class="grid compact"><thead><tr><th>Request ID</th><th>Contract</th><th>Decision</th><th>Final Due Date</th><th>Admin</th><th>Date</th></tr></thead>
      <tbody>${history.map(r => `<tr><td>${r.id}</td><td>${esc(r.contract_id)}</td><td>${reqTag(r.status)}</td><td>${fmtDate(r.final_due)}</td><td>${esc(r.decided_by)}</td><td>${fmtDate(String(r.decided_at || "").slice(0, 10))}</td></tr>`).join("")
        || `<tr><td colspan="6">No Due Date adjustment history</td></tr>`}</tbody></table></div></section>
    ${renderLevels()}
    <section class="panel"><div class="panel-head"><div><h2>Permission Management</h2><p>กำหนดสิทธิ์หลังบ้าน: Microsoft Entra → Access Level → สิทธิ์ในฐานข้อมูล</p></div></div>
      <div class="tabs">${[["user_access", "Users & Roles"], ["entra_role_mappings", "Entra Role Mapping"], ["access_audit", "Change History"]].map(([k, l]) =>
        `<button class="tab ${S.adminTab === k ? "on" : ""}" data-atab="${k}">${l}</button>`).join("")}</div></section>
    ${S.adminTab === "access_audit" ? renderAudit() : S.adminTab === "entra_role_mappings" ? renderGrid("entra_role_mappings", true, { saveLabel: "Save Mapping" })
      : renderGrid("user_access", true, { saveLabel: "Save Users", extraCol: { label: "Last Microsoft sign-in", value: r => {
      const p = (S.db.profiles || []).find(x => x.email === r.email);
      return p?.last_sign_in_at ? fmtDate(String(p.last_sign_in_at).slice(0, 10)) : '<span class="muted">ยังไม่เคยเข้า</span>';
    } } })}

    <section class="panel"><div class="panel-head"><div><h2>LINE Status Notifications <span class="tag tag-dark">Preview</span></h2><p>ข้อความแจ้งเตือน Status Update Y/R สำหรับส่งกลุ่ม LINE (คัดลอกไปส่งได้ทันที)</p></div>
      <button class="btn btn-primary" data-copy-all ${alerts.length ? "" : "disabled"}>Copy all / คัดลอกทั้งหมด</button></div>
      <div class="toolbar" style="padding:0 18px 12px"><span class="tag tag-amber">Trigger Y=Delayed</span><span class="tag tag-red">Trigger R=Overdue</span><span class="tag tag-dark">${alerts.length} messages</span></div>
      <div class="table-wrap" style="max-height:600px"><table class="grid compact"><thead><tr><th>Contract</th><th>Contract Owner</th><th>Status Update</th><th>Message Preview</th><th></th></tr></thead>
      <tbody>${alerts.map((x, i) => `<tr><td><b>${esc(x.c.id)}</b><div class="small muted">${x.c.access_level === "Confidential" ? "Confidential Contract" : esc(x.c.name)}</div></td><td>${esc(x.c.owner)}</td><td>${statusTag(x.m.code)}</td>
        <td><div class="msg-preview" id="msg-${i}">${esc(msg(x))}</div></td><td><button class="btn btn-sm" data-copy="${i}">Copy</button></td></tr>`).join("") || `<tr><td colspan="5" class="empty">ไม่มีสัญญาที่ต้องแจ้งเตือน</td></tr>`}</tbody></table></div></section>`;
  }

  // Production Snapshot import (production_snapshot.json → database, add or update by key)
  const IMPORT_LABELS = [["contracts", "Contracts"], ["contract_logs", "Logs"], ["due_date_requests", "Due Date Requests"], ["departments", "Departments"],
    ["people", "People"], ["contract_types", "Contract Types"], ["contract_templates", "Contract Name Templates"], ["action_sla", "Action SLA"]];
  function renderImport() {
    const P = S.snap;
    const preview = P ? `<div class="current-card" style="margin-top:12px"><b>${esc(P.fileName)}</b>
        <div class="small muted">Snapshot: ${esc(P.meta.loadedAt ? String(P.meta.loadedAt).replace("T", " ").slice(0, 16) : "-")}</div>
        <div class="toolbar" style="margin-top:8px">${IMPORT_LABELS.map(([k, l]) => `<span class="tag">${l}: ${(P.data[k] || []).length}</span>`).join("")}</div>
        ${P.problems.length ? `<div class="login-error show" style="margin-top:8px">พบปัญหา ${P.problems.length} รายการ แก้ไฟล์ก่อนนำเข้า:<br>${P.problems.slice(0, 5).map(esc).join("<br>")}</div>`
          : `<div class="small" style="margin-top:8px">ตรวจไฟล์ผ่าน: ไม่มี Contract ID ซ้ำ และทุก Log มีสัญญาอยู่จริง</div>
             <div style="margin-top:10px"><button class="btn btn-primary" data-snap-import>Import to database / นำเข้าข้อมูล</button></div>`}</div>` : "";
    const done = S.snapResult ? `<div class="current-card" style="margin-top:12px"><b>นำเข้าเรียบร้อย</b><div class="small">นำเข้า ${S.snapResult.imported_contracts ?? "-"} สัญญา และ ${S.snapResult.imported_logs ?? "-"} logs
      · ในระบบตอนนี้มี ${S.snapResult.contracts ?? "-"} สัญญา · เพิ่มผู้ใช้ใหม่ ${S.snapResult.new_users ?? 0} คน (Viewer)
      ${S.snapResult.locked_kept ? ` · แถวที่แก้ไขในเว็บ (Locked) ${S.snapResult.locked_kept} แถว ไม่ถูกเขียนทับ` : ""}</div></div>` : "";
    return `<section class="panel"><div class="panel-head"><div><h2>Import Production Snapshot <span class="tag tag-dark">Admin Only</span></h2>
      <p>เลือกไฟล์ production_snapshot.json เพื่อนำข้อมูลล่าสุดเข้าฐานข้อมูล · สัญญาที่มี Contract ID เดิมจะถูกอัปเดต ที่ยังไม่มีจะถูกเพิ่ม ไม่ลบข้อมูลเดิม · สิทธิ์ผู้ใช้เดิมไม่เปลี่ยน</p></div></div>
      <div style="padding:0 18px 16px"><input type="file" accept=".json,.jsonp,application/json" data-snap-file>${preview}${done}</div></section>`;
  }
  async function readSnapshot(file) {
    try {
      const parsed = window.Snapshot.parse(await file.text());
      S.snap = { fileName: file.name, ...parsed }; S.snapResult = null;
    } catch (e) { S.snap = null; toast(e.message, true); }
    render();
  }
  async function runImport(btn) {
    if (!armed(btn, `ยืนยันนำเข้า ${S.snap.data.contracts.length} สัญญา`)) return;
    btn.disabled = true; btn.textContent = "กำลังนำเข้า...";
    try {
      S.snapResult = await window.Store.importSnapshot(S.snap.data);
      S.snap = null;
      await reload(); renderNav(); render(); toast("นำเข้าข้อมูลเรียบร้อย");
    } catch (e) { console.error(e); toast(e.message || String(e), true); btn.disabled = false; btn.textContent = "Import to database / นำเข้าข้อมูล"; }
  }

  const LEVEL_RIGHTS = {
    viewer: "เมนู: Dashboard, Contracts (ดูอย่างเดียว)",
    user: "เมนู: Dashboard, Contracts, User Case Action",
    confidential: "เมนู: Dashboard, Contracts, Confidential, User Case Action",
    admin: "เมนู: Dashboard, Contracts, Confidential, User Case Action, Admin Tools",
    root: "เมนู: Dashboard, Contracts, Confidential, User Case Action, Master Data, Admin Tools"
  };
  function renderAudit() {
    const rows = [...(S.db.access_audit || [])].sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)) || b.id - a.id);
    const lv = r => r ? `${window.ROLES[r]?.level} · ${window.ROLES[r]?.label}` : "-";
    return `<section class="panel"><div class="panel-head"><div><h2>Change History</h2><p>ทุกการเพิ่ม เปลี่ยน หรือลบสิทธิ์ ถูกบันทึกโดยฐานข้อมูลอัตโนมัติ · ${rows.length} รายการ</p></div></div>
      <div class="table-wrap" style="max-height:calc(100vh - 300px)"><table class="grid compact"><thead><tr><th>When</th><th>Account</th><th>Action</th><th>Level</th><th>Active</th><th>Managed by</th><th>Changed by</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td style="white-space:nowrap">${esc(String(r.changed_at || "").replace("T", " ").slice(0, 16))}</td><td>${esc(r.email)}</td>
        <td><span class="tag ${r.action === "removed" ? "tag-red" : r.action === "added" ? "tag-green" : "tag-amber"}">${esc(r.action)}</span></td>
        <td>${r.action === "added" ? lv(r.new_role) : r.action === "removed" ? lv(r.old_role) : `${lv(r.old_role)} → ${lv(r.new_role)}`}</td>
        <td>${r.action === "changed" && r.old_active !== r.new_active ? (r.new_active ? "เปิดใช้งาน" : "ระงับ") : ""}</td><td>${esc(r.source || "")}</td><td>${esc(r.changed_by)}</td></tr>`).join("")
        || `<tr><td colspan="7" class="empty">ยังไม่มีการเปลี่ยนสิทธิ์</td></tr>`}</tbody></table></div></section>`;
  }

  function renderLevels() {
    const rows = S.db.user_access || [];
    return `<section class="panel"><div class="panel-head"><div><h2>Access Levels</h2><p>บัญชีอีเมลแต่ละบัญชีได้สิทธิ์ตาม Level · ปิด Active เพื่อระงับสิทธิ์ทันทีโดยไม่ต้องลบบัญชี Microsoft</p></div></div>
      <div class="level-grid">${Object.entries(window.ROLES).map(([k, r]) => `<div class="level-card">
        <div class="level-top"><span class="level-n">${r.level}</span><div><strong>${esc(r.label)}</strong><span>${esc(r.nameEn)}</span></div>
        <span class="level-count">${rows.filter(u => u.role === k && u.active !== false).length} บัญชี</span></div>
        <p>${esc(LEVEL_RIGHTS[k])}</p></div>`).join("")}</div></section>`;
  }

  async function decide(id, status) {
    const r = S.db.due_date_requests.find(x => String(x.id) === String(id));
    const finalDue = status === "Approved" ? ($(`#final-${id}`)?.value || r.requested_due) : null;
    await guard(async () => {
      await window.Store.update("due_date_requests", r.id, { status, final_due: finalDue, decided_by: S.user.display_name || S.user.username, decided_at: new Date().toISOString() });
      if (status === "Approved") await window.Store.update("contracts", r.contract_id, { due_date: finalDue });
      await reload(); render();
    }, status === "Approved" ? "อนุมัติแล้ว" : "ปฏิเสธคำขอแล้ว");
  }

  function copyText(text) {
    (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast("คัดลอกแล้ว"), () => toast("คัดลอกไม่สำเร็จ", true));
  }

  // ───────────── Event binding ─────────────
  function bindView(root) {
    $$("[data-open]", root).forEach(b => b.addEventListener("click", () => openDrawer(b.dataset.open)));
    // Dashboard: Contract ID opens the Contracts page filtered to that contract
    $$("[data-goto]", root).forEach(b => b.addEventListener("click", () => {
      const c = S.db.contracts.find(x => x.id === b.dataset.goto); if (!c) return;
      const view = c.access_level === "Confidential" && can(3) ? "confidential" : "contracts";
      S.search[view] = c.id; location.hash = "#/" + view; setTimeout(() => openDrawer(c.id), 0);
    }));
    $$("[data-dash]", root).forEach(s => s.addEventListener("change", () => { S.dash[s.dataset.dash] = s.value; render(); }));
    $$("[data-log-view]", root).forEach(b => b.addEventListener("click", () => openLogView(b.dataset.logView)));
    $$("[data-col-filter]", root).forEach(s => s.addEventListener("change", () => { S.filters[s.dataset.viewName][s.dataset.colFilter] = s.value; render(); }));
    $$("[data-due-range]", root).forEach(i => i.addEventListener("change", () => { S.filters[i.dataset.viewName][i.dataset.dueRange] = i.value; render(); }));
    $$("[data-due-clear]", root).forEach(b => b.addEventListener("click", () => { const f = S.filters[b.dataset.dueClear]; f.dueFrom = f.dueTo = ""; render(); }));
    // Header filter menus: one open at a time, popover placed under its header (outside the scrolling table)
    const placeMenu = menu => {
      const r = menu.querySelector("summary").getBoundingClientRect(), pop = menu.querySelector(".th-filter-popover");
      const w = Math.max(200, pop.offsetWidth || 200);
      pop.style.left = `${Math.min(Math.max(12, r.left), window.innerWidth - w - 12)}px`;
      pop.style.top = `${r.bottom + 6}px`;
    };
    $$("[data-filter-menu]", root).forEach(menu => menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      $$("[data-filter-menu][open]", root).forEach(o => { if (o !== menu) o.removeAttribute("open"); });
      placeMenu(menu);
    }));
    $$(".contract-status", root).forEach(t => t.closest(".table-wrap").addEventListener("scroll", () => $$("[data-filter-menu][open]", root).forEach(placeMenu)));
    $$("[data-clear-filters]", root).forEach(b => b.addEventListener("click", () => { S.filters[b.dataset.clearFilters] = {}; render(); }));
    $$("[data-search]", root).forEach(i => i.addEventListener("input", () => {
      S.search[i.dataset.search] = i.value; const pos = i.selectionStart; render();
      const ni = $(`[data-search="${i.dataset.search}"]`); ni.focus(); ni.setSelectionRange(pos, pos);
    }));
    $$("[data-export]", root).forEach(b => b.addEventListener("click", () => {
      const rows = contractsFor(b.dataset.export).map(c => { const m = metrics(c); return CONTRACT_COLS.map(col => cellValue(c, m, col.k)); });
      exportCsv(`contracts_${todayISO()}.csv`, CONTRACT_COLS.map(c => c.label), rows);
    }));
    // user case
    $$("[data-step]", root).forEach(b => b.addEventListener("click", async () => { S.caseStep = b.dataset.step; await refreshIfStale(); render(); }));
    $$("[data-class]", root).forEach(b => b.addEventListener("click", () => { S.addForm = { ...S.addForm, classification: b.dataset.class, type: "", sub_type: "" }; render(); }));
    $$("[data-add]", root).forEach(el => el.addEventListener(el.tagName === "SELECT" || el.type === "date" ? "change" : "input", () => {
      const k = el.dataset.add; S.addForm[k] = el.value;
      if (k === "type") S.addForm.sub_type = "";
      if (k === "department") S.addForm.owner = "";
      if (el.tagName === "SELECT" || el.type === "date") render();
    }));
    $("[data-add-reset]", root)?.addEventListener("click", () => { S.addForm = { classification: CLASS_DAY }; render(); });
    $("[data-add-submit]", root)?.addEventListener("click", submitAddCase);
    $$("[data-pick]", root).forEach(s => s.addEventListener("change", () => { S.selectedContract = s.value; render(); }));
    $("[data-update-submit]", root)?.addEventListener("click", submitUpdate);
    bindCc(root);
    $("[data-close-submit]", root)?.addEventListener("click", submitClose);
    $("[data-due-submit]", root)?.addEventListener("click", submitDue);
    // master
    $$("[data-mtab]", root).forEach(b => b.addEventListener("click", () => {
      if (S.masterDraft?.dirty && !armed(b, "ทิ้งการแก้ไข?")) return toast("มีการแก้ไขที่ยังไม่บันทึก กดซ้ำเพื่อทิ้ง หรือกด Save ก่อน");
      S.masterTab = b.dataset.mtab; S.masterDraft = null; render();
    }));
    $$("[data-cell]", root).forEach(el => el.addEventListener("change", () => {
      const D = S.masterDraft, r = D.rows[Number(el.dataset.cell)];
      r[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value;
      el.closest("tr")?.classList.toggle("row-changed", rowChanged(MASTER[D.table], r));
      if (!D.dirty || D.problems.length) { D.dirty = true; if (D.problems.length) D.problems = masterProblems(D.table, D); render(); }
    }));
    if (S.masterDraft && $("[data-master-q]", root)) applyMasterFilter(root);
    $("[data-master-q]", root)?.addEventListener("input", e => { S.masterQ = e.target.value; applyMasterFilter(root); });
    $("[data-master-show]", root)?.addEventListener("change", e => { S.masterShow = e.target.value; applyMasterFilter(root); });
    $("[data-master-contract]", root)?.addEventListener("change", e => { S.masterContract = e.target.value; render(); });
    $("[data-master-add]", root)?.addEventListener("click", () => {
      const D = S.masterDraft, row = { __new: true, active: true };
      D.rows.push(row); D.dirty = true; S.masterQ = ""; S.masterShow = "all"; render();
      const wrap = $(".table-wrap", root.querySelector("[data-master-q]")?.closest(".panel") || root);
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
      $(`tr[data-ri="${D.rows.length - 1}"] input:not([disabled]), tr[data-ri="${D.rows.length - 1}"] select`, root)?.focus();
    });
    $$("[data-master-del]", root).forEach(b => b.addEventListener("click", () => {
      const D = S.masterDraft, def = MASTER[D.table], i = Number(b.dataset.masterDel), r = D.rows[i], key = window.TABLE_KEYS[D.table];
      // A row still used by contracts, people, templates, users or logs is switched off instead of deleted (the database refuses too)
      const used = !r.__new && def.uses ? def.uses(r) : 0;
      if (used) {
        if (r.active === false) return toast(`"${r[def.cols[0][0]]}" ยังถูกใช้อยู่ ${used} รายการ จึงลบไม่ได้ (ปิด Active ไว้แล้ว)`, true);
        if (!armed(b, "ปิด Active แทน?")) return toast(`"${r[def.cols[0][0]]}" ยังถูกใช้อยู่ ${used} รายการ จึงลบไม่ได้ · กดอีกครั้งเพื่อปิด Active แทน`);
        r.active = false; D.dirty = true; render(); return toast("ปิด Active แล้ว กด Save เพื่อบันทึก");
      }
      if (!armed(b, "ยืนยันลบ")) return;
      if (!r.__new && r[key] != null) D.removed.push(r[key]);
      D.rows.splice(i, 1); D.dirty = true; render();
    }));
    $("[data-master-save]", root)?.addEventListener("click", saveMaster);
    $("[data-master-import]", root)?.addEventListener("change", e => { if (e.target.files[0]) importMaster(e.target.files[0]); });
    $("[data-master-export]", root)?.addEventListener("click", () => {
      const def = MASTER[S.masterDraft.table];
      const cols = def.track ? [...def.cols.map(c => c[0]), "locked", "edited_by", "edited_at"] : def.cols.map(c => c[0]);
      exportCsv(`${S.masterDraft.table}_${todayISO()}.csv`, cols, S.masterDraft.rows.map(r => cols.map(k => r[k])));
    });
    // admin
    $$("[data-atab]", root).forEach(b => b.addEventListener("click", () => {
      if (S.masterDraft?.dirty && !armed(b, "ทิ้งการแก้ไข?")) return toast("มีการแก้ไขที่ยังไม่บันทึก กดซ้ำเพื่อทิ้ง หรือกด Save ก่อน");
      S.adminTab = b.dataset.atab; S.masterDraft = null; render();
    }));
    $$("[data-approve]", root).forEach(b => b.addEventListener("click", () => decide(b.dataset.approve, "Approved")));
    $$("[data-reject]", root).forEach(b => b.addEventListener("click", () => decide(b.dataset.reject, "Rejected")));
    $$("[data-copy]", root).forEach(b => b.addEventListener("click", () => copyText($(`#msg-${b.dataset.copy}`).textContent)));
    $("[data-copy-all]", root)?.addEventListener("click", () => copyText($$(".msg-preview", root).map(e => e.textContent).join("\n\n────────\n\n")));
    $("[data-snap-file]", root)?.addEventListener("change", e => { if (e.target.files[0]) readSnapshot(e.target.files[0]); });
    $("[data-snap-import]", root)?.addEventListener("click", e => runImport(e.currentTarget));
    $("[data-reset-demo]", root)?.addEventListener("click", async () => {
      if (!armed($("[data-reset-demo]", root), "กดอีกครั้งเพื่อยืนยัน")) return;
      await window.Store.resetDemo(); await reload(); renderNav(); render(); toast("รีเซ็ตข้อมูลแล้ว");
    });
  }

  // ───────────── Boot ─────────────
  async function boot() {
    await window.Store.init();
    initLogin();
    window.addEventListener("hashchange", () => { if (S.user) { closeDrawer(); ["logActionRoot", "logViewRoot"].forEach(id => { const r = $(`#${id}`); if (r) r.innerHTML = ""; }); refreshIfStale().finally(route); } });
    // Back on the tab: pick up new data; read-only pages redraw, forms keep what the user typed
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState === "visible" && await refreshIfStale()) { renderNav(); if (["dashboard", "contracts", "confidential"].includes(S.view)) render(); }
    });
    $("#nav").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) location.hash = "#/" + b.dataset.view; });
    $("#refreshBtn").addEventListener("click", () => guard(async () => { await reload(); renderNav(); render(); }, "รีเฟรชข้อมูลแล้ว"));
    $("#profileTrigger").addEventListener("click", e => { e.stopPropagation(); $("#profileDropdown").hidden = !$("#profileDropdown").hidden; });
    document.addEventListener("click", e => { if (!e.target.closest(".profile-menu")) $("#profileDropdown").hidden = true; });
    document.addEventListener("click", e => { if (!e.target.closest("[data-filter-menu]")) $$("[data-filter-menu][open]").forEach(m => m.removeAttribute("open")); });
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      const top = ["logActionRoot", "logViewRoot"].map(id => $(`#${id}`)).find(r => r && r.innerHTML);
      if (top) top.innerHTML = ""; else closeDrawer();
    });
    $("#logoutBtn").addEventListener("click", async () => {
      $$(".toast").forEach(t => t.remove());
      await window.Store.signOut(); S.user = null; ["logActionRoot", "logViewRoot"].forEach(id => { const r = $(`#${id}`); if (r) r.innerHTML = ""; }); document.body.classList.remove("auth-ready"); $("#profileDropdown").hidden = true; closeDrawer();
    });
    try { S.user = await window.Store.currentUser(); } catch (e) { S.user = null; showLoginError(e.message); }
    if (S.user) await enterApp();
  }
  boot();
})();
