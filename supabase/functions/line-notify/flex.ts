// LINE Flex messages, same layout as the Production system (attachment_upload_apps_script.js):
//  1. one carousel of tables per Status (R / Y) and Contract Owner, 4 contracts per page, 10 pages per message
//  2. after the tables, "By Person — Station Owner Summary": Y/R bar per Contract Owner with the Latest Action of each contract
// Confidential contracts show only the Contract ID; name, vendor and reason are masked.

export interface Candidate {
  contractId: string;
  statusCode: "Y" | "R";
  ownerName: string;
  contractName: string;
  confidential: boolean;
  pendingDays: number;
  totalSla: number | null;
  dueDate: string;
  vendor: string;
  action: string;
  reason: string;
}

export const MASK_NAME = "Confidential Contract / สัญญาลับ";
export const MASK_DETAIL = "Restricted / จำกัดสิทธิ์";

export function text(value: unknown, limit = 100) {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, limit) || "-";
}

// Contract Name / Vendor / Reason as they may appear in LINE
export function shown(c: Candidate) {
  return c.confidential
    ? { name: MASK_NAME, vendor: MASK_DETAIL, reason: MASK_DETAIL }
    : { name: c.contractName || "-", vendor: c.vendor || "-", reason: c.reason || "-" };
}

const byDays = (a: Candidate, b: Candidate) => b.pendingDays - a.pendingDays || a.contractId.localeCompare(b.contractId);

// Pushes to send in order (LINE allows at most 5 messages per push): each with its contracts
export function buildPushes(candidates: Candidate[]) {
  const grouped = new Map<string, { statusCode: "Y" | "R"; ownerName: string; items: Candidate[] }>();
  candidates.forEach(c => {
    const key = `${c.statusCode}|${c.ownerName}`;
    if (!grouped.has(key)) grouped.set(key, { statusCode: c.statusCode, ownerName: c.ownerName, items: [] });
    grouped.get(key)!.items.push(c);
  });
  const pages: { bubble: unknown; items: Candidate[] }[] = [];
  [...grouped.keys()].sort().forEach(key => {
    const g = grouped.get(key)!;
    g.items.sort(byDays);
    const pageCount = Math.ceil(g.items.length / 4);
    for (let i = 0; i < g.items.length; i += 4) {
      const items = g.items.slice(i, i + 4);
      pages.push({ bubble: statusBubble(g.statusCode, g.ownerName, items, i / 4 + 1, pageCount, candidates), items });
    }
  });
  // A carousel holds up to 12 bubbles and 50 KB of JSON: keep to 10 bubbles and about 40 KB per message
  const chunks: typeof pages[] = [];
  pages.forEach(p => {
    const last = chunks[chunks.length - 1];
    if (last && last.length < 10 && JSON.stringify([...last, p].map(x => x.bubble)).length < 40000) last.push(p);
    else chunks.push([p]);
  });
  // LINE counts one push request once per group member, however many messages (up to 5) it carries:
  // so pack the carousels and the summary into as few pushes as possible (34 contracts = 1 push)
  const all: { message: unknown; items: Candidate[] }[] = chunks.map(chunk => {
    const items = chunk.flatMap(p => p.items);
    const codes = [...new Set(items.map(c => c.statusCode))].sort().join("/");
    return { items, message: {
      type: "flex",
      altText: `[${codes}] Contract Status Update - ${items.length} contract(s)`,
      contents: { type: "carousel", contents: chunk.map(p => p.bubble) }
    } };
  });
  if (all.length) all.push({ message: ownerSummary(candidates), items: [] });
  const pushes: { messages: unknown[]; items: Candidate[] }[] = [];
  for (let i = 0; i < all.length; i += 5) {
    const part = all.slice(i, i + 5);
    pushes.push({ messages: part.map(x => x.message), items: part.flatMap(x => x.items) });
  }
  return pushes;
}

