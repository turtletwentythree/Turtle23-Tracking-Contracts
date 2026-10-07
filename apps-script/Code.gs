/**
 * T23 Contract Tracking: attachment upload + status email endpoint (Google Apps Script web app).
 *
 * The GitHub Pages site never talks to Google Drive or Gmail itself. It sends files (Base64) and
 * email drafts here; this script checks who is calling, saves files in Google Drive and sends the email.
 *
 * Script Properties (Project Settings > Script Properties). No password, token or key lives in the website.
 *   SUPABASE_URL          https://<project>.supabase.co                      (required)
 *   SUPABASE_ANON_KEY     the Publishable / anon key (same one the website uses)  (required)
 *   ATTACHMENT_FOLDER_ID  Google Drive folder that receives attachments        (required)
 *   SHARE_MODE            recipients (default) | domain | anyone | none
 *                           recipients: To and CC are added as viewers of each file
 *                           domain:     anyone in the Google Workspace domain with the link
 *                           anyone:     anyone with the link (only if company policy allows)
 *   MAX_EMAIL_ATTACH_MB   total size attached to the email itself (default 20, Gmail limit is 25);
 *                         larger files are sent as Drive links only
 *   SENDER_NAME           display name of the sender (default "T23 Contract Tracking")
 *   LOG_SHEET_ID          optional Google Sheet that gets one row per upload/email
 *
 * Requests (POST, body = JSON text):
 *   { mode: "uploadFile", accessToken, requestId, contractId, file: { fileName, mimeType, fileSize, base64 } }
 *   { mode: "sendStatusEmail", accessToken, requestId, contractId, action, to, cc?, subject, body,
 *     attachments: [ { fileId } | { fileName, mimeType, base64 } ] }
 * GET ?mode=health&callback=fn            -> is the endpoint configured
 * GET ?mode=status&requestId=..&callback  -> result of a request (used when the browser cannot read the POST reply)
 */

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 10;
const ALLOWED_TYPES = {
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"]
};
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const CASE_ROLES = ["user", "confidential", "admin", "root"]; // Level 2 and up

function doPost(e) {
  let requestId = "";
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || "{}");
    requestId = cleanId_(payload.requestId);
    if (!requestId) throw new Error("Missing requestId.");
    const done = cachedResult_(requestId);
    if (done && done.state !== "processing") return json_(done); // same request sent again: answer, don't redo
    const caller = verifyCaller_(payload.accessToken);
    setResult_(requestId, { success: true, state: "processing" });
    let result;
    if (payload.mode === "uploadFile") result = uploadFile_(payload, caller);
    else if (payload.mode === "sendStatusEmail") result = sendStatusEmail_(payload, caller);
    else throw new Error("Unknown mode.");
    result = Object.assign({ success: true, state: "done", requestId: requestId }, result);
    setResult_(requestId, result);
    return json_(result);
  } catch (error) {
    const failed = { success: false, state: "failed", requestId: requestId, error: message_(error) };
    if (requestId) setResult_(requestId, failed);
    console.error("T23 request failed: " + failed.error);
    return json_(failed);
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.mode === "status") {
    const id = cleanId_(p.requestId);
    return jsonp_(id ? (cachedResult_(id) || { success: true, state: "pending" }) : { success: false, error: "Missing requestId." }, p.callback);
  }
  const props = PropertiesService.getScriptProperties();
  const ready = Boolean(props.getProperty("SUPABASE_URL") && props.getProperty("SUPABASE_ANON_KEY") && props.getProperty("ATTACHMENT_FOLDER_ID"));
  return jsonp_({ success: true, state: ready ? "ready" : "not-configured", service: "T23 Contract Tracking email endpoint" }, p.callback);
}

// ───────────── Who is calling ─────────────
// The website passes the signed-in user's Supabase session token. Supabase confirms the token and returns the
// user's Access Level; only Level 2 (Contract User) and up may upload files or send email.
function verifyCaller_(token) {
  token = String(token || "");
  if (!token) throw new Error("Not signed in.");
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty("SUPABASE_URL") || "").replace(/\/+$/, "");
  const key = String(props.getProperty("SUPABASE_ANON_KEY") || "");
  if (!base || !key) throw new Error("Apps Script is not configured (SUPABASE_URL / SUPABASE_ANON_KEY).");
  const headers = { apikey: key, Authorization: "Bearer " + token };
  const user = UrlFetchApp.fetch(base + "/auth/v1/user", { headers: headers, muteHttpExceptions: true });
  if (user.getResponseCode() !== 200) throw new Error("Session expired. Please sign in again.");
  const access = UrlFetchApp.fetch(base + "/rest/v1/rpc/my_access", {
    method: "post", contentType: "application/json", payload: "{}", headers: headers, muteHttpExceptions: true
  });
  const rows = access.getResponseCode() === 200 ? JSON.parse(access.getContentText() || "[]") : [];
  const me = rows[0];
  if (!me || me.active === false || CASE_ROLES.indexOf(String(me.role)) < 0) throw new Error("This account may not send case emails (Level 2 required).");
  return { email: String(me.email || JSON.parse(user.getContentText()).email || ""), name: String(me.display_name || "") };
}

