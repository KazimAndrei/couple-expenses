// Данные для виджетов iOS: после каждой загрузки собираем короткий снимок месяца
// и отдаём его нативной части (Capture.setWidgetData → общий keychain → WidgetKit).
// Виджет сам ничего не грузит — показывает последний снимок и подписи на языке приложения.
import { Capacitor } from '@capacitor/core';
import { Capture } from './capture.js';
import { getState, isSolo } from '../lib/store.js';
import { categoryLabel, getLang, monthName, t } from '../lib/i18n.js';
import { currentMonth, formatMoney, todayStr } from '../lib/utils.js';
import { memberDisplayLabel, resolveMemberSides, resolvePayerSide, expenseJoinedProfileName } from '../lib/member-filters.js';

let lastJson = '';

const isGoalExpense = (x) => Array.isArray(x.goal_contributions) && x.goal_contributions.length > 0;
const num = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : 0; };

export function buildWidgetSnapshot(state = getState(), now = new Date()) {
  const { couple, expenses = [], categories = [], members = [], goals = [], monthlyIncome = 0 } = state;
  if (!couple) return null;
  const month = currentMonth();
  // Виджет всегда про текущий месяц, даже если в приложении открыт прошлый
  if ((state.currentMonth || month) !== month) return null;
  const cur = couple.currency || 'USD';
  const money = (v) => formatMoney(v, cur);
  const spend = expenses.filter((x) => !isGoalExpense(x));
  const total = spend.reduce((s, x) => s + num(x.amount), 0);
  const today = todayStr();
  const todayTotal = spend.filter((x) => x.expense_date === today).reduce((s, x) => s + num(x.amount), 0);
  const day = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const sides = resolveMemberSides(members);
  const split = { a: 0, b: 0, shared: 0 };
  for (const x of spend) {
    if (x.split === 'equal') { split.shared += num(x.amount); continue; }
    const side = resolvePayerSide(x.paid_by, sides, expenseJoinedProfileName(x));
    split[side === 'b' ? 'b' : 'a'] += num(x.amount);
  }

  // Расходы без известной категории — одной строкой «Другое», а не несколькими
  const known = new Set(categories.map((c) => c.id));
  const byCat = new Map();
  for (const x of spend) {
    const key = known.has(x.category_id) ? x.category_id : '__other';
    byCat.set(key, (byCat.get(key) || 0) + num(x.amount));
  }
  const topCategories = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id, amount]) => {
      const c = categories.find((k) => k.id === id);
      return { name: categoryLabel(c?.name || t('common.other')), amount: money(amount), share: total > 0 ? Math.max(0, amount / total) : 0, color: c?.color || '#888780' };
    });

  const goal = goals
    .filter((g) => !g.completed && num(g.target_amount) > 0)
    .sort((a, b) => num(b.current_amount) / num(b.target_amount) - num(a.current_amount) / num(a.target_amount))[0];

  // Без created_at (запись из офлайн-очереди) сравниваем по дате расхода с концом дня
  const stamp = (x) => String(x.created_at || `${x.expense_date}T23:59:59`);
  const last = [...spend].sort((a, b) => stamp(b).localeCompare(stamp(a)))[0];
  const lastTitle = last ? (last.description || categoryLabel(last.categories?.name || '')) : '';
  const income = num(monthlyIncome);
  const solo = isSolo(state);

  return {
    v: 1,
    updatedAt: now.getTime(),
    // Виджет сверяет с текущей датой: «сегодня» обнуляется в полночь, месяц — при смене месяца
    day: today,
    monthKey: month,
    zero: money(0),
    lang: getLang(),
    currency: cur,
    month: monthName(now.getMonth()),
    total: money(total),
    totalValue: total,
    today: money(todayTotal),
    perDay: money(total / Math.max(1, day)),
    forecast: money((total / Math.max(1, day)) * daysInMonth),
    income: income > 0 ? money(income) : null,
    left: income > 0 ? money(income - total) : null,
    usedShare: income > 0 ? Math.min(1, Math.max(0, total / income)) : null,
    over: income > 0 && total > income,
    solo,
    split: solo ? null : {
      a: { name: memberDisplayLabel(sides.memberA) || 'A', amount: money(split.a), share: total > 0 ? Math.max(0, split.a / total) : 0 },
      // Партнёр ещё не присоединился — как на главном экране, его не показываем
      b: sides.memberB ? { name: memberDisplayLabel(sides.memberB), amount: money(split.b), share: total > 0 ? Math.max(0, split.b / total) : 0 } : null,
      shared: { amount: money(split.shared), share: total > 0 ? Math.max(0, split.shared / total) : 0 },
    },
    topCategories,
    goal: goal ? {
      name: goal.name,
      saved: money(goal.current_amount),
      target: money(goal.target_amount),
      share: Math.min(1, num(goal.current_amount) / num(goal.target_amount)),
    } : null,
    last: lastTitle ? { title: lastTitle, amount: money(last.amount) } : null,
    count: spend.length,
    flow: moneyFlow(state, spend, expenses, money),
    // Карточка как на главном экране: те же подписи, что в приложении
    hero: {
      label: t(solo ? 'home.spentSolo' : 'home.spentTogether'),
      meta: `${t('home.txCount', { count: spend.length })}${total > 0 ? ` · ${t('home.perDay', { amount: money(total / Math.max(1, day)) })}` : ''}`,
      // «Осталось <b>…</b> из …»: жирную часть виджет выделит сам
      income: income > 0
        ? (income - total >= 0
          ? t('home.leftOfIncome', { left: money(income - total), income: money(income) })
          : t('home.overIncome', { amount: money(total - income) }))
        : null,
    },
    l: {
      spent: t(solo ? 'widget.spentSolo' : 'widget.spent'),
      today: t('widget.today'),
      perDay: t('widget.perDay'),
      forecast: t('widget.forecast'),
      left: t('widget.left'),
      over: t('widget.over'),
      of: t('widget.of'),
      shared: t('common.shared'),
      top: t('widget.top'),
      goal: t('widget.goal'),
      add: t('widget.add'),
      voice: t('capture.voice'),
      qr: t('widget.qr'),
      last: t('widget.last'),
      empty: t('widget.empty'),
      noGoal: t('widget.noGoal'),
      stale: t('widget.stale'),
      noIncome: t('widget.noIncome'),
      incomeTitle: t('analytics.income'),
    },
  };
}

