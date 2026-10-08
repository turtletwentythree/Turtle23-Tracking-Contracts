-- Step 1: run in Supabase > SQL Editor. Copy the single cell "items" (the whole JSON) into the Apps Script, line DATA = ...
-- Lists the Production attachments that only have the contract's Drive folder, not the file. Read only.
select coalesce(jsonb_agg(distinct jsonb_build_object(
         'fileId', a ->> 'fileId', 'contractId', l.contract_id,
         'folderId', substring(a ->> 'cloudFolderUrl' from '/folders/([A-Za-z0-9_-]+)'),
         'name', coalesce(nullif(a ->> 'originalFileName', ''), a ->> 'fileName'))), '[]'::jsonb)::text as items
from public.contract_logs l
cross join lateral jsonb_array_elements(case when jsonb_typeof(l.attachments) = 'array' then l.attachments else '[]' end) a
where coalesce(a ->> 'url', '') = '' and coalesce(a ->> 'path', '') = ''
  and coalesce(a ->> 'fileId', '') <> '' and (a ->> 'cloudFolderUrl') ~ '/folders/'
  and not exists (select 1 from public.attachment_links k where k.file_id = a ->> 'fileId');
