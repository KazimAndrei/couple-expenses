import { getBalance, getCategories, getBudgets, getCoupleMembers, getExpenses, getGoals, getIncome, getIncomeEntries, getSettlements } from '../lib/supabase.js';
import { getState, setState } from '../lib/store.js';
import { currentMonth } from '../lib/utils.js';
import { diagError, diagStep } from './diagnostics.js';

// Оффлайн-кэш: последние загруженные данные месяца сохраняются в localStorage,
// при ошибке сети показываем их вместо пустых экранов.
const CACHE_KEY = 'ce_data_cache_v1';

function readCache(coupleId, month) {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cache?.coupleId === coupleId && cache?.month === month) return cache.data;
  } catch { /* повреждённый кэш игнорируем */ }
  return null;
}

function writeCache(coupleId, month, data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ coupleId, month, savedAt: Date.now(), data }));
  } catch { /* квота localStorage — не критично */ }
}

export async function loadExpenses() {
  const { couple } = getState();
  if (!couple) return;
  const month = getState().currentMonth || currentMonth();
  try {
    diagStep(`loadExpenses: ${month}`);
    const expenses = await getExpenses(couple.id, month);
    setState({ expenses, currentMonth: month });
    const cached = readCache(couple.id, month);
    if (cached) writeCache(couple.id, month, { ...cached, expenses });
  } catch (err) {
    console.error('loadExpenses error:', err);
    diagError('loadExpenses failed', err);
    const cached = readCache(couple.id, month);
    setState({ expenses: cached?.expenses || [], currentMonth: month });
  }
}

export async function loadAll() {
  const { couple } = getState();
  if (!couple) return;
  const month = getState().currentMonth || currentMonth();
  try {
    diagStep(`loadAll: ${month}`);
    const [expenses, categories, budgets, goals, members, monthlyIncome, incomeEntries, balanceRows, settlements] = await Promise.all([
      getExpenses(couple.id, month),
      getCategories(couple.id),
      getBudgets(couple.id, month),
      getGoals(couple.id),
      getCoupleMembers(couple.id),
      getIncome(couple.id, month),
      getIncomeEntries(couple.id, month),
      getBalance(couple.id).catch(() => []),
      getSettlements(couple.id).catch(() => []),
    ]);
    const data = { expenses, categories, budgets, goals, members, monthlyIncome, incomeEntries, balanceRows, settlements };
    setState({ ...data, currentMonth: month });
    writeCache(couple.id, month, data);
  } catch (err) {
    console.error('loadAll error:', err);
    diagError('loadAll failed', err);
    const cached = readCache(couple.id, month);
    setState({
      expenses: cached?.expenses || [],
      categories: cached?.categories || [],
      budgets: cached?.budgets || [],
      goals: cached?.goals || [],
      members: cached?.members || [],
      monthlyIncome: cached?.monthlyIncome || 0,
      incomeEntries: cached?.incomeEntries || [],
      balanceRows: cached?.balanceRows || [],
      settlements: cached?.settlements || [],
      currentMonth: month,
    });
  }
}
