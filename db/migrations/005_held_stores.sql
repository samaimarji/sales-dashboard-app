-- Stores whose files don't match are held instead of holding the whole day.

alter table reconciliation_issues add column store_number text;
create index reconciliation_issues_store on reconciliation_issues (batch_id, store_number);

create table import_held_stores (
  batch_id      int  not null references import_batches(id) on delete cascade,
  dealer_id     int  not null references dealers(id) on delete cascade,
  biz_date      date not null,
  store_id      int  not null references stores(org_unit_id) on delete cascade,
  store_number  text not null,
  status        text not null default 'held' check (status in ('held','released')),
  carried_from  date,          -- date of the last good numbers shown while held (null = none this month)
  released_at   timestamptz,
  released_by   int references users(id) on delete set null,
  primary key (batch_id, store_id)
);
create index import_held_stores_date on import_held_stores (dealer_id, biz_date, status);

alter table import_held_stores enable row level security;
create policy dealer_isolation on import_held_stores to dd_app
  using (dealer_id = current_dealer_id()) with check (dealer_id = current_dealer_id());

grant select, insert, update, delete on import_held_stores to dd_app;
-- Tables added by later migrations are usable by the app role too.
alter default privileges in schema public grant select, insert, update, delete on tables to dd_app;
alter default privileges in schema public grant usage, select on sequences to dd_app;

alter table import_batches drop constraint import_batches_status_check;
alter table import_batches add constraint import_batches_status_check
  check (status in ('queued','reading','checking','needs_review','saving','done','failed','replaced','cancelled'));
