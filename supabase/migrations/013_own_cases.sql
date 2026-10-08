-- 013: User Case Action works only on the user's own cases. Run after 001-012. Safe to run more than once.
-- Nothing is dropped and no data is changed; only the write rules of three tables are tightened.
--   * "Own case" = the signed-in email belongs to the Contract Owner or the current Station Owner
--     (People Master email; a user whose People row has no email is matched by the display name in Users & Roles)
--   * Current Station Owner = "To" of the contract's newest log (highest Log No), else the contract's Station To
--   * Level 4 (Admin) and Level 5 (Root) may act on every case
--   * The person who added a case may write its first log right after Add Case
--   * Reading is unchanged: Dashboard, Contracts and Confidential still show what the level allows

create or replace function public.my_case_names()
returns setof text language sql stable security definer set search_path = public as $$
  select p.name from public.people p
    join public.profiles pr on lower(pr.email) = lower(p.email)
    where pr.id = auth.uid() and coalesce(p.email, '') <> ''
  union
  select ua.display_name from public.user_access ua
    join public.profiles pr on lower(pr.email) = lower(ua.email)
    where pr.id = auth.uid() and coalesce(ua.display_name, '') <> ''
$$;

create or replace function public.is_my_case(cid text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_level(4) or exists (
    select 1 from public.contracts c
    where c.id = cid and (
      c.owner in (select public.my_case_names())
      or coalesce((select l.to_person from public.contract_logs l
                   where l.contract_id = c.id and coalesce(l.action, '') !~* '^due date '
                   order by l.log_no desc, l.updated_at desc, l.id desc limit 1), c.station_to)
         in (select public.my_case_names())))
$$;

-- The contract was added by the signed-in user (Add Case writes Log No 1 right after the contract)
create or replace function public.added_by_me(cid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.contracts c where c.id = cid and c.created_by = auth.uid())
$$;

grant execute on function public.my_case_names() to authenticated;
grant execute on function public.is_my_case(text) to authenticated;
grant execute on function public.added_by_me(text) to authenticated;

drop policy if exists contracts_update on public.contracts;
create policy contracts_update on public.contracts for update
  using (public.has_level(2) and (access_level = 'Normal' or public.has_level(3)) and public.is_my_case(id));

drop policy if exists logs_insert on public.contract_logs;
create policy logs_insert on public.contract_logs for insert
  with check (public.has_level(2) and exists (select 1 from public.contracts c where c.id = contract_id)
    and (public.is_my_case(contract_id) or public.added_by_me(contract_id)));

drop policy if exists logs_update on public.contract_logs;
create policy logs_update on public.contract_logs for update
  using (public.has_level(2) and exists (select 1 from public.contracts c where c.id = contract_id) and public.is_my_case(contract_id))
  with check (public.has_level(2) and exists (select 1 from public.contracts c where c.id = contract_id) and public.is_my_case(contract_id));

drop policy if exists ddr_insert on public.due_date_requests;
create policy ddr_insert on public.due_date_requests for insert
  with check (public.has_level(2) and public.is_my_case(contract_id));
