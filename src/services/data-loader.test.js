import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getState, setState } from '../lib/store.js';
import { loadAll } from './data-loader.js';

vi.mock('./diagnostics.js', () => ({
  diagStep: vi.fn(),
  diagError: vi.fn(),
}));

vi.mock('../lib/supabase.js', () => ({
  getExpenses: vi.fn(),
  getCategories: vi.fn(),
  getBudgets: vi.fn(),
  getGoals: vi.fn(),
  getCoupleMembers: vi.fn(),
  getIncome: vi.fn(),
  getIncomeEntries: vi.fn(),
  getBalance: vi.fn().mockResolvedValue([]),
  getSettlements: vi.fn().mockResolvedValue([]),
}));

import {
  getBudgets,
  getCategories,
  getCoupleMembers,
  getExpenses,
  getGoals,
  getIncome,
  getIncomeEntries,
} from '../lib/supabase.js';

const baseState = () => ({
  user: null,
  profile: null,
  couple: { id: 'couple-1' },
  categories: [],
  expenses: [],
  budgets: [],
  goals: [],
  members: [],
  filterBy: null,
  analyticsFilterBy: null,
  monthlyIncome: 0,
  incomeEntries: [],
  currentMonth: null,
  loading: true,
});

describe('loadAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setState(baseState());
  });

  afterEach(() => {
    setState(baseState());
  });

  it('on failure resets expenses, monthlyIncome, incomeEntries and related state', async () => {
    setState({
      couple: { id: 'couple-1' },
      currentMonth: '2026-04',
      monthlyIncome: 99999,
      incomeEntries: [{ id: '1', amount: 100 }],
      expenses: [{ id: 'x' }],
      categories: [{ id: 'c' }],
      members: [{ id: 'm' }],
    });

    getExpenses.mockRejectedValue(new Error('network'));

    await loadAll();

    const s = getState();
    expect(s.expenses).toEqual([]);
    expect(s.categories).toEqual([]);
    expect(s.budgets).toEqual([]);
    expect(s.goals).toEqual([]);
    expect(s.members).toEqual([]);
    expect(s.monthlyIncome).toBe(0);
    expect(s.incomeEntries).toEqual([]);
    expect(s.currentMonth).toBe('2026-04');
  });

  it('on success fills state from loaders', async () => {
    setState({ couple: { id: 'couple-1' }, currentMonth: '2026-05' });

    getExpenses.mockResolvedValue([{ id: 'e1' }]);
    getCategories.mockResolvedValue([{ id: 'cat1' }]);
    getBudgets.mockResolvedValue([]);
    getGoals.mockResolvedValue([]);
    getCoupleMembers.mockResolvedValue([{ id: 'u1' }]);
    getIncome.mockResolvedValue(5000);
    getIncomeEntries.mockResolvedValue([{ id: 'i1', amount: 5000 }]);

    await loadAll();

    const s = getState();
    expect(s.expenses).toHaveLength(1);
    expect(s.monthlyIncome).toBe(5000);
    expect(s.incomeEntries).toHaveLength(1);
    expect(s.members).toHaveLength(1);
  });
});
