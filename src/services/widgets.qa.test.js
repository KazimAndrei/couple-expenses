// QA: снимок для виджетов iOS (buildWidgetSnapshot / syncWidgets / clearWidgets).
// Проверяем и арифметику, и «контракт» с Swift-структурой Snapshot (CEWidgets.swift):
// все не-optional поля Swift обязаны всегда присутствовать и иметь правильный тип,
// иначе JSONDecoder падает и все виджеты показывают пустое состояние.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';

const native = { on: false };
const setWidgetData = vi.fn(async () => {});
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.on, getPlatform: () => (native.on ? 'ios' : 'web') },
  registerPlugin: () => ({}),
}));
vi.mock('./capture.js', () => ({ Capture: { setWidgetData: (...a) => setWidgetData(...a) } }));

// localStorage для getLang(): ce_lang
const ls = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k),
});

const { buildWidgetSnapshot, syncWidgets, clearWidgets } = await import('./widgets.js');
const { setState } = await import('../lib/store.js');

const DUMP = process.env.QA_WIDGET_DUMP; // каталог для JSON-образцов (декодируются Swift-скриптом)
const dumped = [];
function dump(name, snap) {
  if (!DUMP || !snap) return;
  mkdirSync(DUMP, { recursive: true });
  writeFileSync(`${DUMP}/${name}.json`, JSON.stringify(snap));
  dumped.push(name);
}

// ---- Валидатор, повторяющий Swift Decodable Snapshot ----
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const opt = (v, f) => v === null || v === undefined || f(v);
function swiftDecodeErrors(s) {
  const err = [];
  const req = (path, ok) => { if (!ok) err.push(path); };
  req('updatedAt', isNum(s.updatedAt));
  for (const k of ['month', 'total', 'today', 'perDay', 'forecast']) req(k, isStr(s[k]));
  req('income', opt(s.income, isStr));
  req('left', opt(s.left, isStr));
  req('usedShare', opt(s.usedShare, isNum));
  req('over', typeof s.over === 'boolean');
  req('solo', typeof s.solo === 'boolean');
  // b — опционален: партнёр мог ещё не присоединиться
  req('split', opt(s.split, (sp) => ['a', 'shared'].every((p) => sp[p] && opt(sp[p].name, isStr) && isStr(sp[p].amount) && isNum(sp[p].share))
    && opt(sp.b, (b) => opt(b.name, isStr) && isStr(b.amount) && isNum(b.share))));
  req('day', isStr(s.day)); req('monthKey', isStr(s.monthKey)); req('zero', isStr(s.zero));
  req('topCategories', Array.isArray(s.topCategories) && s.topCategories.every((c) => isStr(c.name) && isStr(c.amount) && isNum(c.share) && isStr(c.color)));
  req('goal', opt(s.goal, (g) => isStr(g.name) && isStr(g.saved) && isStr(g.target) && isNum(g.share)));
  req('last', opt(s.last, (x) => isStr(x.title) && isStr(x.amount)));
  req('count', isInt(s.count));
  req('hero', opt(s.hero, (h) => isStr(h.label) && isStr(h.meta) && opt(h.income, isStr)));
  req('flow', opt(s.flow, (f) => isStr(f.incomeLabel) && isStr(f.income) && isStr(f.leftLabel) && isStr(f.left)
    && typeof f.negative === 'boolean' && isInt(f.spentPct) && isInt(f.savedPct) && isStr(f.spentText) && opt(f.savedText, isStr)));
  req('l', s.l && Object.values(s.l).every(isStr));
  return err;
}
// JSON roundtrip: NaN/Infinity превращаются в null — ровно то, что увидит Swift
const roundtrip = (s) => JSON.parse(JSON.stringify(s));

