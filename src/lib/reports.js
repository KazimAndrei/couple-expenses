// Отчёт за несколько месяцев: траты по месяцам, сравнение с предыдущим таким же отрезком, тренды по категориям.
import { isGoalExpense } from './money-flow.js';

const pad = (n) => String(n).padStart(2, '0');
const num = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : 0; };

// n месяцев, заканчивая endMonth ('YYYY-MM'), по возрастанию
export function monthKeys(endMonth, n) {
  const [y, m] = endMonth.split('-').map(Number);
  const keys = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(y, m - 1 - i, 1);
    keys.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  return keys;
}

// Границы запроса за период вместе с предыдущим таким же: { from, to, months, prevMonths }
export function reportRange(endMonth, n) {
  const all = monthKeys(endMonth, n * 2);
  const months = all.slice(n);
  const [y, m] = endMonth.split('-').map(Number);
  return {
    months,
    prevMonths: all.slice(0, n),
    from: `${all[0]}-01`,
    to: `${endMonth}-${pad(new Date(y, m, 0).getDate())}`,
  };
}

const delta = (now, before) => (before > 0 ? Math.round((now / before - 1) * 100) : null);

// partialMonth — текущий, ещё не закончившийся месяц: в среднее и в «самый дешёвый» он не идёт
export function buildReport(expenses, { months, prevMonths, partialMonth = null }) {
  const index = new Map(months.map((key, i) => [key, i]));
  const prevSet = new Set(prevMonths);
  const byMonth = months.map((month) => ({ month, total: 0, saved: 0, count: 0 }));
  const cats = new Map();
  let prevTotal = 0;

  for (const x of expenses || []) {
    const key = String(x.expense_date).slice(0, 7);
    const amount = num(x.amount);
    const i = index.get(key);
    if (i === undefined && !prevSet.has(key)) continue;
    if (isGoalExpense(x)) { if (i !== undefined) byMonth[i].saved += amount; continue; }
    const id = x.category_id || 'other';
    const cat = cats.get(id) || {
      id, name: x.categories?.name || null, icon: x.categories?.icon || 'more-horizontal', color: x.categories?.color || '#888780',
      total: 0, prevTotal: 0, byMonth: months.map(() => 0),
    };
    if (i !== undefined) {
      byMonth[i].total += amount;
      byMonth[i].count += 1;
      cat.total += amount;
      cat.byMonth[i] += amount;
      // Название и значок берём из свежих трат: категорию могли переименовать
      if (x.categories?.name) Object.assign(cat, { name: x.categories.name, icon: x.categories.icon || cat.icon, color: x.categories.color || cat.color });
    } else {
      prevTotal += amount;
      cat.prevTotal += amount;
    }
    cats.set(id, cat);
  }

  const total = byMonth.reduce((s, r) => s + r.total, 0);
  const saved = byMonth.reduce((s, r) => s + r.saved, 0);
  // Среднее — по месяцам, где были траты: пустые месяцы до начала учёта его бы занизили.
  // Незаконченный месяц тоже занижал бы — считаем без него, если есть другие.
  const withData = byMonth.filter((r) => r.count > 0);
  const full = withData.filter((r) => r.month !== partialMonth);
  const active = full.length ? full : withData;
  const activeTotal = active.reduce((s, r) => s + r.total, 0);
  const activeIndexes = new Set(active.map((r) => index.get(r.month)));
  const categories = [...cats.values()]
    .filter((c) => c.total > 0 || c.prevTotal > 0)
    .map((c) => ({
      ...c,
      share: total > 0 ? c.total / total : 0,
      deltaPct: delta(c.total, c.prevTotal),
      change: c.total - c.prevTotal,
      // Среднее по тем же месяцам, что и общее «в среднем в месяц»
      average: active.length ? c.byMonth.reduce((s, v, i) => s + (activeIndexes.has(i) ? v : 0), 0) / active.length : 0,
    }))
    .sort((a, b) => b.total - a.total);
  const ranked = [...active].sort((a, b) => b.total - a.total);
  const peak = [...withData].sort((a, b) => b.total - a.total)[0] || null;

  return {
    months,
    byMonth,
    total,
    saved,
    count: byMonth.reduce((s, r) => s + r.count, 0),
    average: active.length ? activeTotal / active.length : 0,
    prevTotal,
    deltaPct: delta(total, prevTotal),
    peak,
    lowest: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    categories,
    // Что выросло и что сократилось сильнее всего в деньгах — только там, где есть с чем сравнить
    grew: categories.filter((c) => c.prevTotal > 0 && c.change > 0).sort((a, b) => b.change - a.change).slice(0, 3),
    shrank: categories.filter((c) => c.prevTotal > 0 && c.change < 0).sort((a, b) => a.change - b.change).slice(0, 3),
    empty: total === 0 && saved === 0,
  };
}
