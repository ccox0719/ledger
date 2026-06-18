// data.js — Supabase persistence layer for The Ledger
// Mirrors the old localStorage `state` shape so the app logic is unchanged:
//   state = { months: {key: {...}}, rules: [...], trips: [...] }
// On load we hydrate this shape from Supabase; saves are debounced upserts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Vite injects these at build time from Netlify env vars. The fallback keeps
// GitHub/Netlify builds connected even if the site env vars are missing.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://svaozzitkajgqzacldur.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2YW96eml0a2FqZ3F6YWNsZHVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyMDY1NDMsImV4cCI6MjA3Mzc4MjU0M30.zn50Iw8ib-wTt2Z0gQuKnJbDSe8qr-H-tRvkW2THiKQ';

const missingConfig = !SUPABASE_URL || !SUPABASE_ANON_KEY;
export const supabase = missingConfig ? null : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function requireSupabase() {
  if (missingConfig) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify, then redeploy.');
  }
  return supabase;
}

function assertOk(result, action) {
  if (result?.error) {
    const err = result.error;
    const details = [err.message, err.details, err.hint, err.code].filter(Boolean).join(' | ');
    throw new Error(`${action}: ${details || 'Supabase request failed'}`);
  }
  return result;
}

async function fetchAll(makeQuery, action, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = assertOk(await makeQuery().range(from, from + pageSize - 1), action);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

let householdId = null;
let currentUserId = null;

export async function getSession() {
  const { data } = await requireSupabase().auth.getSession();
  currentUserId = data.session?.user?.id || null;
  return data.session;
}
export async function signIn(email, password) {
  return requireSupabase().auth.signInWithPassword({ email, password });
}
export async function signOut() { return requireSupabase().auth.signOut(); }

export async function resolveHousehold() {
  const session = await getSession();
  currentUserId = session?.user?.id || null;
  const { data } = assertOk(await requireSupabase()
    .from('household_members').select('household_id').limit(1).maybeSingle(), 'Load household');
  householdId = data?.household_id || null;
  return householdId;
}

// ---- LOAD: build the in-memory state object from all tables ----
export async function loadState() {
  const state = { months: {}, rules: [], trips: [], _txns: [] };
  if (!householdId) await resolveHousehold();
  if (!householdId) return state; // not set up yet

  const [months, rules, trips, txns] = await Promise.all([
    fetchAll(() => requireSupabase().from('months').select('*'), 'Load months'),
    fetchAll(() => requireSupabase().from('rules').select('*').order('priority', { ascending: false }), 'Load rules'),
    fetchAll(() => requireSupabase().from('trips').select('*'), 'Load trips'),
    fetchAll(() => requireSupabase().from('transactions').select('*').order('txn_date', { ascending: true }), 'Load transactions'),
  ]);

  months.forEach(row => {
    state.months[row.month_key] = {
      todayBalance: row.today_balance,
      groups: row.groups || [],
      oneTime: row.one_time || [],
      imported: [], // filled from transactions below
    };
  });

  // attach transactions to their month
  txns.forEach(t => {
    const mk = t.month_key;
    if (!state.months[mk]) state.months[mk] = { todayBalance: null, groups: [], oneTime: [], imported: [] };
    state.months[mk].imported.push({
      _id: t.id,
      date: t.txn_date || t.date,
      desc: t.description,
      amount: appAmountFromTransactionRow(t),
      type: t.txn_type || t.type,
      source: t.account_name || t.source,
      cat: !t.category || t.category === 'other' ? undefined : t.category,
      workTravel: t.work_travel,
    });
  });

  state.rules = rules.map(r => [r.keyword, r.line_name, r.source, r.id]);
  state.trips = trips.map(r => ({
    id: r.id, name: r.name, start: r.start_date, end: r.end_date, kind: r.kind,
  }));

  return state;
}

// ---- SAVE: debounced per-entity upserts ----
// The app calls save() broadly; we diff-write the relevant tables.
let saveTimer = null;
export function scheduleSave(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushSave(state).catch(err => console.error('Save failed', err));
  }, 600);
}

export async function flushSave(state) {
  if (!householdId) return;
  const hid = householdId;

  // months (+ their imported txns)
  const monthRows = monthRowsForState(state, Object.keys(state.months));
  if (monthRows.length) assertOk(await requireSupabase().from('months').upsert(monthRows), 'Save months');

  const { transactionRows, txRefs } = await transactionRowsForState(state, Object.keys(state.months));
  const savedTxnKeys = await saveTransactions(transactionRows, txRefs);

  // rules: replace-all is simplest and safe for this volume
  assertOk(await requireSupabase().from('rules').delete().eq('household_id', hid), 'Clear rules');
  const ruleRows = (state.rules || []).map((r, i) => ({
    household_id: hid, keyword: r[0], line_name: r[1],
    source: r[2] || 'chase', priority: (state.rules.length - i),
  }));
  if (ruleRows.length) assertOk(await requireSupabase().from('rules').insert(ruleRows), 'Save rules');

  // trips
  assertOk(await requireSupabase().from('trips').delete().eq('household_id', hid), 'Clear trips');
  const tripRows = (state.trips || []).map(t => ({
    household_id: hid, name: t.name || '', start_date: t.start || null,
    end_date: t.end || null, kind: t.kind || 'personal',
  }));
  if (tripRows.length) assertOk(await requireSupabase().from('trips').insert(tripRows), 'Save trips');
  return { transactionsSaved: savedTxnKeys.size };
}