// ───────────── Files ─────────────
function uploadFile_(payload, caller) {
  const f = payload.file || {};
  const file = saveFile_(f, payload.contractId, caller);
  log_(["upload", payload.requestId, payload.contractId, caller.email, file.fileName, file.fileSize, file.fileId]);
  return { file: file };
}

function saveFile_(f, contractId, caller) {
  const name = cleanFileName_(f.fileName);
  const type = checkType_(name, f.mimeType);
  if (!f.base64) throw new Error("Missing file data: " + name);
  const bytes = Utilities.base64Decode(String(f.base64));
  if (!bytes.length) throw new Error("Empty file: " + name);
  if (bytes.length > MAX_FILE_BYTES) throw new Error("File is over 20 MB: " + name);
  const folder = contractFolder_(contractId);
  const driveFile = folder.createFile(Utilities.newBlob(bytes, type, name));
  driveFile.setDescription("Contract " + cleanText_(contractId) + " · uploaded by " + caller.email);
  return describe_(driveFile, caller.email, new Date().toISOString());
}

function describe_(file, uploadedBy, uploadedAt) {
  const id = file.getId();
  return {
    fileId: id,
    fileName: file.getName(),
    mimeType: file.getMimeType(),
    fileSize: file.getSize(),
    url: "https://drive.google.com/file/d/" + id + "/view",
    downloadUrl: "https://drive.google.com/uc?export=download&id=" + id,
    uploadedBy: uploadedBy,
    uploadedAt: uploadedAt,
    status: "Uploaded"
  };
}

function checkType_(name, mimeType) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const allowed = ALLOWED_TYPES[ext];
  if (!allowed) throw new Error("File type not allowed: " + name);
  const type = String(mimeType || "").toLowerCase();
  return allowed.indexOf(type) >= 0 ? type : allowed[0];
}

// Files go to ATTACHMENT_FOLDER_ID / <Contract ID>
function contractFolder_(contractId) {
  const root = rootFolder_();
  const name = cleanText_(contractId) || "Unassigned";
  const existing = root.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : root.createFolder(name);
}

function rootFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty("ATTACHMENT_FOLDER_ID");
  if (!id) throw new Error("Apps Script is not configured (ATTACHMENT_FOLDER_ID).");
  return DriveApp.getFolderById(id);
}

// A file id from the website is only accepted if the file sits in the attachment folder tree,
// so the endpoint can never be used to mail out other Drive files.
function attachmentFileById_(fileId) {
  const file = DriveApp.getFileById(cleanId_(fileId));
  const rootId = rootFolder_().getId();
  const parents = file.getParents();
  while (parents.hasNext()) {
    const parent = parents.next();
    if (parent.getId() === rootId) return file;
    const up = parent.getParents();
    if (up.hasNext() && up.next().getId() === rootId) return file;
  }
  throw new Error("Attachment is not in the contract attachment folder.");
}

function share_(file, emails) {
  const mode = String(PropertiesService.getScriptProperties().getProperty("SHARE_MODE") || "recipients").toLowerCase();
  try {
    if (mode === "anyone") file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    else if (mode === "domain") file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    else if (mode === "recipients") emails.forEach(function(email) {
      try { file.addViewer(email); } catch (error) { console.warn("Could not share with " + email + ": " + message_(error)); }
    });
  } catch (error) {
    console.warn("Sharing not changed: " + message_(error));
  }
}

