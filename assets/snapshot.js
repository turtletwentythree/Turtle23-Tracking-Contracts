// Production Snapshot → database rows.
// Reads production_snapshot.json ({ tables: { <name>: { headers: [...], rows: [[...], ...] } } }) exported from the
// Production Shared Drive and maps it to the app's tables. Columns without a column of their own go into `details`.
(function () {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const date = v => { const s = String(v ?? "").trim().slice(0, 10); return DATE.test(s) ? s : null; };
  const int = v => { const s = String(v ?? "").trim(); if (s === "" || isNaN(Number(s))) return null; return Math.round(Number(s)); };
  const text = v => { const s = String(v ?? "").trim(); return s === "" ? null : s; };
  const yes = v => !/^(no|false|0|n|inactive)$/i.test(String(v ?? "").trim());
  const json = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };
  // Old department names in the source files → the name in department_master
  const DEPT_ALIAS = { "Project Manager": "Project Management" };
  const dept = v => { const s = text(v); return s && DEPT_ALIAS[s] ? DEPT_ALIAS[s] : s; };
  const pick = (r, keys) => Object.fromEntries(keys.filter(k => r[k] !== undefined && r[k] !== "").map(k => [k, r[k]]));

  function table(snap, name) {
    const t = snap.tables?.[name];
    if (!t) return [];
    if (Array.isArray(t)) return t;
    const h = t.headers || [];
    return (t.rows || []).map(row => Array.isArray(row) ? Object.fromEntries(h.map((k, i) => [k, row[i] ?? ""])) : row);
  }

  function parseText(raw) {
    let s = String(raw || "").trim().replace(/^﻿/, "");
    const m = s.match(/^[\w$.]+\(([\s\S]*)\);?$/); // JSONP wrapper, e.g. t23export({...});
    if (m) s = m[1];
    let snap;
    try { snap = JSON.parse(s); } catch (e) { throw new Error("อ่านไฟล์ไม่ได้ กรุณาเลือกไฟล์ production_snapshot.json"); }
    if (!snap || !snap.tables || !snap.tables.contracts) throw new Error("ไฟล์นี้ไม่มีตาราง contracts กรุณาเลือกไฟล์ production_snapshot.json");
    return snap;
  }

  function map(snap) {
    const logsRaw = table(snap, "logs");
    const logs = logsRaw.map(r => ({
      contract_id: text(r["Contract ID"]),
      log_no: int(r["Log No"]),
      cycle: int(r["Cycle"]) || 1,
      action: text(r["Action"]),
      from_person: text(r["From"]),
      to_person: text(r["To"]),
      in_date: date(r["In"]),
      out_date: date(r["Out"]),
      sla: int(r["SLA"]),
      reason: text(r["Action Reason Detail"]) || text(r["Delay Reason"]) || text(r["Action Reason"]),
      approval: text(r["Approval"]),
      updated_by: text(r["Updated By"]),
      updated_at: text(r["Updated Date and Time"]),
      details: {
        // Every snapshot column without a column of its own; 007_log_view.sql copies them into contract_logs columns
        ...pick(r, ["Log View", "Days on Hand", "Alert", "Delay Reason", "Action Reason", "Corrective Action", "Action Reason Type",
          "Action Reason Detail", "Approval Type", "Approval Conditions", "Corrective Action Detail", "Action Code",
          "Action Name TH", "Action Name EN", "Action Description TH", "Action Description EN", "Action SLA",
          "Action Reason Type TH", "Action Reason Type EN"]),
        attachments: json(r["Attachments"], []),
        cc_recipients: json(r["CC Recipients"], [])
      }
    })).filter(l => l.contract_id && l.log_no != null);

    const lastLog = {};
    logs.forEach(l => { if (!lastLog[l.contract_id] || l.log_no > lastLog[l.contract_id].log_no) lastLog[l.contract_id] = l; });

    const requests = [];
    const contracts = table(snap, "contracts").map(r => {
      const id = text(r["Contract ID"]);
      const st = String(r["Station"] || "").match(/^From (.+?) >> To (.+)$/);
      const statusText = String(r["Status Update"] || "");
      const status = /Cancelled/i.test(statusText) ? "Cancelled" : /B=Completed/i.test(statusText) ? "Closed" : "Open";
      const last = lastLog[id];
      const pending = json(r["Pending Due Date Request"], null);
      if (pending && pending.requestedDue) {
        requests.push({
          contract_id: id,
          requested_due: date(pending.requestedDue),
          reason: text(pending.reason),
          requested_by: text(pending.requestedBy),
          status: /approv/i.test(pending.status) ? "Approved" : /reject/i.test(pending.status) ? "Rejected" : "Pending",
          created_at: text(pending.requestedAt),
          details: pending
        });
      }
      return {
        id,
        name: text(r["Contract Name"]) || id,
        department: dept(r["Department / Restaurant"]),
        owner: text(r["Contract Owner"]),
        classification: text(r["Category"]) || (r["Access Level"] === "Confidential" ? "Confidential" : "Day-to-day Work"),
        type: text(r["Type of Contract"]),
        sub_type: text(r["Work Type"]),
        vendor: text(r["Vendor / Counter party"]),
        stage: text(r["Stage"]) || "Draft Created",
        cycle: int(r["Cycle"]) || 1,
        returns: int(r["Returns"]) || 0,
        station_from: st ? st[1].trim() : null,
        station_to: st ? st[2].trim() : null,
        station_in: (last && last.in_date) || date(r["Add Case Date"]),
        add_case_date: date(r["Add Case Date"]),
        due_date: date(r["Due Date"]),
        system_due: date(r["System Due Date"]),
        total_sla: int(r["Total SLA"]),
        remark: text(r["Remark"]),
        access_level: r["Access Level"] === "Confidential" ? "Confidential" : "Normal",
        status,
        closed_at: status === "Open" ? null : (last && (last.in_date || date(last.updated_at))) || null,
        close_reason: status === "Open" ? null : (last && last.reason) || (status === "Closed" ? "Completed" : "Cancelled"),
        details: pick(r, ["Status Update", "Station", "Station Owner", "Days Used", "Days on Hand", "Balance", "Alert", "Visibility"])
      };
    }).filter(c => c.id);

    const departments = table(snap, "department_master").map(r => ({
      name: text(r["Department / Restaurant"]), code: text(r["Department Code"]) || "", active: yes(r["Active"])
    })).filter(d => d.name);
    const people = table(snap, "people_master").map(r => ({
      name: text(r["name"]), department: dept(r["department"]), email: (text(r["email"]) || "").toLowerCase() || null,
      line_user_id: text(r["lineUserId"]), active: yes(r["active"])
    })).filter(p => p.name);
    const contract_types = table(snap, "type_master").map(r => ({
      classification: text(r["Contract Classification"]), type: text(r["Type of Contract"]), sub_type: text(r["Sub Type of Contract"]) || "",
      sla: int(r["Fixed SLA (Working Days)"]) ?? 20, active: yes(r["Active"])
    })).filter(t => t.classification && t.type);
    const action_sla = table(snap, "action_sla_master").map(r => ({
      action: text(r["Action"]), description: text(r["Description / รายละเอียด"]), sla: int(r["Fixed SLA (Working Days)"]) ?? 0,
      rule: text(r["SLA Rule / วิธีนับ"]), active: yes(r["Active"])
    })).filter(a => a.action);
    const contract_templates = table(snap, "contract_template_master").map(r => ({
      classification: text(r.classification), type_group: text(r.typeGroup), sub_type: text(r.subType), name: text(r.name),
      selection_label: text(r.selectionLabel), source_row: int(r.sourceRow), type: text(r.type), work_type: text(r.workType),
      contract_id: text(r.contractId), access_level: text(r.accessLevel), category: text(r.category), department: dept(r.department),
      vendor: text(r.vendor), group_name: text(r.group), fixed_sla: int(r.fixedSla), sla_version: text(r.slaVersion),
      remark: text(r.remark), active: yes(r.active)
    })).filter(t => t.name);

    // Checks before anything is written
    const ids = new Set();
    const problems = [];
    contracts.forEach(c => { if (ids.has(c.id)) problems.push(`Contract ID ซ้ำ: ${c.id}`); ids.add(c.id); if (!c.add_case_date) problems.push(`${c.id}: ไม่มี Add Case Date`); });
    const orphan = new Set(logs.filter(l => !ids.has(l.contract_id)).map(l => l.contract_id));
    orphan.forEach(id => problems.push(`Log อ้างถึงสัญญาที่ไม่มี: ${id}`));
    const seen = new Set();
    logs.forEach(l => { const k = `${l.contract_id}#${l.log_no}`; if (seen.has(k)) problems.push(`Log ซ้ำ: ${k}`); seen.add(k); });

    return {
      meta: { loadedAt: snap.loadedAt || null, fingerprint: snap.databaseFingerprint || null },
      problems,
      data: { contracts, contract_logs: logs, due_date_requests: requests, departments, people, contract_types, action_sla, contract_templates }
    };
  }

  window.Snapshot = { parse: raw => map(parseText(raw)) };
})();
