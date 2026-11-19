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

const parseDay = (text) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

// payments — расходы, привязанные к платежам: [{ recurring_id, expense_date }]
export function billStatus(bill, payments = [], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = Number(bill.day_of_month) || 1;
  const yearly = bill.period === 'year';
  const month = yearly ? (Number(bill.month_of_year) || 1) - 1 : today.getMonth();
  const cycle = (k) => (yearly ? dueIn(today.getFullYear() + k, month, day) : dueIn(today.getFullYear(), month + k, day));
  const current = cycle(0);
  const created = bill.created_at ? new Date(bill.created_at) : null;
  const createdDay = created && !Number.isNaN(created.getTime()) ? new Date(created.getFullYear(), created.getMonth(), created.getDate()) : null;
  // Сроки до создания платежа не считаются: завели 18-го счёт на 5-е — первый срок в следующем месяце
  const started = (d) => (createdDay ? d >= createdDay : d >= current);
  const dues = [-1, 0, 1, 2].map(cycle);
  // Каждая оплата закрывает самый старый незакрытый срок — как долг. Наперёд можно заплатить не раньше,
  // чем за полцикла (30-го за аренду 1-го числа), поэтому вторая оплата в том же месяце следующий срок не гасит.
  // К календарному месяцу оплату не привязываем: заплатили 2-го за счёт 28-го — это прошлый срок.
  const half = (yearly ? 183 : 16) * DAY;
  const covered = new Set();
  const paidDays = payments.filter((p) => p.recurring_id === bill.id).map((p) => parseDay(p.expense_date))
    .filter((d) => d && d.getTime() >= dues[0].getTime() - half)
    .sort((a, b) => a - b);
  for (const paidOn of paidDays) {
    const due = dues.find((d) => started(d) && !covered.has(ymd(d)) && d.getTime() <= paidOn.getTime() + half);
    if (due) covered.add(ymd(due));
  }
  const result = (due, extra) => ({
    due: ymd(due),
    daysLeft: Math.round((due - today) / DAY),
    paid: false,
    paidThisCycle: covered.has(ymd(current)),
    overdue: false,
    ...extra,
  });

  if (bill.auto_add) {
    // Расход создаётся сам 1-го числа, поэтому первый раз — не раньше месяца после создания платежа
    const firstRun = createdDay ? new Date(createdDay.getFullYear(), createdDay.getMonth() + 1, 1) : null;
    const due = [0, 1, 2].map(cycle).find((d) => d >= today && (!firstRun || d >= firstRun)) || cycle(1);
    return result(due);
  }

  const target = dues.find((d) => started(d) && !covered.has(ymd(d))) || cycle(1);
  // Ближайший предстоящий срок уже оплачен — показываем его с отметкой «оплачено»
  const upcoming = [0, 1].map(cycle).find((d) => d >= today);
  if (upcoming && covered.has(ymd(upcoming)) && target > upcoming) return result(upcoming, { paid: true });
  return result(target, { overdue: target < today });
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
  const known = tracked.map((b) => normalize(b.description)).filter(Boolean);
  // «Netflix» уже отслеживается как «Netflix Premium» — тоже считаем заведённым
  const isKnown = (key) => known.some((k) => k === key || k.startsWith(`${key} `) || key.startsWith(`${k} `));
  const groups = new Map();
  for (const x of expenses || []) {
    if (isGoalExpense(x) || x.recurring_id) continue;
    const key = normalize(x.description);
    if (!key || isKnown(key)) continue;
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
    const mid = Math.floor(amounts.length / 2);
    const median = amounts.length % 2 ? amounts[mid] : (amounts[mid - 1] + amounts[mid]) / 2;
    // Подписки дорожают — допускаем четверть от обычной суммы
    if (!(median > 0) || amounts.some((a) => Math.abs(a - median) > median * 0.25)) continue;
    const last = list.reduce((top, x) => (x.expense_date > top.expense_date ? x : top));
    found.push({
      description: last.description,
      // Предлагаем последнюю цену: она и будет списана в следующий раз
      amount: num(last.amount),
      category_id: last.category_id || null,
      categories: last.categories || null,
      paid_by: last.paid_by || null,
      split: last.split === 'full_payer' ? 'full_payer' : 'equal',
      day_of_month: Number(String(last.expense_date).slice(8, 10)) || 1,
      months: months.size,
    });
  }
  return found.sort((a, b) => b.amount - a.amount);
}
