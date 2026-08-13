// Фикстура для съёмки скриншотов App Store: подменяет lib/supabase.js через alias
// в vite.config.js и подключается ТОЛЬКО при сборке с SHOT=1 (npm run build:shot).
// В обычный и релизный бандл не попадает — проверяется скриптом scripts/check-no-shot.mjs.
export const APPLE_APP_BUNDLE_ID = 'com.kazimandrei.coupleexpenses';
export const WEB_APP_ORIGIN = 'https://couple-expenses.pages.dev';
export function inviteLink(code) { return `${WEB_APP_ORIGIN}/#/invite/${code}`; }

const MONTH = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();
const day = (n) => `${MONTH}-${String(n).padStart(2, '0')}`;

const ALEX = '11111111-1111-4111-8111-111111111111';
const SAM = '22222222-2222-4222-8222-222222222222';
const COUPLE = '33333333-3333-4333-8333-333333333333';

const CATS = [
  { id: 'c1', name: 'Groceries', icon: 'shopping-cart', color: '#EF9F27', couple_id: COUPLE, sort_order: 1 },
  { id: 'c2', name: 'Restaurants', icon: 'utensils', color: '#E24B4A', couple_id: COUPLE, sort_order: 2 },
  { id: 'c3', name: 'Housing', icon: 'home', color: '#7F77DD', couple_id: COUPLE, sort_order: 3 },
  { id: 'c4', name: 'Transport', icon: 'car', color: '#378ADD', couple_id: COUPLE, sort_order: 4 },
  { id: 'c5', name: 'Health', icon: 'heart', color: '#D4537E', couple_id: COUPLE, sort_order: 5 },
  { id: 'c6', name: 'Entertainment', icon: 'gamepad', color: '#1D9E75', couple_id: COUPLE, sort_order: 6 },
  { id: 'c7', name: 'Clothing', icon: 'shirt', color: '#D85A30', couple_id: COUPLE, sort_order: 7 },
  { id: 'c8', name: 'Subscriptions', icon: 'credit-card', color: '#534AB7', couple_id: COUPLE, sort_order: 8 },
];
const catById = (id) => CATS.find((c) => c.id === id);

const RAW = [
  [24, 'c2', 'Dinner at Nobu', 128.4, SAM],
  [23, 'c1', 'Whole Foods', 96.15, ALEX],
  [22, 'c4', 'Gas', 52.0, ALEX],
  [21, 'c6', 'Movie night', 34.0, SAM],
  [20, 'c1', 'Farmers market', 41.8, SAM],
  [18, 'c8', 'Netflix + Spotify', 27.98, ALEX],
  [16, 'c5', 'Pharmacy', 23.4, SAM],
  [15, 'c3', 'Rent', 1850.0, ALEX],
  [14, 'c7', 'Sneakers', 119.0, SAM],
  [12, 'c2', 'Brunch', 63.25, ALEX],
  [10, 'c1', 'Trader Joe\'s', 87.6, ALEX],
  [8, 'c4', 'Uber', 18.75, SAM],
  [6, 'c6', 'Concert tickets', 145.0, ALEX],
  [4, 'c1', 'Costco run', 162.3, SAM],
  [2, 'c3', 'Electricity', 94.2, ALEX],
];

const EXPENSES = RAW.map(([d, cat, description, amount, paid_by], i) => ({
  id: `e${i}`,
  couple_id: COUPLE,
  category_id: cat,
  description,
  amount,
  currency: 'USD',
  paid_by,
  // 'equal' — совместная трата («Shared» в строке), 'full_payer' — конкретный плательщик
  split: i % 5 === 0 ? 'equal' : 'full_payer',
  expense_date: day(d),
  created_at: `${day(d)}T12:00:00Z`,
  receipt_url: null,
  categories: { name: catById(cat).name, icon: catById(cat).icon, color: catById(cat).color },
  profiles: { display_name: paid_by === ALEX ? 'Alex' : 'Sam' },
  goal_contributions: [],
}));

const MEMBERS = [
  { id: ALEX, display_name: 'Alex', avatar_url: null, created_at: '2026-01-02T10:00:00Z' },
  { id: SAM, display_name: 'Sam', avatar_url: null, created_at: '2026-01-02T10:05:00Z' },
];

const COUPLE_ROW = { id: COUPLE, name: 'Alex & Sam', currency: 'USD', owner_id: ALEX, invite_code: 'LOVE24' };
const PROFILE = { id: ALEX, display_name: 'Alex', couple_id: COUPLE, avatar_url: null, couples: COUPLE_ROW };
const USER = { id: ALEX, email: 'alex@example.com' };
const SESSION = { user: USER, access_token: 'shot', refresh_token: 'shot' };

