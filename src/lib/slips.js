// Разбор тайских платёжных слипов и PromptPay QR.
// Нативная часть (SlipScanner) отдаёт сырой результат Apple Vision: строки текста с
// координатами (доли кадра, y сверху вниз) и содержимое QR-кодов. Всё понимание —
// здесь, чтобы его можно было проверить тестами на реальных слипах.

// ---- EMVCo TLV (PromptPay QR и QR проверки слипа устроены одинаково) ----

export function parseTlv(str) {
  const out = [];
  let i = 0;
  while (i + 4 <= str.length) {
    const id = str.slice(i, i + 2);
    const lenRaw = str.slice(i + 2, i + 4);
    const len = Number(lenRaw);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lenRaw) || i + 4 + len > str.length) return null;
    out.push({ id, value: str.slice(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return i === str.length ? out : null;
}

// CRC16-CCITT (0x1021, начальное 0xFFFF) — контрольная сумма EMVCo, тег 63
// Считаем по байтам UTF-8: в QR с тайским названием магазина символы многобайтные
export function crc16(str) {
  let crc = 0xffff;
  const bytes = new TextEncoder().encode(str);
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tag = (tlv, id) => tlv?.find((x) => x.id === id)?.value ?? null;

// QR оплаты на кассе / перевода (Thai QR Payment). Сумма есть только в динамических кодах.
export function parsePromptPayQr(payload) {
  const raw = String(payload || '').trim();
  if (!raw.startsWith('000201')) return null;
  const tlv = parseTlv(raw);
  if (!tlv) return null;
  const crcTag = tag(tlv, '63');
  const crcOk = crcTag ? crc16(raw.slice(0, raw.length - 4)) === crcTag.toUpperCase() : false;
  const currency = tag(tlv, '53');
  const amountRaw = tag(tlv, '54');
  const amount = amountRaw && /^\d+(\.\d{1,2})?$/.test(amountRaw) ? Number(amountRaw) : null;
  // 29 — PromptPay перевод (01 телефон, 02 ID, 03 e-wallet), 30 — оплата счёта
  const credit = parseTlv(tag(tlv, '29') || '') || [];
  const bill = parseTlv(tag(tlv, '30') || '') || [];
  let target = null;
  if (tag(credit, '01')) target = { type: 'phone', id: tag(credit, '01') };
  else if (tag(credit, '02')) target = { type: 'national_id', id: tag(credit, '02') };
  else if (tag(credit, '03')) target = { type: 'ewallet', id: tag(credit, '03') };
  else if (tag(bill, '01')) target = { type: 'biller', id: tag(bill, '01'), ref: tag(bill, '02') };
  return {
    kind: 'promptpay',
    crcOk,
    amount: amount && amount > 0 ? amount : null,
    currency: currency === '764' ? 'THB' : currency,
    merchant: tag(tlv, '59') ? tidyName(tag(tlv, '59')) : null,
    city: tag(tlv, '60'),
    target,
  };
}

// Мини-QR проверки на слипе (стандарт Банка Таиланда): код банка-отправителя и номер транзакции.
// Номер транзакции уникален — по нему не даём добавить один слип дважды.
export function parseSlipVerifyQr(payload) {
  const raw = String(payload || '').trim();
  const tlv = parseTlv(raw);
  if (!tlv || tag(tlv, '51') !== 'TH') return null;
  const inner = parseTlv(tag(tlv, '00') || '');
  const transRef = tag(inner, '02');
  if (!inner || tag(inner, '00') !== '000001' || !transRef) return null;
  return { bankCode: tag(inner, '01'), transRef };
}

// ---- OCR слипа ----

const MONTHS_EN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// Тайские сокращения месяцев без точек и пробелов (OCR их теряет)
const MONTHS_TH = { มค: 1, กพ: 2, มีค: 3, เมย: 4, พค: 5, มิย: 6, กค: 7, สค: 8, กย: 9, ตค: 10, พย: 11, ธค: 12 };
// Полные тайские названия месяцев
const MONTHS_TH_FULL = { มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6, กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12 };
// Тайские цифры ๐-๙ → 0-9
const thaiDigits = (s) => String(s).replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0e50));

const PROVIDERS = [
  ['TrueMoney', /true\s*money/i],
  ['K PLUS', /k\s*plus|kasikorn|กสิกร/i],
  ['SCB', /\bscb\b|ไทยพาณิชย์/i],
  ['Krungthai', /krungthai|กรุงไทย/i],
  ['Bangkok Bank', /bangkok\s*bank|ธนาคารกรุงเทพ|bualuang/i],
  ['Krungsri', /krungsri|กรุงศรี/i],
  ['ttb', /\bttb\b|ทีทีบี/i],
  ['GSB', /\bgsb\b|ออมสิน/i],
  ['UOB', /\buob\b/i],
  ['ShopeePay', /shopee\s*pay/i],
  ['LINE BK', /line\s*bk/i],
];

const TOTAL_LABEL = /grand\s*total|net\s*total|total\s*amount|amount\s*due|total\s*due|^net\b|\bnet\s*(amount|pay)|รวมทั้งสิ้น|ยอดรวมสุทธิ|ยอดสุทธิ|ยอดที่ต้องชำระ/i;
const AMOUNT_LABEL = /amount|(?<!sub\s?-?)total|จำนวนเงิน|จำนวน|ยอดเงิน|ยอดชำระ|ยอดโอน|รวม/i;
const NOT_AMOUNT = /fee|ค่าธรรมเนียม|balance|คงเหลือ|available|cash\s*back|discount|ส่วนลด|sub\s?-?total|ยอดก่อน|\bvat\b|ภาษี|service\s*charge|items?\b/i;
// Признак успешной оплаты; одних слов «transaction/reference» мало — так выглядят и брони, и чаты
const SUCCESS_WORDS = /success|completed|โอนเงินสำเร็จ|ชำระเงินสำเร็จ|สำเร็จ|paid\b|ชำระแล้ว/i;
// Входящий перевод — это не расход
const INCOMING = /\breceived\b|รับเงิน|เงินเข้า|you\s+got|incoming|^\+\s*[\d,]+/im;
const MONEY = /(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/;
// Маска имени («KAZ****») — не счёт; счёт — маска рядом с дефисом/цифрами или длинный номер
const ACCOUNTISH = /[xX*]{2,}[-_]|[-_][xX*]{2,}|[xX*]{3}-|\d[xX*]+\d|\d{2,}[-_]\S*\d|\(\d{6,}\)|\b\d{9,}\b|account|wallet|บัญชี/i;

// Склеиваем строки одной «линии» слипа (подпись слева, значение справа)
export function toRows(lines) {
  const sorted = [...(lines || [])].filter((l) => l?.t).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const l of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - l.y) < Math.max(0.012, Math.min(row.h, l.h) * 0.5)) {
      row.items.push(l);
      row.h = Math.max(row.h, l.h);
    } else {
      rows.push({ y: l.y, h: l.h, items: [l] });
    }
  }
  return rows.map((r) => {
    const items = r.items.sort((a, b) => a.x - b.x);
    return { y: r.y, h: r.h, x: items[0].x, items, text: items.map((i) => i.t).join(' ').replace(/\s+/g, ' ').trim() };
  });
}