export function ownerSummary(candidates: Candidate[]) {
  const map = new Map<string, { ownerName: string; delayed: number; risk: number; actions: string[] }>();
  candidates.forEach(c => {
    const o = map.get(c.ownerName) || { ownerName: c.ownerName, delayed: 0, risk: 0, actions: [] };
    if (c.statusCode === "Y") o.delayed++;
    if (c.statusCode === "R") o.risk++;
    o.actions.push(c.action || "-");
    map.set(c.ownerName, o);
  });
  const owners = [...map.values()].sort((a, b) => (b.delayed + b.risk) - (a.delayed + a.risk) || b.risk - a.risk || a.ownerName.localeCompare(b.ownerName));
  const maxTotal = Math.max(1, ...owners.map(o => o.delayed + o.risk));
  const bubbles = [];
  for (let i = 0; i < owners.length; i += 6) bubbles.push(summaryBubble(owners.slice(i, i + 6), maxTotal, i / 6 + 1, Math.ceil(owners.length / 6)));
  return { type: "flex", altText: "By Person - Station Owner Summary - Delayed and Overdue", contents: { type: "carousel", contents: bubbles } };
}

function summaryBubble(owners: { ownerName: string; delayed: number; risk: number; actions: string[] }[], maxTotal: number, page: number, pages: number) {
  const rows: unknown[] = [];
  owners.forEach((o, i) => {
    if (i) rows.push({ type: "separator", color: "#ECEEEF", margin: "md" });
    const bar: unknown[] = [];
    if (o.delayed) bar.push({ type: "box", layout: "vertical", flex: o.delayed, backgroundColor: "#C58A00", justifyContent: "center",
      contents: [{ type: "text", text: String(o.delayed), size: "xxs", color: "#FFFFFF", weight: "bold", align: "center" }] });
    if (o.risk) bar.push({ type: "box", layout: "vertical", flex: o.risk, backgroundColor: "#CE3D34", justifyContent: "center",
      contents: [{ type: "text", text: String(o.risk), size: "xxs", color: "#FFFFFF", weight: "bold", align: "center" }] });
    const rest = maxTotal - o.delayed - o.risk;
    if (rest > 0) bar.push({ type: "box", layout: "vertical", flex: rest, contents: [] });
    const actionRows = [];
    for (let k = 0; k < o.actions.length; k += 5) {
      actionRows.push({ type: "box", layout: "horizontal", height: "26px", margin: "none", spacing: "none",
        contents: o.actions.slice(k, k + 5).map(a => ({ type: "box", layout: "vertical", flex: 1, paddingAll: "4px", backgroundColor: "#E7EDCA", justifyContent: "center",
          contents: [{ type: "text", text: text(a, 30), size: "xxs", color: "#202124", weight: "bold", align: "center", wrap: true, maxLines: 2 }] })) });
    }
    rows.push({ type: "box", layout: "vertical", margin: i ? "md" : "none", contents: [
      { type: "text", text: text(o.ownerName, 80), size: "xs", weight: "bold", color: "#202124", wrap: true, maxLines: 2 },
      { type: "box", layout: "horizontal", height: "26px", margin: "sm", backgroundColor: "#E5EAEE", contents: bar },
      ...actionRows
    ] });
  });
  return {
    type: "bubble", size: "giga",
    header: { type: "box", layout: "vertical", paddingAll: "16px", backgroundColor: "#F5F6F7", contents: [
      { type: "text", text: "By Person — Station Owner Summary", size: "lg", weight: "bold", color: "#202124", wrap: true },
      { type: "text", text: "สรุปสถานะตาม Station Owner", size: "xs", color: "#6F7478", margin: "sm" }] },
    body: { type: "box", layout: "vertical", paddingAll: "16px", contents: rows },
    footer: { type: "box", layout: "horizontal", paddingAll: "12px", contents: [
      { type: "text", text: "Y = Delayed", size: "xxs", color: "#C58A00", weight: "bold", flex: 1 },
      { type: "text", text: "R = Overdue", size: "xxs", color: "#CE3D34", weight: "bold", flex: 1 },
      { type: "text", text: pages > 1 ? `${page}/${pages}` : "Summary", size: "xxs", color: "#777C80", align: "end", flex: 1 }] }
  };
}