// ---- Фикстуры ----
const A = 'a1', B = 'b2';
const NOW = new Date(2026, 9, 15, 12, 0, 0); // 15 окт 2026, локальное время
const M = '2026-10';
const exp = (o) => ({ id: Math.random(), amount: '100', category_id: 'g', paid_by: A, split: 'full_payer', expense_date: `${M}-10`, created_at: `${M}-10T10:00:00Z`, ...o });
const base = () => ({
  couple: { id: 'c', currency: 'THB', solo: false },
  currentMonth: M,
  members: [{ id: A, display_name: 'Andrei', created_at: '2026-01-01' }, { id: B, display_name: 'Mila', created_at: '2026-01-02' }],
  categories: [{ id: 'g', name: 'Продукты', color: '#EF9F27' }, { id: 'h', name: 'Жильё', color: '#7F77DD' }],
  expenses: [],
  goals: [],
  monthlyIncome: 0,
  incomeEntries: [],
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  ls.clear();
});
afterEach(() => { vi.useRealTimers(); native.on = false; setWidgetData.mockClear(); });

describe('buildWidgetSnapshot — контракт со Swift', () => {
  it('пустой месяц: все обязательные поля есть, нули', () => {
    const s = buildWidgetSnapshot(base(), NOW);
    dump('empty-month', s);
    expect(swiftDecodeErrors(roundtrip(s))).toEqual([]);
    expect(s.totalValue).toBe(0);
    expect(s.count).toBe(0);
    expect(s.topCategories).toEqual([]);
    expect(s.last).toBe(null);
    expect(s.goal).toBe(null);
    expect(s.flow).toBe(null);
    expect(s.income).toBe(null);
    expect(s.hero.income).toBe(null);
    // в пустом месяце hero.meta без «≈ … в день»
    expect(s.hero.meta).not.toContain('≈');
    // split есть (пара), но все доли 0
    expect(s.split.a.share).toBe(0);
  });

  it('только взносы в цели: тратами не считаются, flow показывает «отложено»', () => {
    const st = { ...base(), monthlyIncome: 1000, expenses: [exp({ amount: '300', goal_contributions: [{ goal_id: 'x' }] })] };
    const s = buildWidgetSnapshot(st, NOW);
    dump('only-goal-contrib', s);
    expect(swiftDecodeErrors(roundtrip(s))).toEqual([]);
    expect(s.totalValue).toBe(0);
    expect(s.count).toBe(0);
    expect(s.last).toBe(null);
    expect(s.flow).toMatchObject({ spentPct: 0, savedPct: 30, negative: false });
    expect(s.flow.savedText).toContain('300');
  });

  it('соло: split=null, подписи «Потрачено»', () => {
    const st = { ...base(), couple: { id: 'c', currency: 'USD', solo: true }, members: [base().members[0]], expenses: [exp({ amount: '12.5' })] };
    const s = buildWidgetSnapshot(st, NOW);
    dump('solo', s);
    expect(s.solo).toBe(true);
    expect(s.split).toBe(null);
    expect(s.l.spent).toBe('Spent');
    expect(s.hero.label).toBe('Spent this month');
    expect(swiftDecodeErrors(roundtrip(s))).toEqual([]);
  });

  it('соло-пара, к которой присоединился партнёр → уже не соло', () => {
    const st = { ...base(), couple: { id: 'c', currency: 'USD', solo: true } };
    expect(buildWidgetSnapshot(st, NOW).solo).toBe(false);
  });

  it('партнёр ещё не присоединился (не соло): b не показываем (как на главной)', () => {
    const st = { ...base(), members: [base().members[0]], expenses: [exp({ amount: '500' })] };
    const s = buildWidgetSnapshot(st, NOW);
    dump('partner-not-joined', s);
    expect(s.split.b).toBe(null);
    expect(s.split.a.share).toBe(1);
    expect(swiftDecodeErrors(roundtrip(s))).toEqual([]);
  });

  it('трата с неизвестным плательщиком (удалённый профиль) уходит в A — как на главной', () => {
    const st = { ...base(), expenses: [exp({ paid_by: 'ghost', amount: '200' }), exp({ paid_by: B, amount: '100' })] };
    const s = buildWidgetSnapshot(st, NOW);
    expect(s.split.a.share).toBeCloseTo(2 / 3);
    expect(s.split.b.share).toBeCloseTo(1 / 3);
  });

  it('доход: incomeEntries (flow) против monthlyIncome (hero/month) — расхождение видно в разных виджетах', () => {
    const st = { ...base(), monthlyIncome: 5000, incomeEntries: [{ amount: '3000' }, { amount: '1000' }], expenses: [exp({ amount: '1000' })] };
    const s = buildWidgetSnapshot(st, NOW);
    expect(s.income).toContain('5,000'); // hero / Month / Lock берут monthlyIncome
    expect(s.flow.income).toContain('4,000'); // Flow — сумму поступлений
    // В приложении обе величины синхронизированы (setState кладёт newTotal), так что это лишь фиксация поведения
  });

  it('доход только через monthlyIncome (incomeEntries пуст) — flow строится', () => {
    const st = { ...base(), monthlyIncome: '2000', expenses: [exp({ amount: '500' })] };
    const s = buildWidgetSnapshot(st, NOW);
    expect(s.flow).toMatchObject({ spentPct: 25, negative: false });
    expect(s.usedShare).toBe(0.25);
  });

  it('перерасход: left отрицательный, over=true, usedShare=1, hero.income — «сверх дохода»', () => {
    const st = { ...base(), monthlyIncome: 1000, expenses: [exp({ amount: '1500' })] };
    const s = buildWidgetSnapshot(st, NOW);
    dump('overspend', s);
    expect(s.over).toBe(true);
    expect(s.usedShare).toBe(1);
    expect(s.left.startsWith('-')).toBe(true); // Swift снимает «-» через replacingOccurrences
    expect(s.hero.income).toContain('over');
    expect(s.flow).toMatchObject({ negative: true, spentPct: 100, savedPct: 0 });
  });

  it('перерасход в RU: минус — обычный дефис (Swift убирает только U+002D)', () => {
    ls.set('ce_lang', 'ru');
    const st = { ...base(), monthlyIncome: 1000, expenses: [exp({ amount: '1500' })] };
    const s = buildWidgetSnapshot(st, NOW);
    expect(s.left).toMatch(/^-/);
    expect(s.left).not.toContain('−');
  });

  it('отрицательные (возвраты), NaN, строки, null — без NaN/Infinity в JSON', () => {
    const st = {
      ...base(),
      monthlyIncome: 1000,
      expenses: [
        exp({ amount: '-300' }),
        exp({ amount: 'abc' }),
        exp({ amount: null }),
        exp({ amount: '  42.5 ' }),
        exp({ amount: 100 }),
      ],
    };
    const s = buildWidgetSnapshot(st, NOW);
    dump('weird-amounts', s);
    expect(swiftDecodeErrors(roundtrip(s))).toEqual([]);
    expect(s.totalValue).toBeCloseTo(-157.5);
  });

  it('итог месяца отрицательный (только возвраты) → доли и проценты не уходят ниже нуля', () => {
    const st = { ...base(), monthlyIncome: 1000, expenses: [exp({ amount: '-300' })] };
    const s = buildWidgetSnapshot(st, NOW);
    dump('negative-total', s);
    // Swift: frame(width: g.size.width * spentPct / 100) с отрицательным значением → "Invalid frame dimension"
    expect(s.flow.spentPct).toBe(0);
    expect(s.usedShare).toBe(0);
    expect(s.topCategories[0].share).toBe(0);
  });

  it('категория удалена / без имени / без цвета → «Other» и серый', () => {
    const st = { ...base(), categories: [{ id: 'z', name: '', color: null }], expenses: [exp({ category_id: 'missing' }), exp({ category_id: 'z' }), exp({ category_id: null })] };
    const s = buildWidgetSnapshot(st, NOW);
    expect(swiftDecodeErrors(roundtrip(s))).toEqual([]);
    for (const c of s.topCategories) {
      expect(c.name).toBe('Other');
      expect(c.color).toBe('#888780');
    }
    // 'z' — существующая категория без имени, остальные две неизвестные склеены в одну строку
    expect(s.topCategories.length).toBe(2);
  });

  it('>6 категорий: максимум 6, по убыванию', () => {
    const categories = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, name: `Cat ${i}`, color: '#123456' }));
    const expenses = categories.map((c, i) => exp({ category_id: c.id, amount: String((i + 1) * 10) }));
    const s = buildWidgetSnapshot({ ...base(), categories, expenses }, NOW);
    expect(s.topCategories).toHaveLength(6);
    expect(s.topCategories.map((c) => c.name)).toEqual(['Cat 9', 'Cat 8', 'Cat 7', 'Cat 6', 'Cat 5', 'Cat 4']);
    const sum = s.topCategories.reduce((a, c) => a + c.share, 0);
    expect(sum).toBeLessThan(1);
  });

  it('очень длинные имена и огромные суммы — JSON остаётся небольшим', () => {
    const long = 'Очень-очень длинное название категории '.repeat(10);
    const categories = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: long + i, color: '#E24B4A' }));
    const expenses = Array.from({ length: 3000 }, (_, i) => exp({ category_id: `c${i % 8}`, amount: '4115.63', description: 'D'.repeat(500) }));
    const st = {
      ...base(),
      members: [{ id: A, display_name: 'А'.repeat(200) }, { id: B, display_name: 'Б'.repeat(200) }],
      categories, expenses,
      goals: [{ id: 'g', name: 'Цель '.repeat(100), current_amount: 9999999999.99, target_amount: 9999999999.99 }],
      monthlyIncome: 12345678.9,
    };
    const s = buildWidgetSnapshot(st, NOW);
    dump('long-and-huge', s);
    const bytes = Buffer.byteLength(JSON.stringify(s));
    // Имена не обрезаются в JS: 6 × ~400 симв. кириллицы + цель + описание ≈ несколько КБ — для keychain терпимо
    expect(bytes).toBeLessThan(16 * 1024);
    expect(swiftDecodeErrors(roundtrip(s))).toEqual([]);
  });

  it('типичный снимок < 3 КБ', () => {
    const st = { ...base(), monthlyIncome: 40000, goals: [{ id: 'g', name: 'Bali', current_amount: 100, target_amount: 1000 }],
      expenses: Array.from({ length: 200 }, (_, i) => exp({ amount: String(i * 7), category_id: i % 2 ? 'g' : 'h', description: `item ${i}` })) };
    expect(Buffer.byteLength(JSON.stringify(buildWidgetSnapshot(st, NOW)))).toBeLessThan(3000);
  });

  it('RU vs EN подписи и названия месяца', () => {
    const en = buildWidgetSnapshot(base(), NOW);
    expect(en.lang).toBe('en');
    expect(en.month).toBe('October');
    expect(en.l.today).toBe('Today');
    ls.set('ce_lang', 'ru');
    const ru = buildWidgetSnapshot({ ...base(), expenses: [exp({ amount: '1234' })] }, NOW);
    dump('ru', ru);
    expect(ru.lang).toBe('ru');
    expect(ru.month).toBe('Октябрь');
    expect(ru.l.today).toBe('Сегодня');
    expect(ru.l.voice).toBe('Голосом');
    expect(ru.hero.label).toBe('Потратили вместе');
    // все ключи l переведены (нет «сырых» ключей вида widget.xxx)
    for (const v of Object.values(ru.l)) expect(v).not.toMatch(/^[a-z]+\.[a-zA-Z]+$/);
    for (const v of Object.values(en.l)) expect(v).not.toMatch(/^[a-z]+\.[a-zA-Z]+$/);
  });

  it('RU: «1 транзакций» — плюрализация hero.meta (как в приложении)', () => {
    ls.set('ce_lang', 'ru');
    const s = buildWidgetSnapshot({ ...base(), expenses: [exp({})] }, NOW);
    expect(s.hero.meta.startsWith('1 транзакций')).toBe(true); // унаследовано из home.txCount
  });

  it('валюты: USD/THB/RUB/JPY и неизвестный код', () => {
    const fmt = (cur, lang) => {
      if (lang) ls.set('ce_lang', lang); else ls.delete('ce_lang');
      return buildWidgetSnapshot({ ...base(), couple: { id: 'c', currency: cur }, expenses: [exp({ amount: '12345678.9' })] }, NOW).total;
    };
    expect(fmt('USD')).toBe('$12,345,678.90');
    // en-US + THB/RUB → код, а не символ (Intl): «THB 12,345,679», хотя превью виджета рисует «฿28,450»
    expect(fmt('THB')).toBe('THB\u00a012,345,679');
    expect(fmt('RUB')).toBe('RUB\u00a012,345,679');
    expect(fmt('JPY')).toBe('¥12,345,679');
    expect(fmt('RUB', 'ru')).toMatch(/^12\s345\s679\s₽$/);
    expect(fmt('THB', 'ru')).toMatch(/^12\s345\s679\s฿$/);
    expect(fmt('XYZ')).toBe('XYZ\u00a012,345,678.90'); // Intl принимает любой 3-буквенный код
    expect(buildWidgetSnapshot({ ...base(), couple: { id: 'c', currency: null } }, NOW).currency).toBe('USD');
  });

  it('месяц не текущий → null; currentMonth не задан → считаем текущим', () => {
    expect(buildWidgetSnapshot({ ...base(), currentMonth: '2026-09' }, NOW)).toBe(null);
    expect(buildWidgetSnapshot({ ...base(), currentMonth: null }, NOW)).not.toBe(null);
    expect(buildWidgetSnapshot({ ...base(), couple: null }, NOW)).toBe(null);
  });

  it('BUG: смена месяца при открытом приложении — state.currentMonth остаётся старым → снимок null навсегда', () => {
    // Приложение запущено 31 октября (currentMonth = '2026-10'), наступило 1 ноября
    vi.setSystemTime(new Date(2026, 10, 1, 9, 0));
    const s = buildWidgetSnapshot({ ...base(), currentMonth: '2026-10' }, new Date());
    expect(s).toBe(null); // → syncWidgets ничего не шлёт, виджет держит октябрьские цифры
  });

  it('день 1 и последний день: perDay / forecast', () => {
    const one = new Date(2026, 9, 1, 8, 0);
    vi.setSystemTime(one);
    const st = { ...base(), couple: { id: 'c', currency: 'USD' }, expenses: [exp({ amount: '31', expense_date: '2026-10-01' })] };
    let s = buildWidgetSnapshot(st, one);
    expect(s.perDay).toBe('$31.00');
    expect(s.forecast).toBe('$961.00'); // 31 × 31 дней
    expect(s.today).toBe('$31.00');
    const last = new Date(2026, 9, 31, 23, 59);
    vi.setSystemTime(last);
    s = buildWidgetSnapshot(st, last);
    expect(s.perDay).toBe('$1.00');
    expect(s.forecast).toBe('$31.00');
    expect(s.today).toBe('$0.00');
    // февраль невисокосного года
    const feb = new Date(2027, 1, 28, 12);
    vi.setSystemTime(feb);
    s = buildWidgetSnapshot({ ...st, currentMonth: '2027-02', expenses: [exp({ amount: '28', expense_date: '2027-02-01' })] }, feb);
    expect(s.forecast).toBe('$28.00');
  });

  it('today — по локальной дате, не UTC', () => {
    // 00:30 локального 16 окт; в UTC (для зон восточнее UTC) это ещё 15-е
    const t = new Date(2026, 9, 16, 0, 30);
    vi.setSystemTime(t);
    const st = { ...base(), couple: { id: 'c', currency: 'USD' }, expenses: [exp({ amount: '5', expense_date: '2026-10-16' }), exp({ amount: '7', expense_date: '2026-10-15' })] };
    expect(buildWidgetSnapshot(st, t).today).toBe('$5.00');
  });

  it('несогласованность: now ≠ системные часы — today/month берутся из разных источников', () => {
    // buildWidgetSnapshot(state, now): day/daysInMonth/monthName — из now, а currentMonth()/todayStr() — из системных часов
    vi.setSystemTime(new Date(2026, 9, 15, 12));
    const st = { ...base(), couple: { id: 'c', currency: 'USD' }, expenses: [exp({ amount: '10', expense_date: '2026-10-15' })] };
    const s = buildWidgetSnapshot(st, new Date(2026, 9, 20, 12));
    expect(s.today).toBe('$10.00'); // «сегодня» = 15-е, хотя now = 20-е
    expect(s.perDay).toBe('$0.50'); // делим на 20 дней
  });

  it('цель: берётся самая близкая к завершению незавершённая; >100% обрезается', () => {
    const st = { ...base(), goals: [
      { id: 1, name: 'Done', current_amount: 10, target_amount: 10, completed: true },
      { id: 2, name: 'Half', current_amount: 50, target_amount: 100 },
      { id: 3, name: 'Over', current_amount: '150', target_amount: '100' },
      { id: 4, name: 'Zero target', current_amount: 5, target_amount: 0 },
    ] };
    const s = buildWidgetSnapshot(st, NOW);
    expect(s.goal).toMatchObject({ name: 'Over', share: 1 });
  });

  it('последний расход: по created_at; без created_at (оффлайн) сравнение даты со временем', () => {
    const st = { ...base(), couple: { id: 'c', currency: 'USD' }, expenses: [
      exp({ description: 'server', created_at: '2026-10-15T08:00:00Z', expense_date: '2026-10-15' }),
      exp({ description: 'offline', created_at: undefined, expense_date: '2026-10-15' }),
    ] };
    const s = buildWidgetSnapshot(st, NOW);
    // без created_at сравниваем с концом дня — свежий оффлайн-расход последний
    expect(s.last.title).toBe('offline');
  });

  it('последний расход без описания и без join categories → пустой заголовок', () => {
    const st = { ...base(), expenses: [exp({ description: '' })] };
    const s = buildWidgetSnapshot(st, NOW);
    expect(s.last).toBe(null); // без заголовка строку «Последний» не показываем
    const st2 = { ...base(), expenses: [exp({ description: '', categories: { name: 'Продукты' } })] };
    expect(buildWidgetSnapshot(st2, NOW).last.title).toBe('Groceries');
  });

  it('hero.income: HTML <b> только вокруг суммы; имена/описания в hero не попадают', () => {
    const st = { ...base(), monthlyIncome: 1000, expenses: [exp({ amount: '100' })] };
    const s = buildWidgetSnapshot(st, NOW);
    expect(s.hero.income).toBe('<b>THB\u00a0900</b> left of THB\u00a01,000');
  });

  it('amount "Infinity" считается нулём — снимок декодируется', () => {
    const s = buildWidgetSnapshot({ ...base(), expenses: [exp({ amount: 'Infinity' })] }, NOW);
    dump('infinity-amount', s);
    expect(swiftDecodeErrors(roundtrip(s))).toEqual([]);
  });

  it('фаззинг: 300 случайных состояний декодируются Swift-схемой', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const amounts = ['0', '1', '-5', '1e6', 'NaN', '', null, undefined, 3.3, '999999999.99', '0.001'];
    for (let i = 0; i < 300; i++) {
      const st = {
        ...base(),
        couple: { id: 'c', currency: pick(['USD', 'THB', 'RUB', 'JPY', 'EUR', 'KZT', 'XYZ', undefined]), solo: rnd() < 0.3 },
        members: base().members.slice(0, Math.floor(rnd() * 3)),
        monthlyIncome: pick([0, 1000, '500', null, -100, 'abc']),
        incomeEntries: rnd() < 0.5 ? [] : [{ amount: pick(amounts) }],
        goals: rnd() < 0.5 ? [] : [{ id: 1, name: pick(['G', '']), current_amount: pick(amounts), target_amount: pick(['100', 50, '0']) }],
        expenses: Array.from({ length: Math.floor(rnd() * 8) }, () => exp({
          amount: pick(amounts), split: pick(['equal', 'full_payer', undefined]), paid_by: pick([A, B, null, 'x']),
          category_id: pick(['g', 'h', 'zz', null]), description: pick(['', 'x', null]),
          goal_contributions: rnd() < 0.2 ? [{ goal_id: 1 }] : [],
        })),
      };
      const s = buildWidgetSnapshot(st, NOW);
      const errs = swiftDecodeErrors(roundtrip(s));
      if (errs.length) {
        dump(`fuzz-fail-${i}`, s);
        throw new Error(`state #${i} не декодируется Swift: ${errs.join(', ')}\n${JSON.stringify(st.expenses.map((e) => e.amount))}`);
      }
      if (i < 20) dump(`fuzz-${i}`, s);
    }
  });
});

