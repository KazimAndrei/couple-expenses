import { afterEach, describe, expect, it } from 'vitest';
import { getState, setState, subscribe } from './store.js';

const initial = {
  user: null,
  profile: null,
  couple: null,
  categories: [],
  expenses: [],
  budgets: [],
  goals: [],
  members: [],
  filterBy: null,
  analyticsFilterBy: null,
  currentMonth: null,
  loading: true,
};

afterEach(() => {
  setState({ ...initial });
});

describe('store', () => {
  it('merges state updates', () => {
    setState({ loading: false, currentMonth: '2026-03' });
    const state = getState();
    expect(state.loading).toBe(false);
    expect(state.currentMonth).toBe('2026-03');
  });

  it('notifies and unsubscribes listeners', () => {
    let calls = 0;
    const unsubscribe = subscribe(() => {
      calls += 1;
    });

    setState({ loading: false });
    unsubscribe();
    setState({ loading: true });

    expect(calls).toBe(1);
  });
});