// Карточка «Доход за месяц» из аналитики: те же формулы (доход — сумма поступлений месяца)
function moneyFlow(state, spend, expenses, money) {
  const entries = state.incomeEntries || [];
  const income = entries.length ? entries.reduce((s, e) => s + num(e.amount), 0) : num(state.monthlyIncome);
  if (!(income > 0)) return null;
  const spent = spend.reduce((s, x) => s + num(x.amount), 0);
  const saved = expenses.filter(isGoalExpense).reduce((s, x) => s + num(x.amount), 0);
  const leftover = income - spent - saved;
  const spentPct = Math.max(0, Math.min(100, Math.round((spent / income) * 100)));
  const savedPct = Math.max(0, Math.min(100 - spentPct, Math.round((saved / income) * 100)));
  return {
    incomeLabel: t('analytics.income'),
    income: money(income),
    leftLabel: leftover >= 0 ? t('analytics.leftover') : t('analytics.overspent'),
    left: money(Math.abs(leftover)),
    negative: leftover < 0,
    spentPct,
    savedPct,
    spentText: `${t('analytics.spent')} ${money(spent)} · ${spentPct}%`,
    savedText: saved > 0 ? `${t('analytics.saved')} ${money(saved)}` : null,
  };
}

// Вызывается после загрузки данных; одинаковый снимок повторно не отправляем
export async function syncWidgets() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return;
  // Пары больше нет (вышли из неё или не вошли) — виджет не должен показывать старые суммы
  if (!getState().couple) {
    if (!getState().loading) await clearWidgets();
    return;
  }
  // Открыт другой месяц — оставляем последний снимок текущего (виджет сам поймёт, что он устарел)
  const snap = buildWidgetSnapshot();
  if (!snap) return;
  const json = JSON.stringify({ ...snap, updatedAt: 0 });
  if (json === lastJson) return;
  lastJson = json;
  try {
    await Capture.setWidgetData({ json: JSON.stringify(snap) });
  } catch { /* старая сборка без виджетов */ }
}

// При выходе из аккаунта виджет не должен показывать чужие суммы
export async function clearWidgets() {
  lastJson = '';
  if (!Capacitor.isNativePlatform()) return;
  try { await Capture.setWidgetData({ json: '' }); } catch { /* нет плагина */ }
}
