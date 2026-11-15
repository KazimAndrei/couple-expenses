import { describe, it, expect } from 'vitest';
import { buildRecap, lastWeekRange, shouldOfferRecap, weekRangeFrom } from './weekly-recap.js';

// 2026-11-18 — среда; прошлая неделя 9–15 ноября, позапрошлая 2–8
const WED = new Date(2026, 10, 18, 12);
const RANGE = { from: '2026-11-09', to: '2026-11-15', prevFrom: '2026-11-02', prevTo: '2026-11-08' };
const x = (date, amount, extra = {}) => ({ expense_date: date, amount, description: 'x', category_id: 'c1', categories: { name: 'Food', icon: 'utensils', color: '#f00' }, ...extra });

describe('lastWeekRange', () => {
  it('в среду — прошлые пн–вс', () => {
    expect(lastWeekRange(WED)).toEqual(RANGE);
  });
  it('в понедельник — только что закончившаяся неделя', () => {
    expect(lastWeekRange(new Date(2026, 10, 16, 0, 5)).from).toBe('2026-11-09');
  });
  it('в воскресенье — ещё не эта неделя, а предыдущая', () => {
    expect(lastWeekRange(new Date(2026, 10, 15, 23)).from).toBe('2026-11-02');
  });
  it('неделя через границу года', () => {
    expect(lastWeekRange(new Date(2027, 0, 6))).toMatchObject({ from: '2026-12-28', to: '2027-01-03' });
  });
});

describe('weekRangeFrom', () => {
  it('неделя из пуша — по её понедельнику', () => {
    expect(weekRangeFrom('2026-11-09')).toEqual(RANGE);
  });
  it('мусор вместо даты — null', () => {
    expect(weekRangeFrom('2026-13-40')).toBeNull();
    expect(weekRangeFrom(undefined)).toBeNull();
    expect(weekRangeFrom('true')).toBeNull();
  });
});

describe('shouldOfferRecap', () => {
  it('пн–ср и ещё не смотрели — да', () => {
    expect(shouldOfferRecap(WED, null)).toBe(true);
    expect(shouldOfferRecap(new Date(2026, 10, 16), '2026-11-02')).toBe(true);
  });
  it('уже смотрели эту неделю или уже четверг — нет', () => {
    expect(shouldOfferRecap(WED, '2026-11-09')).toBe(false);
    expect(shouldOfferRecap(new Date(2026, 10, 19), null)).toBe(false);
  });
});

describe('buildRecap', () => {
  const data = [
    x('2026-11-09', 100),
    x('2026-11-10', '50.5', { category_id: 'c2', categories: { name: 'Taxi', icon: 'car', color: '#00f' }, description: 'Grab' }),
    x('2026-11-10', 300, { description: 'Hotel', expense_reactions: [{ id: 1 }, { id: 2 }] }),
    x('2026-11-12', 200, { goal_contributions: [{ goal_id: 'g' }] }),
    x('2026-11-08', 150),
    x('2026-11-16', 999),
    x('2026-11-01', 999),
  ];
  const recap = buildRecap(data, RANGE, (e) => (e.description === 'Grab' ? 'b' : e.description === 'Hotel' ? 'shared' : 'a'));

  it('считает траты недели без накоплений и без соседних недель', () => {
    expect(recap.total).toBe(450.5);
    expect(recap.count).toBe(3);
    expect(recap.saved).toBe(200);
    expect(recap.empty).toBe(false);
  });
  it('сравнивает с позапрошлой неделей', () => {
    expect(recap.prevTotal).toBe(150);
    expect(recap.deltaPct).toBe(200);
  });
  it('категории по убыванию с долями', () => {
    expect(recap.categories.map((c) => [c.name, c.amount])).toEqual([['Food', 400], ['Taxi', 50.5]]);
    expect(recap.categories[0].share).toBeCloseTo(0.888, 2);
  });
  it('кто платил, самый дорогой день и самая большая трата', () => {
    expect(recap.split).toEqual({ a: 100, b: 50.5, shared: 300 });
    expect(recap.busiestDay).toEqual({ date: '2026-11-10', amount: 350.5 });
    expect(recap.biggest).toMatchObject({ description: 'Hotel', amount: 300 });
    expect(recap.reactions).toBe(2);
  });
  it('пустая неделя и не с чем сравнивать', () => {
    const empty = buildRecap([], RANGE);
    expect(empty).toMatchObject({ empty: true, total: 0, deltaPct: null, biggest: null, busiestDay: null, categories: [] });
  });
});
