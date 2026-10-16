-- 019: Daily email to the people holding R = Overdue contracts (Edge Function overdue-mail). Run after 001-018.
-- Safe to run more than once. Nothing is dropped and no existing data is changed.
--   * overdue_mail_settings (one row): Automatic On/Off, the schedule key, last run. Only the Edge Function
--     (service role) reads or writes it, so the website never sees the schedule key.
--   * Every email is recorded in email_outbox (012) with kind 'overdue_reminder'; its request_id
--     'overdue:<date>:<email>' keeps the scheduled run to one email per person per day.
--   * Automatic starts Off: nothing is emailed until an Admin turns it On in Admin Tools > Overdue Email.
-- The Mon-Fri 09:00 schedule (pg_cron + pg_net) is in supabase/functions/overdue-mail/README-TH.md.

create table if not exists public.overdue_mail_settings (
  id int primary key default 1 check (id = 1),
  cron_key text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  auto_enabled boolean not null default false,
  auto_changed_by text,
  auto_changed_at timestamptz,
  cc_contract_owner boolean not null default true,
  run_lock_until timestamptz,
  last_run_at timestamptz,
  last_run jsonb
);
insert into public.overdue_mail_settings (id) values (1) on conflict (id) do nothing;
alter table public.overdue_mail_settings enable row level security;
-- no policies: only the service role (Edge Function) can read or write
