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

-- 3) TRANSACTIONS ----------------------------------------------
-- Imported CSV rows (Chase card + US Bank checking). The data you can't recreate.
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  month_key text not null,                  -- which budget month it belongs to
  source text not null default 'chase',     -- 'chase' | 'usbank'
  txn_date date,
  description text not null,
  amount numeric not null,                  -- negative = charge/debit, positive = credit
  txn_type text,                            -- raw type from CSV
  category text,                            -- assigned budget line (null = uncategorized)
  work_travel boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists transactions_household_month
  on transactions (household_id, month_key);

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
