// Draws LINE Flex Messages (the JSON line-notify sends) as HTML, close to how the LINE app shows them.
// Used by Admin Tools > LINE Notification > "ดูข้อความ LINE" so the message can be checked before anything is sent.
// Covers what supabase/functions/line-notify/flex.ts uses: carousel, bubble (header/body/footer), box, text, separator.
(function () {
  const SIZE = { xxs: 11, xs: 13, sm: 14, md: 16, lg: 19, xl: 22, xxl: 29 };
  const GAP = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
  const px = v => v == null ? null : GAP[v] != null ? GAP[v] + "px" : /^\d+(px|%)$/.test(String(v)) ? v : null;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const safeColor = c => /^#[0-9a-f]{3,8}$/i.test(String(c || "")) ? c : null;

  function node(n, parentLayout, first) {
    if (!n) return "";
    const st = [];
    if (parentLayout === "horizontal") st.push(n.flex != null ? `flex:${Number(n.flex) || 0} 1 0` : "flex:1 1 0", "min-width:0");
    else if (n.flex === 0) st.push("flex:none");
    const m = px(n.margin);
    if (m && !first) st.push(parentLayout === "horizontal" ? `margin-left:${m}` : `margin-top:${m}`);
    if (n.type === "separator") {
      return `<div style="${parentLayout === "horizontal" ? "width:1px;align-self:stretch" : "height:1px"};background:${safeColor(n.color) || "#ddd"};${st.join(";")}"></div>`;
    }
    if (n.type === "text") {
      st.push(`font-size:${SIZE[n.size] || 14}px`, `color:${safeColor(n.color) || "#111"}`, `text-align:${["start", "end", "center"].includes(n.align) ? n.align : "start"}`, "line-height:1.35");
      if (n.weight === "bold") st.push("font-weight:700");
      if (n.wrap) { st.push("white-space:normal", "overflow-wrap:anywhere"); if (n.maxLines) st.push("display:-webkit-box", `-webkit-line-clamp:${Number(n.maxLines)}`, "-webkit-box-orient:vertical", "overflow:hidden"); }
      else st.push("white-space:nowrap", "overflow:hidden", "text-overflow:ellipsis");
      return `<div style="${st.join(";")}">${esc(n.text)}</div>`;
    }
    if (n.type === "box") {
      const horiz = n.layout === "horizontal";
      st.push("display:flex", `flex-direction:${horiz ? "row" : "column"}`);
      if (n.backgroundColor) st.push(`background:${safeColor(n.backgroundColor) || "transparent"}`);
      if (px(n.paddingAll)) st.push(`padding:${px(n.paddingAll)}`);
      if (n.cornerRadius) st.push(`border-radius:${px(n.cornerRadius) || "8px"}`);
      if (n.width) st.push(`width:${px(n.width)}`, "flex:none");
      if (n.height) st.push(`height:${px(n.height)}`);
      if (n.justifyContent === "center") st.push("justify-content:center");
      if (horiz) st.push("align-items:" + (n.height ? "stretch" : "flex-start"));
      const gap = GAP[n.spacing] || 0;
      if (gap) st.push(`gap:${gap}px`);
      return `<div style="${st.join(";")}">${(n.contents || []).map((c, i) => node(c, n.layout, i === 0)).join("")}</div>`;
    }
    return "";
  }

  function bubble(b) {
    const w = { nano: 120, micro: 160, kilo: 260, mega: 300, giga: 386 }[b.size] || 300;
    return `<div class="lf-bubble" style="width:${w}px">${["header", "body", "footer"].map(k => b[k] ? node(b[k]) : "").join("")}</div>`;
  }

  function message(m) {
    if (m.type === "text") return `<div class="lf-text">${esc(m.text)}</div>`;
    const c = m.contents || {};
    const bubbles = c.type === "carousel" ? c.contents || [] : [c];
    return `<div class="lf-alt">${esc(m.altText || "")}</div><div class="lf-carousel">${bubbles.map(bubble).join("")}</div>`;
  }

  const CSS = `.lf-chat{background:#8CABD9;padding:14px;border-radius:12px;font-family:-apple-system,"Helvetica Neue","Noto Sans Thai",sans-serif}
    .lf-from{color:#fff;font-size:12px;margin:10px 0 4px}.lf-alt{color:#eef3fb;font-size:11px;margin:2px 0 6px}
    .lf-carousel{display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;align-items:flex-start}
    .lf-bubble{flex:none;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.15)}
    .lf-text{background:#fff;border-radius:16px;padding:10px 12px;display:inline-block;max-width:386px;white-space:pre-wrap}`;

  // pushes: [[message, ...], ...] (one inner array per LINE push)
  function render(pushes, botName) {
    return `<style>${CSS}</style><div class="lf-chat">${(pushes || []).map((msgs, i) =>
      `<div class="lf-from">${esc(botName || "T23 Bot")} · ข้อความชุดที่ ${i + 1}/${pushes.length}</div>${msgs.map(message).join("")}`).join("")}</div>`;
  }
  window.LineFlexView = { render };
})();
