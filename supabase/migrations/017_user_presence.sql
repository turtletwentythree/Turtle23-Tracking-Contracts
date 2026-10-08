-- 017: Online users for Admin Tools. Run after 001-016. Safe to run more than once. No data is deleted.
--   * Each signed-in browser sends a heartbeat every minute (touch_presence) with the page it shows (dashboard, contracts, ...).
--   * Online = a heartbeat within the last 3 minutes. Signing out removes the row at once.
--   * Stored: user id, page, when this visit started, last heartbeat. No IP address, no browser details, no contract data.
--   * While the Web app is Off, Level 1-3 heartbeats are refused and their rows removed, so they are never counted.
--   * Only Level 4-5 can read the list (online_users). The table has no direct access; everything goes through the functions.

create table if not exists public.user_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  page text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.user_presence enable row level security;
revoke all on public.user_presence from public, anon, authenticated;

-- Returns false when this user may not use the app now (inactive, or Level 1-3 while the app is Off)
create or replace function public.touch_presence(p_page text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare lv int := public.role_level(public.current_app_role());
begin
  if auth.uid() is null then return false; end if;
  if lv is null or (lv < 4 and not public.app_is_open()) then
    delete from public.user_presence where user_id = auth.uid();
    return false;
  end if;
  insert into public.user_presence (user_id, page, started_at, last_seen_at)
  values (auth.uid(), left(p_page, 40), now(), now())
  on conflict (user_id) do update set
    page = excluded.page,
    -- a gap longer than 10 minutes starts a new visit
    started_at = case when public.user_presence.last_seen_at < now() - interval '10 minutes' then now() else public.user_presence.started_at end,
    last_seen_at = now();
  delete from public.user_presence where last_seen_at < now() - interval '7 days';
  return true;
end $$;

create or replace function public.leave_presence()
returns void language sql security definer set search_path = public as $$
  delete from public.user_presence where user_id = auth.uid()
$$;

drop function if exists public.online_users(int);
create function public.online_users(p_minutes int default 3)
returns table (email text, display_name text, role public.app_role, department text, page text,
               last_sign_in_at timestamptz, started_at timestamptz, last_seen_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_level(4) then return; end if;
  return query
  select pr.email, coalesce(ua.display_name, pr.display_name), ua.role, ua.department, p.page,
         pr.last_sign_in_at, p.started_at, p.last_seen_at
  from public.user_presence p
  join public.profiles pr on pr.id = p.user_id
  join public.user_access ua on ua.email = pr.email and ua.active
  where p.last_seen_at > now() - make_interval(mins => greatest(1, least(coalesce(p_minutes, 3), 60)))
    and (public.role_level(ua.role) >= 4 or public.app_is_open())
  order by p.last_seen_at desc;
end $$;

revoke all on function public.touch_presence(text) from public, anon;
revoke all on function public.leave_presence() from public, anon;
revoke all on function public.online_users(int) from public, anon;
grant execute on function public.touch_presence(text) to authenticated;
grant execute on function public.leave_presence() to authenticated;
grant execute on function public.online_users(int) to authenticated;
