-- 016: LINE master switch (all sending On/Off). Run after 001-015. Safe to run more than once. No data is deleted.
--   * sending_enabled Off = nothing goes to LINE: neither the 09:30 schedule nor Send Now. Preview still works.
--   * Starts On, so running this changes nothing until an Admin switches it Off.

alter table public.line_settings add column if not exists sending_enabled boolean not null default true;
alter table public.line_settings add column if not exists sending_changed_by text;
alter table public.line_settings add column if not exists sending_changed_at timestamptz;

drop function if exists public.line_auto_status();
create function public.line_auto_status()
returns table (auto_enabled boolean, auto_changed_by text, auto_changed_at timestamptz,
               sending_enabled boolean, sending_changed_by text, sending_changed_at timestamptz, last_run_at timestamptz, last_run jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_level(4) then return; end if;
  return query select l.auto_enabled, l.auto_changed_by, l.auto_changed_at, l.sending_enabled, l.sending_changed_by, l.sending_changed_at, l.last_run_at, l.last_run
    from public.line_settings l where l.id = 1;
end $$;

create or replace function public.set_line_sending(enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare old boolean;
begin
  if not public.has_level(4) then raise exception 'Level 4-5 only'; end if;
  select sending_enabled into old from public.line_settings where id = 1;
  update public.line_settings set sending_enabled = enabled, sending_changed_by = public.my_email(), sending_changed_at = now() where id = 1;
  insert into public.app_settings_audit (setting, old_value, new_value, changed_by)
    values ('line_sending', old::text, enabled::text, public.my_email());
end $$;

revoke all on function public.line_auto_status() from public, anon;
revoke all on function public.set_line_sending(boolean) from public, anon;
grant execute on function public.line_auto_status() to authenticated;
grant execute on function public.set_line_sending(boolean) to authenticated;
