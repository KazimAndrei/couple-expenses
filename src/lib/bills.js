// Счета и подписки (таблица recurring_expenses): когда следующий платёж, оплачен ли он, сколько это в год.
import { isGoalExpense } from './money-flow.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : 0; };
const DAY = 86400000;

// День платежа в месяце: «31-е» в феврале — последний день месяца
const dueIn = (year, month, day) => new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()));

export const monthlyCost = (bill) => (bill.period === 'year' ? num(bill.amount) / 12 : num(bill.amount));
export const yearlyCost = (bill) => (bill.period === 'year' ? num(bill.amount) : num(bill.amount) * 12);

// Начало текущего цикла: месяц для ежемесячного, год для годового — расход с этой даты значит «оплачено»
const cycleStart = (bill, now) => (bill.period === 'year' ? `${now.getFullYear()}-01-01` : `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`);

// payments — расходы, привязанные к платежам: [{ recurring_id, expense_date }]
export function billStatus(bill, payments = [], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = Number(bill.day_of_month) || 1;
  const yearly = bill.period === 'year';
  const month = yearly ? (Number(bill.month_of_year) || 1) - 1 : today.getMonth();
  const paid = payments.some((p) => p.recurring_id === bill.id && p.expense_date >= cycleStart(bill, today));
  let due = dueIn(today.getFullYear(), month, day);
  // Платёж завели уже после его дня в этом цикле — первый раз он наступит в следующем, просрочки нет
  const created = bill.created_at ? new Date(bill.created_at) : null;
  const createdDay = created && !Number.isNaN(created.getTime()) ? new Date(created.getFullYear(), created.getMonth(), created.getDate()) : null;
  const notYetStarted = createdDay !== null && due < createdDay;
  // Оплаченный или списываемый сам платёж, чей день прошёл, — уже про следующий цикл
  if (due < today && (paid || bill.auto_add || notYetStarted)) {
    due = yearly ? dueIn(today.getFullYear() + 1, month, day) : dueIn(today.getFullYear(), month + 1, day);
  }
  const daysLeft = Math.round((due - today) / DAY);
  return {
    due: ymd(due),
    daysLeft,
    paid: paid && daysLeft >= 0 && ymd(dueIn(today.getFullYear(), month, day)) === ymd(due),
    paidThisCycle: paid,
    overdue: !paid && !bill.auto_add && daysLeft < 0,
  };
}

// Активные платежи по дате: просроченные и ближайшие сверху
export function upcomingBills(bills, payments, now = new Date()) {
  return (bills || []).filter((b) => b.active !== false)
    .map((bill) => ({ bill, status: billStatus(bill, payments, now) }))
    .sort((a, b) => a.status.due.localeCompare(b.status.due) || String(a.bill.description).localeCompare(String(b.bill.description)));
}

export function billTotals(bills) {
  const active = (bills || []).filter((b) => b.active !== false);
  const sum = (list, fn) => list.reduce((s, b) => s + fn(b), 0);
  const subs = active.filter((b) => b.kind === 'subscription');
  return {
    monthly: sum(active, monthlyCost),
    yearly: sum(active, yearlyCost),
    subscriptionsMonthly: sum(subs, monthlyCost),
    subscriptionsYearly: sum(subs, yearlyCost),
    count: active.length,
    subscriptions: subs.length,
  };
}

const normalize = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Похоже на подписку: одно и то же название в трёх и более разных месяцах с близкой суммой.
// tracked — уже заведённые платежи, их не предлагаем повторно.
export function detectRecurring(expenses, tracked = []) {
  const known = new Set(tracked.map((b) => normalize(b.description)));
  const groups = new Map();
  for (const x of expenses || []) {
    if (isGoalExpense(x) || x.recurring_id) continue;
    const key = normalize(x.description);
    if (!key || known.has(key)) continue;
    const list = groups.get(key) || [];
    list.push(x);
    groups.set(key, list);
  }
  const found = [];
  for (const list of groups.values()) {
    const months = new Set(list.map((x) => String(x.expense_date).slice(0, 7)));
    if (months.size < 3) continue;
    // Ровно одна трата в месяц: продукты, которые покупают чаще, — не подписка
    if (list.length !== months.size) continue;
    const amounts = list.map((x) => num(x.amount)).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    if (!(median > 0) || amounts.some((a) => Math.abs(a - median) > median * 0.1)) continue;
    const last = list.reduce((top, x) => (x.expense_date > top.expense_date ? x : top));
    found.push({
      description: last.description,
      amount: median,
      category_id: last.category_id || null,
      categories: last.categories || null,
      paid_by: last.paid_by || null,
      split: last.split || 'equal',
      day_of_month: Number(String(last.expense_date).slice(8, 10)) || 1,
      months: months.size,
    });
  }
  return found.sort((a, b) => b.amount - a.amount);
}
