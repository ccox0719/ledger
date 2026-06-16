# The Ledger — Supabase + Netlify setup

Household budgeting + cash-flow app. Vanilla JS, Vite build, Supabase backend,
deployed to Netlify (same pattern as the devotional app).

## One-time setup

### 1. Create the Supabase project
1. supabase.com → New project. Note the **Project URL** and **anon public key**
   (Settings → API).
2. SQL Editor → New query → paste all of `supabase/schema.sql` → Run.
   This creates the tables, row-level security, and the `current_household()` helper.
   If you previously ran an older partial schema and see `column "household_id"
   does not exist`, rerun the full current `supabase/schema.sql`; it includes
   compatibility `ALTER TABLE` statements before recreating the policies.

### 2. Create your two logins
1. Authentication → Users → Add user → create one for you, one for Annie
   (email + password each). Copy each user's UUID.
2. SQL Editor, run. Chris's existing Supabase login is `cac5102008@gmail.com`, and its UUID is already filled in:
   ```sql
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
   ```
3. After creating Annie's auth user, insert her UUID as `editor` using the commented SQL at the bottom of `supabase/schema.sql`.

### 3. Local dev (optional)
```bash
npm install
cp .env.example .env      # fill in your real URL + anon key
npm run dev               # http://localhost:5173
```

### 4. Deploy to Netlify
1. Push this folder to a GitHub repo.
2. Netlify → Add new site → import the repo.
   Build command `npm run build`, publish dir `dist` (already in `netlify.toml`).
3. Site settings → Environment variables, add:
   - `VITE_SUPABASE_URL` = your project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
4. Deploy. Visiting the site shows the login screen.

## How data is organized
- **households / household_members** — links you + Annie to one shared dataset.
- **months** — per-month budget structure (groups/lines as JSON) + the cash-flow
  "today balance" anchor.
- **transactions** — imported Chase card + US Bank checking rows, with assigned
  category and work-travel flag. The data you can't recreate.
- **rules** — keyword → budget-line mappings, learned over time, tagged by source
  (`chase` vs `usbank`).
- **trips** — travel log (name, dates, work/personal).

## Notes
- The anon key is safe to expose in the browser; row-level security restricts every
  query to your own household.
- Saves are debounced (~0.6s) and flushed on tab close.
- The local single-file version (`budget.html`) still works offline with
  localStorage; this project is the synced multi-device version.
