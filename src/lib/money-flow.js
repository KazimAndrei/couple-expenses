// Единый расчёт «сколько осталось» для главной, аналитики и виджетов:
// остаток = доход месяца − траты − отложенное в цели (деньги в цели уже не свободны).
export const isGoalExpense = (x) => Array.isArray(x?.goal_contributions) && x.goal_contributions.length > 0;

const num = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : 0; };

export function moneyFlow(income, expenses = []) {
  const inc = num(income);
  let spent = 0;
  let saved = 0;
  for (const x of expenses) {
    if (isGoalExpense(x)) saved += num(x.amount);
    else spent += num(x.amount);
  }
  const left = inc - spent - saved;
  const spentPct = inc > 0 ? Math.max(0, Math.min(100, Math.round((spent / inc) * 100))) : 0;
  const savedPct = inc > 0 ? Math.max(0, Math.min(100 - spentPct, Math.round((saved / inc) * 100))) : 0;
  return { income: inc, spent, saved, left, spentPct, savedPct, usedPct: Math.min(100, spentPct + savedPct) };
}
