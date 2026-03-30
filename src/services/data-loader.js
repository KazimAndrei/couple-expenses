import { getCategories, getBudgets, getCoupleMembers, getExpenses, getGoals } from '../lib/supabase.js';
import { getState, setState } from '../lib/store.js';
import { currentMonth } from '../lib/utils.js';

export async function loadExpenses() {
  const { couple } = getState();
  if (!couple) return;
  const month = getState().currentMonth || currentMonth();
  const expenses = await getExpenses(couple.id, month);
  setState({ expenses, currentMonth: month });
}

export async function loadAll() {
  const { couple } = getState();
  if (!couple) return;
  const month = getState().currentMonth || currentMonth();
  const [expenses, categories, budgets, goals, members] = await Promise.all([
    getExpenses(couple.id, month),
    getCategories(couple.id),
    getBudgets(couple.id, month),
    getGoals(couple.id),
    getCoupleMembers(couple.id),
  ]);
  setState({ expenses, categories, budgets, goals, members, currentMonth: month });
}
