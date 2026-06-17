// data.js — Supabase persistence layer for The Ledger
// Mirrors the old localStorage `state` shape so the app logic is unchanged:
//   state = { months: {key: {...}}, rules: [...], trips: [...] }
// On load we hydrate this shape from Supabase; saves are debounced upserts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Vite injects these at build time from Netlify env vars.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const missingConfig = !SUPABASE_URL || !SUPABASE_ANON_KEY;
export const supabase = missingConfig ? null : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function requireSupabase() {
  if (missingConfig) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify, then redeploy.');
  }
  return supabase;
}

let householdId = null;

export async function getSession() {
  const { data } = await requireSupabase().auth.getSession();
  return data.session;
}
export async function signIn(email, password) {
  return requireSupabase().auth.signInWithPassword({ email, password });
}
export async function signOut() { return requireSupabase().auth.signOut(); }

export async function resolveHousehold() {
  const { data, error } = await requireSupabase()
    .from('household_members').select('household_id').limit(1).maybeSingle();
  if (error) throw error;
  householdId = data?.household_id || null;
  return householdId;
}

// ---- LOAD: build the in-memory state object from all tables ----
export async function loadState() {
  const state = { months: {}, rules: [], trips: [], _txns: [] };
  if (!householdId) await resolveHousehold();
  if (!householdId) return state; // not set up yet

  const [months, rules, trips, txns] = await Promise.all([
    requireSupabase().from('months').select('*'),
    requireSupabase().from('rules').select('*').order('priority', { ascending: false }),
    requireSupabase().from('trips').select('*'),
    requireSupabase().from('transactions').select('*'),
  ]);

  (months.data || []).forEach(row => {
    state.months[row.month_key] = {
      todayBalance: row.today_balance,
      groups: row.groups || [],
      oneTime: row.one_time || [],
      imported: [], // filled from transactions below
    };
  });

  // attach transactions to their month
  (txns.data || []).forEach(t => {
    const mk = t.month_key;
    if (!state.months[mk]) state.months[mk] = { todayBalance: null, groups: [], oneTime: [], imported: [] };
    state.months[mk].imported.push({
      _id: t.id,
      date: t.txn_date,
      desc: t.description,
      amount: Number(t.amount),
      type: t.txn_type,
      source: t.source,
      cat: t.category === null ? undefined : t.category,
      workTravel: t.work_travel,
    });
  });

  state.rules = (rules.data || []).map(r => [r.keyword, r.line_name, r.source, r.id]);
  state.trips = (trips.data || []).map(r => ({
    id: r.id, name: r.name, start: r.start_date, end: r.end_date, kind: r.kind,
  }));

  return state;
}

// ---- SAVE: debounced per-entity upserts ----
// The app calls save() broadly; we diff-write the relevant tables.
let saveTimer = null;
export function scheduleSave(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushSave(state), 600);
}

export async function flushSave(state) {
  if (!householdId) return;
  const hid = householdId;

  // months (+ their imported txns)
  const monthRows = Object.entries(state.months).map(([key, m]) => ({
    household_id: hid, month_key: key,
    today_balance: m.todayBalance ?? null,
    groups: m.groups || [], one_time: m.oneTime || [],
    updated_at: new Date().toISOString(),
  }));
  if (monthRows.length) await requireSupabase().from('months').upsert(monthRows);

  // transactions: upsert those with _id, insert those without
  for (const [key, m] of Object.entries(state.months)) {
    for (const t of (m.imported || [])) {
      const row = {
        household_id: hid, month_key: key, source: t.source || 'chase',
        txn_date: normDate(t.date), description: t.desc, amount: t.amount,
        txn_type: t.type, category: t.cat ?? null, work_travel: !!t.workTravel,
        import_key: txnImportKey(t),
      };
      if (t._id) { row.id = t._id; await requireSupabase().from('transactions').upsert(row); }
      else {
        const { data } = await requireSupabase()
          .from('transactions')
          .upsert(row, { onConflict: 'household_id,import_key' })
          .select('id')
          .single();
        if (data) t._id = data.id;
      }
    }
  }

  // rules: replace-all is simplest and safe for this volume
  await requireSupabase().from('rules').delete().eq('household_id', hid);
  const ruleRows = (state.rules || []).map((r, i) => ({
    household_id: hid, keyword: r[0], line_name: r[1],
    source: r[2] || 'chase', priority: (state.rules.length - i),
  }));
  if (ruleRows.length) await requireSupabase().from('rules').insert(ruleRows);

  // trips
  await requireSupabase().from('trips').delete().eq('household_id', hid);
  const tripRows = (state.trips || []).map(t => ({
    household_id: hid, name: t.name || '', start_date: t.start || null,
    end_date: t.end || null, kind: t.kind || 'personal',
  }));
  if (tripRows.length) await requireSupabase().from('trips').insert(tripRows);
}

function normDate(d) {
  if (!d) return null;
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const p = s.split('/'); if (p.length < 3) return null;
  return `${p[2]}-${String(p[0]).padStart(2,'0')}-${String(p[1]).padStart(2,'0')}`;
}

function txnImportKey(t) {
  const source = t.source || 'chase';
  const date = normDate(t.date) || '';
  const desc = String(t.desc || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const amount = Number(t.amount || 0).toFixed(2);
  const type = String(t.type || '').toUpperCase().trim();
  return [source, date, desc, amount, type].join('|');
}

// Delete a single transaction (e.g. clearing an import)
export async function deleteTxns(monthKey) {
  if (!householdId) return;
  await requireSupabase().from('transactions').delete()
    .eq('household_id', householdId).eq('month_key', monthKey);
}

export async function deleteTxnIds(ids) {
  if (!householdId || !ids?.length) return;
  await requireSupabase().from('transactions').delete()
    .eq('household_id', householdId).in('id', ids);
}
