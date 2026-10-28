const state = {
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
  monthlyIncome: 0,
  incomeEntries: [],
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

/** «Я сам по себе»: пара из одного человека. Как только партнёр присоединился — обычный режим. */
export function isSolo(s = state) {
  return !!s.couple?.solo && (s.members || []).length < 2;
}