describe('syncWidgets / clearWidgets', () => {
  const live = () => ({ ...base(), couple: { id: 'c', currency: 'USD' }, expenses: [exp({ amount: '10' })] });

  it('web — ничего не шлёт', async () => {
    setState(live());
    await syncWidgets();
    expect(setWidgetData).not.toHaveBeenCalled();
  });

  it('iOS: шлёт снимок; одинаковый (кроме updatedAt) не дублирует; изменение — шлёт', async () => {
    native.on = true;
    await clearWidgets(); // сброс lastJson
    setWidgetData.mockClear();
    setState(live());
    await syncWidgets();
    expect(setWidgetData).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(setWidgetData.mock.calls[0][0].json);
    expect(sent.updatedAt).toBe(NOW.getTime());
    vi.setSystemTime(NOW.getTime() + 60_000);
    await syncWidgets();
    expect(setWidgetData).toHaveBeenCalledTimes(1);
    setState({ expenses: [exp({ amount: '20' })] });
    await syncWidgets();
    expect(setWidgetData).toHaveBeenCalledTimes(2);
  });

  it('BUG: снимок null (выход из пары / смена месяца / прошлый месяц) не очищает виджет', async () => {
    native.on = true;
    await clearWidgets();
    setWidgetData.mockClear();
    setState(live());
    await syncWidgets();
    expect(setWidgetData).toHaveBeenCalledTimes(1);
    setState({ couple: null }); // покинули пару / удалили пару — без SIGNED_OUT
    await syncWidgets();
    expect(setWidgetData).toHaveBeenCalledTimes(1); // ничего не отправлено → виджет показывает данные старой пары
  });

  it('clearWidgets: шлёт пустую строку и сбрасывает дедуп', async () => {
    native.on = true;
    setState(live());
    await syncWidgets();
    setWidgetData.mockClear();
    await clearWidgets();
    expect(setWidgetData).toHaveBeenCalledWith({ json: '' });
    await syncWidgets();
    expect(setWidgetData).toHaveBeenCalledTimes(2); // после очистки тот же снимок снова уходит
  });

  it('ошибка плагина (старая сборка) не пробрасывается, но дедуп запоминает снимок', async () => {
    native.on = true;
    await clearWidgets();
    setWidgetData.mockClear();
    setWidgetData.mockRejectedValueOnce(new Error('not implemented'));
    setState({ ...live(), expenses: [exp({ amount: '77' })] });
    await expect(syncWidgets()).resolves.toBeUndefined();
    await syncWidgets();
    expect(setWidgetData).toHaveBeenCalledTimes(1); // повтор после ошибки не делается
  });
});

