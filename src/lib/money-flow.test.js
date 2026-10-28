import { describe, it, expect } from 'vitest';
import { moneyFlow } from './money-flow.js';

const goal = (amount) => ({ amount, goal_contributions: [{ goal_id: 'g' }] });

describe('moneyFlow — единый остаток', () => {
  it('доход − траты − отложенное в цели', () => {
    expect(moneyFlow(40000, [{ amount: '26070' }, goal('2000')])).toMatchObject({ spent: 26070, saved: 2000, left: 11930, spentPct: 65, savedPct: 5, usedPct: 70 });
  });
  it('перерасход и пустой доход', () => {
    expect(moneyFlow(1000, [{ amount: 900 }, goal(300)]).left).toBe(-200);
    expect(moneyFlow(0, [{ amount: 10 }])).toMatchObject({ spentPct: 0, savedPct: 0, left: -10 });
  });
});
