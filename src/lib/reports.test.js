import { describe, it, expect } from 'vitest';
import { buildReport, monthKeys, reportRange } from './reports.js';

describe('monthKeys / reportRange', () => {
  it('месяцы подряд, через границу года', () => {
    expect(monthKeys('2027-02', 4)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
  it('период и предыдущий такой же, с датами запроса', () => {
    expect(reportRange('2026-11', 3)).toEqual({
      months: ['2026-09', '2026-10', '2026-11'],
      prevMonths: ['2026-06', '2026-07', '2026-08'],
      from: '2026-06-01',
      to: '2026-11-30',
    });
    expect(reportRange('2028-02', 1).to).toBe('2028-02-29');
  });
});

describe('buildReport', () => {
  const food = { name: 'Food', icon: 'utensils', color: '#f00' };
  const taxi = { name: 'Taxi', icon: 'car', color: '#00f' };
  const x = (date, amount, category_id, categories, extra = {}) => ({ expense_date: date, amount, category_id, categories, ...extra });
  const range = reportRange('2026-11', 3);
  const data = [
    x('2026-09-10', 100, 'f', food), x('2026-10-10', 200, 'f', food), x('2026-11-10', '300', 'f', food),
    x('2026-10-12', 50, 't', taxi),
    x('2026-11-15', 400, 'g', food, { goal_contributions: [{ goal_id: 'g' }] }),
    x('2026-07-01', 300, 'f', food), x('2026-08-01', 100, 't', taxi), x('2026-08-02', 60, 'old', { name: 'Old', icon: 'x', color: '#000' }),
    x('2026-05-01', 999, 'f', food), x('2026-12-01', 999, 'f', food),
    x('2026-11-20', 25, null, null),
  ];
  const r = buildReport(data, range);

  it('траты по месяцам без накоплений и без чужих месяцев', () => {
    expect(r.byMonth.map((m) => m.total)).toEqual([100, 250, 325]);
    expect(r.byMonth[2].saved).toBe(400);
    expect(r.total).toBe(675);
    expect(r.saved).toBe(400);
    expect(r.count).toBe(5);
    expect(r.average).toBe(225);
  });
  it('сравнение с предыдущим отрезком', () => {
    expect(r.prevTotal).toBe(460);
    expect(r.deltaPct).toBe(47);
  });
  it('самый дорогой и самый дешёвый месяц', () => {
    expect(r.peak.month).toBe('2026-11');
    expect(r.lowest.month).toBe('2026-09');
  });
  it('категории: сумма, доля, помесячно, изменение', () => {
    const f = r.categories.find((c) => c.id === 'f');
    expect(f).toMatchObject({ total: 600, prevTotal: 300, deltaPct: 100, change: 300, byMonth: [100, 200, 300] });
    expect(f.share).toBeCloseTo(0.889, 2);
    expect(r.categories.find((c) => c.id === 'other')).toMatchObject({ total: 25, deltaPct: null });
    expect(r.categories.find((c) => c.id === 'old')).toMatchObject({ total: 0, prevTotal: 60, deltaPct: -100 });
    expect(r.categories.map((c) => c.id)).toEqual(['f', 't', 'other', 'old']);
  });
  it('что выросло и что сократилось', () => {
    expect(r.grew.map((c) => c.id)).toEqual(['f']);
    expect(r.shrank.map((c) => c.id)).toEqual(['old', 't']);
  });
  it('пустой период', () => {
    const empty = buildReport([], range);
    expect(empty).toMatchObject({ empty: true, total: 0, average: 0, deltaPct: null, peak: null, lowest: null, categories: [] });
  });
  it('пустые месяцы не занижают среднее', () => {
    expect(buildReport([x('2026-11-10', 300, 'f', food)], range).average).toBe(300);
  });
});
