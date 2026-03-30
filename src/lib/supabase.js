import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Auth helpers ----
export async function signInAnonymously() {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Join couple by invite code (creates anon user if needed)
export async function authWithInviteCode(code, displayName) {
  // Ensure we have a session (anonymous)
  let session = await getSession();
  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw new Error('Ошибка авторизации: ' + error.message);
    if (!data?.session) throw new Error('Не удалось создать сессию. Проверь что Anonymous Sign-In включён в Supabase.');
    session = data.session;
  }
  
  const { data: couple, error: rpcError } = await supabase.rpc('join_couple_by_invite', {
    p_invite_code: code,
    p_display_name: displayName || 'User',
  });
  if (rpcError || !couple) throw new Error('Код не найден');
  
  // Save code to localStorage so user doesn't need to enter again
  localStorage.setItem('ce_invite_code', code);
  localStorage.setItem('ce_display_name', displayName || 'User');
  
  return couple;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*, couples(*)')
    .eq('id', user.id)
    .maybeSingle();
  if (error) {
    console.error('getProfile error:', error);
    return null;
  }
  return data;
}

// Get both partners in a couple
export async function getCoupleMembers(coupleId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .eq('couple_id', coupleId);
  if (error) { console.error('getCoupleMembers error:', error); return []; }
  return data || [];
}

// ---- Couple helpers ----
export async function createCouple(name = 'Our Budget') {
  const { data: couple, error: coupleErr } = await supabase
    .from('couples')
    .insert({ name })
    .select()
    .single();
  if (coupleErr) throw coupleErr;
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('profiles').update({ couple_id: couple.id }).eq('id', user.id);
  await supabase.rpc('seed_default_categories', { p_couple_id: couple.id });
  return couple;
}

export async function joinCouple(inviteCode) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();
  return authWithInviteCode(inviteCode, profile?.display_name || 'User');
}

// ---- Expense helpers ----
export async function getExpenses(coupleId, month) {
  const startDate = `${month}-01`;
  const endDate = new Date(month + '-01');
  endDate.setMonth(endDate.getMonth() + 1);
  const endStr = endDate.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('expenses')
    .select('*, categories(name, icon, color), profiles!paid_by(display_name)')
    .eq('couple_id', coupleId)
    .gte('expense_date', startDate)
    .lt('expense_date', endStr)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addExpense(expense) {
  const { data, error } = await supabase
    .from('expenses').insert(expense)
    .select('*, categories(name, icon, color), profiles!paid_by(display_name)')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteExpense(id) {
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;
}

// ---- Category helpers ----
export async function getCategories(coupleId) {
  const { data, error } = await supabase
    .from('categories').select('*').eq('couple_id', coupleId).order('sort_order');
  if (error) throw error;
  return data || [];
}

// ---- Budget helpers ----
export async function getBudgets(coupleId, month) {
  const { data, error } = await supabase
    .from('budgets').select('*, categories(name, icon, color)')
    .eq('couple_id', coupleId).eq('month', `${month}-01`);
  if (error) throw error;
  return data || [];
}

export async function upsertBudget(budget) {
  const { data, error } = await supabase
    .from('budgets').upsert(budget, { onConflict: 'couple_id,category_id,month' })
    .select().single();
  if (error) throw error;
  return data;
}

// ---- Goal helpers ----
export async function getGoals(coupleId) {
  const { data, error } = await supabase
    .from('goals').select('*').eq('couple_id', coupleId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addGoal(goal) {
  const { data, error } = await supabase.from('goals').insert(goal).select().single();
  if (error) throw error;
  return data;
}

export async function addGoalContribution(goalId, amount) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('goal_contributions')
    .insert({ goal_id: goalId, contributed_by: user.id, amount })
    .select().single();
  if (error) throw error;
  return data;
}

// ---- Analytics helpers ----
export async function getMonthlyTotals(coupleId, month) {
  const { data, error } = await supabase
    .from('monthly_category_totals').select('*')
    .eq('couple_id', coupleId).eq('month', `${month}-01`);
  if (error) throw error;
  return data || [];
}

export async function getPayerTotals(coupleId, month) {
  const { data, error } = await supabase
    .from('monthly_payer_totals').select('*')
    .eq('couple_id', coupleId).eq('month', `${month}-01`);
  if (error) throw error;
  return data || [];
}

export async function getBalance(coupleId) {
  const { data, error } = await supabase
    .from('balance_between_partners').select('*').eq('couple_id', coupleId);
  if (error) throw error;
  return data || [];
}

// ---- Settlement helpers ----
export async function addSettlement(coupleId, amount, note = '') {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('settlements')
    .insert({ couple_id: coupleId, settled_by: user.id, amount, note })
    .select().single();
  if (error) throw error;
  return data;
}

// ---- Realtime ----
export function subscribeToExpenses(coupleId, callback) {
  return supabase.channel(`expenses:${coupleId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'expenses',
      filter: `couple_id=eq.${coupleId}`,
    }, callback).subscribe();
}

export function subscribeToGoals(coupleId, callback) {
  return supabase.channel(`goals:${coupleId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'goals',
      filter: `couple_id=eq.${coupleId}`,
    }, callback).subscribe();
}

// ---- Push notifications ----
export async function registerPush(subscription) {
  const { data: { user } } = await supabase.auth.getUser();
  const keys = subscription.toJSON().keys;
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: user.id,
    endpoint: subscription.endpoint,
    keys_p256dh: keys.p256dh,
    keys_auth: keys.auth,
  }, { onConflict: 'user_id,endpoint' });
  if (error) throw error;
}
