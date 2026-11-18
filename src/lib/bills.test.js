import { describe, it, expect } from 'vitest';
import { billStatus, billTotals, detectRecurring, monthlyCost, upcomingBills, yearlyCost } from './bills.js';

const NOW = new Date(2026, 10, 18, 15); // 18 ноября 2026
const bill = (extra = {}) => ({ id: 'b1', description: 'Rent', amount: 18000, period: 'month', day_of_month: 25, kind: 'bill', auto_add: false, active: true, ...extra });
const paidOn = (date, id = 'b1') => [{ recurring_id: id, expense_date: date }];

describe('billStatus', () => {
  it('ещё не наступил — дней до платежа', () => {
    expect(billStatus(bill(), [], NOW)).toMatchObject({ due: '2026-11-25', daysLeft: 7, paid: false, overdue: false });
  });
  it('сегодня', () => {
    expect(billStatus(bill({ day_of_month: 18 }), [], NOW)).toMatchObject({ daysLeft: 0, overdue: false });
  });
  it('день прошёл и не оплачен — просрочен, дата остаётся прежней', () => {
    expect(billStatus(bill({ day_of_month: 5 }), [], NOW)).toMatchObject({ due: '2026-11-05', daysLeft: -13, overdue: true });
  });
  it('оплачен заранее — отмечен оплаченным до своего дня', () => {
    expect(billStatus(bill(), paidOn('2026-11-10'), NOW)).toMatchObject({ due: '2026-11-25', paid: true, overdue: false });
  });
  it('оплачен и день прошёл — показываем следующий месяц', () => {
    expect(billStatus(bill({ day_of_month: 5 }), paidOn('2026-11-05'), NOW)).toMatchObject({ due: '2026-12-05', paid: false, paidThisCycle: true, overdue: false });
  });
  it('оплата прошлого месяца не считается', () => {
    expect(billStatus(bill({ day_of_month: 5 }), paidOn('2026-10-05'), NOW).overdue).toBe(true);
  });
  it('чужой платёж не считается', () => {
    expect(billStatus(bill(), paidOn('2026-11-10', 'other'), NOW).paid).toBe(false);
  });
  it('автодобавление не бывает просроченным', () => {
    expect(billStatus(bill({ day_of_month: 5, auto_add: true }), [], NOW)).toMatchObject({ due: '2026-12-05', overdue: false });
  });
  it('заведён после своего дня — ждём следующего цикла, а не «просрочено»', () => {
    expect(billStatus(bill({ day_of_month: 5, created_at: '2026-11-18T08:00:00Z' }), [], NOW)).toMatchObject({ due: '2026-12-05', overdue: false });
    expect(billStatus(bill({ period: 'year', month_of_year: 1, day_of_month: 12, created_at: '2026-11-18T08:00:00Z' }), [], NOW)).toMatchObject({ due: '2027-01-12', overdue: false });
  });
  it('заведён до своего дня и пропущен — просрочен', () => {
    expect(billStatus(bill({ day_of_month: 5, created_at: '2026-11-02T08:00:00Z' }), [], NOW).overdue).toBe(true);
    expect(billStatus(bill({ day_of_month: 5, created_at: '2026-06-02T08:00:00Z' }), [], NOW).overdue).toBe(true);
  });
  it('31-е число в коротком месяце — последний день', () => {
    expect(billStatus(bill({ day_of_month: 31 }), [], NOW).due).toBe('2026-11-30');
    expect(billStatus(bill({ day_of_month: 31 }), [], new Date(2027, 1, 10)).due).toBe('2027-02-28');
  });
  it('декабрьский оплаченный переходит на январь следующего года', () => {
    expect(billStatus(bill({ day_of_month: 3 }), paidOn('2026-12-03'), new Date(2026, 11, 20)).due).toBe('2027-01-03');
  });
  it('годовой: в своём месяце, после оплаты — через год', () => {
    const yearly = bill({ period: 'year', month_of_year: 12, day_of_month: 1 });
    expect(billStatus(yearly, [], NOW)).toMatchObject({ due: '2026-12-01', daysLeft: 13 });
    expect(billStatus({ ...yearly, month_of_year: 3 }, paidOn('2026-03-01'), NOW).due).toBe('2027-03-01');
    expect(billStatus({ ...yearly, month_of_year: 3 }, [], NOW).overdue).toBe(true);
  });
});

describe('суммы', () => {
  it('в месяц и в год', () => {
    expect(yearlyCost(bill({ amount: 100 }))).toBe(1200);
    expect(monthlyCost(bill({ amount: 1200, period: 'year' }))).toBe(100);
    expect(yearlyCost(bill({ amount: '1200.00', period: 'year' }))).toBe(1200);
  });
  it('итоги: отдельно подписки, без выключенных', () => {
    const totals = billTotals([
      bill({ amount: 1000 }),
      bill({ id: 'b2', kind: 'subscription', amount: 10 }),
      bill({ id: 'b3', kind: 'subscription', amount: 120, period: 'year' }),
      bill({ id: 'b4', kind: 'subscription', amount: 999, active: false }),
    ]);
    expect(totals).toMatchObject({ monthly: 1020, yearly: 12240, subscriptionsMonthly: 20, subscriptionsYearly: 240, count: 3, subscriptions: 2 });
  });
});

describe('upcomingBills', () => {
  it('по дате: просроченный, затем ближайшие', () => {
    const list = upcomingBills([bill({ id: 'a', day_of_month: 28 }), bill({ id: 'b', day_of_month: 5 }), bill({ id: 'c', day_of_month: 20 })], [], NOW);
    expect(list.map((x) => x.bill.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('detectRecurring', () => {
  const x = (date, description, amount, extra = {}) => ({ expense_date: date, description, amount, category_id: 'c8', split: 'full_payer', paid_by: 'u1', ...extra });
  const history = [
    x('2026-08-03', 'Netflix', 15.99), x('2026-09-03', 'netflix', 15.99), x('2026-10-03', 'Netflix ', 16.49),
    x('2026-08-10', 'Groceries', 80), x('2026-08-17', 'Groceries', 85), x('2026-09-10', 'Groceries', 78), x('2026-10-10', 'Groceries', 90),
    x('2026-08-01', 'Gym', 40), x('2026-09-01', 'Gym', 40),
    x('2026-08-05', 'Taxi', 10), x('2026-09-05', 'Taxi', 30), x('2026-10-05', 'Taxi', 55),
    x('2026-08-05', 'Spotify', 9.99), x('2026-09-05', 'Spotify', 9.99), x('2026-10-05', 'Spotify', 9.99),
    x('2026-08-05', 'Trip fund', 100, { goal_contributions: [{ goal_id: 'g' }] }), x('2026-09-05', 'Trip fund', 100, { goal_contributions: [{ goal_id: 'g' }] }), x('2026-10-05', 'Trip fund', 100, { goal_contributions: [{ goal_id: 'g' }] }),
  ];
  it('находит ежемесячные траты с близкой суммой', () => {
    const found = detectRecurring(history);
    expect(found.map((f) => f.description.trim())).toEqual(['Netflix', 'Spotify']);
    expect(found[0]).toMatchObject({ amount: 15.99, day_of_month: 3, months: 3, category_id: 'c8' });
  });
  it('не предлагает уже заведённое', () => {
    expect(detectRecurring(history, [{ description: 'NETFLIX' }]).map((f) => f.description)).toEqual(['Spotify']);
  });
  it('пусто — пусто', () => {
    expect(detectRecurring([])).toEqual([]);
    expect(detectRecurring(undefined)).toEqual([]);
  });
});
