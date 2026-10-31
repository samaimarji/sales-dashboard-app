-- Dealer Dashboard: core schema.
--
-- Design notes (see docs/DATABASE.md for the plain-language version):
-- * Multi-tenant: every dealer-owned row carries dealer_id, and row-level security
--   (RLS) limits the app role to the dealer set in the `app.dealer_id` session setting.
-- * The org tree (Dealer > Region > Area > District > Store) lives in org_units with an
--   ltree `path`, so "everything under this unit" is one indexed lookup.
-- * Power BI exports are month-to-date (MTD) snapshots. We keep one snapshot per
--   business date ("numbers through" date). KPI values sit in a jsonb map keyed by
--   kpi_catalog.code, so new KPIs never need a schema change.
-- * org_rollup_daily holds pre-added totals for every org unit and date, so screens
--   never add up thousands of stores on the fly.

create extension if not exists ltree;

-- ---------------------------------------------------------------------------
-- Dealers and org structure
-- ---------------------------------------------------------------------------

create table dealers (
  id            serial primary key,
  slug          text not null unique,
  name          text not null,
  logo_url      text,
  primary_color text not null default '#0f766e',
  accent_color  text not null default '#f59e0b',
  timezone      text not null default 'America/Los_Angeles',
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- Each dealer names (or skips) the levels between itself and its stores.
create table dealer_org_levels (
  dealer_id  int  not null references dealers(id) on delete cascade,
  level_key  text not null check (level_key in ('dealer','region','area','district','store')),
  label      text not null,          -- e.g. 'Territory' instead of 'Region'
  enabled    boolean not null default true,
  depth      smallint not null,      -- 0 = dealer ... 4 = store
  primary key (dealer_id, level_key)
);

create table org_units (
  id         serial primary key,
  dealer_id  int  not null references dealers(id) on delete cascade,
  parent_id  int  references org_units(id) on delete cascade,
  level_key  text not null check (level_key in ('dealer','region','area','district','store')),
  name       text not null,
  code       text,                   -- store number / district code as dealers know it
  path       ltree not null,         -- e.g. u1.u7.u42 (ids of every ancestor + self)
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (dealer_id, level_key, code)
);
create index org_units_path_gist on org_units using gist (path);
create index org_units_parent on org_units (parent_id);
create index org_units_dealer_level on org_units (dealer_id, level_key);
create index org_units_name on org_units (dealer_id, lower(name));

create table stores (
  org_unit_id   int primary key references org_units(id) on delete cascade,
  dealer_id     int not null references dealers(id) on delete cascade,
  store_number  text not null,
  sales_code    text,                -- Power BI 'Sales Code'
  address       text,
  city          text,
  state         text,
  opened_on     date,
  -- {"mon":["10:00","20:00"], ..., "sun":["10:00","19:00"]}
  hours         jsonb not null default '{}'::jsonb,
  unique (dealer_id, store_number)
);

-- ---------------------------------------------------------------------------
-- People (reps) and logins
-- ---------------------------------------------------------------------------

create table people (
  id                     serial primary key,
  dealer_id              int  not null references dealers(id) on delete cascade,
  display_name           text not null,
  employee_code          text,       -- the ID in "Advocate Name and ID"
  hidden_from_rep_views  boolean not null default false,  -- counts in totals, never shown by name
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  unique (dealer_id, employee_code)
);
create index people_dealer_name on people (dealer_id, lower(display_name));

-- Every spelling of a person seen in an import maps to one person, which is how
-- reps who work at several stores are combined under one name.
create table person_aliases (
  dealer_id  int  not null references dealers(id) on delete cascade,
  raw_name   text not null,
  person_id  int  not null references people(id) on delete cascade,
  primary key (dealer_id, raw_name)
);

create table store_assignments (
  id          serial primary key,
  dealer_id   int  not null references dealers(id) on delete cascade,
  person_id   int  not null references people(id) on delete cascade,
  store_id    int  not null references stores(org_unit_id) on delete cascade,
  is_primary  boolean not null default true,
  start_date  date not null,
  end_date    date
);
create index store_assignments_person on store_assignments (person_id);
create index store_assignments_store on store_assignments (store_id);

create table users (
  id                 serial primary key,
  email              text not null unique,
  full_name          text not null,
  password_hash      text,
  is_platform_admin  boolean not null default false,
  dealer_id          int references dealers(id) on delete cascade,  -- null only for platform admins
  person_id          int references people(id) on delete set null,  -- set for reps
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

-- A role is always tied to one point in the org tree; access = that unit and everything under it.
create table user_roles (
  id           serial primary key,
  user_id      int  not null references users(id) on delete cascade,
  dealer_id    int  not null references dealers(id) on delete cascade,
  role         text not null check (role in ('dealer_admin','region','area','district','store_manager','rep')),
  org_unit_id  int  not null references org_units(id) on delete cascade
);
create index user_roles_user on user_roles (user_id);

create table sessions (
  id          text primary key,       -- random token (hashed)
  user_id     int  not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- KPI catalog (global) and saved reports (per dealer / per user)
-- ---------------------------------------------------------------------------

create table kpi_catalog (
  code              text primary key,
  label             text not null,
  category          text not null,          -- Sales, Features, Fees, Retention, Home Internet, ...
  unit              text not null check (unit in ('count','currency','percent','decimal')),
  -- How to combine across stores/reps:
  --   sum          add it up
  --   ratio        numerator / denominator, both summed first (never average percentages)
  --   weighted_avg average weighted by weight_kpi (used when the file only gives the %)
  agg               text not null check (agg in ('sum','ratio','weighted_avg')),
  numerator         text references kpi_catalog(code) deferrable initially deferred,
  denominator       text references kpi_catalog(code) deferrable initially deferred,
  weight_kpi        text references kpi_catalog(code) deferrable initially deferred,
  higher_is_better  boolean not null default true,
  stored            boolean not null default true,   -- false = calculated from other KPIs
  sources           jsonb not null default '[]'::jsonb, -- [{"file":"matrix","header":"Device Upgrades"}]
  sort              int not null default 0,
  description       text
);

create table saved_reports (
  id             serial primary key,
  dealer_id      int  not null references dealers(id) on delete cascade,
  owner_user_id  int  references users(id) on delete cascade,  -- null = official dealer report
  name           text not null,
  row_level      text not null check (row_level in ('region','area','district','store','rep')),
  is_official    boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table saved_report_kpis (
  report_id  int  not null references saved_reports(id) on delete cascade,
  kpi_code   text not null references kpi_catalog(code),
  position   int  not null,
  primary key (report_id, kpi_code)
);

-- ---------------------------------------------------------------------------
-- Imports
-- ---------------------------------------------------------------------------

create table import_batches (
  id               serial primary key,
  dealer_id        int  not null references dealers(id) on delete cascade,
  biz_date         date not null,          -- "numbers through" date
  uploaded_by      int  references users(id) on delete set null,
  status           text not null default 'queued'
                   check (status in ('queued','reading','checking','needs_review','saving','done','failed','replaced')),
  progress         smallint not null default 0,   -- 0-100 for the progress bar
  summary          jsonb not null default '{}'::jsonb,
  source           text not null default 'upload', -- upload | email | drive | generator
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index import_batches_dealer_date on import_batches (dealer_id, biz_date desc);

create table import_files (
  id                serial primary key,
  batch_id          int  not null references import_batches(id) on delete cascade,
  dealer_id         int  not null references dealers(id) on delete cascade,
  file_type         text check (file_type in ('mtd','rank','matrix','fees','retention','chi','features')),
  original_name     text not null,
  header_signature  text,
  row_count         int,
  storage_key       text,
  status            text not null default 'pending'
);

create table reconciliation_issues (
  id         serial primary key,
  batch_id   int  not null references import_batches(id) on delete cascade,
  dealer_id  int  not null references dealers(id) on delete cascade,
  severity   text not null check (severity in ('error','warning','info')),
  check_name text not null,
  store_id   int  references stores(org_unit_id) on delete cascade,
  kpi_code   text,
  expected   numeric,
  actual     numeric,
  message    text not null
);

-- ---------------------------------------------------------------------------
-- Numbers (MTD snapshots, partitioned by month)
-- ---------------------------------------------------------------------------

-- One row per rep per store per day. A rep at two stores has two rows; rep views add them up.
create table rep_daily_mtd (
  dealer_id        int  not null,
  biz_date         date not null,
  store_id         int  not null,
  person_id        int  not null,
  m                jsonb not null,
  import_batch_id  int,
  primary key (dealer_id, biz_date, store_id, person_id)
) partition by range (biz_date);
create index rep_daily_mtd_person on rep_daily_mtd (dealer_id, person_id, biz_date);

-- Store totals exactly as the store-level exports report them (includes everyone, hidden or not).
create table store_daily_mtd (
  dealer_id        int  not null,
  biz_date         date not null,
  store_id         int  not null,
  m                jsonb not null,
  import_batch_id  int,
  primary key (dealer_id, biz_date, store_id)
) partition by range (biz_date);

-- Pre-added totals for every org unit (store, district, area, region, dealer) and day.
create table org_rollup_daily (
  dealer_id    int  not null,
  biz_date     date not null,
  org_unit_id  int  not null,
  store_count  int  not null,
  m            jsonb not null,
  primary key (dealer_id, biz_date, org_unit_id)
) partition by range (biz_date);
create index org_rollup_daily_unit on org_rollup_daily (org_unit_id, biz_date);

-- Monthly targets at any org level. Store goals add up to district/region goals
-- unless a higher level has its own goal.
create table kpi_goals (
  dealer_id    int  not null references dealers(id) on delete cascade,
  org_unit_id  int  not null references org_units(id) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  kpi_code     text not null references kpi_catalog(code),
  target       numeric not null,
  source       text not null default 'manual',   -- manual | import
  primary key (dealer_id, org_unit_id, month, kpi_code)
);

-- Creates monthly partitions for the three fact tables between two dates.
create or replace function ensure_month_partitions(p_from date, p_to date) returns void
language plpgsql as $$
declare
  m date := date_trunc('month', p_from)::date;
  t text;
begin
  while m <= p_to loop
    foreach t in array array['rep_daily_mtd','store_daily_mtd','org_rollup_daily'] loop
      execute format(
        'create table if not exists %I partition of %I for values from (%L) to (%L)',
        t || '_' || to_char(m, 'YYYY_MM'), t, m, (m + interval '1 month')::date);
    end loop;
    m := (m + interval '1 month')::date;
  end loop;
end $$;

select ensure_month_partitions(date '2026-01-01', date '2027-12-01');

-- ---------------------------------------------------------------------------
-- Settings, audit, and tables reserved for later phases
-- ---------------------------------------------------------------------------

create table audit_log (
  id         bigserial primary key,
  dealer_id  int references dealers(id) on delete cascade,
  user_id    int references users(id) on delete set null,
  action     text not null,          -- e.g. 'import.saved', 'settings.goal_changed'
  entity     text,
  entity_id  text,
  details    jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
create index audit_log_dealer_at on audit_log (dealer_id, at desc);

-- Later: schedule planner. Rules such as {"weekly_paid_hours_budget":288,
-- "lunch":[{"min_hours":5,"max_hours":6,"unpaid_minutes":30},{"over_hours":6,"unpaid_minutes":60}],
-- "max_shift_hours":8,"max_week_hours_incl_lunch":44,"max_week_paid_hours":40}
create table labor_rules (
  id              serial primary key,
  dealer_id       int  not null references dealers(id) on delete cascade,
  org_unit_id     int  references org_units(id) on delete cascade,  -- null = whole dealer
  effective_from  date not null,
  rules           jsonb not null
);

create table schedules (
  id           serial primary key,
  dealer_id    int  not null references dealers(id) on delete cascade,
  store_id     int  not null references stores(org_unit_id) on delete cascade,
  week_start   date not null,
  status       text not null default 'draft',
  unique (store_id, week_start)
);

create table shifts (
  id           serial primary key,
  dealer_id    int  not null references dealers(id) on delete cascade,
  schedule_id  int  not null references schedules(id) on delete cascade,
  person_id    int  references people(id) on delete set null,  -- null = open shift
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  unpaid_minutes int not null default 0
);

-- Later: commission calculator.
create table commission_plans (
  id           serial primary key,
  dealer_id    int  not null references dealers(id) on delete cascade,
  name         text not null,
  month        date not null,
  rules        jsonb not null
);

-- Later: billing, priced by store count.
create table billing_accounts (
  dealer_id         int primary key references dealers(id) on delete cascade,
  plan              text not null default 'trial',
  price_per_store   numeric,
  billed_store_count int,
  status            text not null default 'trial'
);

-- ---------------------------------------------------------------------------
-- Row-level security: the app connects as role dd_app and must set app.dealer_id.
-- Migrations, the sample-data generator and platform-admin tools use the owner role.
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'dd_app') then
    create role dd_app login password 'dd_app';
  end if;
end $$;

grant usage on schema public to dd_app;
grant select, insert, update, delete on all tables in schema public to dd_app;
grant usage, select on all sequences in schema public to dd_app;
grant execute on all functions in schema public to dd_app;

create or replace function current_dealer_id() returns int
language sql stable as $$ select nullif(current_setting('app.dealer_id', true), '')::int $$;

do $$
declare t text;
begin
  foreach t in array array[
    'dealer_org_levels','org_units','stores','people','person_aliases','store_assignments',
    'user_roles','saved_reports','import_batches','import_files','reconciliation_issues',
    'rep_daily_mtd','store_daily_mtd','org_rollup_daily','kpi_goals','audit_log',
    'labor_rules','schedules','shifts','commission_plans','billing_accounts'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy dealer_isolation on %I to dd_app using (dealer_id = current_dealer_id()) with check (dealer_id = current_dealer_id())', t);
  end loop;
end $$;

alter table dealers enable row level security;
create policy dealer_isolation on dealers to dd_app using (id = current_dealer_id());
