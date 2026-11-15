// Итог недели: цифры для карточки-истории. Неделя — с понедельника по воскресенье, берём последнюю завершённую.
import { isGoalExpense } from './money-flow.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const num = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : 0; };

// { from, to } — прошлая неделя, { prevFrom, prevTo } — позапрошлая (для сравнения); даты строками YYYY-MM-DD
export function lastWeekRange(now = new Date()) {
  const mondayOffset = (now.getDay() + 6) % 7; // пн = 0 … вс = 6
  const thisMonday = addDays(now, -mondayOffset);
  const from = addDays(thisMonday, -7);
  return {
    from: ymd(from),
    to: ymd(addDays(from, 6)),
    prevFrom: ymd(addDays(from, -7)),
    prevTo: ymd(addDays(from, -1)),
  };
}

// Показываем напоминание в первые дни новой недели и один раз на неделю
export function shouldOfferRecap(now, seenWeek) {
  const day = (now.getDay() + 6) % 7;
  return day <= 2 && seenWeek !== lastWeekRange(now).from;
}

const inRange = (x, from, to) => x.expense_date >= from && x.expense_date <= to;

// sideOf(expense) → 'a' | 'b' | 'shared'
export function buildRecap(expenses, range, sideOf = () => 'a') {
  const week = (expenses || []).filter((x) => inRange(x, range.from, range.to));
  const prev = (expenses || []).filter((x) => inRange(x, range.prevFrom, range.prevTo));
  const spends = week.filter((x) => !isGoalExpense(x));
  const total = spends.reduce((s, x) => s + num(x.amount), 0);
  const prevTotal = prev.filter((x) => !isGoalExpense(x)).reduce((s, x) => s + num(x.amount), 0);
  const saved = week.filter(isGoalExpense).reduce((s, x) => s + num(x.amount), 0);

  const byCat = new Map();
  for (const x of spends) {
    const key = x.category_id || 'other';
    const row = byCat.get(key) || { id: key, name: x.categories?.name || null, icon: x.categories?.icon || 'more-horizontal', color: x.categories?.color || '#888780', amount: 0 };
    row.amount += num(x.amount);
    byCat.set(key, row);
  }
  const categories = [...byCat.values()].sort((a, b) => b.amount - a.amount)
    .map((c) => ({ ...c, share: total > 0 ? c.amount / total : 0 }));

  const split = { a: 0, b: 0, shared: 0 };
  for (const x of spends) split[sideOf(x)] += num(x.amount);

  const byDay = new Map();
  for (const x of spends) byDay.set(x.expense_date, (byDay.get(x.expense_date) || 0) + num(x.amount));
  const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const biggest = spends.reduce((top, x) => (!top || num(x.amount) > num(top.amount) ? x : top), null);

  return {
    from: range.from,
    to: range.to,
    empty: week.length === 0,
    total,
    prevTotal,
    // null — сравнивать не с чем (позапрошлая неделя пустая)
    deltaPct: prevTotal > 0 ? Math.round((total / prevTotal - 1) * 100) : null,
    count: spends.length,
    saved,
    categories,
    split,
    busiestDay: busiest ? { date: busiest[0], amount: busiest[1] } : null,
    biggest: biggest ? { description: biggest.description, amount: num(biggest.amount), category: biggest.categories?.name || null } : null,
    reactions: week.reduce((s, x) => s + (x.expense_reactions?.length || 0), 0),
  };
}