afterEach(() => {
  if (DUMP && dumped.length) writeFileSync(`${DUMP}/_index.txt`, dumped.join('\n'));
});

// Фикстуры для визуального стенда (рендер SwiftUI-вьюх виджетов на macOS): только при QA_WIDGET_DUMP
describe.runIf(!!process.env.QA_WIDGET_DUMP)('render fixtures', () => {
  const cats = [
    { id: 'h', name: 'Жильё', color: '#7F77DD' }, { id: 'g', name: 'Продукты', color: '#EF9F27' },
    { id: 'r', name: 'Рестораны', color: '#E24B4A' }, { id: 't', name: 'Транспорт', color: '#378ADD' },
    { id: 'l', name: 'Очень длинная пользовательская категория для подарков родственникам', color: '#1D9E75' },
    { id: 'x', name: 'Подписки', color: '#D4537E' },
  ];
  const typical = (o = {}) => ({
    ...base(), categories: cats, monthlyIncome: 40000, incomeEntries: [{ amount: 40000 }],
    goals: [{ id: 'g1', name: 'Bali trip', current_amount: 18000, target_amount: 60000 }],
    expenses: [
      exp({ amount: '12000', category_id: 'h', split: 'equal', description: 'Rent' }),
      exp({ amount: '7300', category_id: 'g' }), exp({ amount: '4100', category_id: 'r', paid_by: B }),
      exp({ amount: '2050', category_id: 't', paid_by: B }), exp({ amount: '620', category_id: 'g', expense_date: '2026-10-15', description: 'Tops Kamala', created_at: '2026-10-15T11:00:00Z' }),
      exp({ amount: '2000', category_id: 'x', goal_contributions: [{ goal_id: 'g1' }] }),
    ],
    ...o,
  });
  it('dump', () => {
    dump('R-en-typical', buildWidgetSnapshot(typical(), NOW));
    ls.set('ce_lang', 'ru');
    dump('R-ru-typical', buildWidgetSnapshot(typical(), NOW));
    const huge = typical({
      members: [{ id: A, display_name: 'Александра-Виктория Константинопольская' }, { id: B, display_name: 'Максимилиан Ааааааааааааааа' }],
      monthlyIncome: 99999999.99, incomeEntries: [],
      goals: [{ id: 'g1', name: 'Квартира в Бангкоке с видом на реку и бассейном на крыше', current_amount: 9876543.21, target_amount: 99999999 }],
      expenses: typical().expenses.map((x) => ({ ...x, amount: String(Number(x.amount) * 1028.7), description: 'Очень длинное описание последнего расхода в магазине у дома' })),
    });
    dump('R-ru-huge-long', buildWidgetSnapshot(huge, NOW));
    dump('R-ru-overspend', buildWidgetSnapshot(typical({ monthlyIncome: 20000, incomeEntries: [{ amount: 20000 }] }), NOW));
    dump('R-ru-solo-noincome', buildWidgetSnapshot(typical({ couple: { id: 'c', currency: 'RUB', solo: true }, members: [base().members[0]], monthlyIncome: 0, incomeEntries: [], goals: [] }), NOW));
    dump('R-ru-partner-missing', buildWidgetSnapshot(typical({ members: [base().members[0]], expenses: typical().expenses.filter((x) => x.paid_by === A) }), NOW));
    ls.delete('ce_lang');
    dump('R-en-huge-usd', buildWidgetSnapshot({ ...huge, couple: { id: 'c', currency: 'USD' } }, NOW));
    dump('R-en-empty', buildWidgetSnapshot({ ...base(), monthlyIncome: 1000 }, NOW));
  });
});
