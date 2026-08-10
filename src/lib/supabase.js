import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY';
const CE_SESSION_KEY = 'ce_auth_session_v1';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function persistSession(session) {
  if (!session?.access_token || !session?.refresh_token) return;
  localStorage.setItem(CE_SESSION_KEY, JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  }));
}

function readPersistedSession() {
  try {
    const raw = localStorage.getItem(CE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.access_token || !parsed?.refresh_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPersistedSession() {
  localStorage.removeItem(CE_SESSION_KEY);
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    clearPersistedSession();
    return;
  }
  if (session) persistSession(session);
});

// ---- Auth helpers ----
export async function signInAnonymously() {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (data?.session) persistSession(data.session);
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  clearPersistedSession();
}

// Канонизируем имя: "Andrei"/"andrey"/"Андрей" → "Андрей", аналогично для Полины.
// Так RPC claim_couple_seat найдёт существующее место даже если ввели в другой раскладке.
function canonicalizeMemberName(name) {
  const n = (name || '').trim().toLowerCase();
  if (!n) return name;
  if (n.includes('андрей') || n.includes('andrei') || n.includes('andrey') || n.includes('andrew')) return 'Андрей';
  if (n.includes('полина') || n.includes('polina') || n.includes('поліна')) return 'Полина';
  return name;
}

// Join couple by invite code. Проверяет capacity ДО создания anonymous user, чтобы не плодить orphan'ов.
export async function authWithInviteCode(code, displayName) {
  const canonicalName = canonicalizeMemberName(displayName);
  let session = await getSession();

  if (session?.user?.id) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('couple_id, couples(invite_code)')
      .eq('id', session.user.id)
      .maybeSingle();
    if (existing?.couples?.invite_code === code) {
      localStorage.setItem('ce_invite_code', code);
      if (displayName) localStorage.setItem('ce_display_name', displayName);
      return existing.couples;
    }
  }

  // Pre-flight capacity check: предотвращает создание orphan auth user, если пара уже полная.
  // Если имя совпадает с существующим участником — пропускаем (claim_couple_seat возьмёт это место).
  const { data: capacity, error: capErr } = await supabase.rpc('check_invite_capacity', {
    p_invite_code: code,
  });
  if (capErr) throw new Error('Не удалось проверить код: ' + capErr.message);
  if (!capacity?.found) throw new Error('Код не найден');
  if (capacity.full) {
    const wanted = (canonicalName || '').trim().toLowerCase();
    const memberNames = capacity.member_names || [];
    const nameMatches = memberNames.some((m) => m === wanted);
    if (!nameMatches) {
      throw new Error('В этой паре уже два участника с другими именами. Введите имя одного из них (например, ' + memberNames.join(' или ') + '), чтобы войти.');
    }
    // Имя совпадает — продолжаем, claim_couple_seat заберёт место.
  }

  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw new Error('Ошибка авторизации: ' + error.message);
    if (!data?.session) throw new Error('Не удалось создать сессию. Проверь что Anonymous Sign-In включён в Supabase.');
    session = data.session;
  }

  // Используем claim_couple_seat: если в паре уже есть участник с таким именем,
  // забираем его место (имя+ключ работают как login/password при восстановлении доступа).
  const { data: couple, error: rpcError } = await supabase.rpc('claim_couple_seat', {
    p_invite_code: code,
    p_display_name: canonicalName || 'Пользователь',
  });
  if (rpcError) {
    if (rpcError.message?.includes('couple is full')) {
      throw new Error('В этой паре уже два участника с другими именами. Введите имя одного из них, чтобы войти.');
    }
    if (rpcError.message?.includes('invite code not found')) {
      throw new Error('Код не найден');
    }
    if (rpcError.message?.includes('name required')) {
      throw new Error('Введите имя');
    }
    throw new Error('Не удалось присоединиться: ' + rpcError.message);
  }
  if (!couple) throw new Error('Код не найден');

  localStorage.setItem('ce_invite_code', code);
  localStorage.setItem('ce_display_name', displayName || 'Пользователь');

  return couple;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    persistSession(session);
    return session;
  }

  const fallbackSession = readPersistedSession();
  if (!fallbackSession) return null;

  try {
    const { data, error } = await supabase.auth.setSession(fallbackSession);
    if (error) {
      clearPersistedSession();
      return null;
    }
    if (data?.session) {
      persistSession(data.session);
      return data.session;
    }
    clearPersistedSession();
    return null;
  } catch {
    clearPersistedSession();
    return null;
  }
}

