-- ============================================================
-- The Ledger — Supabase schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- 1) HOUSEHOLDS ------------------------------------------------
-- One household groups multiple users (you + Annie) around shared data.
create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our Household',
  created_at timestamptz not null default now()
);

-- Maps auth users to a household. Insert a row per person.
create table if not exists household_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  role text not null default 'editor', -- 'owner' | 'editor' (social convention; both can write)
  created_at timestamptz not null default now(),
  primary key (user_id, household_id)
);

-- If a previous partial run created tables without the current columns,
-- reconcile them before creating functions and RLS policies.
alter table household_members
  add column if not exists household_id uuid references households(id) on delete cascade,
  add column if not exists role text not null default 'editor',
  add column if not exists created_at timestamptz not null default now();

-- Helper: returns the household_id for the currently-authenticated user.
create or replace function current_household()
returns uuid
language sql stable
as $$
  select household_id from household_members where user_id = auth.uid() limit 1
$$;

-- 2) MONTHS ----------------------------------------------------
-- Budget structure + cash-flow anchor for one calendar month.
-- groups/lines stored as JSON (hand-edited in UI; not worth normalizing).
create table if not exists months (
  household_id uuid not null references households(id) on delete cascade,
  month_key text not null,                 -- 'YYYY-MM'
  today_balance numeric,                    -- cash-flow anchor (null until entered)
  groups jsonb not null default '[]',       -- [{id,name,lines:[{id,name,budgeted,day,type,...}]}]
  one_time jsonb not null default '[]',     -- what-if expenses
  updated_at timestamptz not null default now(),
  primary key (household_id, month_key)
);
alter table months
  add column if not exists household_id uuid references households(id) on delete cascade,
  add column if not exists month_key text,
  add column if not exists today_balance numeric,
  add column if not exists groups jsonb not null default '[]',
  add column if not exists one_time jsonb not null default '[]',
  add column if not exists updated_at timestamptz not null default now();

-- 3) TRANSACTIONS ----------------------------------------------
-- Imported CSV rows (Chase card + US Bank checking). The data you can't recreate.
create table if not exists transactions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,
  description text not null default '',
  amount numeric not null default 0,
  type text not null default 'expense',
  category text not null default 'other',
  source text not null default 'manual',    -- 'chase' | 'usbank' | 'manual'
  notes text not null default '',
  review_status text not null default 'reviewed',
  classification_source text not null default 'legacy',
  updated_at timestamptz not null default now(),
  household_id uuid references households(id) on delete cascade,
  month_key text,                           -- which budget month it belongs to
  txn_date date,
  txn_type text,                            -- raw type from CSV
  import_key text,                          -- stable duplicate key from imported CSV fields
  work_travel boolean not null default false,
  created_at timestamptz not null default now()
);
alter table transactions
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists date text,
  add column if not exists type text not null default 'expense',
  add column if not exists notes text not null default '',
  add column if not exists review_status text not null default 'reviewed',
  add column if not exists classification_source text not null default 'legacy',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists household_id uuid references households(id) on delete cascade,
  add column if not exists month_key text,
  add column if not exists source text not null default 'chase',
  add column if not exists txn_date date,
  add column if not exists description text,
  add column if not exists amount numeric,
  add column if not exists txn_type text,
  add column if not exists import_key text,
  add column if not exists category text not null default 'other',
  add column if not exists work_travel boolean not null default false,
  add column if not exists created_at timestamptz not null default now();

update transactions
set import_key = concat(
  coalesce(source, 'chase'), '|',
  coalesce(txn_date::text, ''), '|',
  trim(regexp_replace(upper(coalesce(description, '')), '\s+', ' ', 'g')), '|',
  to_char(round(coalesce(amount, 0)::numeric, 2), 'FM999999999999990.00'), '|',
  trim(upper(coalesce(txn_type, '')))
)
where import_key is null;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by household_id, import_key
      order by created_at nulls last, id
    ) as keep_id,
    first_value(category) over (
      partition by household_id, import_key
      order by (category is null), created_at nulls last, id
    ) as merged_category,
    bool_or(work_travel) over (
      partition by household_id, import_key
    ) as merged_work_travel,
    row_number() over (
      partition by household_id, import_key
      order by created_at nulls last, id
    ) as rn
  from transactions
  where import_key is not null
),
keepers as (
  select distinct keep_id, merged_category, merged_work_travel
  from ranked
  where rn = 1
)
update transactions t
set
  category = coalesce(k.merged_category, t.category),
  work_travel = coalesce(k.merged_work_travel, t.work_travel)
