import { describe, it, expect } from 'vitest';

function applyAdvancedFilters(expenses, filters) {
  const query = (filters.searchQuery || '').trim().toLowerCase();
  const categoryId = filters.categoryFilter || null;
  const minAmount = filters.amountMin ? parseFloat(filters.amountMin) : null;
  const maxAmount = filters.amountMax ? parseFloat(filters.amountMax) : null;
  const dateFrom = filters.dateFrom || null;
  const dateTo = filters.dateTo || null;
  return expenses.filter((expense) => {
    if (query && !`${expense.description || ''}`.toLowerCase().includes(query)) return false;
    if (categoryId && expense.category_id !== categoryId) return false;
    const amount = parseFloat(expense.amount);
    if (Number.isFinite(minAmount) && amount < minAmount) return false;
    if (Number.isFinite(maxAmount) && amount > maxAmount) return false;
    if (dateFrom && expense.expense_date < dateFrom) return false;
    if (dateTo && expense.expense_date > dateTo) return false;
    return true;
  });
}

const expenses = [
  { description: 'Молоко', category_id: 'c1', amount: '150', expense_date: '2026-03-01' },
  { description: 'Такси', category_id: 'c2', amount: '500', expense_date: '2026-03-15' },
  { description: 'Ресторан', category_id: 'c3', amount: '2000', expense_date: '2026-03-20' },
];

describe('applyAdvancedFilters', () => {
  it('returns all with empty filters', () => {
    expect(applyAdvancedFilters(expenses, {})).toHaveLength(3);
  });

  it('filters by search query', () => {
    expect(applyAdvancedFilters(expenses, { searchQuery: 'молоко' })).toHaveLength(1);
    expect(applyAdvancedFilters(expenses, { searchQuery: 'xyz' })).toHaveLength(0);
  });

  it('filters by category', () => {
    expect(applyAdvancedFilters(expenses, { categoryFilter: 'c2' })).toHaveLength(1);
  });

  it('filters by amount range', () => {
    expect(applyAdvancedFilters(expenses, { amountMin: '200' })).toHaveLength(2);
    expect(applyAdvancedFilters(expenses, { amountMax: '500' })).toHaveLength(2);
    expect(applyAdvancedFilters(expenses, { amountMin: '200', amountMax: '1000' })).toHaveLength(1);
  });

  it('filters by date range', () => {
    expect(applyAdvancedFilters(expenses, { dateFrom: '2026-03-10' })).toHaveLength(2);
    expect(applyAdvancedFilters(expenses, { dateTo: '2026-03-10' })).toHaveLength(1);
  });

  it('combines multiple filters', () => {
    expect(applyAdvancedFilters(expenses, { searchQuery: 'так', amountMin: '100' })).toHaveLength(1);
  });
});