function moneyIn(text) {
  // OCR иногда разрывает тысячи пробелом («1 794.74»); время «14:22 500.00» склеивать нельзя
  const t = String(text).replace(/(?<![:.\d])(\d{1,3})\s+(?=\d{3}\.\d{2}(?!\d))/g, '$1');
  const m = t.match(MONEY);
  if (m) return Number(m[1].replace(/,/g, '') + '.' + m[2]);
  // Целая сумма рядом с валютой: «฿ 50», «1,200 THB»
  const c = t.match(/(?:฿|THB|baht|บาท)\s*((?:\d{1,3}(?:,\d{3})+|\d+))(?![\d.,])|(?<![\d.,:])((?:\d{1,3}(?:,\d{3})+|\d+))\s*(?:฿|THB|baht|บาท)/i);
  const v = c && (c[1] || c[2]);
  return v ? Number(v.replace(/,/g, '')) : null;
}

function findAmount(rows) {
  // 1. Строка с подписью «Grand total», затем «Amount / จำนวนเงิน» — значение в той же или следующей строке
  for (const label of [TOTAL_LABEL, AMOUNT_LABEL]) {
    const v = amountByLabel(rows, label);
    if (v) return v;
  }
  return amountByLook(rows);
}

function amountByLabel(rows, label) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!label.test(r.text) || NOT_AMOUNT.test(r.text) || /unit\s*price|ราคาต่อหน่วย/i.test(r.text)) continue;
    const same = moneyIn(r.text);
    if (same) return same;
    const next = rows[i + 1];
    if (next && !NOT_AMOUNT.test(next.text)) {
      const v = moneyIn(next.text);
      if (v) return v;
    }
  }
  return null;
}