from keepers k
where t.id = k.keep_id;

with ranked as (
  select
    id,
    row_number() over (
      partition by household_id, import_key
      order by created_at nulls last, id
    ) as rn
  from transactions
  where import_key is not null
)
delete from transactions t
using ranked r
where t.id = r.id
  and r.rn > 1;

create index if not exists transactions_household_month
  on transactions (household_id, month_key);
drop index if exists transactions_household_import_key;
create unique index if not exists transactions_household_import_key
  on transactions (household_id, import_key);

-- 4) RULES -----------------------------------------------------
-- Keyword → budget-line mappings (learned over time). source distinguishes card vs checking.
create table if not exists rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  source text not null default 'chase',     -- 'chase' | 'usbank'
  keyword text not null,                    -- uppercased substring to match
  line_name text not null,                  -- budget line it maps to
  priority int not null default 0,          -- higher = checked first (longer keywords win)
  created_at timestamptz not null default now()
);
alter table rules
  add column if not exists household_id uuid references households(id) on delete cascade,
  add column if not exists source text not null default 'chase',
  add column if not exists keyword text,
  add column if not exists line_name text,
  add column if not exists priority int not null default 0,
  add column if not exists created_at timestamptz not null default now();

-- 5) TRIPS -----------------------------------------------------
create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null default '',
  start_date date,
  end_date date,
  kind text not null default 'personal',    -- 'personal' | 'work'
  created_at timestamptz not null default now()
);
alter table trips
  add column if not exists household_id uuid references households(id) on delete cascade,
  add column if not exists name text not null default '',
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists kind text not null default 'personal',
  add column if not exists created_at timestamptz not null default now();

-- ============================================================
-- ROW LEVEL SECURITY
-- Everyone in a household can read+write that household's data.
-- ============================================================
alter table households        enable row level security;
alter table household_members enable row level security;
alter table months            enable row level security;
alter table transactions      enable row level security;
alter table rules             enable row level security;
alter table trips             enable row level security;

drop policy if exists "members read household" on households;
drop policy if exists "read own membership" on household_members;
drop policy if exists "months rw" on months;
drop policy if exists "transactions rw" on transactions;
drop policy if exists "rules rw" on rules;
drop policy if exists "trips rw" on trips;

-- households: members can see their own household
create policy "members read household" on households
  for select using (id = current_household());

-- household_members: a user can see their own membership row
create policy "read own membership" on household_members
  for select using (user_id = auth.uid());

-- Generic policy generator pattern for the data tables:
-- SELECT/INSERT/UPDATE/DELETE allowed when row's household = caller's household.
create policy "months rw" on months
  for all using (household_id = current_household())
  with check (household_id = current_household());

create policy "transactions rw" on transactions
  for all using (household_id = current_household())
  with check (household_id = current_household());

create policy "rules rw" on rules
  for all using (household_id = current_household())
  with check (household_id = current_household());

create policy "trips rw" on trips
  for all using (household_id = current_household())
  with check (household_id = current_household());

-- ============================================================
-- ONE-TIME SETUP (run after creating your two auth users)
-- ============================================================
-- Creates/reuses the Cox household and links Chris's existing auth user.
-- Login email: cac5102008@gmail.com
with household as (
  insert into households (name)
  values ('Cox Household')
  on conflict do nothing
  returning id
), selected_household as (
  select id from household
  union all
  select id from households where name = 'Cox Household'
  limit 1
)
insert into household_members (user_id, household_id, role)
select 'a2b045f5-dfc5-467d-81d5-ae749cc05c7e'::uuid, id, 'owner'
from selected_household
on conflict (user_id, household_id) do update set role = excluded.role;

-- Add Annie after creating her auth user:
-- insert into household_members (user_id, household_id, role)
-- select '<annie-user-uuid>'::uuid, id, 'editor'
-- from households
-- where name = 'Cox Household'
-- on conflict (user_id, household_id) do update set role = excluded.role;
