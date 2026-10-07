-- 011: Attachments in Supabase Storage (replaces Google Drive)
-- Safe to run more than once. Creates one private bucket and its access rules; no table data is changed.
--   * Bucket "attachments" is private: files open only through short-lived signed links made in the app
--   * Storage itself refuses files over 20 MB and types other than PDF, Word, Excel, PowerPoint, JPG, PNG
--   * Files sit under <Contract ID>/<random id>.<ext>; the original file name is kept in the Log (attachments JSON)
--   * Level 2+ can upload; a file can be opened only by someone who can see its contract
--     (Confidential contracts stay hidden from levels that cannot see them); Level 4+ can delete

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 20971520, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- The folder name is the Contract ID with anything outside A-Z a-z 0-9 . _ - replaced by "_" (same rule as the app)
create or replace function public.attachment_contract_visible(object_name text)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.contracts c
    where regexp_replace(c.id, '[^A-Za-z0-9._-]', '_', 'g') = split_part(object_name, '/', 1))
$$;

drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.has_level(2) and name ~ '^[A-Za-z0-9_-][A-Za-z0-9._-]*/[A-Za-z0-9_-][A-Za-z0-9._-]*$');

drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.has_level(2)
    and (public.has_level(4) or public.attachment_contract_visible(name) or owner = auth.uid()));

drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.has_level(4));