function amountByLook(rows) {
  // 2. Самая крупная сумма с ฿ / THB / บาท (заголовок слипа)
  const afterNot = (r) => { const i = rows.indexOf(r); return i > 0 && NOT_AMOUNT.test(rows[i - 1].text) && !moneyIn(rows[i - 1].text); };
  const withCurrency = rows
    .filter((r) => /฿|THB|บาท|baht/i.test(r.text) && !NOT_AMOUNT.test(r.text) && !afterNot(r) && moneyIn(r.text))
    .sort((a, b) => b.h - a.h);
  if (withCurrency.length) return moneyIn(withCurrency[0].text);
  // 3. Самая крупная строка, похожая на сумму
  const any = rows.filter((r) => !NOT_AMOUNT.test(r.text) && !afterNot(r) && /^[฿\s]*[\d,]+\.\d{2}\b/.test(r.text)).sort((a, b) => b.h - a.h);
  // Экран баланса: крупная сумма под «Available balance» — не платёж
  return any.length ? moneyIn(any[0].text) : null;
}

function resolveYear(y, thaiMonth, now) {
  const n = Number(y);
  if (y.length === 4) return n > 2400 ? n - 543 : n;
  const nowY = now.getFullYear();
  const ce = 2000 + n;
  const be = 2500 + n - 543;
  if (thaiMonth) return be;
  return Math.abs(ce - nowY) <= Math.abs(be - nowY) ? ce : be;
}

const pad = (n) => String(n).padStart(2, '0');
const to24 = (h, ampm) => {
  const m = String(ampm || '').toLowerCase();
  if (m === 'pm' && h < 12) return h + 12;
  if (m === 'am' && h === 12) return 0;
  return h;
};

export function findDateTime(rows, now = new Date()) {
  // Сначала строки с подписью «Date / วันที่» (но не «Due date»), потом любые
  const labeled = rows.filter((r) => /date|วันที่/i.test(r.text) && !/due|ครบกำหนด/i.test(r.text));
  return dateIn(labeled, now) || dateIn(rows, now) || { date: null, time: null };
}

function dateIn(rows, now) {
  for (const r of rows) {
    const text = thaiDigits(r.text);
    const time = text.match(/\b(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\b(?!\.\d)\s*(am|pm|น\.)?/i);
    let d = null;
    const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) d = { day: +iso[3], month: +iso[2], year: resolveYear(iso[1], false, now) };
    // «Oct 28, 2026» — месяц первым
    const mf = !d && text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
    if (mf) d = { day: +mf[2], month: MONTHS_EN[mf[1].toLowerCase()], year: resolveYear(mf[3], false, now) };
    const full = !d && text.match(/(\d{1,2})\s*([ก-๙]{5,})\s*(\d{4}|\d{2})\b(?![:.]\d)/);
    if (full && MONTHS_TH_FULL[full[2]]) d = { day: +full[1], month: MONTHS_TH_FULL[full[2]], year: resolveYear(full[3], true, now) };
    // Двузначный год не должен оказаться часами: «5 May, 14:30» — без года
    const en = d ? null : text.match(/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4}|\d{2})\b(?![:.]\d)/i);
    if (en) d = { day: +en[1], month: MONTHS_EN[en[2].toLowerCase()], year: resolveYear(en[3], false, now) };
    if (!d) {
      const th = text.match(/(\d{1,2})\s*((?:[ก-๙]\s*\.?\s*){2,4})\s*(\d{4}|\d{2})\b(?![:.]\d)/);
      const key = th?.[2].replace(/[\s.]/g, '');
      if (th && MONTHS_TH[key]) d = { day: +th[1], month: MONTHS_TH[key], year: resolveYear(th[3], true, now) };
    }
    if (!d) {
      const num = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/);
      if (num && +num[2] >= 1 && +num[2] <= 12) d = { day: +num[1], month: +num[2], year: resolveYear(num[3], false, now) };
    }
    // Несуществующие даты (31/02) отбрасываем: проверяем, что Date не «перескочил» месяц
    const real = d && d.month && new Date(d.year, d.month - 1, d.day).getMonth() === d.month - 1 && d.day >= 1;
    if (real) {
      return {
        date: `${d.year}-${pad(d.month)}-${pad(d.day)}`,
        time: time && +time[1] < 24 ? `${pad(to24(+time[1], time[4]))}:${time[2]}` : null,
      };
    }
  }
  return null;
}

