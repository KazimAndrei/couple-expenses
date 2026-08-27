import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { t } from './i18n.js';
import { reencodeImage } from './image.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY';
export const APPLE_APP_BUNDLE_ID = 'com.kazimandrei.coupleexpenses';
export const WEB_APP_ORIGIN = 'https://couple-expenses.pages.dev';

// В нативе location.origin — это capacitor://localhost, такую ссылку не отправишь.
export function inviteLink(code) {
  const origin = window.location.origin?.startsWith('http') ? window.location.origin : WEB_APP_ORIGIN;
  return `${origin}/#/invite?code=${code}`;
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Auth helpers ----
// supabase.auth.getUser() в Capacitor WebView иногда не возвращает управление
// (внутренний лок supabase-js + отсутствие navigator.locks), из-за чего экраны зависали.
// Берём пользователя из локальной сессии — она уже восстановлена при старте.
export async function currentUser() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return session.user;
  const { data } = await Promise.race([
    supabase.auth.getUser(),
    new Promise((resolve) => setTimeout(() => resolve({ data: {} }), 5000)),
  ]);
  return data?.user || null;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Native (iOS): ASAuthorization → identity token → signInWithIdToken.
// Web: обычный OAuth-редирект — страница уходит на Apple и возвращается с сессией.
export async function signInWithApple() {
  if (Capacitor.getPlatform() === 'ios') {
    const { SignInWithApple } = await import('@capacitor-community/apple-sign-in');
    const rawNonce = crypto.randomUUID();
    const { response } = await SignInWithApple.authorize({
      clientId: APPLE_APP_BUNDLE_ID,
      scopes: 'name email',
      nonce: await sha256Hex(rawNonce),
    });
    if (!response?.identityToken) throw new Error('Apple не вернул identity token');

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: response.identityToken,
      nonce: rawNonce,
    });
    if (error) throw error;

    // Apple отдаёт имя только при самом первом входе — сохраняем его сразу.
    // Вход уже состоялся: любая ошибка здесь не должна ронять авторизацию.
    try {
      const appleName = [response.givenName, response.familyName].filter(Boolean).join(' ').trim();
      if (appleName && data?.user) {
        const { data: profile } = await supabase
          .from('profiles').select('display_name').eq('id', data.user.id).maybeSingle();
        if (!profile?.display_name || ['', 'User', 'Пользователь'].includes(profile.display_name)) {
          await supabase.from('profiles').update({ display_name: appleName }).eq('id', data.user.id);
        }
      }
    } catch (nameErr) {
      console.error('apple name save failed:', nameErr);
    }
    return data;
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
  return null; // страница уходит в редирект
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function ensureAuthenticated() {
  const session = await getSession();
  if (!session) return null;
  const profile = await getProfile();
  return { session, profile };
}

export async function getProfile() {
  const user = await currentUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*, couples!profiles_couple_id_fkey(*)')
    .eq('id', user.id)
    .maybeSingle();
  if (error) {
    console.error('getProfile error:', error);
    return null;
  }
  if (data?.avatar_url) data.avatar_url = await avatarUrl(data.avatar_url);
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
  return Promise.all((data || []).map(async (m) => (
    m.avatar_url ? { ...m, avatar_url: await avatarUrl(m.avatar_url) } : m
  )));
}

// ---- Couple helpers ----
export async function createCouple(name = 'Our Budget', currency) {
  // Атомарный RPC: couple + couple_id в профиле + сид категорий одной транзакцией.
  // Прямой INSERT..RETURNING не работает: SELECT-политика couples видит пару только после привязки профиля.
  // Валюта: выбранная на экране логина до создания пары (ce_pending_currency) или THB.
  const { data: couple, error } = await supabase.rpc('create_couple', {
    p_name: name,
    p_currency: currency || localStorage.getItem('ce_pending_currency') || 'USD',
  });
  if (error) throw error;
  localStorage.removeItem('ce_pending_currency');
  return couple;
}

export async function joinCouple(inviteCode, displayName) {
  const { data: couple, error } = await supabase.rpc('join_couple_by_invite', {
    p_invite_code: inviteCode.trim(),
    p_display_name: displayName || t('common.member'),
  });
  if (error) {
    if (error.message?.includes('couple is full')) throw new Error(t('setup.coupleFull'));
    if (error.message?.includes('invite code not found')) throw new Error(t('setup.codeNotFound'));
    throw new Error(t('setup.joinFailed', { msg: error.message }));
  }
  if (!couple) throw new Error(t('setup.codeNotFound'));
  return couple;
}

export async function updateDisplayName(name) {
  const user = await currentUser();
  if (!user) throw new Error('not authenticated');
  const { error } = await supabase.from('profiles').update({ display_name: name }).eq('id', user.id);
  if (error) throw error;
}

// ---- Expense helpers ----
export async function getExpenses(coupleId, month) {
  const startDate = `${month}-01`;
  // Границу месяца считаем строками: Date парсит '2026-03-01' как UTC, а getMonth/setMonth
  // работают в локальном времени — в западных зонах месяц уезжал на день-два.
  const [y, m] = month.split('-').map(Number);
  const endStr = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const { data, error } = await supabase
    .from('expenses')
    .select('*, categories(name, icon, color), profiles!paid_by(display_name), goal_contributions(goal_id, goals(name))')
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

// Расход «в цель»: атомарно создаёт expense + goal_contribution (RPC).
// Удаление расхода каскадно снимает contribution и пересчитывает цель.
export async function addExpenseToGoal({ goal_id, amount, paid_by, split = 'equal', expense_date, description }) {
  const { data, error } = await supabase.rpc('add_expense_to_goal', {
    p_goal_id: goal_id,
    p_amount: amount,
    p_paid_by: paid_by,
    p_split: split,
    p_expense_date: expense_date,
    p_description: description || null,
  });
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

export async function updateCategory(id, patch) {
  const { data, error } = await supabase.from('categories').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// Расходы переживают удаление категории: FK стоит ON DELETE SET NULL, они просто
// остаются без категории. А вот бюджет по ней уходит каскадом — об этом предупреждаем.
export async function deleteCategory(id) {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
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
  const user = await currentUser();
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
      window.showToast(t('home.incomeLoadFailed', { msg: error.message || 'unknown' }));
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
  const user = await currentUser();
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

// ---- Export ----
// Экспорт постранично: PostgREST режет выдачу на 1000 строк, и у пары с историей
// за год файл молча получался неполным
export async function fetchAllExpensesForExport(coupleId) {
  const PAGE = 1000;
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('expenses')
      .select('expense_date, description, amount, currency, split, paid_by_snapshot_name, categories(name), goal_contributions(goals(name))')
      .eq('couple_id', coupleId)
      .order('expense_date', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

// ---- Account deletion (App Store 5.1.1v) ----
// Удаление аккаунта идёт через Edge Function: чеки и аватар лежат в Storage, а его
// объекты нельзя снести из SQL — DELETE по storage.objects убирает только метаданные
// и оставляет файл висеть в бакете. Функция чистит файлы service-ключом и уже потом
// вызывает delete_my_account().
export async function deleteMyAccount() {
  const { data, error } = await supabase.functions.invoke('delete-account');
  if (error) throw error;
  if (data && data.ok === false) throw new Error(data.error || 'delete failed');
  await supabase.auth.signOut().catch(() => { /* сессия уже мертва после удаления */ });
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

// ---- Receipts ----
export async function uploadReceipt(file, coupleId) {
  // Перекодируем перед отправкой: снимок с камеры несёт EXIF с GPS, и в исходном
  // виде чек уносил бы на сервер координаты места покупки
  const blob = await reencodeImage(file);
  const path = `${coupleId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('receipts').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  // Храним путь, а не публичную ссылку: бакет приватный, чек виден только своей паре
  return path;
}

// Чек открывается по временной подписанной ссылке (час) — публичных ссылок на чеки нет
export async function receiptUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith('http')) return pathOrUrl; // старые записи с публичной ссылкой
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(pathOrUrl, 3600);
  if (error) { console.error('receipt url failed:', error); return null; }
  return data?.signedUrl || null;
}

// Аватар лежит в приватном бакете по пути <user_id>/avatar.jpg: публичной ссылки у него
// нет, поэтому в profiles.avatar_url хранится путь, а наружу отдаём подписанную ссылку.
export async function avatarUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith('http') || pathOrUrl.startsWith('data:')) return pathOrUrl; // записи прежнего формата
  const { data, error } = await supabase.storage.from('avatars').createSignedUrl(pathOrUrl, 3600);
  if (error) { console.error('avatar url failed:', error); return null; }
  return data?.signedUrl || null;
}

export async function uploadAvatar(blob, userId) {
  const path = `${userId}/avatar.jpg`;
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
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
  const user = await currentUser();
  const keys = subscription.toJSON().keys;
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: user.id,
    endpoint: subscription.endpoint,
    keys_p256dh: keys.p256dh,
    keys_auth: keys.auth,
  }, { onConflict: 'user_id,endpoint' });
  if (error) throw error;
}