function statusBubble(code: "Y" | "R", ownerName: string, items: Candidate[], page: number, pages: number, all: Candidate[]) {
  const overdue = code === "R";
  const accent = overdue ? "#C62828" : "#C88A00";
  const total = all.filter(c => c.statusCode === code).length;
  const rows: unknown[] = [{ type: "box", layout: "horizontal", backgroundColor: "#F5F6F7", paddingAll: "9px", spacing: "sm", contents: [
    { type: "text", text: "CONTRACT ID", size: "xxs", color: "#777C80", weight: "bold", flex: 3 },
    { type: "text", text: "CONTRACT NAME", size: "xxs", color: "#777C80", weight: "bold", flex: 5 },
    { type: "text", text: "DAYS", size: "xxs", color: "#777C80", weight: "bold", align: "end", flex: 2 },
    { type: "text", text: "DUE DATE", size: "xxs", color: "#777C80", weight: "bold", align: "end", flex: 3 }] }];
  items.forEach(c => {
    const s = shown(c);
    const contents: unknown[] = [{ type: "box", layout: "horizontal", spacing: "sm", contents: [
      { type: "text", text: text(c.contractId, 28), size: "xxs", color: "#1667A8", weight: "bold", wrap: true, flex: 3 },
      { type: "text", text: text(s.name, 100), size: "xxs", color: "#202124", weight: "bold", wrap: true, maxLines: 3, flex: 5 },
      { type: "text", text: String(c.pendingDays), size: "xxs", color: accent, weight: "bold", align: "end", flex: 2 },
      { type: "text", text: text(c.dueDate, 20), size: "xxs", color: "#4D5357", align: "end", wrap: true, flex: 3 }] }];
    if (overdue) contents.push(
      { type: "text", text: "Vendor: " + text(s.vendor, 80), size: "xxs", color: "#4D5357", margin: "sm", wrap: true, maxLines: 2 },
      { type: "text", text: "Action: " + text(c.action, 60), size: "xxs", color: "#202124", margin: "xs", weight: "bold", wrap: true, maxLines: 2 },
      { type: "text", text: "Reason: " + text(s.reason, 140), size: "xxs", color: "#4D5357", margin: "xs", wrap: true, maxLines: 3 });
    rows.push({ type: "separator", color: "#ECEEEF" }, { type: "box", layout: "vertical", paddingAll: "10px", contents });
  });
  return {
    type: "bubble", size: "giga",
    header: { type: "box", layout: "horizontal", backgroundColor: overdue ? "#FFF0F0" : "#FFF8E1", paddingAll: "16px", contents: [
      { type: "box", layout: "vertical", flex: 1, contents: [
        { type: "text", text: `[${code}] ${overdue ? "Overdue Contracts" : "Delayed Contracts"}`, color: accent, weight: "bold", size: "lg" },
        { type: "text", text: overdue ? "สัญญาที่เกินกำหนด" : "สัญญาที่ถึงช่วงติดตาม", color: accent, size: "xs", margin: "sm" }] },
      { type: "box", layout: "vertical", width: "40px", flex: 0, backgroundColor: accent, cornerRadius: "md", paddingAll: "6px", justifyContent: "center",
        contents: [{ type: "text", text: String(total), color: "#FFFFFF", weight: "bold", size: "sm", align: "center" }] }] },
    body: { type: "box", layout: "vertical", paddingAll: "0px", contents: [
      { type: "box", layout: "vertical", paddingAll: "14px", contents: [
        { type: "text", text: "CONTRACT OWNER", color: "#777C80", size: "xxs", weight: "bold" },
        { type: "text", text: text(ownerName, 80), color: "#202124", size: "sm", weight: "bold", margin: "sm", wrap: true }] },
      { type: "separator", color: "#DDE1E4" },
      { type: "box", layout: "vertical", contents: rows }] },
    footer: { type: "box", layout: "horizontal", paddingAll: "12px", contents: [
      { type: "text", text: pages > 1 ? `${page}/${pages}` : "Status Summary", size: "xxs", color: "#777C80", align: "end" }] }
  };
}