const PROVIDER_ANY = new RegExp(PROVIDERS.map(([, re]) => re.source).join('|'), 'i');
const LABELISH = /date|time|reference|ref\.|merchant id|transaction|amount|fee|location|scan|qr|completed|success|สำเร็จ|วันที่|เวลา|จำนวน|ค่าธรรมเนียม|รหัส|เลขที่|promptpay|พร้อมเพย์|from|to\b|จาก|ไปยัง|ถึง/i;

function isPartyName(text) {
  if (!/[A-Za-zก-๙]{2}/.test(text)) return false;
  if (ACCOUNTISH.test(text) || MONEY.test(text) || LABELISH.test(text)) return false;
  // Название банка — подпись под именем, а не участник
  if ((PROVIDER_ANY.test(text) && text.length < 25) || /^ธ\.|ธนาคาร|\bbank$/i.test(text)) return false;
  return true;
}

export function tidyName(name) {
  let s = String(name || '')
    .replace(/[*＊]+|\s\*(\s\*)*/g, ' ')
    .replace(/^[A-Z0-9]+-C2B\s+/, '') // «TOPS-C2B Tops Kamala» → «Tops Kamala»
    .replace(/^(mr|mrs|ms|miss|นาย|นางสาว|นาง|น\.ส\.)\.?\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Маскированный хвост фамилии («K* * *» → «K») — одиночная буква не несёт смысла
  s = s.replace(/\s+[A-Za-z]$/, '').trim();
  if (s && s === s.toUpperCase() && /[A-Z]/.test(s)) {
    // Короткие аббревиатуры (KFC, SCB, H&M) оставляем; после апострофа заглавную не ставим (McDonald's)
    s = s.split(' ').map((w) => (/^[A-Z&]{2,3}$/.test(w) ? w
      : w.toLowerCase().replace(/(^|-)([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/^Mc([a-z])/, (m, c) => `Mc${c.toUpperCase()}`))).join(' ');
  }
  return s;
}

function findParties(rows) {
  // Участник — строка с именем, под которой (в пределах двух строк) номер счёта или кошелька
  const parties = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!isPartyName(r.text)) continue;
    const below = rows.slice(i + 1, i + 3).map((x) => x.text).join(' ');
    if (ACCOUNTISH.test(below) || /promptpay|พร้อมเพย์|wallet|krungthai|kasikorn|scb|bank|ธนาคาร/i.test(below)) {
      parties.push({ text: r.text, isFrom: /\bfrom\b|จาก|ผู้โอน/i.test(below) || /\bfrom\b|จาก/i.test(rows[i - 1]?.text || '') });
    }
  }
  // Подписи «To / ไปยัง / ผู้รับ» — запасной путь
  const toIdx = rows.findIndex((r) => /^(to|ไปยัง|ถึง|ผู้รับ|receiver|recipient)\b/i.test(r.text));
  let receiver = parties[1]?.text || null;
  if (!receiver && toIdx >= 0) {
    const inline = rows[toIdx].text.replace(/^(to|ไปยัง|ถึง|ผู้รับ|receiver|recipient)\s*:?\s*/i, '');
    receiver = inline && isPartyName(inline) ? inline : rows.slice(toIdx + 1).find((r) => isPartyName(r.text))?.text || null;
  }
  // Единственный найденный участник — получатель, только если это не отправитель («From wallet»)
  if (!receiver && parties.length === 1 && !parties[0].isFrom) receiver = parties[0].text;
  return { sender: parties[0]?.text || null, receiver };
}

function findReference(rows) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!/reference|ref\.?\s*no|transaction id|รหัสอ้างอิง|เลขที่รายการ/i.test(r.text)) continue;
    const m = r.text.match(/([A-Z0-9]{8,})\s*$/i) || rows[i + 1]?.text.match(/^([A-Z0-9]{8,})$/i);
    if (m) return m[1];
  }
  return null;
}

