-- 014: LINE notification (Edge Function line-notify). Run after 001-013. Safe to run more than once.
-- Nothing is dropped and no existing data is changed.
--   * line_settings (one row): group id captured by the LINE webhook, the schedule key, Automatic On/Off, last run
--     Only the Edge Function (service role) reads or writes it: the website never sees the schedule key
--   * line_notifications: one row per contract sent to LINE, per day (max 1 scheduled send per contract per day)
--   * Automatic starts Off: nothing is sent to LINE until an Admin turns it On in Admin Tools > LINE Notification
-- The 09:30 Mon-Fri schedule (pg_cron + pg_net) is in supabase/functions/line-notify/README-TH.md, because it needs the project URL.

create table if not exists public.line_settings (
  id int primary key default 1 check (id = 1),
  group_id text,
  group_captured_at timestamptz,
  cron_key text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  auto_enabled boolean not null default false,
  run_lock_until timestamptz,
  last_run_at timestamptz,
  last_run jsonb
);
insert into public.line_settings (id) values (1) on conflict (id) do nothing;
alter table public.line_settings enable row level security;
-- no policies: only the service role (Edge Function) can read or write

create table if not exists public.line_notifications (
  id bigint generated always as identity primary key,
  contract_id text not null,
  sent_on date not null,
  status_code text not null check (status_code in ('Y', 'R')),
  source text not null check (source in ('scheduled', 'admin')),
  sent_by text,
  sent_at timestamptz not null default now()
);
create index if not exists line_notifications_day on public.line_notifications (sent_on, contract_id);
alter table public.line_notifications enable row level security;
drop policy if exists line_notifications_read on public.line_notifications;
create policy line_notifications_read on public.line_notifications for select using (public.has_level(4));
