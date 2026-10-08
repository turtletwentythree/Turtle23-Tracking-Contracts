// SLA engine shared by the website (assets/app.js) and the Edge Functions (line-notify).
// One copy only, so the Dashboard, the Contracts page and the LINE notification always give the same G/Y/R.
// Plain script (no import/export): the website loads it with <script>, Deno with `import "../_shared/sla-engine.js"`;
// both then use globalThis.SlaEngine.create(getDb), where getDb() returns
// { contracts, contract_logs, action_sla, contract_types, holidays }.
//
// Two separate clocks, never mixed:
//  - Alert         = Days on Hand (working days in the current Action) vs Action SLA (Action SLA Master)
//  - Status Update = Accumulated Days (working days since Add Case Date) vs Total SLA (Type of Contract Master)
// The real state is the Latest Action of the newest log; Contract Stage is used only when there is no log.
(function (root) {
  const TZ = "Asia/Bangkok";
  const CLOSED_ACTION = /^(signed|signed\s*\/\s*completed|completed)$/i;
  const CANCELLED_ACTION = /^cancel/i;
  const FORWARD_ACTION = /^forward$/i;
  const NOT_AN_ACTION = /^due date /i; // Due Date request/approval notes do not change the station
  const STATUS_LABEL = { G: "G=On Track", Y: "Y=Delayed", R: "R=Overdue", C: "B=Completed", X: "B=Cancelled", N: "Configuration Required" };
  const ALERT_LABEL = { G: "G=On Track", Y: "Y=Delayed", R: "R=At Risk", U: "U=Uncontrol", C: "B=Completed", X: "B=Cancelled", N: "Configuration Required" };
  const short = v => String(v || "").split(" / ")[0];

  function create(getDb, options = {}) {
    const warn = options.warn || (msg => console.warn(msg));
    // Dates are YYYY-MM-DD in Asia/Bangkok, whatever the time zone of the computer
    const bkkDate = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
    const todayISO = () => bkkDate.format(new Date());
    function dateOf(ts) { if (!ts) return null; const t = Date.parse(ts); return /^\d{4}-\d{2}-\d{2}$/.test(String(ts)) || isNaN(t) ? String(ts).slice(0, 10) : bkkDate.format(new Date(t)); }

    // Working days: Mon–Fri, minus the Holiday Master when the database has one (table holidays, column date).
    // The start day is not counted: start Monday → Tuesday = 1, Wednesday = 2. Counted on calendar dates (UTC), so no time-zone drift.
    const utcDay = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
    let holKey = null, hol = new Set();
    function holidaySet() {
      const rows = getDb().holidays || [];
      if (holKey !== rows) { holKey = rows; hol = new Set(rows.filter(h => h.active !== false).map(h => String(h.date || h.holiday_date || "").slice(0, 10))); }
      return hol;
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

    // Newest log: highest Log No (as the Production system does), then Updated Date and Time, then the order in the database
    function newer(a, b) {
      if ((a.log_no || 0) !== (b.log_no || 0)) return (a.log_no || 0) > (b.log_no || 0);
      const ta = Date.parse(a.updated_at) || 0, tb = Date.parse(b.updated_at) || 0;
      if (ta !== tb) return ta > tb;
      return (Number(a.id) || 0) > (Number(b.id) || 0);
    }
    function latestLog(id) {
      let last = null;
      (getDb().contract_logs || []).forEach(l => { if (l.contract_id === id && !NOT_AN_ACTION.test(l.action || "") && (!last || newer(l, last))) last = l; });
      return last;
    }

    // Missing settings are reported once, never treated as 0
    const configWarned = new Set();
    function configMissing(what) { if (!configWarned.has(what)) { configWarned.add(what); warn(`[SLA] Configuration Required: ${what}`); } }
    function actionSla(action) {
      const a = String(action || "").trim().toLowerCase();
      const row = (getDb().action_sla || []).find(r => String(r.action || "").trim().toLowerCase() === a);
      const n = row && row.sla !== "" && row.sla != null ? Number(row.sla) : NaN;
      if (!Number.isFinite(n)) { configMissing(`Action SLA for "${action}"`); return null; }
      return n;
    }
    // Total SLA: Classification + Type of Contract + Sub Type in the Type of Contract Master (Classification must match too);
    // when the master has no matching row, the Total SLA saved on the contract at Add Case
    function totalSla(c) {
      const cls = short(c.classification || (c.access_level === "Confidential" ? "Confidential" : "Day-to-day Work")).toLowerCase();
      const rows = (getDb().contract_types || []).filter(t => short(t.classification).toLowerCase() === cls && short(t.type).toLowerCase() === short(c.type).toLowerCase());
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
      // The current Action is still on someone's desk while the case is open, so it counts to today even if an Out date was typed
      const onHand = forward || !inDate ? null : workdays(inDate, end);
      // Draft Created has no row in the Action SLA Master: it gets the contract's Total SLA (as the Production system does)
      const aSla = kind === "open" && !forward ? (/^draft created$/i.test(action) && !(getDb().action_sla || []).some(r => /^draft created$/i.test(String(r.action || "").trim())) ? sla : actionSla(action)) : null;
      const alert = kind === "completed" ? "C" : kind === "cancelled" ? "X" : forward ? "U" : aSla == null || onHand == null ? "N"
        : onHand < aSla - 1 ? "G" : onHand <= aSla ? "Y" : "R";
      return { c, log, action, reason: (log && log.reason) || "", kind, closeDate, acc, used: acc, totalSla: sla, balance: sla == null ? null : sla - acc,
        code, onHand, actionSla: aSla, alert };
    }

    return { todayISO, dateOf, workdays, addWorkdays, latestLog, actionSla, totalSla, contractState };
  }

  root.SlaEngine = { create, TZ, CLOSED_ACTION, CANCELLED_ACTION, FORWARD_ACTION, NOT_AN_ACTION, STATUS_LABEL, ALERT_LABEL, short };
})(typeof globalThis !== "undefined" ? globalThis : window);