const DOC_WORDS = /invoice|receipt|tax\s*invoice|bill\b|ใบเสร็จ|ใบแจ้งหนี้|ใบกำกับภาษี|ใบวางบิล/i;
const COMPANY = /co\.?,?\s*ltd|company\s+limited|limited|\bltd\b|บริษัท|บจก|ห้างหุ้นส่วน|หจก/i;

// Продавец на бумажном чеке/счёте: строка с «Co.,Ltd / บริษัท», иначе самая крупная строка сверху
function findVendor(rows) {
  const company = rows.find((r) => COMPANY.test(r.text) && !/account|name of bank/i.test(r.text));
  const pick = company?.items.find((i) => COMPANY.test(i.t))?.t || company?.text;
  if (pick) return pick.replace(/\(?(co\.?,?\s*ltd\.?|company\s+limited|limited|ltd\.?)\)?\.?/gi, '').replace(/^(บริษัท|บจก\.?)\s*/, '').replace(/\s*จำกัด.*$/, '').trim();
  const top = rows.filter((r) => r.y < 0.25 && !DOC_WORDS.test(r.text) && /[A-Za-zก-๙]{3}/.test(r.text) && !MONEY.test(r.text)
    && !/\d/.test(r.text) && !LABELISH.test(r.text) && !/:/.test(r.text)).sort((a, b) => b.h - a.h)[0];
  return top?.text || null;
}

// Главная функция: сырой результат Vision → понятный платёж
export function parseSlip({ lines = [], qr = [] } = {}, now = new Date()) {
  const rows = toRows(lines);
  const fullText = rows.map((r) => r.text).join('\n');
  const verify = (qr || []).map(parseSlipVerifyQr).find(Boolean) || null;
  const provider = PROVIDERS.find(([, re]) => re.test(fullText))?.[0] || null;
  const amount = findAmount(rows);
  const { date, time } = findDateTime(rows, now);
  const { receiver } = findParties(rows);
  const reference = verify?.transRef || findReference(rows);
  // Без QR проверки нужен успех оплаты + банк или номер операции: иначе это чат, бронь или экран баланса
  const success = SUCCESS_WORDS.test(fullText);
  const looksLikeSlip = !INCOMING.test(fullText) && (!!verify
    || (!!date && !DOC_WORDS.test(fullText) && success && (!!provider || !!reference)));
  const looksLikeDoc = !looksLikeSlip && (DOC_WORDS.test(fullText) || TOTAL_LABEL.test(fullText));
  const vendor = looksLikeDoc ? findVendor(rows) : null;
  return {
    // isSlip — электронный слип банка/кошелька (автоимпорт); kind 'document' — бумажный чек или счёт
    isSlip: looksLikeSlip && !!amount,
    kind: amount ? (looksLikeSlip ? 'slip' : looksLikeDoc ? 'document' : null) : null,
    amount,
    currency: 'THB',
    date,
    time,
    receiver: vendor ? tidyName(vendor) : receiver && looksLikeSlip ? tidyName(receiver) : null,
    provider,
    reference,
    // Без номера операции — отпечаток: сумма + дата + время (одинаков у одного слипа из Фото и из «Поделиться»)
    key: verify?.transRef ? `ref:${verify.transRef}` : reference ? `ref:${reference}`
      : amount && date && time ? `fp:${amount}|${date}|${time}` : null,
    text: fullText,
  };
}