const GOALS = [
  { id: 'g1', couple_id: COUPLE, name: 'Trip to Japan', icon: 'plane', target_amount: 6000, current_amount: 3850, deadline: '2027-04-01' },
  { id: 'g2', couple_id: COUPLE, name: 'New sofa', icon: 'home', target_amount: 1800, current_amount: 720, deadline: null },
  { id: 'g3', couple_id: COUPLE, name: 'Emergency fund', icon: 'umbrella', target_amount: 10000, current_amount: 6400, deadline: null },
];

const BUDGETS = [
  { id: 'b1', couple_id: COUPLE, category_id: 'c1', month: MONTH, limit_amount: 500, categories: catById('c1') },
  { id: 'b2', couple_id: COUPLE, category_id: 'c2', month: MONTH, limit_amount: 250, categories: catById('c2') },
  { id: 'b3', couple_id: COUPLE, category_id: 'c6', month: MONTH, limit_amount: 200, categories: catById('c6') },
];

const noop = async () => {};
const nullSub = { unsubscribe() {} };

export const supabase = {
  auth: {
    onAuthStateChange: () => ({ data: { subscription: nullSub } }),
    getUser: async () => ({ data: { user: USER }, error: null }),
    getSession: async () => ({ data: { session: SESSION }, error: null }),
    signOut: noop,
  },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: noop,
};

export async function currentUser() { return USER; }
export async function signInWithApple() { return { session: SESSION, profile: PROFILE }; }
export async function signOut() {}
export async function getSession() { return SESSION; }
export async function ensureAuthenticated() { return { session: SESSION, profile: PROFILE }; }
export async function getProfile() { return PROFILE; }
export async function getCoupleMembers() { return MEMBERS; }
export async function createCouple() { return COUPLE_ROW; }
export async function joinCouple() { return COUPLE_ROW; }
export async function updateDisplayName() {}
export async function getExpenses() { return EXPENSES; }
export async function addExpense(expense) {
  const cat = catById(expense.category_id) || CATS[0];
  return {
    ...expense, id: `new-${EXPENSES.length}`, currency: 'USD',
    categories: { name: cat.name, icon: cat.icon, color: cat.color },
    profiles: { display_name: expense.paid_by === ALEX ? 'Alex' : 'Sam' },
    goal_contributions: [],
  };
}
export async function addExpenseToGoal() { return null; }
export async function deleteExpense() {}
export async function updateExpense(id, patch) { return { ...EXPENSES[0], ...patch }; }
export async function getCategories() { return CATS; }
export async function addCategory(category) { return { ...category, id: `c${CATS.length + 1}` }; }
export async function getRecurringExpenses() { return []; }
export async function createRecurringExpense(tpl) { return { ...tpl, id: 'r1' }; }
export async function deleteRecurringExpense() {}
export async function getBudgets() { return BUDGETS; }
export async function upsertBudget(b) { return { ...b, id: 'b9' }; }
export async function getGoals() { return GOALS; }
export async function addGoal(g) { return { ...g, id: 'g9', current_amount: 0 }; }
export async function updateGoal(id, patch) { return { ...GOALS[0], ...patch }; }
export async function deleteGoal() {}
export async function deleteBudget() {}
export async function addGoalContribution() { return GOALS[0]; }
export async function getIncome() { return 7200; }
export async function getIncomeEntries() {
  return [
    { id: 'i1', couple_id: COUPLE, month: MONTH, amount: 4200, created_by: ALEX, created_at: `${day(1)}T09:00:00Z` },
    { id: 'i2', couple_id: COUPLE, month: MONTH, amount: 3000, created_by: SAM, created_at: `${day(1)}T09:05:00Z` },
  ];
}
export async function addIncomeEntry() { return { id: 'i9', amount: 0 }; }
export async function deleteIncomeEntry() {}
export async function fetchAllExpensesForExport() { return EXPENSES; }
export async function deleteMyAccount() {}
export async function getMonthlyTotals() { return EXPENSES.reduce((s, e) => s + e.amount, 0); }
export async function getPayerTotals() {
  const by = (id) => EXPENSES.filter((e) => e.paid_by === id).reduce((s, e) => s + e.amount, 0);
  return { [ALEX]: by(ALEX), [SAM]: by(SAM) };
}
export async function uploadReceipt() { return null; }
export async function receiptUrl() { return null; }
export function subscribeToExpenses() { return nullSub; }
export function subscribeToGoals() { return nullSub; }
export async function registerPush() {}
