// Разбор голосовой фразы в расход: «кофе 120», «вчера продукты в Тopsе 1 800 бат»,
// «taxi 250 yesterday shared». Распознаёт речь iOS (VoiceInput.swift), здесь — только смысл.
import { guessCategoryId } from './slips.js';

const UNITS = {
  ноль: 0, один: 1, одна: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9,
  десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16,
  семнадцать: 17, восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50,
  шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100, двести: 200, триста: 300, четыреста: 400,
  пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900, полторы: 1.5, полтора: 1.5,
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, a: null, and: null,
};
const SCALES = { сотня: 100, hundred: 100, тысяча: 1000, тысячи: 1000, тысяч: 1000, тыща: 1000, тыщи: 1000, тыщ: 1000, thousand: 1000 };
// «2k» / «2к» разбирает parseNumberToken; отдельное «к» — это предлог («подарок к дню рождения»)

const CURRENCY = /^(฿|\$|€|₽|thb|бат(а|ов|ы)?|baht|bahts|доллар(а|ов)?|бакс(а|ов)?|dollars?|bucks?|евро|euros?|руб(ль|ля|лей)?|рублей|usd|eur|rub)$/i;
const DAY_WORDS = { сегодня: 0, today: 0, вчера: -1, yesterday: -1, позавчера: -2 };
const SHARED = /^(общее|общий|общая|общие|вместе|пополам|shared|together|split)$/i;
const PERSONAL = /^(личное|личный|личная|моё|мое|мой|personal|mine)$/i;
const FILLER = /^(за|на|в|во|из|для|и|потратил|потратила|потратили|заплатил|заплатила|заплатили|купил|купила|купили|расход|for|on|at|in|spent|paid|bought|the|a|an|of)$/i;

// Ключевые слова, которых нет в подсказках слипов (те — про названия магазинов).
// \w в JS не ловит кириллицу — окончания перечисляем явно
const VOICE_HINTS = [
  ['Groceries', /^(продукт[а-яёa-z]*|магазин[а-яёa-z]*|супермаркет[а-яёa-z]*|еда|grocer[а-яёa-z]*|food|market)$/i],
  ['Restaurants', /^(кофе|кофейн[а-яёa-z]*|каф[а-яёa-z]*|ресторан[а-яёa-z]*|обед[а-яёa-z]*|ужин[а-яёa-z]*|завтрак[а-яёa-z]*|доставк[а-яёa-z]*|пицц[а-яёa-z]*|суши|бар[а-яёa-z]*|coffee|lunch|dinner|breakfast|restaurant|cafe|takeout|delivery)$/i],
  ['Transport', /^(такси|бензин[а-яёa-z]*|топлив[а-яёa-z]*|байк[а-яёa-z]*|скутер[а-яёa-z]*|автобус[а-яёa-z]*|метро|парковк[а-яёa-z]*|grab[а-яёa-z]*|bolt|taxi|gas|fuel|bus|parking|scooter)$/i],
  ['Housing', /^(аренд[а-яёa-z]*|квартир[а-яёa-z]*|жиль[а-яёa-z]*|кондо|свет|электричеств[а-яёa-z]*|вод[а-яёa-z]*|коммунал[а-яёa-z]*|rent|apartment|condo|electricity|water|utilities)$/i],
  ['Health', /^(аптек[а-яёa-z]*|лекарств[а-яёa-z]*|врач[а-яёa-z]*|доктор[а-яёa-z]*|клиник[а-яёa-z]*|больниц[а-яёa-z]*|pharmacy|medicine|doctor|clinic|hospital)$/i],
  ['Entertainment', /^(кино|массаж[а-яёa-z]*|концерт[а-яёa-z]*|игр[а-яёa-z]*|cinema|movies?|massage|concert|games?)$/i],
  ['Clothing', /^(одежд[а-яёa-z]*|обув[а-яёa-z]*|кроссовк[а-яёa-z]*|clothes|shoes|clothing)$/i],
  ['Subscriptions', /^(подписк[а-яёa-z]*|netflix|spotify|youtube|subscription)$/i],
];

