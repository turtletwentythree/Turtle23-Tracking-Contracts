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
    { id: "master", icon: "▤", label: "Master Data", title: "Master Data", sub: "แก้ไขข้อมูล dropdown และบันทึกกลับฐานข้อมูล", min: 4 },
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

  function todayISO() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function parseDate(s) { if (!s) return null; const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function fmtDate(s) {
    const d = parseDate(s); if (!d) return "-";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  // Working days (Mon–Fri) after `from` up to and including `to`
  function workdays(from, to) {
    const a = parseDate(from), b = parseDate(to);
    if (!a || !b || b <= a) return 0;
    let n = 0; const d = new Date(a);
    while (d < b) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
    return n;
  }
  function addWorkdays(from, days) {
    const d = parseDate(from) || new Date(); let n = 0;
    while (n < days) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
    return iso(d);
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
  function metrics(c) {
    const asOf = c.status !== "Open" && c.closed_at ? c.closed_at : todayISO();
    const used = workdays(c.add_case_date, asOf);
    const onHand = c.status === "Open" ? workdays(c.station_in || c.add_case_date, asOf) : 0;
    const sla = Number(c.total_sla) || 0;
    const balance = sla - used;
    let code = "G";
    if (c.status === "Closed") code = "C";
    else if (c.status === "Cancelled") code = "X";
    else if (c.due_date && todayISO() > c.due_date) code = "R";
    else if (balance < 0) code = "R";
    else if (balance <= Math.max(2, Math.round(sla * 0.2))) code = "Y";
    return { used, onHand, balance, code };
  }
  const STATUS_LABEL = { G: "G=On Track", Y: "Y=Delayed", R: "R=Overdue", C: "Completed", X: "Cancelled" };
  const STATUS_TAG = { G: "tag-green", Y: "tag-amber", R: "tag-red", C: "tag-dark", X: "tag-grey" };
  const statusTag = code => `<span class="tag status-dot ${STATUS_TAG[code]}">${STATUS_LABEL[code]}</span>`;

  function visibleContracts() {
    return S.db.contracts.filter(c => c.access_level !== "Confidential" || can(3));
  }
  function contractsFor(view) {
    if (view === "confidential") return S.db.contracts.filter(c => c.access_level === "Confidential" && can(3));
    return S.db.contracts.filter(c => c.access_level !== "Confidential");
  }
  function logsOf(id) { return S.db.contract_logs.filter(l => l.contract_id === id).sort((a, b) => a.log_no - b.log_no); }
  function latestLog(id) { const l = logsOf(id); return l[l.length - 1]; }
  function activeTypes() { return S.db.contract_types.filter(t => t.active !== false); }
  function activePeople(dept) { return S.db.people.filter(p => p.active !== false && (!dept || p.department === dept)); }

  // ───────────── Data loading ─────────────
  async function reload() {
    const db = await window.Store.loadAll();
    Object.assign(S.db, db);
    S.db.contracts.sort((a, b) => a.id.localeCompare(b.id));
    S.masterDraft = null;
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
    $("#msForm").addEventListener("submit", async e => {
      e.preventDefault();
      const domain = (window.APP_CONFIG?.EMAIL_DOMAIN || "turtle23.com").toLowerCase();
      let email = $("#msEmail").value.trim().toLowerCase();
      if (email && !email.includes("@")) email = `${email}@${domain}`;
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) return showLoginError("กรุณากรอกอีเมลบริษัท เช่น name@" + domain);
      if (!email.endsWith("@" + domain)) return showLoginError(`ใช้ได้เฉพาะอีเมล @${domain} ของ Turtle23 เท่านั้น`);
      showLoginError("");
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
    const counts = { contracts: contractsFor("contracts").length, confidential: contractsFor("confidential").length };
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
  function renderDashboard() {
    const all = visibleContracts().filter(c =>
      (!S.dash.department || c.department === S.dash.department) &&
      (!S.dash.classification || (c.access_level === "Confidential" ? "Confidential" : "Day-to-day Work") === S.dash.classification));
    const open = all.filter(c => c.status === "Open").map(c => ({ c, m: metrics(c) }));
    const closed = all.filter(c => c.status === "Closed");
    const since = iso(new Date(Date.now() - 30 * 864e5));
    const closed30 = closed.filter(c => c.closed_at && c.closed_at >= since);
    const avgComplete = closed.length ? (closed.reduce((s, c) => s + metrics(c).used, 0) / closed.length) : 0;
    const overdue = open.filter(x => x.m.code === "R");

    const depts = uniq(visibleContracts().map(c => c.department)).sort();
    const pending = [...open].sort((a, b) => b.m.onHand - a.m.onHand);

    const byDept = {};
    open.forEach(({ c, m }) => { (byDept[c.department] = byDept[c.department] || []).push(m.onHand); });
    const avgRows = Object.entries(byDept).map(([d, a]) => [d, a.reduce((s, x) => s + x, 0) / a.length]).sort((a, b) => b[1] - a[1]);

    return `
      <div class="dash-filters">
        <select class="select" data-dash="department"><option value="">ทุกแผนก / All Departments</option>
          ${depts.map(d => `<option ${S.dash.department === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>
        <select class="select" data-dash="classification"><option value="">ทุกกลุ่มสัญญา / All Classifications</option>
          ${["Day-to-day Work", ...(can(3) ? ["Confidential"] : [])].map(d => `<option ${S.dash.classification === d ? "selected" : ""}>${d}</option>`).join("")}</select>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">1. Total Pending Contracts</div><div class="kpi-value">${open.length}</div><div class="kpi-note">Is Pending</div></div>
        <div class="kpi"><div class="kpi-label">2. Completed Last 30 Days</div><div class="kpi-value">${closed30.length}</div><div class="kpi-note">ย้อนหลัง 30 วัน / Rolling 30 days</div></div>
        <div class="kpi"><div class="kpi-label">3. Avg Complete Day</div><div class="kpi-value">${avgComplete ? avgComplete.toFixed(1) : 0}</div><div class="kpi-note">Total Spending Days</div></div>
        <div class="kpi"><div class="kpi-label">4. Overdue Contracts</div><div class="kpi-value">${overdue.length}</div><div class="kpi-note">R = Overdue</div></div>
      </div>
      <div class="dash-grid">
        <section class="panel">
          <div class="panel-head"><div><h2>5. Longest pending on hand</h2><p>R = Overdue · Highest Days on Hand first</p></div></div>
          <div class="table-wrap" style="max-height:760px">
            <table class="grid compact">
              <thead><tr><th>Contract Details</th><th>Ownership</th><th class="num">Day</th></tr></thead>
              <tbody>${pending.map(({ c, m }) => {
                const l = latestLog(c.id);
                return `<tr class="pending-item">
                  <td class="cd"><button class="id-link" data-open="${esc(c.id)}">${esc(c.id)}</button> ${m.code !== "G" ? `<span class="tag ${STATUS_TAG[m.code]}">${STATUS_LABEL[m.code]}</span>` : ""}
                    <strong>${esc(c.name)}</strong>
                    <div class="mini"><b>Type:</b> ${esc(c.type)}<br><b>Vendor:</b> ${esc(c.vendor || "-")}<br>
                    <b>Latest Action / การดำเนินการล่าสุด:</b> ${esc(l?.action || c.stage)}<br><b>Reason / เหตุผล:</b> ${esc(l?.reason || "-")}</div></td>
                  <td><div class="owner-block">Department</div><div class="owner-name">${esc(c.department)}</div>
                    <div class="owner-block">Contract Owner</div><div class="owner-name">${esc(c.owner)}</div>
                    <div class="owner-block">Station Owner</div><div class="owner-name">${esc(c.station_to || c.owner)}</div></td>
                  <td class="num"><span class="day-badge ${m.code === "Y" ? "y" : m.code === "G" ? "g" : ""}">${m.onHand}D</span></td></tr>`;
              }).join("") || `<tr><td colspan="3" class="empty">No pending contracts</td></tr>`}</tbody>
            </table>
          </div>
          <div class="panel-body" style="padding-top:12px;text-align:right"><span class="tag tag-red">R = Overdue</span> <span class="small muted">${pending.length} Contracts</span></div>
        </section>
        <section class="panel">
          <div class="panel-head"><div><h2>6. Avg Spending Time at Station by Dept</h2><p>Department · Average working days</p></div></div>
          <div class="table-wrap"><table class="grid compact">
            <thead><tr><th>Department / Restaurant</th><th class="num">Avg. Days</th></tr></thead>
            <tbody>${avgRows.map(([d, a]) => `<tr><td><b>${esc(d)}</b></td><td class="num"><b>${Math.round(a * 10) / 10}</b> D</td></tr>`).join("") || `<tr><td colspan="2" class="empty">-</td></tr>`}</tbody>
          </table></div>
          <div class="panel-body small muted" style="padding-top:10px;text-align:right">${avgRows.length} Departments · Highest average first</div>
        </section>
      </div>
      ${barPanel("7. By Person — Station Owner Status Summary", open, x => x.c.station_to || x.c.owner, true)}
      ${barPanel("8. By Dept — Station Owner Status Summary", open, x => x.c.department, false)}`;
  }

  function barPanel(title, open, keyFn, withStages) {
    const groups = {};
    open.forEach(x => { const k = keyFn(x) || "-"; (groups[k] = groups[k] || []).push(x); });
    const rows = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    const max = Math.max(1, ...rows.map(r => r[1].length));
    return `<section class="panel"><div class="panel-head"><div><h2>${esc(title)}</h2></div></div>
      <div class="panel-body"><div class="bar-list">${rows.map(([k, items]) => {
        const n = { G: 0, Y: 0, R: 0 }; items.forEach(x => { n[x.m.code] = (n[x.m.code] || 0) + 1; });
        const segs = ["R", "Y", "G"].filter(c => n[c]).map(c => `<div class="bar-seg ${c.toLowerCase()}" style="width:${(n[c] / max) * 100}%" title="${STATUS_LABEL[c]}">${n[c]}</div>`).join("");
        const stages = withStages ? `<div class="stage-strip" style="width:${(items.length / max) * 100}%">${items.map(x => `<span class="stage-chip" title="${esc(x.c.id)}">${esc(x.c.stage)}</span>`).join("")}</div><span></span>` : "";
        return `<div class="bar-row"><div class="bar-name">${esc(k)}</div><div class="bar-track">${segs}</div><div class="bar-total">${items.length}</div>${withStages ? `<span></span>${stages}` : ""}</div>`;
      }).join("") || `<div class="empty">No data</div>`}</div>
      <div class="legend"><span class="g">G = On Track</span><span class="y">Y = Delayed</span><span class="r">R = Overdue</span></div></div></section>`;
  }

  // ───────────── Contracts table ─────────────
  const CONTRACT_COLS = [
    { k: "id", label: "Contract ID", filter: true },
    { k: "name", label: "Contract Name" },
    { k: "department", label: "Department / Restaurant", filter: true },
    { k: "owner", label: "Contract Owner", filter: true },
    { k: "type", label: "Type of Contract", filter: true },
    { k: "vendor", label: "Vendor / Counter party" },
    { k: "stage", label: "Stage", filter: true },
    { k: "cycle", label: "Cycle", num: true },
    { k: "returns", label: "Returns", num: true },
    { k: "_status", label: "Status Update", filter: true },
    { k: "_station", label: "Station" },
    { k: "station_to", label: "Station Owner", filter: true },
    { k: "due_date", label: "Due Date" },
    { k: "total_sla", label: "Total SLA", num: true },
    { k: "_used", label: "Days Used", num: true },
    { k: "_onHand", label: "Days on Hand", num: true },
    { k: "_balance", label: "Balance", num: true }
  ];
  function cellValue(c, m, k) {
    if (k === "_status") return STATUS_LABEL[m.code];
    if (k === "_station") return `From ${c.station_from || "-"} >> To ${c.station_to || "-"}`;
    if (k === "_used") return m.used;
    if (k === "_onHand") return m.onHand;
    if (k === "_balance") return m.balance;
    return c[k] ?? "";
  }

  function renderContracts(view) {
    if (view === "confidential" && !can(3)) return lockedPanel("Confidential access required", "ต้องมีสิทธิ์ระดับ Confidential ขึ้นไป");
    const f = S.filters[view] = S.filters[view] || {};
    const q = (S.search[view] || "").toLowerCase();
    const rows = contractsFor(view).map(c => ({ c, m: metrics(c) }));
    const shown = rows.filter(({ c, m }) =>
      CONTRACT_COLS.every(col => !f[col.k] || String(cellValue(c, m, col.k)) === f[col.k]) &&
      (!q || [c.id, c.name, c.vendor, c.owner, c.department, c.remark].join(" ").toLowerCase().includes(q)));
    return `<section class="panel">
      <div class="panel-head">
        <div><h2>${view === "confidential" ? "Confidential Contracts" : "Contract Status"}</h2><p>ติดตาม Contract Owner, cycle, return และสถานะล่าสุด · ${shown.length} / ${rows.length} รายการ</p></div>
        <div class="toolbar">
          <input class="input search" type="search" placeholder="ค้นหา ID, ชื่อสัญญา, Vendor..." value="${esc(S.search[view] || "")}" data-search="${view}">
          ${Object.values(f).some(Boolean) ? `<button class="btn" data-clear-filters="${view}">ล้างตัวกรอง</button>` : ""}
          <button class="btn" data-export="${view}">Export CSV</button>
        </div>
      </div>
      <div class="table-wrap" style="max-height:calc(100vh - 230px)">
        <table class="grid">
          <thead><tr>${CONTRACT_COLS.map(col => {
            if (!col.filter) return `<th class="${col.num ? "num" : ""}">${esc(col.label)}</th>`;
            const opts = uniq(rows.map(({ c, m }) => String(cellValue(c, m, col.k)))).sort();
            return `<th><span class="th-filter">${esc(col.label)}<select class="${f[col.k] ? "on" : ""}" data-col-filter="${col.k}" data-view-name="${view}" title="Filter">
              <option value="">▾</option>${opts.map(o => `<option ${f[col.k] === o ? "selected" : ""} value="${esc(o)}">${esc(o)}</option>`).join("")}</select></span></th>`;
          }).join("")}</tr></thead>
          <tbody>${shown.map(({ c, m }) => `<tr>${CONTRACT_COLS.map(col => {
            const v = cellValue(c, m, col.k);
            if (col.k === "id") return `<td><button class="id-link" data-open="${esc(c.id)}">${esc(v)}</button></td>`;
            if (col.k === "_status") return `<td>${statusTag(m.code)}</td>`;
            if (col.k === "due_date") return `<td style="white-space:nowrap">${fmtDate(v)}</td>`;
            if (col.k === "_balance") return `<td class="num" style="color:${m.balance < 0 ? "var(--red)" : "inherit"};font-weight:700">${v}</td>`;
            if (col.k === "name") return `<td style="min-width:200px">${esc(v)}</td>`;
            return `<td class="${col.num ? "num" : ""}">${esc(v)}</td>`;
          }).join("")}</tr>`).join("") || `<tr><td colspan="${CONTRACT_COLS.length}" class="empty">ไม่พบสัญญา</td></tr>`}</tbody>
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

  // ───────────── Contract detail drawer ─────────────
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
          <h2>${esc(c.id)} · ${esc(c.name)}</h2><div style="margin-top:6px">${statusTag(m.code)} <span class="tag tag-grey">${esc(c.stage)}</span></div></div>
          <button class="icon-button" data-close-drawer aria-label="Close">✕</button></div>
        <div class="drawer-body">
          <div class="kv-grid">
            ${kv("Department", esc(c.department))}${kv("Contract Owner", esc(c.owner))}${kv("Station Owner", esc(c.station_to || "-"))}
            ${kv("Type of Contract", esc(c.type))}${kv("Sub Type / Work Type", esc(c.sub_type || "-"))}${kv("Vendor / Counter party", esc(c.vendor || "-"))}
            ${kv("Add Case Date", fmtDate(c.add_case_date))}${kv("Due Date", fmtDate(c.due_date))}${kv("System Due", fmtDate(c.system_due))}
            ${kv("Total SLA", `${c.total_sla ?? "-"} วันทำการ`)}${kv("Days Used", m.used)}${kv("Days on Hand", m.onHand)}
            ${kv("Balance", `<span style="color:${m.balance < 0 ? "var(--red)" : "inherit"}">${m.balance}</span>`)}${kv("Cycle / Returns", `${c.cycle} / ${c.returns}`)}${kv("Closed", c.closed_at ? `${fmtDate(c.closed_at)} · ${esc(c.close_reason || "")}` : "-")}
          </div>
          ${c.remark ? `<div><p class="section-title">Remark</p><div class="current-card small">${esc(c.remark)}</div></div>` : ""}
          <div><p class="section-title">Log View · ประวัติการดำเนินการ (${logs.length})</p>
            <div class="timeline">${logs.map(l => `<div class="tl-item"><strong>#${l.log_no} ${esc(l.action || "-")}</strong> <span class="small muted">Cycle ${l.cycle} · SLA ${l.sla ?? "-"} วัน</span>
              <div class="small">From <b>${esc(l.from_person || "-")}</b> → To <b>${esc(l.to_person || "-")}</b></div>
              <div class="small muted">In ${fmtDate(l.in_date)} · Out ${l.out_date ? fmtDate(l.out_date) : "-"} · by ${esc(l.updated_by || "-")}</div>
              ${l.reason ? `<div class="small">${esc(l.reason)}</div>` : ""}</div>`).join("") || `<div class="muted">No log</div>`}</div></div>
          ${reqs.length ? `<div><p class="section-title">Due Date Requests</p><table class="grid compact"><thead><tr><th>Requested</th><th>Reason</th><th>Status</th></tr></thead><tbody>
            ${reqs.map(r => `<tr><td>${fmtDate(r.requested_due)}</td><td>${esc(r.reason)}</td><td>${esc(r.status)}</td></tr>`).join("")}</tbody></table></div>` : ""}
          ${can(2) && c.status === "Open" ? `<div class="form-actions"><button class="btn" data-goto-step="update" data-cid="${esc(c.id)}">Update Status</button>
            <button class="btn" data-goto-step="due" data-cid="${esc(c.id)}">Request Due Date</button><button class="btn btn-primary" data-goto-step="close" data-cid="${esc(c.id)}">Close Case</button></div>` : ""}
        </div></aside></div>`;
    $$("[data-close-drawer]", $("#drawerRoot")).forEach(el => el.addEventListener("click", e => { if (e.target === el) closeDrawer(); }));
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
          <div class="field"><label>Send to (Station Owner) / ส่งให้</label><select class="select" data-add="station_to">${opt(activePeople().map(p => p.name), F.station_to, "Same as Contract Owner")}</select></div>
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
    const open = visibleContracts().filter(c => c.status === "Open");
    const sel = S.selectedContract;
    return `<select class="select" data-pick="${attr}"><option value="">เลือกสัญญา / Select contract</option>
      ${open.map(c => `<option value="${esc(c.id)}" ${sel === c.id ? "selected" : ""}>${esc(c.id)} · ${esc(c.name)}</option>`).join("")}</select>`;
  }
  function currentCard(c) {
    if (!c) return `<div class="current-card muted small">ยังไม่ได้เลือกสัญญา</div>`;
    const m = metrics(c);
    return `<div class="current-card"><b>${esc(c.id)} · ${esc(c.name)}</b> ${statusTag(m.code)}
      <div class="small muted" style="margin-top:4px">Stage: <b>${esc(c.stage)}</b> · Station: ${esc(c.station_from || "-")} → <b>${esc(c.station_to || "-")}</b> · Due ${fmtDate(c.due_date)} · Days on hand ${m.onHand} · Cycle ${c.cycle} · Returns ${c.returns}</div></div>`;
  }

  function renderUpdateCase() {
    const c = S.db.contracts.find(x => x.id === S.selectedContract && x.status === "Open");
    const acts = S.db.action_sla.filter(a => a.active !== false);
    return `<section class="panel form-panel"><div class="panel-head"><div><h2 style="font-size:20px">Update Status</h2><p>อัปเดตสถานะ · ส่งต่อสัญญาไปยังผู้รับผิดชอบลำดับถัดไป</p></div></div>
      <div class="panel-body" style="display:grid;gap:14px">
        <div class="form-grid"><div class="field full"><label>Contract <span class="req">*</span></label>${contractPicker("update")}</div></div>
        ${currentCard(c)}
        <div class="form-grid">
          <div class="field"><label>Action <span class="req">*</span></label><select class="select" id="upAction"><option value="">Select Action</option>
            ${acts.map(a => `<option value="${esc(a.action)}">${esc(a.action)} · ${a.sla} วัน — ${esc(a.description || "")}</option>`).join("")}</select></div>
          <div class="field"><label>Send to / ส่งให้ <span class="req">*</span></label><select class="select" id="upTo"><option value="">Select person</option>
            ${activePeople().map(p => `<option ${c && c.owner === p.name ? "" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Date / วันที่</label><input class="input" type="date" id="upDate" value="${todayISO()}"></div>
          <div class="field full"><label>Reason / เหตุผล</label><textarea class="input" rows="2" id="upReason" placeholder="รายละเอียดการดำเนินการ"></textarea></div>
        </div>
        <div class="form-actions"><button class="btn btn-primary" data-update-submit ${c ? "" : "disabled"}>Save Update / บันทึก</button></div>
      </div></section>`;
  }

  async function submitUpdate() {
    const c = S.db.contracts.find(x => x.id === S.selectedContract);
    const action = $("#upAction").value, to = $("#upTo").value, date = $("#upDate").value || todayISO(), reason = $("#upReason").value.trim();
    if (!c || !action || !to) return toast("กรุณาเลือก Contract, Action และผู้รับ", true);
    const act = S.db.action_sla.find(a => a.action === action);
    const logs = logsOf(c.id); const last = logs[logs.length - 1];
    const cycle = c.cycle + (action === "Resubmit" ? 1 : 0);
    const returns = c.returns + (action === "Return" ? 1 : 0);
    const who = S.user.display_name || S.user.username;
    await guard(async () => {
      if (last && !last.out_date) await window.Store.update("contract_logs", last.id, { out_date: date });
      await window.Store.insert("contract_logs", {
        contract_id: c.id, log_no: (last?.log_no || 0) + 1, cycle, action, from_person: c.station_to || c.owner, to_person: to,
        in_date: date, sla: act?.sla ?? null, reason, approval: "OK", updated_by: who, updated_at: new Date().toISOString()
      });
      await window.Store.update("contracts", c.id, {
        stage: STAGE_BY_ACTION[action] || action, cycle, returns, station_from: c.station_to || c.owner, station_to: to, station_in: date
      });
      await reload(); render();
    }, `อัปเดต ${c.id} แล้ว`);
  }

  function renderCloseCase() {
    const c = S.db.contracts.find(x => x.id === S.selectedContract && x.status === "Open");
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
    const logs = logsOf(c.id); const last = logs[logs.length - 1];
    const who = S.user.display_name || S.user.username;
    await guard(async () => {
      if (last && !last.out_date) await window.Store.update("contract_logs", last.id, { out_date: date });
      await window.Store.insert("contract_logs", {
        contract_id: c.id, log_no: (last?.log_no || 0) + 1, cycle: c.cycle, action: result === "Closed" ? "Completed" : "Cancelled",
        from_person: c.station_to, to_person: c.owner, in_date: date, out_date: date, reason: note, approval: "OK", updated_by: who, updated_at: new Date().toISOString()
      });
      await window.Store.update("contracts", c.id, { status: result, stage: result === "Closed" ? "Completed" : "Cancelled", closed_at: date, close_reason: note || (result === "Closed" ? "Completed" : "Cancelled") });
      S.selectedContract = null;
      await reload(); renderNav(); render();
    }, `ปิดเคส ${c.id} แล้ว`);
  }

  function renderDueCase() {
    const c = S.db.contracts.find(x => x.id === S.selectedContract && x.status === "Open");
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
  const MASTER = {
    contracts: { title: "Contract Records", sub: "แก้ไขหรือลบเคสที่สร้างผิดจาก Add Case", cols: [
      ["id", "Contract ID", "ro"], ["name", "Contract Name"], ["department", "Department / Restaurant"], ["owner", "Contract Owner"],
      ["type", "Type of Contract"], ["sub_type", "Sub Type"], ["vendor", "Vendor"], ["stage", "Stage"], ["due_date", "Due Date", "date"],
      ["total_sla", "Total SLA", "num"], ["access_level", "Access Level", ["Normal", "Confidential"]], ["status", "Status", ["Open", "Closed", "Cancelled"]], ["remark", "Remark"]] },
    departments: { title: "Departments", sub: "แผนก / ร้านอาหาร", cols: [["name", "Department / Restaurant", "key"], ["code", "Department Code"], ["active", "Active", "bool"]] },
    people: { title: "People", sub: "รายชื่อผู้รับผิดชอบ", cols: [["name", "Name", "key"], ["department", "Department"], ["email", "Email"], ["active", "Active", "bool"]] },
    contract_types: { title: "Contract Types", sub: "ประเภทสัญญาและ SLA มาตรฐาน (วันทำการ)", cols: [["id", "#", "ro"], ["classification", "Classification", [CLASS_DAY, CLASS_CONF]], ["type", "Type of Contract"], ["sub_type", "Sub Type of Contract"], ["sla", "Fixed SLA", "num"], ["active", "Active", "bool"]] },
    action_sla: { title: "Action SLA", sub: "SLA ของแต่ละ Action ใน Update Status", cols: [["action", "Action", "key"], ["description", "Description / รายละเอียด"], ["sla", "Fixed SLA (Working Days)", "num"], ["rule", "SLA Rule / วิธีนับ"], ["active", "Active", "bool"]] },
    user_access: { title: "Users & Roles", sub: "ผู้ใช้ที่เข้าระบบด้วย Microsoft 365 ได้ และระดับสิทธิ์ (จับคู่ด้วยอีเมลบริษัท)", admin: true, cols: [
      ["email", "Microsoft 365 Email", "key"], ["display_name", "Display Name"], ["department", "Department"],
      ["role", "Access Level", Object.entries(window.ROLES).map(([k, r]) => [k, `${r.level} · ${r.label} — ${r.nameEn}`])], ["active", "Active", "bool"], ["source", "Managed by", "ro"]] },
    entra_role_mappings: { title: "Entra Role Mapping", sub: "App Role (หรือ Group ID) ใน Microsoft Entra → Access Level · มีผลทุกครั้งที่ผู้ใช้เข้าระบบ", admin: true, cols: [
      ["claim_value", "Entra App Role / Group ID", "key"], ["role", "Access Level", Object.entries(window.ROLES).map(([k, r]) => [k, `${r.level} · ${r.label} — ${r.nameEn}`])], ["note", "Note"]] }
  };
  const MASTER_TABS = Object.keys(MASTER).filter(k => !MASTER[k].admin);

  function ensureDraft(t) {
    if (!S.masterDraft || S.masterDraft.table !== t) {
      const src = t === "contracts" ? visibleContracts() : S.db[t] || [];
      S.masterDraft = { table: t, rows: JSON.parse(JSON.stringify(src)), removed: [], dirty: false };
    }
    return S.masterDraft;
  }

  // Editable table bound to S.masterDraft (used by Master Data and Admin Tools)
  function renderGrid(t, editable, opts = {}) {
    const def = MASTER[t], D = ensureDraft(t);
    const cell = (r, i, [k, , kind]) => {
      const v = r[k];
      const dis = !editable || kind === "ro" || (kind === "key" && !r.__new) ? "disabled" : "";
      if (kind === "bool") return `<input type="checkbox" data-cell="${i}" data-k="${k}" ${v !== false ? "checked" : ""} ${editable ? "" : "disabled"}>`;
      if (Array.isArray(kind)) return `<select class="cell-input" data-cell="${i}" data-k="${k}" ${editable ? "" : "disabled"}>${kind.map(o => {
        const [val, label] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(val)}" ${val === v ? "selected" : ""}>${esc(label)}</option>`;
      }).join("")}</select>`;
      return `<input class="cell-input" ${kind === "date" ? 'type="date"' : kind === "num" ? 'type="number" style="min-width:70px"' : ""} data-cell="${i}" data-k="${k}" value="${esc(v ?? "")}" ${dis}>`;
    };
    const extra = opts.extraCol;
    return `<section class="panel">
      <div class="panel-head"><div><h2>${esc(def.title)}</h2><p>${esc(def.sub)} · ${D.rows.length} rows${D.dirty ? ' · <b style="color:var(--t23-orange-dark)">ยังไม่บันทึก</b>' : ""}</p></div>
        <div class="toolbar">
          ${editable && t !== "contracts" ? `<button class="btn" data-master-add>+ Add Row</button>` : ""}
          ${editable ? `<label class="btn">Import<input type="file" accept=".csv" data-master-import hidden></label>` : ""}
          <button class="btn" data-master-export>Export</button>
          ${opts.saveLabel && editable ? `<button class="btn btn-primary" data-master-save ${D.dirty ? "" : "disabled"}>${esc(opts.saveLabel)}</button>` : ""}</div></div>
      <div class="table-wrap" style="max-height:calc(100vh - 300px)"><table class="grid compact">
        <thead><tr>${def.cols.map(c => `<th>${esc(c[1])}</th>`).join("")}${extra ? `<th>${esc(extra.label)}</th>` : ""}${editable ? "<th></th>" : ""}</tr></thead>
        <tbody>${D.rows.map((r, i) => `<tr>${def.cols.map(c => `<td>${cell(r, i, c)}</td>`).join("")}${extra ? `<td class="small">${extra.value(r)}</td>` : ""}
          ${editable ? `<td><button class="btn btn-sm btn-danger" data-master-del="${i}" title="Delete">Delete</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="${def.cols.length + 2}" class="empty">No rows</td></tr>`}</tbody>
      </table></div></section>`;
  }

  function renderMaster() {
    const t = MASTER_TABS.includes(S.masterTab) ? S.masterTab : "contracts";
    const editable = can(4);
    const D = ensureDraft(t);
    return `<section class="panel">
      <div class="panel-head"><div><h2>Master Data</h2><p>Edit dropdown data and save it back to the database${editable ? "" : " · อ่านอย่างเดียว (แก้ไขได้เฉพาะ Admin)"}</p></div>
        ${editable ? `<button class="btn btn-primary" data-master-save ${D.dirty ? "" : "disabled"}>Save Master Data</button>` : ""}</div>
      <div class="tabs">${MASTER_TABS.map(k => `<button class="tab ${k === t ? "on" : ""}" data-mtab="${k}">${esc(MASTER[k].title)}</button>`).join("")}</div>
    </section>${renderGrid(t, editable)}`;
  }

  async function saveMaster() {
    const D = S.masterDraft, def = MASTER[D.table], key = window.TABLE_KEYS[D.table];
    const bad = D.rows.find(r => key !== "id" && !String(r[key] ?? "").trim());
    if (bad) return toast(`กรุณากรอก ${def.cols[0][1]} ให้ครบทุกแถว`, true);
    const clean = D.rows.map(r => {
      const o = {};
      def.cols.forEach(([k, , kind]) => {
        let v = r[k];
        if (kind === "num") v = v === "" || v == null ? null : Number(v);
        if (kind === "date") v = v || null;
        if (kind === "bool") v = v !== false;
        if (k === "email" && D.table === "user_access") v = String(v || "").trim().toLowerCase();
        o[k] = v;
      });
      return o;
    });
    await guard(async () => {
      for (const k of D.removed) await window.Store.remove(D.table, k);
      await window.Store.upsertMany(D.table, clean);
      await reload(); renderNav(); render();
    }, D.table === "user_access" ? "บันทึกสิทธิ์ผู้ใช้แล้ว" : D.table === "entra_role_mappings" ? "บันทึกการจับคู่ Role แล้ว" : "บันทึก Master Data แล้ว");
  }

  function importMaster(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result));
      if (rows.length < 2) return toast("ไฟล์ว่าง", true);
      const head = rows[0].map(h => h.trim());
      const def = MASTER[S.masterDraft.table];
      const idx = def.cols.map(([k, label]) => { const i = head.findIndex(h => h === k || h === label); return i; });
      if (idx.every(i => i < 0)) return toast("หัวคอลัมน์ไม่ตรงกับตาราง", true);
      const key = window.TABLE_KEYS[S.masterDraft.table];
      rows.slice(1).forEach(r => {
        const o = {};
        def.cols.forEach(([k, , kind], j) => { if (idx[j] < 0) return; let v = r[idx[j]]; if (kind === "bool") v = !/^(no|false|0)$/i.test(v); o[k] = v; });
        const existing = S.masterDraft.rows.find(x => key !== "id" && String(x[key]) === String(o[key]));
        if (existing) Object.assign(existing, o); else S.masterDraft.rows.push({ ...o, __new: true });
      });
      S.masterDraft.dirty = true; render(); toast(`นำเข้า ${rows.length - 1} แถว (ยังไม่บันทึก)`);
    };
    reader.readAsText(file, "utf-8");
  }

  // ───────────── Admin tools ─────────────
  function renderAdmin() {
    if (!can(4)) return lockedPanel("Admin only", "ต้องมีสิทธิ์ผู้ดูแลระบบ");
    const reqs = S.db.due_date_requests;
    const pending = reqs.filter(r => r.status === "Pending");
    const history = reqs.filter(r => r.status !== "Pending").sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)));
    const alerts = visibleContracts().filter(c => c.status === "Open").map(c => ({ c, m: metrics(c) })).filter(x => x.m.code === "R" || x.m.code === "Y");
    const msg = ({ c, m }) => `[${m.code}] Contract Status Update: ${m.code === "R" ? "Overdue" : "Delayed"}\nสถานะสัญญา: ${m.code === "R" ? "เกิน SLA รวม" : "ใกล้ครบ SLA"}\n\nContract ID: ${c.id}\nContract Name: ${c.name}\nContract Owner: ${c.owner}\nStation Owner: ${c.station_to}\nDue Date: ${fmtDate(c.due_date)}\n\nPlease update the action plan immediately. / กรุณาอัปเดตแผนดำเนินการทันที`;
    return `<section class="panel"><div class="panel-head"><div><h2>Admin Tools <span class="tag tag-dark">Admin Only</span></h2><p>เครื่องมือสำหรับผู้ดูแลระบบ</p></div>
      ${window.Store.mode === "demo" ? `<button class="btn" data-reset-demo>Reset demo data</button>` : ""}</div></section>
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

  const LEVEL_RIGHTS = {
    viewer: "เมนู: Dashboard, Contracts (ดูอย่างเดียว)",
    user: "เมนู: Dashboard, Contracts, User Case Action",
    confidential: "เมนู: Dashboard, Contracts, Confidential, User Case Action",
    admin: "เมนู: Dashboard, Contracts, Confidential, User Case Action, Master Data, Admin Tools"
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
    $$("[data-dash]", root).forEach(s => s.addEventListener("change", () => { S.dash[s.dataset.dash] = s.value; render(); }));
    $$("[data-col-filter]", root).forEach(s => s.addEventListener("change", () => { S.filters[s.dataset.viewName][s.dataset.colFilter] = s.value; render(); }));
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
    $$("[data-step]", root).forEach(b => b.addEventListener("click", () => { S.caseStep = b.dataset.step; render(); }));
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
    $("[data-close-submit]", root)?.addEventListener("click", submitClose);
    $("[data-due-submit]", root)?.addEventListener("click", submitDue);
    // master
    $$("[data-mtab]", root).forEach(b => b.addEventListener("click", () => {
      if (S.masterDraft?.dirty && !armed(b, "ทิ้งการแก้ไข?")) return toast("มีการแก้ไขที่ยังไม่บันทึก กดซ้ำเพื่อทิ้ง หรือกด Save ก่อน");
      S.masterTab = b.dataset.mtab; S.masterDraft = null; render();
    }));
    $$("[data-cell]", root).forEach(el => el.addEventListener("change", () => {
      const r = S.masterDraft.rows[Number(el.dataset.cell)];
      r[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value;
      if (!S.masterDraft.dirty) { S.masterDraft.dirty = true; render(); }
    }));
    $("[data-master-add]", root)?.addEventListener("click", () => {
      const row = { __new: true, active: true };
      S.masterDraft.rows.push(row); S.masterDraft.dirty = true; render();
    });
    $$("[data-master-del]", root).forEach(b => b.addEventListener("click", () => {
      const D = S.masterDraft, r = D.rows[Number(b.dataset.masterDel)], key = window.TABLE_KEYS[D.table];
      if (!armed(b, "ยืนยันลบ")) return;
      if (!r.__new && r[key] != null) D.removed.push(r[key]);
      D.rows.splice(Number(b.dataset.masterDel), 1); D.dirty = true; render();
    }));
    $("[data-master-save]", root)?.addEventListener("click", saveMaster);
    $("[data-master-import]", root)?.addEventListener("change", e => { if (e.target.files[0]) importMaster(e.target.files[0]); });
    $("[data-master-export]", root)?.addEventListener("click", () => {
      const def = MASTER[S.masterDraft.table];
      exportCsv(`${S.masterDraft.table}_${todayISO()}.csv`, def.cols.map(c => c[0]), S.masterDraft.rows.map(r => def.cols.map(c => r[c[0]])));
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
    $("[data-reset-demo]", root)?.addEventListener("click", async () => {
      if (!armed($("[data-reset-demo]", root), "กดอีกครั้งเพื่อยืนยัน")) return;
      await window.Store.resetDemo(); await reload(); renderNav(); render(); toast("รีเซ็ตข้อมูลแล้ว");
    });
  }

  // ───────────── Boot ─────────────
  async function boot() {
    await window.Store.init();
    initLogin();
    window.addEventListener("hashchange", () => { if (S.user) { closeDrawer(); route(); } });
    $("#nav").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) location.hash = "#/" + b.dataset.view; });
    $("#refreshBtn").addEventListener("click", () => guard(async () => { await reload(); renderNav(); render(); }, "รีเฟรชข้อมูลแล้ว"));
    $("#profileTrigger").addEventListener("click", e => { e.stopPropagation(); $("#profileDropdown").hidden = !$("#profileDropdown").hidden; });
    document.addEventListener("click", e => { if (!e.target.closest(".profile-menu")) $("#profileDropdown").hidden = true; });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });
    $("#logoutBtn").addEventListener("click", async () => {
      $$(".toast").forEach(t => t.remove());
      await window.Store.signOut(); S.user = null; document.body.classList.remove("auth-ready"); $("#profileDropdown").hidden = true; closeDrawer();
    });
    try { S.user = await window.Store.currentUser(); } catch (e) { S.user = null; showLoginError(e.message); }
    if (S.user) await enterApp();
  }
  boot();
})();
