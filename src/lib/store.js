const state = {
  user: null,
  profile: null,
  couple: null,
  categories: [],
  expenses: [],
  budgets: [],
  goals: [],
  currentMonth: null,
  loading: true,
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(partial) {
  Object.assign(state, partial);
  listeners.forEach(fn => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
