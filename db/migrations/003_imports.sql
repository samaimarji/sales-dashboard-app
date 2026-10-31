-- Step 2: daily upload.

-- Goals come in two kinds: the dealer's own goals (MTD report "Goals") and
-- Cricket's performance targets (rank export "Perf Target").
alter table kpi_goals add column goal_set text not null default 'dealer'
  check (goal_set in ('dealer', 'cricket'));
alter table kpi_goals drop constraint kpi_goals_pkey;
alter table kpi_goals add primary key (dealer_id, org_unit_id, month, kpi_code, goal_set);

alter table import_batches drop constraint import_batches_status_check;
alter table import_batches add constraint import_batches_status_check
  check (status in ('queued','reading','checking','needs_review','saving','done','failed','replaced','cancelled'));
alter table import_batches add column error text;
alter table import_batches add column date_source text;  -- 'file' (from Applied filters) or 'chosen'

alter table import_files add column detected_date date;
alter table import_files add column message text;
alter table import_files drop constraint import_files_file_type_check;
alter table import_files add constraint import_files_file_type_check
  check (file_type in ('mtd','rank','matrix','fees','retention','chi','features'));

-- Stores and people the importer adds on its own are flagged so an admin can review them.
alter table org_units add column auto_added boolean not null default false;
alter table people add column auto_added boolean not null default false;

create index reconciliation_issues_batch on reconciliation_issues (batch_id, severity);
create index import_files_batch on import_files (batch_id);
