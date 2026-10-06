-- 007: Log View. Run after 001-006. Safe to run more than once. Nothing is dropped and no data is removed.
--   * contract_logs gets a column for every field of the Production Snapshot's logs table (logs.csv),
--     so the Log View Detail window and the Action Reason window read real columns.
--   * Rows imported before this script keep their values: the new columns are filled from `details`.
--   * Every later insert/update (Import, User Case Action) fills them the same way.
--   * log_view_columns holds the headers of the Log View Detail table and the rows of the Action Reason
--     window (order, English/Thai labels, shown or hidden). The web app builds both from this table.
-- After running it, import the same production_snapshot.json again (Admin Tools → Import) so the Thai/English
-- action names and descriptions are stored too.

alter table public.contract_logs
  add column if not exists log_view text,                  -- Log View        "From X >> To Y"
  add column if not exists days_on_hand int,               -- Days on Hand    working days (Mon–Fri)
  add column if not exists alert text,                     -- Alert           e.g. "Green >>G=On Track"
  add column if not exists delay_reason text,              -- Delay Reason
  add column if not exists action_reason text,             -- Action Reason
  add column if not exists corrective_action text,         -- Corrective Action
  add column if not exists action_reason_type text,        -- Action Reason Type
  add column if not exists action_reason_detail text,      -- Action Reason Detail
  add column if not exists approval_type text,             -- Approval Type
  add column if not exists approval_conditions text,       -- Approval Conditions
  add column if not exists corrective_action_detail text,  -- Corrective Action Detail
  add column if not exists action_code text,               -- Action Code
  add column if not exists action_name_th text,            -- Action Name TH
  add column if not exists action_name_en text,            -- Action Name EN
  add column if not exists action_description_th text,     -- Action Description TH
  add column if not exists action_description_en text,     -- Action Description EN
  add column if not exists action_sla int,                 -- Action SLA
  add column if not exists action_reason_type_th text,     -- Action Reason Type TH
  add column if not exists action_reason_type_en text,     -- Action Reason Type EN
  add column if not exists attachments jsonb not null default '[]',    -- Attachments
  add column if not exists cc_recipients jsonb not null default '[]',  -- CC Recipients
  add column if not exists details jsonb;

-- Fill the columns from `details` (the snapshot's original columns) whenever a row is written
create or replace function public.contract_log_fields()
returns trigger language plpgsql set search_path = public as $$
declare
  d jsonb := coalesce(new.details, '{}');
  num text;
begin
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

drop trigger if exists contract_logs_fields on public.contract_logs;
create trigger contract_logs_fields before insert or update on public.contract_logs
  for each row execute function public.contract_log_fields();

-- Existing rows: run the trigger once (a no-op update) so their new columns are filled
update public.contract_logs set details = details;

-- ───────────── Headers of the Log View windows ─────────────
create table if not exists public.log_view_columns (
  key text not null,                 -- field shown (see the web app: assets/app.js LOG_FIELDS)
  section text not null default 'table' check (section in ('table', 'detail')),
                                     -- table: a column of Log View Detail; detail: a row of the Action Reason window
  position int not null default 0,
  label_en text not null,
  label_th text,
  visible boolean not null default true,
  primary key (section, key)
);
alter table public.log_view_columns enable row level security;
grant select, insert, update, delete on public.log_view_columns to authenticated;
drop policy if exists log_view_columns_read on public.log_view_columns;
drop policy if exists log_view_columns_admin_write on public.log_view_columns;
create policy log_view_columns_read on public.log_view_columns for select using (public.has_level(1));
create policy log_view_columns_admin_write on public.log_view_columns for all using (public.has_level(5)) with check (public.has_level(5));

-- Same headers and order as the original Contract Tracking app (labels can be changed later; positions are kept)
insert into public.log_view_columns (section, key, position, label_en, label_th) values
  ('table', 'contract_id', 1, 'Contract ID', 'รหัสสัญญา'),
  ('table', 'log_view', 2, 'Log View', 'เส้นทาง'),
  ('table', 'from_person', 3, 'From', 'จาก'),
  ('table', 'to_person', 4, 'To', 'ถึง'),
  ('table', 'in_date', 5, 'In', 'วันที่รับ'),
  ('table', 'out_date', 6, 'Out', 'วันที่ส่งต่อ'),
  ('table', 'sla', 7, 'SLA', 'SLA'),
  ('table', 'days_on_hand', 8, 'Days on Hand (Mon–Fri)', 'วันที่ถืองาน (จ.–ศ.)'),
  ('table', 'alert', 9, 'Alert', 'การแจ้งเตือน'),
  ('table', 'delay_reason', 10, 'Delay Reason', 'เหตุผลที่ล่าช้า'),
  ('table', 'action', 11, 'Action', 'การดำเนินการ'),
  ('detail', 'action', 1, 'Action', 'การดำเนินการ'),
  ('detail', 'alert', 2, 'Alert', 'การแจ้งเตือน'),
  ('detail', 'status_update', 3, 'Status Update', 'สถานะปัจจุบัน'),
  ('detail', 'description', 4, 'Description', 'คำอธิบาย'),
  ('detail', 'reason_type', 5, 'Reason Type', 'ประเภทเหตุผล'),
  ('detail', 'reason', 6, 'Reason', 'เหตุผล'),
  ('detail', 'delay_reason', 7, 'Delay Reason', 'เหตุผลที่ล่าช้า'),
  ('detail', 'approval', 8, 'Approval', 'การอนุมัติ'),
  ('detail', 'corrective_action', 9, 'Corrective Action', 'การแก้ไข'),
  ('detail', 'sla', 10, 'SLA', 'ระยะเวลาดำเนินการ'),
  ('detail', 'updated_by', 11, 'Updated By', 'ผู้บันทึก'),
  ('detail', 'attachments', 12, 'Attachments', 'ไฟล์แนบ'),
  ('detail', 'cc_recipients', 13, 'CC Recipients', 'ผู้รับสำเนา')
on conflict (section, key) do nothing;