function wordsToNumber(tokens) {
  // tokens — подряд идущие числительные; «две тысячи пятьсот» → 2500, «полторы тысячи» → 1500
  let total = 0, current = 0, used = false;
  for (const w of tokens) {
    const lw = w.toLowerCase();
    if (lw in SCALES) {
      const scale = SCALES[lw];
      total += (current || 1) * scale;
      current = 0;
      used = true;
    } else if (UNITS[lw] != null) {
      current += UNITS[lw];
      used = true;
    }
  }
  return used ? total + current : null;
}

const isNumWord = (w) => { const lw = w.toLowerCase(); return lw in SCALES || (lw in UNITS && UNITS[lw] != null); };

function parseNumberToken(tok) {
  // «1 800», «1,800», «1800,50», «4.50», «2k»
  const t = tok.replace(/[฿$€₽]/g, '');
  const k = t.match(/^(\d+(?:[.,]\d+)?)[kк]$/i);
  if (k) return Number(k[1].replace(',', '.')) * 1000;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (/^\d+([.,]\d{1,2})?$/.test(t)) return Number(t.replace(',', '.'));
  return null;
}

export function parseVoiceExpense(text, { categories = [], labelOf = (n) => n, now = new Date() } = {}) {
  const src = String(text || '')
    .replace(/(\d)\s+(?=\d{3}\b)/g, '$1') // «1 800» → «1800»
    .replace(/(\d)([฿$€₽])/g, '$1 $2').replace(/([฿$€₽])(\d)/g, '$1 $2');
  const tokens = src.split(/\s+/).map((w) => w.replace(/^[«"“(]+|[»"”).!?,:;]+$/g, '')).filter(Boolean);

  let amount = null;
  let dayShift = 0;
  let payer = null;
  const rest = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    const lw = w.toLowerCase();
    if (amount == null && parseNumberToken(w) != null) { amount = parseNumberToken(w); continue; }
    if (amount == null && isNumWord(w) && !(lw === 'a' || lw === 'and')) {
      let j = i;
      while (j < tokens.length && (isNumWord(tokens[j]) || /^(a|and|и)$/i.test(tokens[j]))) j++;
      const n = wordsToNumber(tokens.slice(i, j));
      if (n) { amount = n; i = j - 1; continue; }
    }
    if (lw in DAY_WORDS) { dayShift = DAY_WORDS[lw]; continue; }
    if (SHARED.test(lw)) { payer = 'shared'; continue; }
    if (PERSONAL.test(lw)) { payer = 'me'; continue; }
    if (CURRENCY.test(lw)) continue;
    rest.push(w);
  }
  // «позавчера» и «day before yesterday»
  const joined = rest.join(' ');
  let words = rest;
  if (/day before yesterday/i.test(joined)) {
    dayShift = -2;
    words = joined.replace(/day before yesterday/i, '').split(/\s+/).filter(Boolean);
  }
  while (words.length && FILLER.test(words[0])) words.shift();
  while (words.length && FILLER.test(words[words.length - 1])) words.pop();
  const description = words.join(' ').replace(/\s+/g, ' ').trim();

  const hint = VOICE_HINTS.find(([, re]) => words.some((w) => re.test(w)))?.[0];
  let categoryId = null;
  if (hint) {
    categoryId = categories.find((c) => c.name === hint || labelOf(c.name) === labelOf(hint))?.id || null;
  }
  if (!categoryId) categoryId = guessCategoryId(description, categories, labelOf);

  const d = new Date(now);
  d.setDate(d.getDate() + dayShift);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  return {
    amount: amount && amount > 0 ? Math.round(amount * 100) / 100 : null,
    description: description ? description[0].toUpperCase() + description.slice(1) : '',
    categoryId,
    date,
    payer,
  };
}
