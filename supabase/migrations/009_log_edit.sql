-- 009: Log View Detail edited in Master Data (Level 5). Run after 001-008. Safe to run more than once.
-- Nothing is dropped and no data is removed.
--   * contract_logs gets locked / edited_by / edited_at like the master tables in 008: a log edited by hand is locked,
--     and Import no longer overwrites it (untick "Locked" in Master Data to let Import update it again).
--   * Every change to a log is written to master_audit (History in Master Data).
--   * The Log View columns (007) are filled from the snapshot's `details` only on Import or when `details` itself changes,
--     so a value edited by hand in a column is kept.
--   * import_snapshot() is the same as in 008, except that locked logs are skipped too.

alter table public.contract_logs
  add column if not exists locked boolean not null default false,
  add column if not exists edited_by text,
  add column if not exists edited_at timestamptz;

create or replace function public.master_row_key(tbl text, r jsonb)
returns text language sql immutable as $$
  select case tbl
    when 'departments' then r ->> 'name'
    when 'people' then r ->> 'name'
    when 'action_sla' then r ->> 'action'
    when 'contract_types' then concat_ws(' | ', r ->> 'classification', r ->> 'type', nullif(r ->> 'sub_type', ''))
    when 'contract_templates' then coalesce(r ->> 'selection_label', r ->> 'name')
    when 'log_view_columns' then concat_ws(' / ', r ->> 'section', r ->> 'key')
    when 'contract_logs' then concat(r ->> 'contract_id', ' #', r ->> 'log_no')
    else r ->> 'id' end
$$;

-- Same as 007, but an update that keeps `details` as it was keeps the columns as they were set
create or replace function public.contract_log_fields()
returns trigger language plpgsql set search_path = public as $$
declare
  d jsonb := coalesce(new.details, '{}');
  num text;
begin
  if tg_op = 'UPDATE' and new.details is not distinct from old.details
     and coalesce(current_setting('app.importing', true), 'off') <> 'on' then
    new.attachments := coalesce(new.attachments, '[]');
    new.cc_recipients := coalesce(new.cc_recipients, '[]');
    return new;
  end if;
  new.log_view := coalesce(nullif(d ->> 'Log View', ''), new.log_view,
    case when new.from_person is not null or new.to_person is not null
      then 'From ' || coalesce(new.from_person, '-') || ' >> To ' || coalesce(new.to_person, '-') end);
  num := nullif(d ->> 'Days on Hand', '');
  if num ~ '^-?\d+(\.\d+)?$' then new.days_on_hand := round(num::numeric); end if;
  num := nullif(d ->> 'Action SLA', '');
  if num ~ '^-?\d+(\.\d+)?$' then new.action_sla := round(num::numeric); end if;
  new.alert := coalesce(nullif(d ->> 'Alert', ''), new.alert);
  new.delay_reason := coalesce(nullif(d ->> 'Delay Reason', ''), new.delay_reason);
  new.action_reason := coalesce(nullif(d ->> 'Action Reason', ''), new.action_reason);
  new.corrective_action := coalesce(nullif(d ->> 'Corrective Action', ''), new.corrective_action);
  new.action_reason_type := coalesce(nullif(d ->> 'Action Reason Type', ''), new.action_reason_type);
  new.action_reason_detail := coalesce(nullif(d ->> 'Action Reason Detail', ''), new.action_reason_detail);
  new.approval_type := coalesce(nullif(d ->> 'Approval Type', ''), new.approval_type);
  new.approval_conditions := coalesce(nullif(d ->> 'Approval Conditions', ''), new.approval_conditions);
  new.corrective_action_detail := coalesce(nullif(d ->> 'Corrective Action Detail', ''), new.corrective_action_detail);
  new.action_code := coalesce(nullif(d ->> 'Action Code', ''), new.action_code);
  new.action_name_th := coalesce(nullif(d ->> 'Action Name TH', ''), new.action_name_th);
  new.action_name_en := coalesce(nullif(d ->> 'Action Name EN', ''), new.action_name_en);
  new.action_description_th := coalesce(nullif(d ->> 'Action Description TH', ''), new.action_description_th);
  new.action_description_en := coalesce(nullif(d ->> 'Action Description EN', ''), new.action_description_en);
  new.action_reason_type_th := coalesce(nullif(d ->> 'Action Reason Type TH', ''), new.action_reason_type_th);
  new.action_reason_type_en := coalesce(nullif(d ->> 'Action Reason Type EN', ''), new.action_reason_type_en);
  if jsonb_typeof(d -> 'attachments') = 'array' then new.attachments := d -> 'attachments'; end if;
  if jsonb_typeof(d -> 'cc_recipients') = 'array' then new.cc_recipients := d -> 'cc_recipients'; end if;
  new.attachments := coalesce(new.attachments, '[]');
  new.cc_recipients := coalesce(new.cc_recipients, '[]');
  return new;
