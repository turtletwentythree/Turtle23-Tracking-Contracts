-- 020: Fixed recipients of the Request Due Date approval email. Run after 001-019.
-- Safe to run more than once. Nothing is dropped and no existing data is changed.
--   * people.due_mail: 'To' = approver (always on To), 'CC' = admin who adjusts the data after approval (always on CC).
--   * Set it in Master Data > People (column "Due Date Email"). Users cannot remove these recipients in the form;
--     they can still add more CC. With nobody set to 'To', the email goes to the active Admins as before.
alter table public.people add column if not exists due_mail text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'people_due_mail_check') then
    alter table public.people add constraint people_due_mail_check check (due_mail is null or due_mail in ('To', 'CC'));
  end if;
end $$;
