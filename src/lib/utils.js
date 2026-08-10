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
    formatterCache[key] = new Intl.NumberFormat(dateLocale(), {
      style: 'decimal',
      maximumFractionDigits: zeroDecimal.has(currency) ? 0 : 2,
    });
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

export function formatMoney(amount, currency = 'THB') {
  const sym = CURRENCIES[currency]?.[0] || currency;
  return `${getFormatter(currency).format(Math.round(amount))} ${sym}`;
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
  return `${d.getDate()} ${monthShort(d.getMonth())}, ${dayShort(d.getDay())}`;
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

export function formatExpenseDateRow(dateStr) {
  if (dateStr == null || dateStr === '') return '';
  if (dateStr instanceof Date && !Number.isNaN(dateStr.getTime())) {
    const d = dateStr;
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  }
  const raw = String(dateStr);
  const iso = raw.slice(0, 10);
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
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
  'globe': '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  'copy': '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'trending-up': '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  'trending-down': '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>',
};

export const availableIcons = Object.keys(iconPaths);

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