end $$;

-- Lock and history for logs (the functions are the ones from 008); logs are never deleted from Master Data
drop trigger if exists contract_logs_track on public.contract_logs;
create trigger contract_logs_track before insert or update on public.contract_logs
  for each row execute function public.master_track();
drop trigger if exists contract_logs_audit on public.contract_logs;
create trigger contract_logs_audit after insert or update or delete on public.contract_logs
  for each row execute function public.master_audit_log();

-- ───────────── Import: same as 008, but locked (hand-edited) logs are kept too ─────────────
create or replace function public.import_snapshot(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added int;
  v_locked int;
begin
  if not public.has_level(4) then
    raise exception 'Only a System Administrator can import a snapshot';
  end if;
  -- Rows written below are marked as import (not manual edits) by master_track()
  perform set_config('app.importing', 'on', true);
  if jsonb_array_length(coalesce(p -> 'contracts', '[]')) = 0 then
    raise exception 'Snapshot has no contracts';
  end if;

  insert into public.departments (name, code, active)
  select name, coalesce(code, ''), coalesce(active, true)
  from jsonb_to_recordset(coalesce(p -> 'departments', '[]')) as x(name text, code text, active boolean)
  where coalesce(name, '') <> ''
  on conflict (name) do update set code = excluded.code, active = excluded.active
  where not public.departments.locked;

  insert into public.people (name, department, email, line_user_id, active)
  select name, department, nullif(lower(email), ''), nullif(line_user_id, ''), coalesce(active, true)
  from jsonb_to_recordset(coalesce(p -> 'people', '[]')) as x(name text, department text, email text, line_user_id text, active boolean)
  where coalesce(name, '') <> ''
  on conflict (name) do update set department = excluded.department, email = excluded.email,
    line_user_id = excluded.line_user_id, active = excluded.active
  where not public.people.locked;

  insert into public.contract_types (classification, type, sub_type, sla, active)
  select classification, type, coalesce(sub_type, ''), coalesce(sla, 20), coalesce(active, true)
  from jsonb_to_recordset(coalesce(p -> 'contract_types', '[]')) as x(classification text, type text, sub_type text, sla int, active boolean)
  on conflict (classification, type, (coalesce(sub_type, ''))) do update set sub_type = excluded.sub_type, sla = excluded.sla, active = excluded.active
  where not public.contract_types.locked;

  insert into public.action_sla (action, description, sla, rule, active)
  select action, description, coalesce(sla, 0), rule, coalesce(active, true)
  from jsonb_to_recordset(coalesce(p -> 'action_sla', '[]')) as x(action text, description text, sla int, rule text, active boolean)
  on conflict (action) do update set description = excluded.description, sla = excluded.sla, rule = excluded.rule, active = excluded.active
  where not public.action_sla.locked;

  insert into public.contract_templates (classification, type_group, sub_type, name, selection_label, source_row, type, work_type,
    contract_id, access_level, category, department, vendor, group_name, fixed_sla, sla_version, remark, active)
  select classification, type_group, sub_type, name, selection_label, source_row, type, work_type,
    contract_id, access_level, category, department, vendor, group_name, fixed_sla, sla_version, remark, coalesce(active, true)
  from jsonb_to_recordset(coalesce(p -> 'contract_templates', '[]')) as x(classification text, type_group text, sub_type text, name text,
    selection_label text, source_row int, type text, work_type text, contract_id text, access_level text, category text, department text,
    vendor text, group_name text, fixed_sla int, sla_version text, remark text, active boolean)
  where coalesce(name, '') <> ''
  on conflict (selection_label) do update set classification = excluded.classification, type_group = excluded.type_group,
    sub_type = excluded.sub_type, name = excluded.name, source_row = excluded.source_row, type = excluded.type,
    work_type = excluded.work_type, contract_id = excluded.contract_id, access_level = excluded.access_level,
    category = excluded.category, department = excluded.department, vendor = excluded.vendor, group_name = excluded.group_name,
    fixed_sla = excluded.fixed_sla, sla_version = excluded.sla_version, remark = excluded.remark, active = excluded.active
  where not public.contract_templates.locked;

  insert into public.contracts (id, name, department, owner, classification, type, sub_type, vendor, stage, cycle, returns,
    station_from, station_to, station_in, add_case_date, due_date, system_due, total_sla, remark, access_level, status,
    closed_at, close_reason, created_by, details)
  select id, name, department, owner, classification, type, sub_type, vendor, coalesce(stage, 'Draft Created'), coalesce(cycle, 1), coalesce(returns, 0),
    station_from, station_to, station_in, coalesce(add_case_date, current_date), due_date, system_due, total_sla, remark,
    coalesce(access_level, 'Normal'), coalesce(status, 'Open'), closed_at, close_reason, null, details
  from jsonb_to_recordset(p -> 'contracts') as x(id text, name text, department text, owner text, classification text, type text,
    sub_type text, vendor text, stage text, cycle int, returns int, station_from text, station_to text, station_in date,
    add_case_date date, due_date date, system_due date, total_sla int, remark text, access_level text, status text,
    closed_at date, close_reason text, details jsonb)
  on conflict (id) do update set name = excluded.name, department = excluded.department, owner = excluded.owner,
    classification = excluded.classification, type = excluded.type, sub_type = excluded.sub_type, vendor = excluded.vendor,
    stage = excluded.stage, cycle = excluded.cycle, returns = excluded.returns, station_from = excluded.station_from,
    station_to = excluded.station_to, station_in = excluded.station_in, add_case_date = excluded.add_case_date,
    due_date = excluded.due_date, system_due = excluded.system_due, total_sla = excluded.total_sla, remark = excluded.remark,
    access_level = excluded.access_level, status = excluded.status, closed_at = excluded.closed_at,
    close_reason = excluded.close_reason, details = excluded.details;

  insert into public.contract_logs (contract_id, log_no, cycle, action, from_person, to_person, in_date, out_date, sla,
    reason, approval, updated_by, updated_at, details)
  select contract_id, log_no, coalesce(cycle, 1), action, from_person, to_person, in_date, out_date, sla,
    reason, approval, updated_by, coalesce(updated_at, now()), details
  from jsonb_to_recordset(coalesce(p -> 'contract_logs', '[]')) as x(contract_id text, log_no int, cycle int, action text,
    from_person text, to_person text, in_date date, out_date date, sla int, reason text, approval text, updated_by text,
    updated_at timestamptz, details jsonb)
  on conflict (contract_id, log_no) do update set cycle = excluded.cycle, action = excluded.action,
    from_person = excluded.from_person, to_person = excluded.to_person, in_date = excluded.in_date, out_date = excluded.out_date,
    sla = excluded.sla, reason = excluded.reason, approval = excluded.approval, updated_by = excluded.updated_by,
    updated_at = excluded.updated_at, details = excluded.details
  where not public.contract_logs.locked;

  insert into public.due_date_requests (contract_id, requested_due, reason, requested_by, status, created_at, details)
  select contract_id, requested_due, reason, requested_by, coalesce(status, 'Pending'), coalesce(created_at, now()), details
  from jsonb_to_recordset(coalesce(p -> 'due_date_requests', '[]')) as x(contract_id text, requested_due date, reason text,
    requested_by text, status text, created_at timestamptz, details jsonb)
  -- the same request (Request ID) is only added once
  where not exists (select 1 from public.due_date_requests d where d.details ->> 'requestId' = x.details ->> 'requestId');

  -- People in the snapshot can sign in; existing accounts (and their levels) are left as they are
  insert into public.user_access (email, display_name, department, role, active)
  select lower(email), name, department, 'viewer', true
  from public.people
  where email like '%@%'
  on conflict (email) do nothing;
  get diagnostics v_added = row_count;

  select (select count(*) from public.departments where locked) + (select count(*) from public.people where locked)
    + (select count(*) from public.contract_types where locked) + (select count(*) from public.action_sla where locked)
    + (select count(*) from public.contract_templates where locked) + (select count(*) from public.contract_logs where locked) into v_locked;
  perform set_config('app.importing', 'off', true);

  return jsonb_build_object(
    'locked_kept', v_locked,
    'imported_contracts', jsonb_array_length(p -> 'contracts'),
    'imported_logs', jsonb_array_length(coalesce(p -> 'contract_logs', '[]')),
    'contracts', (select count(*) from public.contracts),
    'contract_logs', (select count(*) from public.contract_logs),
    'due_date_requests', (select count(*) from public.due_date_requests),
    'departments', (select count(*) from public.departments),
    'people', (select count(*) from public.people),
    'contract_types', (select count(*) from public.contract_types),
    'contract_templates', (select count(*) from public.contract_templates),
    'action_sla', (select count(*) from public.action_sla),
    'new_users', v_added);
end;
$$;

revoke all on function public.import_snapshot(jsonb) from public, anon;
grant execute on function public.import_snapshot(jsonb) to authenticated;
