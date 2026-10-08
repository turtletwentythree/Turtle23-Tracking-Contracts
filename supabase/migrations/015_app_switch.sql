-- 015: On/Off switches for Admin Tools. Run after 001-014. Safe to run more than once. No data is deleted.
--   * Web app On/Off (app_settings): when Off, Level 1-3 cannot read or write anything (enforced in the database by has_level),
--     and the website shows "ระบบปิดใช้งานชั่วคราว". Level 4 Admin and Level 5 Root keep full access to turn it back on.
--   * LINE automatic On/Off: switched from the website through set_line_auto(), with who/when kept.
--   * Every switch change is kept in app_settings_audit.

create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  app_open boolean not null default true,
  closed_message text,
  changed_by text,
  changed_at timestamptz
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;
alter table public.app_settings enable row level security;
-- no table policies: read through app_status(), change through set_app_open()

create table if not exists public.app_settings_audit (
  id bigint generated always as identity primary key,
  setting text not null,
  old_value text,
  new_value text,
  note text,
  changed_by text,
  changed_at timestamptz not null default now()
);
alter table public.app_settings_audit enable row level security;

create or replace function public.app_is_open()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select app_open from public.app_settings where id = 1), true)
$$;

-- Every read/write rule goes through has_level: while the app is Off, only Level 4-5 pass
create or replace function public.has_level(min_level int)
returns boolean language sql stable as $$
  select coalesce(public.role_level(public.current_app_role()) >= min_level
    and (public.role_level(public.current_app_role()) >= 4 or public.app_is_open()), false)
$$;

drop policy if exists app_settings_audit_read on public.app_settings_audit;
create policy app_settings_audit_read on public.app_settings_audit for select using (public.has_level(4));

create or replace function public.my_email()
returns text language sql stable security definer set search_path = public as $$
  select lower(email) from public.profiles where id = auth.uid()
$$;

-- Anyone signed in may see whether the app is open (the closed page needs it)
create or replace function public.app_status()
returns table (app_open boolean, closed_message text, changed_by text, changed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.app_open, s.closed_message,
         case when public.has_level(4) then s.changed_by end, s.changed_at
  from public.app_settings s where s.id = 1
$$;

create or replace function public.set_app_open(open boolean, message text default null)
returns void language plpgsql security definer set search_path = public as $$
declare old boolean;
begin
  if not public.has_level(4) then raise exception 'Level 4-5 only'; end if;
  select app_open into old from public.app_settings where id = 1;
  update public.app_settings set app_open = open, closed_message = case when open then null else nullif(trim(message), '') end,
         changed_by = public.my_email(), changed_at = now() where id = 1;
  insert into public.app_settings_audit (setting, old_value, new_value, note, changed_by)
    values ('web_app_open', old::text, open::text, nullif(trim(message), ''), public.my_email());
end $$;

-- LINE automatic sending (table from 014)
alter table if exists public.line_settings add column if not exists auto_changed_by text;
alter table if exists public.line_settings add column if not exists auto_changed_at timestamptz;

create or replace function public.line_auto_status()
returns table (auto_enabled boolean, auto_changed_by text, auto_changed_at timestamptz, last_run_at timestamptz, last_run jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_level(4) then return; end if;
  return query select l.auto_enabled, l.auto_changed_by, l.auto_changed_at, l.last_run_at, l.last_run from public.line_settings l where l.id = 1;
end $$;

create or replace function public.set_line_auto(enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare old boolean;
begin
  if not public.has_level(4) then raise exception 'Level 4-5 only'; end if;
  select auto_enabled into old from public.line_settings where id = 1;
  update public.line_settings set auto_enabled = enabled, auto_changed_by = public.my_email(), auto_changed_at = now() where id = 1;
  insert into public.app_settings_audit (setting, old_value, new_value, changed_by)
    values ('line_auto', old::text, enabled::text, public.my_email());
end $$;

revoke all on function public.set_app_open(boolean, text) from public, anon;
revoke all on function public.set_line_auto(boolean) from public, anon;
revoke all on function public.line_auto_status() from public, anon;
grant select on public.app_settings_audit to authenticated;
grant execute on function public.app_status() to authenticated;
grant execute on function public.set_app_open(boolean, text) to authenticated;
grant execute on function public.line_auto_status() to authenticated;
grant execute on function public.set_line_auto(boolean) to authenticated;
