// Курсы валют для трат не в валюте пары. Источник — open.er-api.com (без ключа, обновляется раз в сутки).
// Курсы держим в localStorage: в поездке сеть бывает не всегда, а вчерашний курс лучше, чем никакого.
const CACHE_KEY = 'ce_fx_rates_v1';
const FRESH_MS = 12 * 60 * 60 * 1000;
const zeroDecimal = new Set(['THB', 'RUB', 'JPY', 'KZT', 'AMD', 'KRW', 'VND', 'IDR', 'HUF']);

const readCache = () => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
};

// rates — таблица «сколько единиц валюты за 1 base»; пересчёт между любыми двумя идёт через base
export function convertAmount(amount, from, to, rates) {
  const value = Number(amount);
  if (!Number.isFinite(value) || !from || !to) return null;
  if (from === to) return value;
  const rateFrom = rates?.[from];
  const rateTo = rates?.[to];
  if (!(rateFrom > 0) || !(rateTo > 0)) return null;
  return roundMoney((value / rateFrom) * rateTo, to);
}

// Баты и рубли копейками не считают — округляем до целого, остальное до сотых
export function roundMoney(value, currency) {
  const digits = zeroDecimal.has(currency) ? 0 : 2;
  const k = 10 ** digits;
  const rounded = Math.round(value * k) / k;
  // 0.3 бата не должно превратиться в «0» — пустую трату база не примет
  return rounded > 0 ? rounded : Math.round(value * 100) / 100;
}

// { rates, stale }: свежие курсы, либо сохранённые (stale), либо null, если не было сети ни разу
export async function getRates({ now = Date.now(), fetcher = fetch } = {}) {
  const cached = readCache();
  if (cached.rates && now - cached.at < FRESH_MS) return { rates: cached.rates, stale: false };
  try {
    const res = await fetcher('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    if (data?.result !== 'success' || !data.rates) throw new Error('fx: bad response');
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, rates: data.rates })); } catch { /* кэш не обязателен */ }
    return { rates: data.rates, stale: false };
  } catch {
    return cached.rates ? { rates: cached.rates, stale: true } : { rates: null, stale: true };
  }
}

// Пересчёт «одной строкой» для мест, где курсы ещё не загружены
export async function convert(amount, from, to, opts) {
  if (from === to) return { amount: Number(amount), stale: false };
  const { rates, stale } = await getRates(opts);
  return { amount: convertAmount(amount, from, to, rates), stale };
}
