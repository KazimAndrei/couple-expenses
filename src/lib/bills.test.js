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
  it('оплата заранее через границу месяца — не просрочка', () => {
    const rent = bill({ day_of_month: 1, created_at: '2026-08-15T08:00:00Z' });
    const pays = [...paidOn('2026-09-01'), ...paidOn('2026-10-01'), ...paidOn('2026-10-30')];
    expect(billStatus(rent, pays, new Date(2026, 10, 2))).toMatchObject({ due: '2026-12-01', overdue: false });
    expect(billStatus(rent, pays, new Date(2026, 9, 31))).toMatchObject({ due: '2026-11-01', paid: true });
  });
  it('неоплаченный счёт не пропадает с началом нового месяца', () => {
    const late = bill({ day_of_month: 28, created_at: '2026-06-01T08:00:00Z' });
    expect(billStatus(late, paidOn('2026-09-28'), new Date(2026, 10, 1))).toMatchObject({ due: '2026-10-28', overdue: true });
  });
  it('поздняя оплата закрывает прошлый срок, а не следующий', () => {
    const late = bill({ day_of_month: 28, created_at: '2026-06-01T08:00:00Z' });
    const pays = [...paidOn('2026-09-28'), ...paidOn('2026-11-02')];
    expect(billStatus(late, pays, new Date(2026, 10, 3))).toMatchObject({ due: '2026-11-28', paid: false, overdue: false });
  });
  it('годовой: поздняя оплата в январе не гасит следующий год', () => {
    const yearly = bill({ period: 'year', month_of_year: 12, day_of_month: 20, created_at: '2025-01-01T08:00:00Z' });
    const pays = [...paidOn('2025-12-20'), ...paidOn('2027-01-05')];
    expect(billStatus(yearly, pays, new Date(2027, 0, 6))).toMatchObject({ due: '2027-12-20', paid: false, overdue: false });
  });
  it('годовой: оплата в декабре за январский срок', () => {
    const yearly = bill({ period: 'year', month_of_year: 1, day_of_month: 10, created_at: '2025-01-01T08:00:00Z' });
    const pays = [...paidOn('2026-01-10'), ...paidOn('2026-12-28')];
    expect(billStatus(yearly, pays, new Date(2027, 0, 11))).toMatchObject({ due: '2028-01-10', overdue: false });
  });
  it('автодобавление, заведённое в этом месяце, начинается со следующего', () => {
    expect(billStatus(bill({ auto_add: true, day_of_month: 25, created_at: '2026-11-18T08:00:00Z' }), [], NOW).due).toBe('2026-12-25');
    expect(billStatus(bill({ auto_add: true, day_of_month: 25, created_at: '2026-10-18T08:00:00Z' }), [], NOW).due).toBe('2026-11-25');
  });
  it('оплата давно просроченного счёта закрывает именно его', () => {
    const old = bill({ day_of_month: 17, created_at: '2026-10-10T08:00:00Z' });
    expect(billStatus(old, [], new Date(2026, 10, 19))).toMatchObject({ due: '2026-10-17', overdue: true });
    expect(billStatus(old, paidOn('2026-11-19'), new Date(2026, 10, 19))).toMatchObject({ due: '2026-11-17', overdue: true });
    expect(billStatus(old, [...paidOn('2026-11-19'), ...paidOn('2026-11-19')], new Date(2026, 10, 19))).toMatchObject({ due: '2026-12-17', overdue: false });
  });
  it('две оплаты одного срока не гасят следующий', () => {
    const b = bill({ day_of_month: 5, created_at: '2026-06-01T08:00:00Z' });
    const pays = [...paidOn('2026-10-05'), ...paidOn('2026-11-05'), ...paidOn('2026-11-06')];
    expect(billStatus(b, pays, NOW)).toMatchObject({ due: '2026-12-05', paid: false, overdue: false });
    expect(billStatus(b, pays, new Date(2026, 11, 6)).overdue).toBe(true);
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
    expect(found[0]).toMatchObject({ amount: 16.49, day_of_month: 3, months: 3, category_id: 'c8' });
  });
  it('не предлагает уже заведённое', () => {
    expect(detectRecurring(history, [{ description: 'NETFLIX' }]).map((f) => f.description)).toEqual(['Spotify']);
  });
  it('подорожавшая подписка остаётся подпиской, предлагается новая цена', () => {
    const found = detectRecurring([x('2026-08-03', 'Gym', 10), x('2026-09-03', 'Gym', 10), x('2026-10-03', 'Gym', 12)]);
    expect(found).toHaveLength(1);
    expect(found[0].amount).toBe(12);
  });
  it('уже заведённое под более длинным названием не предлагается', () => {
    expect(detectRecurring(history, [{ description: 'Netflix Premium' }, { description: 'Spotify' }])).toEqual([]);
  });
  it('нестандартное деление предлагается как общее', () => {
    const rows = ['08', '09', '10'].map((m) => x(`2026-${m}-03`, 'Cloud', 5, { split: 'custom' }));
    expect(detectRecurring(rows)[0].split).toBe('equal');
  });
  it('пусто — пусто', () => {
    expect(detectRecurring([])).toEqual([]);
    expect(detectRecurring(undefined)).toEqual([]);
  });
});
