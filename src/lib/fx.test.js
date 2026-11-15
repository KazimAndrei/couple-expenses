import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
});

const { convertAmount, roundMoney, getRates, convert } = await import('./fx.js');

const RATES = { USD: 1, THB: 36, EUR: 0.9, RUB: 90 };
const ok = (rates) => vi.fn(async () => ({ json: async () => ({ result: 'success', rates }) }));
const down = () => vi.fn(async () => { throw new Error('offline'); });

beforeEach(() => store.clear());

describe('convertAmount', () => {
  it('пересчитывает через базовую валюту', () => {
    expect(convertAmount(110, 'THB', 'USD', RATES)).toBe(3.06);
    expect(convertAmount(10, 'USD', 'THB', RATES)).toBe(360);
    expect(convertAmount(9, 'EUR', 'THB', RATES)).toBe(360);
  });
  it('та же валюта — без изменений и без курсов', () => {
    expect(convertAmount(110, 'THB', 'THB', null)).toBe(110);
  });
  it('нет курса — null, а не выдуманное число', () => {
    expect(convertAmount(110, 'THB', 'XXX', RATES)).toBeNull();
    expect(convertAmount(110, 'THB', 'USD', null)).toBeNull();
    expect(convertAmount('abc', 'THB', 'USD', RATES)).toBeNull();
  });
});

describe('roundMoney', () => {
  it('баты и рубли — до целого, доллары — до центов', () => {
    expect(roundMoney(359.6, 'THB')).toBe(360);
    expect(roundMoney(3.0556, 'USD')).toBe(3.06);
  });
  it('мелкая сумма не округляется в ноль', () => {
    expect(roundMoney(0.3, 'THB')).toBe(0.3);
    expect(roundMoney(0.004, 'USD')).toBe(0.01);
    expect(convertAmount(100, 'VND', 'USD', { USD: 1, VND: 25000 })).toBe(0.01);
    expect(roundMoney(0, 'USD')).toBe(0);
  });
});

describe('getRates', () => {
  it('берёт из сети и кладёт в кэш', async () => {
    const fetcher = ok(RATES);
    expect(await getRates({ now: 1000, fetcher })).toEqual({ rates: RATES, stale: false });
    const again = ok({ USD: 1, THB: 99 });
    expect((await getRates({ now: 2000, fetcher: again })).rates.THB).toBe(36);
    expect(again).not.toHaveBeenCalled();
  });
  it('кэш старше 12 часов обновляется', async () => {
    await getRates({ now: 0, fetcher: ok(RATES) });
    const res = await getRates({ now: 13 * 3600 * 1000, fetcher: ok({ USD: 1, THB: 40 }) });
    expect(res.rates.THB).toBe(40);
  });
  it('без сети отдаёт старый курс с пометкой stale', async () => {
    await getRates({ now: 0, fetcher: ok(RATES) });
    expect(await getRates({ now: 13 * 3600 * 1000, fetcher: down() })).toEqual({ rates: RATES, stale: true });
  });
  it('кэш с меткой из будущего обновляется', async () => {
    await getRates({ now: 10 * 3600 * 1000, fetcher: ok(RATES) });
    const res = await getRates({ now: 0, fetcher: ok({ USD: 1, THB: 41 }) });
    expect(res.rates.THB).toBe(41);
  });
  it('без сети и без кэша — rates: null', async () => {
    expect(await getRates({ fetcher: down() })).toEqual({ rates: null, stale: true });
  });
  it('ответ с ошибкой не затирает кэш', async () => {
    await getRates({ now: 0, fetcher: ok(RATES) });
    const bad = vi.fn(async () => ({ json: async () => ({ result: 'error' }) }));
    expect((await getRates({ now: 13 * 3600 * 1000, fetcher: bad })).rates).toEqual(RATES);
  });
});

describe('convert', () => {
  it('одна валюта — сеть не трогает', async () => {
    const fetcher = down();
    expect(await convert(50, 'USD', 'USD', { fetcher })).toEqual({ amount: 50, stale: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('нет курсов — amount: null', async () => {
    expect((await convert(110, 'THB', 'USD', { fetcher: down() })).amount).toBeNull();
  });
});
