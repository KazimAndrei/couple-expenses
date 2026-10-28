import { describe, it, expect, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' }, registerPlugin: () => ({}) }));
vi.mock('./capture.js', () => ({ Capture: {} }));
import { buildWidgetSnapshot } from './widgets.js';
import { currentMonth } from '../lib/utils.js';

const m = currentMonth();
const A = 'a1', B = 'b2';
const state = {
  couple: { id: 'c', currency: 'THB', solo: false },
  currentMonth: m,
  members: [{ id: A, display_name: 'Andrei' }, { id: B, display_name: 'Mila' }],
  categories: [{ id: 'g', name: 'Продукты', color: '#EF9F27' }, { id: 'h', name: 'Жильё', color: '#7F77DD' }],
  expenses: [
    { id: 1, amount: '1000', category_id: 'g', paid_by: A, split: 'full_payer', expense_date: `${m}-01`, created_at: `${m}-01T10:00` },
    { id: 2, amount: '3000', category_id: 'h', paid_by: A, split: 'equal', expense_date: `${m}-02`, created_at: `${m}-02T10:00`, description: 'Аренда' },
    { id: 3, amount: '500', category_id: 'g', paid_by: B, split: 'full_payer', expense_date: `${m}-02`, created_at: `${m}-02T09:00` },
    { id: 4, amount: '9999', category_id: 'g', paid_by: B, split: 'equal', expense_date: `${m}-02`, goal_contributions: [{ goal_id: 'x' }] },
  ],
  goals: [{ id: 'x', name: 'Отпуск', current_amount: 2500, target_amount: 10000 }],
  monthlyIncome: 4000,
};

describe('снимок для виджетов', () => {
  it('суммы, раскладка, топ, цель, перерасход; накопления не считаются тратами', () => {
    const s = buildWidgetSnapshot(state, new Date(`${m}-02T12:00:00`));
    expect(s.totalValue).toBe(4500);
    expect(s.over).toBe(true);
    expect(s.usedShare).toBe(1);
    expect(s.split.a.share).toBeCloseTo(1000 / 4500);
    expect(s.split.shared.share).toBeCloseTo(3000 / 4500);
    expect(s.split.b.name).toBe('Mila');
    expect(s.topCategories[0].share).toBeCloseTo(3000 / 4500);
    expect(s.goal).toMatchObject({ name: 'Отпуск', share: 0.25 });
    expect(s.last.title).toBe('Аренда');
    expect(s.count).toBe(3);
    expect(s.hero.income).toContain('<b>');
    // доход 4000, траты 4500, в цель 9999 → перерасход
    expect(s.flow).toMatchObject({ negative: true, spentPct: 100, savedPct: 0 });
    expect(s.flow.savedText).toBeTruthy();
    expect(s.hero.meta).toContain('3');
  });
  it('не текущий месяц или нет пары — снимка нет', () => {
    expect(buildWidgetSnapshot({ ...state, currentMonth: '2001-01' })).toBe(null);
    expect(buildWidgetSnapshot({ ...state, couple: null })).toBe(null);
  });
  it('без дохода и целей, соло', () => {
    const s = buildWidgetSnapshot({ ...state, monthlyIncome: 0, goals: [], couple: { ...state.couple, solo: true }, members: [state.members[0]] });
    expect(s.left).toBe(null);
    expect(s.goal).toBe(null);
    expect(s.split).toBe(null);
  });
});
