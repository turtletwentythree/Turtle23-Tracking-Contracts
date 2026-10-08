// Step 2: Google Apps Script (script.google.com > New project), signed in with the Google account that can open the
// Production Drive folders. Paste the JSON from step 1 between the backticks, click Run (function findFiles).
// It only reads Drive. It writes the SQL for step 3 into a new Google Doc in your Drive and prints the Doc link in the log.
const DATA = `PASTE_STEP_1_JSON_HERE`;

function findFiles() {
  const items = JSON.parse(DATA);
  const byFolder = {};
  items.forEach(it => (byFolder[it.folderId] = byFolder[it.folderId] || []).push(it));
  const norm = s => String(s || '').normalize('NFC').trim().toLowerCase();
  const rows = [], missing = [];
  Object.keys(byFolder).forEach(folderId => {
    let files = [];
    try {
      const it = DriveApp.getFolderById(folderId).getFiles();
      while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) files.push(f); }
    } catch (e) { byFolder[folderId].forEach(x => missing.push(`${x.contractId} ${x.name} (folder not accessible)`)); return; }
    byFolder[folderId].forEach(x => {
      // exact name first, then the same name without extension; newest wins if a name is repeated
      const want = norm(x.name), base = want.replace(/\.[a-z0-9]{1,5}$/, '');
      const newest = list => list.sort((a, b) => b.getLastUpdated() - a.getLastUpdated())[0];
      const hit = newest(files.filter(f => norm(f.getName()) === want)) || newest(files.filter(f => norm(f.getName()).replace(/\.[a-z0-9]{1,5}$/, '') === base));
      if (hit) rows.push([x.fileId, x.contractId, hit.getUrl(), hit.getId(), x.name]);
      else missing.push(`${x.contractId} ${x.name}`);
    });
  });
  const q = s => "'" + String(s).replace(/'/g, "''") + "'";
  const sql = rows.length ? '-- Step 3: paste into Supabase > SQL Editor > Run. Adds direct file links; safe to run again.\n' +
    'insert into public.attachment_links (file_id, contract_id, url, drive_file_id, file_name) values\n' +
    rows.map(r => '(' + r.map(q).join(', ') + ')').join(',\n') +
    '\non conflict (file_id) do update set url = excluded.url, drive_file_id = excluded.drive_file_id, file_name = excluded.file_name, updated_at = now();\n'
    : '-- No files were found in the folders.\n';
  const doc = DocumentApp.create('Turtle23 attachment links ' + new Date().toISOString().slice(0, 16));
  doc.getBody().setText(sql + (missing.length ? '\n-- Not found (' + missing.length + '), these keep opening the folder:\n-- ' + missing.join('\n-- ') : ''));
  Logger.log('Found %s of %s files. Not found: %s. SQL for step 3: %s', rows.length, items.length, missing.length, doc.getUrl());
}