export async function ensureAuthenticated() {
  const session = await getSession();
  if (session) {
    const profile = await getProfile();
    if (profile?.couple_id) return { session, profile };
  }

  const savedCode = localStorage.getItem('ce_invite_code');
  const savedName = localStorage.getItem('ce_display_name');
  if (!savedCode) return null;

  try {
    const couple = await authWithInviteCode(savedCode, savedName || 'User');
    const newSession = await getSession();
    if (!newSession) return null;
    const profile = await getProfile();
    if (profile?.couple_id) {
      return { session: newSession, profile, couple: profile.couples || couple };
    }
    return null;
  } catch {
    return null;
  }
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
    .select('id, display_name, avatar_url, created_at')
    .eq('couple_id', coupleId)
    .order('created_at', { ascending: true });
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

export async function updateExpense(id, patch) {
  const { data, error } = await supabase
    .from('expenses')
    .update(patch)
    .eq('id', id)
    .select('*, categories(name, icon, color), profiles!paid_by(display_name)')
    .single();
  if (error) throw error;
  return data;
}

// ---- Category helpers ----
export async function getCategories(coupleId) {
  const { data, error } = await supabase
    .from('categories').select('*').eq('couple_id', coupleId).order('sort_order');
  if (error) throw error;
  return data || [];
}

export async function addCategory(category) {
  const { data, error } = await supabase.from('categories').insert(category).select().single();
  if (error) throw error;
  return data;
}

// ---- Recurring expense helpers ----
export async function getRecurringExpenses(coupleId) {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .select('*')
    .eq('couple_id', coupleId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createRecurringExpense(template) {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .insert(template)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRecurringExpense(id) {
  const { error } = await supabase.from('recurring_expenses').delete().eq('id', id);
  if (error) throw error;
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

export async function updateGoal(id, patch) {
  const { data, error } = await supabase.from('goals').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteGoal(id) {
  const { error } = await supabase.from('goals').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteBudget(id) {
  const { error } = await supabase.from('budgets').delete().eq('id', id);
  if (error) throw error;
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

// ---- Income helpers ----
// Используем RPC вместо прямого SELECT — обходит любые edge-cases с RLS на couple_income_entries.
export async function getIncome(coupleId, month) {
  if (!coupleId) return 0;
  const { data, error } = await supabase.rpc('get_my_income', { p_month: month });
  if (typeof window !== 'undefined') {
    window.__lastGetIncome = { coupleId, month, data, error: error?.message || null };
  }
  if (error) {
    console.error('getIncome error:', error);
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast('Не удалось загрузить доход: ' + (error.message || 'unknown'));
    }
    return 0;
  }
  return parseFloat(data || 0);
}

/** @returns {Promise<Array<{ id: string, amount: string | number, created_at: string, created_by: string | null }>>} */
export async function getIncomeEntries(coupleId, month) {
  const monthKey = `${month}-01`;
  const { data, error } = await supabase
    .from('couple_income_entries')
    .select('id, amount, created_at, created_by')
    .eq('couple_id', coupleId)
    .eq('month', monthKey)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getIncomeEntries error:', error);
    return [];
  }
  return data || [];
}

export async function addIncomeEntry(coupleId, month, amount) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('not authenticated');
  const { error } = await supabase.from('couple_income_entries').insert({
    couple_id: coupleId,
    month: `${month}-01`,
    amount,
    created_by: user.id,
  });
  if (error) throw error;
}

export async function deleteIncomeEntry(id) {
  const { error } = await supabase.from('couple_income_entries').delete().eq('id', id);
  if (error) throw error;
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
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(async () => {
      t = null;
      try {
        await fn(...args);
      } catch (err) {
        console.error('realtime callback error:', err);
      }
    }, ms);
  };
}

export function subscribeToExpenses(coupleId, callback) {
  const debounced = debounce(callback, 500);
  return supabase.channel(`expenses:${coupleId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'expenses',
      filter: `couple_id=eq.${coupleId}`,
    }, debounced).subscribe();
}

export function subscribeToGoals(coupleId, callback) {
  const debounced = debounce(callback, 500);
  return supabase.channel(`goals:${coupleId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'goals',
      filter: `couple_id=eq.${coupleId}`,
    }, debounced).subscribe();
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