// ---- Категория по получателю ----

const CATEGORY_HINTS = [
  // Магазины — раньше жилья и ресторанов: «Villa Market», «Central Food Retail» (Tops)
  ['Groceries', /\btops\b|7-?eleven|\b7-?11\b|\blotus|big\s*c\b|\bmakro\b|foodland|villa\s*market|gourmet|family\s*mart|lawson|cj\s*(more|express)|rimping|supermarket|central\s*food|food\s*retail|ซูเปอร์|โลตัส|บิ๊กซี|เซเว่น/i],
  ['Housing', /property|\brent\b|room\s*charge|apartment|\bcondo|residence|ค่าเช่า|อพาร์ท|คอนโด|electricity|water\s*supply|ค่าไฟ|ค่าน้ำ/i],
  ['Restaurants', /starbucks|caf[eé]\b|coffee|restaurant|\bkfc\b|mcdonald|burger|pizza|sushi|\bbar\b|\bfood\b|kitchen|\bgrill|bistro|ร้านอาหาร|กาแฟ|ข้าว/i],
  ['Transport', /\bgrab\b|\bbolt\b|\bbts\b|\bmrt\b|\bptt\b|\bshell\b|bangchak|\besso\b|caltex|\btaxi\b|airport|parking|น้ำมัน/i],
  ['Health', /pharmacy|hospital|clinic|\bboots\b|watsons|dental|ร้านยา|โรงพยาบาล|คลินิก/i],
  ['Entertainment', /cinema|\bmajor\s*cineplex|sf\s*cinema|cineplex|ticket|bowling|karaoke/i],
  ['Clothing', /uniqlo|h&m|\bzara\b|central\s*(department|world|festival)|robinson|decathlon/i],
  ['Subscriptions', /netflix|spotify|youtube|apple\.com|icloud|\bais\b|true\s*move|dtac|internet/i],
];

// categories — категории пары; совпадение по каноническому имени (ru или en), иначе null
// Для бумажного счёта смотрим и на весь текст (строки «Room charge», «Electricity»)
export function guessCategoryId(name, categories, labelOf = (n) => n, extraText = '') {
  if ((!name && !extraText) || !Array.isArray(categories)) return null;
  const hit = CATEGORY_HINTS.find(([, re]) => re.test(name || '')) || (extraText ? CATEGORY_HINTS.find(([, re]) => re.test(extraText)) : null);
  if (!hit) return null;
  const want = hit[0];
  const cat = categories.find((c) => c.name === want || labelOf(c.name) === labelOf(want));
  return cat?.id || null;
}

// Описание расхода по слипу: «Tops Kamala» или «Перевод · Amonrat Banth»
export function slipDescription(slip, transferWord) {
  if (!slip?.receiver) return slip?.provider || '';
  const isPerson = !CATEGORY_HINTS.some(([, re]) => re.test(slip.receiver)) && /promptpay|พร้อมเพย์|โอนเงิน|transfer/i.test(slip.text || '');
  return isPerson && transferWord ? `${transferWord} · ${slip.receiver}` : slip.receiver;
}

// Категория для слипа: угадываем по получателю (для бумажного счёта — и по тексту),
// перевод человеку — в «Другое» (labelOf приводит ru/en названия к одному виду), иначе fallback
export function slipCategoryId(slip, categories, labelOf = (n) => n, fallbackId = null) {
  const guessed = guessCategoryId(slip?.receiver, categories, labelOf, slip?.kind === 'document' ? slip.text : '');
  if (guessed) return guessed;
  const isPersonTransfer = !!slip?.receiver && slip.kind === 'slip' && /promptpay|พร้อมเพย์|โอนเงิน|transfer/i.test(slip.text || '');
  const other = isPersonTransfer ? categories?.find((c) => labelOf(c.name) === labelOf('Other'))?.id : null;
  return other || fallbackId || categories?.[0]?.id || null;
}
