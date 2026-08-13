import { dateLocale, dayShort, getLang, monthName, monthShort, t } from './i18n.js';

// ---- Currency formatting ----
// Основные мировые валюты: [символ, название для выбора в настройках]
// Русские названия — источник истины; для en берём Intl.DisplayNames (см. currencyName)
export const CURRENCIES = {
  THB: ['฿', 'Тайский бат'],
  RUB: ['₽', 'Российский рубль'],
  USD: ['$', 'Доллар США'],
  EUR: ['€', 'Евро'],
  GBP: ['£', 'Фунт стерлингов'],
  JPY: ['¥', 'Японская иена'],
  CNY: ['¥', 'Китайский юань'],
  CHF: ['₣', 'Швейцарский франк'],
  AED: ['AED', 'Дирхам ОАЭ'],
  TRY: ['₺', 'Турецкая лира'],
  KZT: ['₸', 'Казахстанский тенге'],
  UAH: ['₴', 'Украинская гривна'],
  BYN: ['Br', 'Белорусский рубль'],
  AMD: ['֏', 'Армянский драм'],
  GEL: ['₾', 'Грузинский лари'],
  RSD: ['дин', 'Сербский динар'],
  INR: ['₹', 'Индийская рупия'],
  KRW: ['₩', 'Южнокорейская вона'],
  VND: ['₫', 'Вьетнамский донг'],
  IDR: ['Rp', 'Индонезийская рупия'],
  MYR: ['RM', 'Малайзийский ринггит'],
  PHP: ['₱', 'Филиппинское песо'],
  SGD: ['S$', 'Сингапурский доллар'],
  HKD: ['HK$', 'Гонконгский доллар'],
  AUD: ['A$', 'Австралийский доллар'],
  CAD: ['C$', 'Канадский доллар'],
  NZD: ['NZ$', 'Новозеландский доллар'],
  SEK: ['kr', 'Шведская крона'],
  NOK: ['kr', 'Норвежская крона'],
  DKK: ['kr', 'Датская крона'],
  PLN: ['zł', 'Польский злотый'],
  CZK: ['Kč', 'Чешская крона'],
  ILS: ['₪', 'Израильский шекель'],
  BRL: ['R$', 'Бразильский реал'],
  MXN: ['MX$', 'Мексиканское песо'],
  ARS: ['AR$', 'Аргентинское песо'],
  EGP: ['E£', 'Египетский фунт'],
  ZAR: ['R', 'Южноафриканский рэнд'],
};

// Валюты без копеечных долей — округляем целиком
const zeroDecimal = new Set(['JPY', 'KRW', 'VND', 'IDR', 'THB', 'RUB', 'KZT', 'AMD']);
const formatterCache = {};

function getFormatter(currency) {
  const key = `${dateLocale()}:${currency}`;
  if (!formatterCache[key]) {
    const digits = zeroDecimal.has(currency) ? 0 : 2;
    let fmt;
    try {
      // style:'currency' сам ставит символ по правилам локали: en-US даёт «$1,234.00»,
      // ru-RU — «1 234 ₽». Раньше символ всегда клеился справа, и в английском UI
      // суммы выглядели как «128.4 $».
      fmt = new Intl.NumberFormat(dateLocale(), {
        style: 'currency',
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    } catch {
      // Неизвестный ISO-код валюты Intl отвергает — падаем на число без символа
      fmt = new Intl.NumberFormat(dateLocale(), { style: 'decimal', maximumFractionDigits: digits });
    }
    formatterCache[key] = fmt;
  }
  return formatterCache[key];
}

let currencyDisplayNames = null;

/** Название валюты для UI: ru — из словаря CURRENCIES, en — через Intl.DisplayNames. */
export function currencyName(code) {
  const ruName = CURRENCIES[code]?.[1] || code;
  if (getLang() !== 'en') return ruName;
  try {
    if (!currencyDisplayNames) {
      currencyDisplayNames = new Intl.DisplayNames(['en'], { type: 'currency' });
    }
    return currencyDisplayNames.of(code) || ruName;
  } catch {
    return ruName;
  }
}

export function formatMoney(amount, currency = 'USD') {
  const sym = CURRENCIES[currency]?.[0] || currency;
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(value)) return `— ${sym}`;
  // Округление до целых съедало центы; форматтер сам знает, у каких валют дробной части нет
  return getFormatter(currency).format(value);
}

// Шаги быстрого ввода суммы. У валют без копеечной части (бат, рубль, иена) единица
// мелкая — там осмысленны сотни; для доллара и евро «+1000» было бы абсурдом.
export function quickAmounts(currency = 'USD') {
  return zeroDecimal.has(currency) ? [100, 500, 1000] : [10, 25, 50];
}

// ---- Date helpers ----
// Имена месяцев/дней недели живут в i18n.js и переключаются вместе с языком.

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonth(monthStr) {
  const [y, m] = monthStr.split('-');
  return `${monthName(parseInt(m) - 1)} ${y}`;
}

export function prevMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function nextMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d.getTime() === today.getTime()) return t('date.today');
  if (d.getTime() === yesterday.getTime()) return t('date.yesterday');
  const num = d.getDate();
  const mon = monthShort(d.getMonth());
  const weekday = dayShort(d.getDay());
  // В английском месяц идёт перед числом: «Apr 1, Thu», а не «1 Apr, Thu»
  return getLang() === 'en' ? `${mon} ${num}, ${weekday}` : `${num} ${mon}, ${weekday}`;
}