// ───────────── Email ─────────────
function sendStatusEmail_(payload, caller) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sentKey = "sent_" + cleanId_(payload.requestId);
    const props = PropertiesService.getScriptProperties();
    const already = props.getProperty(sentKey);
    if (already) return Object.assign(JSON.parse(already), { duplicate: true });

    const to = String(payload.to || "").trim().toLowerCase();
    if (!EMAIL_RE.test(to)) throw new Error("Enter a valid email address (To).");
    const cc = [];
    (Array.isArray(payload.cc) ? payload.cc : []).forEach(function(item) {
      const email = String(item || "").trim().toLowerCase();
      if (!email) return;
      if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address (CC): " + email);
      if (email !== to && cc.indexOf(email) < 0) cc.push(email);
    });
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    if (attachments.length > MAX_FILES) throw new Error("Up to 10 files per email.");

    const files = [];
    const newLinks = [];
    attachments.forEach(function(a) {
      if (a && a.fileId) { files.push(attachmentFileById_(a.fileId)); return; }
      const saved = saveFile_(a || {}, payload.contractId, caller);
      files.push(DriveApp.getFileById(saved.fileId));
      newLinks.push(saved);
    });
    files.forEach(function(file) { share_(file, [to].concat(cc)); });

    const limit = (Number(props.getProperty("MAX_EMAIL_ATTACH_MB")) || 20) * 1024 * 1024;
    let total = 0;
    const blobs = [];
    files.forEach(function(file) {
      const size = file.getSize();
      if (total + size <= limit) { blobs.push(file.getBlob()); total += size; }
    });

    let body = String(payload.body || "");
    if (newLinks.length) {
      body += "\n\nAttachments / ไฟล์แนบ";
      newLinks.forEach(function(f, i) { body += "\n" + (i + 1) + ". " + f.fileName + "\n   Download: " + f.downloadUrl; });
    }
    const subject = String(payload.subject || "").replace(/[\r\n]+/g, " ").slice(0, 250) || "[Contract Tracking] Status Update";
    const options = {
      to: to,
      subject: subject,
      body: body,
      htmlBody: htmlBody_(body),
      name: props.getProperty("SENDER_NAME") || "T23 Contract Tracking"
    };
    if (cc.length) options.cc = cc.join(",");
    if (caller.email) options.replyTo = caller.email;
    if (blobs.length) options.attachments = blobs;
    MailApp.sendEmail(options);

    const result = {
      sent: true, sentAt: new Date().toISOString(), to: to, cc: cc,
      attachedFiles: blobs.length, linkedFiles: files.length, files: newLinks
    };
    props.setProperty(sentKey, JSON.stringify(result));
    pruneSent_(props);
    log_(["email", payload.requestId, payload.contractId, caller.email, to, cc.join(","), subject, files.length]);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function htmlBody_(text) {
  return String(text || "").split("\n").map(function(line) {
    return escapeHtml_(line).replace(/(https:\/\/[^\s<>"']+)/g, function(url) {
      return '<a href="' + url + '" target="_blank">' + url + "</a>";
    });
  }).join("<br>");
}

// Keep "already sent" markers for 14 days
function pruneSent_(props) {
  const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
  const all = props.getProperties();
  Object.keys(all).forEach(function(key) {
    if (key.indexOf("sent_") !== 0) return;
    try { if (new Date(JSON.parse(all[key]).sentAt).getTime() < cutoff) props.deleteProperty(key); } catch (e) { props.deleteProperty(key); }
  });
}

// ───────────── Helpers ─────────────
function cachedResult_(id) {
  const raw = CacheService.getScriptCache().get("t23_" + id);
  return raw ? JSON.parse(raw) : null;
}
function setResult_(id, value) {
  try { CacheService.getScriptCache().put("t23_" + id, JSON.stringify(value), 21600); } catch (e) { console.warn(message_(e)); }
}
function log_(row) {
  const id = PropertiesService.getScriptProperties().getProperty("LOG_SHEET_ID");
  console.log(JSON.stringify(row));
  if (!id) return;
  try { SpreadsheetApp.openById(id).getSheets()[0].appendRow([new Date()].concat(row)); } catch (e) { console.warn("Log sheet: " + message_(e)); }
}
function cleanId_(v) { return String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120); }
function cleanText_(v) { return String(v || "").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 120); }
function cleanFileName_(v) { return String(v || "attachment").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 180) || "attachment"; }
function escapeHtml_(v) {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function message_(e) { return e && e.message ? e.message : String(e); }
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function jsonp_(data, callback) {
  const cb = String(callback || "");
  if (/^[A-Za-z_$][\w$]{0,80}$/.test(cb)) {
    return ContentService.createTextOutput(cb + "(" + JSON.stringify(data) + ");").setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(data);
}

// Run once from the editor (Run > setupCheck) to grant Drive, Gmail and external-request permissions
// and to confirm the Script Properties. The result shows in the Execution log.
function setupCheck() {
  const props = PropertiesService.getScriptProperties();
  ["SUPABASE_URL", "SUPABASE_ANON_KEY", "ATTACHMENT_FOLDER_ID"].forEach(function(k) {
    if (!props.getProperty(k)) throw new Error("Missing Script Property: " + k);
  });
  const folder = rootFolder_();
  const ping = UrlFetchApp.fetch(String(props.getProperty("SUPABASE_URL")).replace(/\/+$/, "") + "/auth/v1/health",
    { headers: { apikey: props.getProperty("SUPABASE_ANON_KEY") }, muteHttpExceptions: true });
  console.log("Drive folder: " + folder.getName());
  console.log("Supabase reachable: HTTP " + ping.getResponseCode());
  console.log("Emails left today: " + MailApp.getRemainingDailyQuota());
  console.log("Sender: " + Session.getEffectiveUser().getEmail());
}