export async function flushImportSave(state, monthKeys) {
  if (!householdId) return;
  const keys = [...new Set((monthKeys || []).filter(key => state.months?.[key]))];
  if (!keys.length) return { transactionsSaved: 0 };

  const monthRows = monthRowsForState(state, keys);
  if (monthRows.length) assertOk(await requireSupabase().from('months').upsert(monthRows), 'Save imported months');

  const { transactionRows, txRefs } = await transactionRowsForState(state, keys);
  const savedTxnKeys = await saveTransactions(transactionRows, txRefs);
  return { transactionsSaved: savedTxnKeys.size };
}

function monthRowsForState(state, monthKeys) {
  const hid = householdId;
  return monthKeys.map(key => {
    const m = state.months[key];
    return {
      household_id: hid, month_key: key,
      today_balance: m.todayBalance ?? null,
      groups: m.groups || [], one_time: m.oneTime || [],
      updated_at: new Date().toISOString(),
    };
  });
}

async function transactionRowsForState(state, monthKeys) {
  const hid = householdId;
  const userId = await getCurrentUserId();
  const transactionRows = [];
  const txRefs = new Map();
  for (const key of monthKeys) {
    const m = state.months[key];
    for (const t of (m.imported || [])) {
      const importKey = txnImportKey(t);
      const txnDate = normDate(t.date);
      const id = t._id || crypto.randomUUID();
      const category = t.cat ?? 'other';
      const appSource = t.source || 'chase';
      transactionRows.push({
        id, household_id: hid, user_id: userId, month_key: key, source: 'manual',
        account_name: appSource, txn_date: txnDate, date: txnDate,
        description: t.desc, amount: Math.abs(Number(t.amount || 0)),
        type: transactionType(t), txn_type: t.type, category, work_travel: !!t.workTravel,
        import_key: importKey,
      });
      txRefs.set(importKey, t);
    }
  }
  return { transactionRows, txRefs };
}

async function saveTransactions(rows, refsByImportKey) {
  const saved = new Set();
  const uniqueRows = [...new Map(rows.map(row => [row.import_key, row])).values()];
  if (!uniqueRows.length) return saved;

  const keys = [...new Set(uniqueRows.map(r => r.import_key).filter(Boolean))];
  const existingByKey = new Map();
  for (let i = 0; i < keys.length; i += 20) {
    const keyChunk = keys.slice(i, i + 20);
    const { data } = assertOk(await requireSupabase()
      .from('transactions')
      .select('id,import_key')
      .in('import_key', keyChunk), 'Find existing imported transactions');
    for (const row of data || []) {
      if (row.import_key && !existingByKey.has(row.import_key)) existingByKey.set(row.import_key, row.id);
    }
  }

  const inserts = [];
  const updates = [];
  for (const row of uniqueRows) {
    const id = existingByKey.get(row.import_key);
    if (id) updates.push({ id, ...row });
    else inserts.push(row);
  }

  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    const { data } = assertOk(await requireSupabase()
      .from('transactions')
      .upsert(chunk)
      .select('id,import_key'), 'Update imported transactions');
    for (const row of data || []) markSaved(row, saved, refsByImportKey);
  }

  for (let i = 0; i < inserts.length; i += 100) {
    const chunk = inserts.slice(i, i + 100);
    const { data } = assertOk(await requireSupabase()
      .from('transactions')
      .insert(chunk)
      .select('id,import_key'), 'Insert imported transactions');
    for (const row of data || []) markSaved(row, saved, refsByImportKey);
  }

  if (saved.size !== uniqueRows.length) {
    throw new Error(`Save imported transactions: Supabase saved ${saved.size} of ${uniqueRows.length} transactions`);
  }
  return saved;
}

async function getCurrentUserId() {
  if (currentUserId) return currentUserId;
  const session = await getSession();
  currentUserId = session?.user?.id || null;
  if (!currentUserId) throw new Error('Save failed: no signed-in Supabase user found.');
  return currentUserId;
}

function markSaved(row, saved, refsByImportKey) {
  if (!row?.import_key) return;
  saved.add(row.import_key);
  const ref = refsByImportKey.get(row.import_key);
  if (ref) ref._id = row.id;
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

function transactionType(t) {
  const raw = String(t.type || '').toLowerCase();
  if (raw.includes('credit') || Number(t.amount) > 0) return 'income';
  return 'expense';
}

function appAmountFromTransactionRow(t) {
  const amount = Number(t.amount || 0);
  if (amount < 0) return amount;
  const rowType = String(t.type || '').toLowerCase();
  const txnType = String(t.txn_type || '').toLowerCase();
  if (rowType === 'expense' || txnType.includes('sale') || txnType.includes('debit')) return -amount;
  return amount;
}

// Delete a single transaction (e.g. clearing an import)
export async function deleteTxns(monthKey) {
  if (!householdId) return;
  assertOk(await requireSupabase().from('transactions').delete()
    .eq('household_id', householdId).eq('month_key', monthKey), 'Delete transactions');
}

export async function deleteTxnIds(ids) {
  if (!householdId || !ids?.length) return;
  assertOk(await requireSupabase().from('transactions').delete()
    .eq('household_id', householdId).in('id', ids), 'Delete duplicate transactions');
}
