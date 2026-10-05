-- Menu / page access per Access Level (run after 003_entra_roles.sql).
--
--   Level 1 Viewer        Dashboard, Contracts
--   Level 2 User          Dashboard, Contracts, User Case Action
--   Level 3 Confidential  Dashboard, Contracts, Confidential, User Case Action
--   Level 4 Admin         Dashboard, Contracts, Confidential, User Case Action, Master Data, Admin Tools
--
-- The web app hides menus and blocks typed URLs; these policies make the data match.
-- Contracts, logs and due-date requests already follow these levels (001_schema.sql):
--   read Normal contracts from Level 1, Confidential from Level 3, write cases from Level 2, admin-only approvals.
-- Master Data becomes an Admin page, so Viewers no longer read the master tables.
-- Level 2-3 still read them because User Case Action fills its dropdowns from them; only Admin writes.
do $$
declare t text;
begin
  foreach t in array array['departments', 'people', 'contract_types', 'action_sla'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (public.has_level(2))', t, t);
  end loop;
end $$;
