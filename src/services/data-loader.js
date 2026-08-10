import { getCategories, getBudgets, getCoupleMembers, getExpenses, getGoals, getIncome, getIncomeEntries } from '../lib/supabase.js';
import { getState, setState } from '../lib/store.js';
import { currentMonth } from '../lib/utils.js';
import { diagError, diagStep } from './diagnostics.js';

export async function loadExpenses() {
  const { couple } = getState();
  if (!couple) return;
  const month = getState().currentMonth || currentMonth();
  try {
    diagStep(`loadExpenses: ${month}`);
    const expenses = await getExpenses(couple.id, month);
    setState({ expenses, currentMonth: month });
  } catch (err) {
    console.error('loadExpenses error:', err);
    diagError('loadExpenses failed', err);
    setState({ expenses: [], currentMonth: month });
  }
}

export async function loadAll() {
  const { couple } = getState();
  if (!couple) return;
  const month = getState().currentMonth || currentMonth();
  try {
    diagStep(`loadAll: ${month}`);
    const [expenses, categories, budgets, goals, members, monthlyIncome, incomeEntries] = await Promise.all([
      getExpenses(couple.id, month),
      getCategories(couple.id),
      getBudgets(couple.id, month),
      getGoals(couple.id),
      getCoupleMembers(couple.id),
      getIncome(couple.id, month),
      getIncomeEntries(couple.id, month),
    ]);
    setState({ expenses, categories, budgets, goals, members, monthlyIncome, incomeEntries, currentMonth: month });
  } catch (err) {
    console.error('loadAll error:', err);
    diagError('loadAll failed', err);
    setState({
      expenses: [],
      categories: [],
      budgets: [],
      goals: [],
      members: [],
      monthlyIncome: 0,
      incomeEntries: [],
      currentMonth: month,
    });
  }
}
