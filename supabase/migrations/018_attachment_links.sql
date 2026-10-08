-- 018: Direct Google Drive links for attachments from the Production system. Run after 001-017. Safe to run more than once.
-- Some Production attachments only kept the contract's Drive folder (cloudFolderUrl), not the file, so the web app could
-- only open the folder. attachment_links stores the file's own Drive link, keyed by the attachment's fileId (FIL-...),
-- found by the Apps Script in supabase/attachment-links/. It is a separate table so a new Production Snapshot import
-- (which rewrites contract_logs.attachments) keeps the links.
-- Visibility follows the contract, like the logs: a confidential contract's links are only readable by those who can see it.

create table if not exists public.attachment_links (
  file_id text primary key,
  contract_id text not null,
  url text not null check (url ~ '^https://(drive|docs)\.google\.com/'),
  drive_file_id text,
  file_name text,
  updated_at timestamptz not null default now()
);
alter table public.attachment_links enable row level security;
grant select on public.attachment_links to authenticated;
drop policy if exists attachment_links_read on public.attachment_links;
create policy attachment_links_read on public.attachment_links for select
  using (exists (select 1 from public.contracts c where c.id = contract_id));
drop policy if exists attachment_links_admin on public.attachment_links;
create policy attachment_links_admin on public.attachment_links for all using (public.has_level(4)) with check (public.has_level(4));
grant insert, update, delete on public.attachment_links to authenticated;
