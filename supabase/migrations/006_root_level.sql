-- 006: Level 5 "Root System Administrator". Run after 001-005. Safe to run more than once.
--   * Level 5 (root) has every right of Level 4 plus Master Data (the only level that can edit it).
--   * Level 4 (admin) keeps Admin Tools, Users & Roles and Import, but Master Data becomes read-only
--     for it (the tables still feed the dropdowns of User Case Action).
--   * Only a Level 5 account can give or take Level 5. While nobody has Level 5 yet, a Level 4 Admin may
--     set it (so the first Root can be chosen in Users & Roles). The SQL Editor can always set it.
--   * Microsoft Entra App Roles never lower a Level 5 account.
--   * "At least one active Admin" now counts Level 4 and Level 5 together.
-- Nobody's level is changed by this script.

alter type public.app_role add value if not exists 'root';

-- r::text so this script does not need the new enum value to be committed first
create or replace function public.role_level(r public.app_role)
returns int language sql immutable as $$
  select case r::text when 'viewer' then 1 when 'user' then 2 when 'confidential' then 3 when 'admin' then 4 when 'root' then 5 end
$$;

-- ───────────── Master Data: edit = Level 5, read = Level 2+ (004) ─────────────
do $$
declare t text;
begin
  foreach t in array array['departments', 'people', 'contract_types', 'action_sla', 'contract_templates'] loop
    execute format('drop policy if exists %I_admin_write on public.%I', t, t);
    execute format('create policy %I_admin_write on public.%I for all using (public.has_level(5)) with check (public.has_level(5))', t, t);
  end loop;
end $$;

-- ───────────── Who may grant or remove Level 5 ─────────────
create or replace function public.guard_root_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- SQL Editor and Microsoft sign-in (no signed-in app user) are not limited here
  if auth.uid() is null or public.has_level(5) then
    return coalesce(new, old);
  end if;
  if ((tg_op <> 'INSERT' and old.role::text = 'root') or (tg_op <> 'DELETE' and new.role::text = 'root'))
     and exists (select 1 from public.user_access where role::text = 'root' and active) then
    raise exception 'Only a Root System Administrator (Level 5) can grant, change or remove Level 5';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists user_access_guard_root on public.user_access;
create trigger user_access_guard_root
  before insert or update or delete on public.user_access
  for each row execute function public.guard_root_role();

-- ───────────── Never lose the last Admin (Level 4 or 5) ─────────────
create or replace function public.keep_one_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role::text in ('admin', 'root') and old.active
     and not exists (select 1 from public.user_access where role::text in ('admin', 'root') and active) then
    raise exception 'At least one active Admin (Level 4 or 5) must remain';
  end if;
  return null;
end $$;

-- ───────────── Entra sign-in never lowers a Level 5 account ─────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(new.email);
  v_name text := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(v_email, '@', 1));
  v_entra public.app_role := public.entra_level_for(new.raw_user_meta_data);
  v_default public.app_role;
begin
  if v_entra is not null then
    insert into public.user_access (email, display_name, role, source) values (v_email, v_name, v_entra, 'entra')
    on conflict (email) do update set role = excluded.role, source = 'entra'
    where public.user_access.role::text <> 'root';
  elsif not exists (select 1 from public.user_access where email = v_email) then
    select default_role into v_default from public.allowed_domains where domain = split_part(v_email, '@', 2);
    if v_default is null then
      raise exception 'Email % is not allowed to use this system', v_email;
    end if;
    insert into public.user_access (email, display_name, role, source) values (v_email, v_name, v_default, 'domain');
  end if;
  insert into public.profiles (id, email, display_name, last_sign_in_at)
  values (new.id, v_email, v_name, now());
  return new;
end $$;

create or replace function public.handle_user_sign_in()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(new.email);
  v_entra public.app_role := public.entra_level_for(new.raw_user_meta_data);
begin
  update public.profiles set last_sign_in_at = new.last_sign_in_at where id = new.id;
  if v_entra is not null then
    update public.user_access set role = v_entra, source = 'entra'
    where email = v_email and role::text <> 'root' and (role <> v_entra or source <> 'entra');
  else
    update public.user_access ua set role = coalesce(d.default_role, 'viewer'), source = 'domain'
    from (select default_role from public.allowed_domains where domain = split_part(v_email, '@', 2)) d
    where ua.email = v_email and ua.source = 'entra' and ua.role::text <> 'root';
  end if;
  return new;
end $$;