/** Calendar date on each transaction row (DD.MM.YYYY). */
/** Localized date+time for income log / analytics. */
export function formatDateTime(isoStr) {
  if (isoStr == null || isoStr === '') return '—';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(dateLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Дата в строке расхода. Порядок частей берём у локали: 31.03.2026 в русском UI
// и 03/31/2026 в английском — иначе американец читает «04.03.2026» как 3 апреля.
function rowDate(d) {
  return d.toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatExpenseDateRow(dateStr) {
  if (dateStr == null || dateStr === '') return '';
  if (dateStr instanceof Date && !Number.isNaN(dateStr.getTime())) return rowDate(dateStr);
  const raw = String(dateStr);
  const iso = raw.slice(0, 10);
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return rowDate(d);
}

// Локальная дата, а не UTC: в UTC+7 после полуночи и в UTC-5 вечером
// toISOString() отдавал соседний день, и расход уезжал в чужой месяц
export function todayStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function groupByDate(expenses) {
  const groups = {};
  for (const exp of expenses) {
    const key = exp.expense_date;
    if (!groups[key]) groups[key] = [];
    groups[key].push(exp);
  }
  return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
}

export function pct(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function safeColor(value, fallback = '#888780') {
  return /^#[0-9a-fA-F]{3,8}$/.test(value || '') ? value : fallback;
}

// ---- SVG Icons ----
const iconPaths = {
  'shopping-cart': '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  'utensils': '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
  'home': '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  'car': '<path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  'heart': '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  'gamepad': '<line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
  'shirt': '<path d="M20.38 3.46L16 2 13.5 4.5L12 3 10.5 4.5 8 2 3.62 3.46a2 2 0 0 0-1.34 1.63L2 8l5 2 .5 9.5a2 2 0 0 0 2 1.5h5a2 2 0 0 0 2-1.5L17 10l5-2-.28-2.91a2 2 0 0 0-1.34-1.63z"/>',
  'credit-card': '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  'more-horizontal': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'coffee': '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
  'plane': '<path d="M17.8 19.2 16 11l3.5-3.5a2.12 2.12 0 0 0-3-3L13 8 4.8 6.2a1 1 0 0 0-.9 1.7L9 11l-2 4-3-1v2l4 2 2 4h2l-1-3 4-2 3.1 5.1a1 1 0 0 0 1.7-.9z"/>',
  'gift': '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  'book': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  'dumbbell': '<path d="m6.5 6.5 11 11"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/><path d="m2 6 4-4"/><path d="m3 10 7-7"/><path d="m14 21 7-7"/>',
  'paw': '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10z"/>',
  'scissors': '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  'wrench': '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  'graduation': '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  'fuel': '<line x1="3" y1="22" x2="15" y2="22"/><line x1="4" y1="9" x2="14" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
  'pill': '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  'smartphone': '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  'baby': '<path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"/><path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5.5 5 1.5"/>',
  'umbrella': '<path d="M22 12a10.06 10.06 1 0 0-20 0Z"/><path d="M12 12v8a2 2 0 0 0 4 0"/><path d="M12 2v1"/>',
  'sparkles': '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
  'plus': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  'target': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'pie-chart': '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  'calendar': '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  'user': '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  'trash-2': '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'check': '<polyline points="20 6 9 17 4 12"/>',
  'x': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'bell': '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  'moon': '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  'lock': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'globe': '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  'copy': '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'trending-up': '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  'trending-down': '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>',
};

export const availableIcons = Object.keys(iconPaths);

// Иконки, подходящие категориям расходов: без служебных (стрелки, галочки, настройки)
export const categoryIcons = [
  'shopping-cart', 'utensils', 'coffee', 'home', 'car', 'fuel', 'plane',
  'heart', 'pill', 'dumbbell', 'gamepad', 'shirt', 'scissors', 'sparkles',
  'gift', 'book', 'graduation', 'baby', 'paw', 'wrench', 'smartphone',
  'credit-card', 'umbrella', 'calendar', 'target', 'more-horizontal',
];

export function icon(name, size = 20, color = 'currentColor') {
  const paths = iconPaths[name] || iconPaths['more-horizontal'];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

// ---- DOM helpers ----
export function $(selector, parent = document) {
  return parent.querySelector(selector);
}

export function $$(selector, parent = document) {
  return [...parent.querySelectorAll(selector)];
}

export function html(tag, attrs = {}, children = '') {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'className') el.className = v;
    else el.setAttribute(k, v);
  }
  if (typeof children === 'string') el.innerHTML = children;
  else if (Array.isArray(children)) children.forEach(c => c && el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  else if (children instanceof Node) el.appendChild(children);
  return el;
}
