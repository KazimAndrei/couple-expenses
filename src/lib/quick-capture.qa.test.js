// QA: быстрый ввод (слипы, PromptPay QR, голос). Тесты `it.fails` фиксируют найденные баги:
// они «проходят», пока баг есть, и упадут, когда его починят — тогда смените it.fails на it.
import { describe, it, expect } from 'vitest';
import { crc16, guessCategoryId, parsePromptPayQr, parseSlip, parseSlipVerifyQr, parseTlv, slipCategoryId, slipDescription, tidyName } from './slips.js';
import { parseVoiceExpense } from './voice.js';

const NOW = new Date('2026-10-28T20:00:00+07:00');
const L = (rows) => ({ lines: rows.map((r, i) => ({ t: r[0], x: r[1] ?? 0.1, y: 0.1 + i * 0.05, w: 0.3, h: r[2] ?? 0.02 })), qr: [] });
const P = (rows) => parseSlip(L(rows), NOW);
const slipWithDate = (d) => P([['Transfer successful'], [d], ['฿ 500.00', 0.4, 0.05]]);
const f = (id, v) => id + String(v.length).padStart(2, '0') + v;
const withCrc = (body) => body + '6304' + crc16(body + '6304');
const CATS = ['Groceries', 'Restaurants', 'Transport', 'Housing', 'Other', 'Health', 'Entertainment', 'Clothing', 'Subscriptions'].map((name) => ({ id: name, name }));

describe('QA slips: банки и форматы, которые работают', () => {
  it('SCB English, From/To подписи', () => {
    const s = P([['SCB'], ['Transfer successful'], ['28 Oct 2026 - 14:22'], ['From MR ANDREI K'], ['xxx-xxx123-4'], ['To MS SOMSRI JAIDEE'], ['xxx-xxx456-7'], ['Amount 1,500.00'], ['Fee 0.00']]);
    expect(s).toMatchObject({ isSlip: true, amount: 1500, date: '2026-10-28', time: '14:22', receiver: 'Somsri Jaidee', provider: 'SCB' });
  });
  it('Bangkok Bank: «Amount (THB)» и сумма строкой ниже', () => {
    const s = P([['Bangkok Bank'], ['Transfer Successful'], ['28 Oct 26, 14:22'], ['Amount (THB)'], ['300.00'], ['To'], ['MR SOMCHAI J'], ['xxx-x-x5678-x']]);
    expect(s).toMatchObject({ isSlip: true, amount: 300, date: '2026-10-28', provider: 'Bangkok Bank', receiver: 'Somchai' });
  });
  it('K PLUS English: Transaction ID как ключ', () => {
    const s = P([['Transfer completed'], ['28 Oct 26 14:22'], ['MR. ANDREI K.'], ['K PLUS'], ['xxx-x-x1234-x'], ['MS. MALEE S.'], ['SCB'], ['xxx-x-x5678-x'], ['Transaction ID:'], ['016301142212ABC12345'], ['Amount:'], ['250.00 Baht'], ['Fee:'], ['0.00 Baht']]);
    expect(s).toMatchObject({ isSlip: true, amount: 250, receiver: 'Malee S.', key: 'ref:016301142212ABC12345' });
  });
  it('Krungthai по-тайски, C2B магазин', () => {
    const s = P([['กรุงไทย'], ['ชำระเงินสำเร็จ'], ['รหัสอ้างอิง C20261025629811216268'], ['นาย อันเดรย์ ก'], ['กรุงไทย'], ['XXX-X-XX398-0'], ['TOPS-C2B Tops Kamala'], ['(010753600031501)'], ['จำนวนเงิน'], ['1,794.74 บาท'], ['ค่าธรรมเนียม'], ['0.00 บาท'], ['วันที่ทำรายการ'], ['25 ต.ค. 2569 - 11:59']]);
    expect(s).toMatchObject({ isSlip: true, amount: 1794.74, date: '2026-10-25', time: '11:59', receiver: 'Tops Kamala', key: 'ref:C20261025629811216268' });
  });
  it('даты: BE, 2-значный год, слитно, Feb 29, полночь', () => {
    expect(slipWithDate('28 ต.ค. 69').date).toBe('2026-10-28');
    expect(slipWithDate('28 ต.ค. 2569').date).toBe('2026-10-28');
    expect(slipWithDate('28ต.ค.2569').date).toBe('2026-10-28');
    expect(slipWithDate('28/10/2026').date).toBe('2026-10-28');
    expect(slipWithDate('28/10/69').date).toBe('2026-10-28');
    expect(slipWithDate('1 ม.ค. 70 08:00').date).toBe('2027-01-01');
    expect(slipWithDate('29 Feb 2028').date).toBe('2028-02-29');
    expect(slipWithDate('29 Feb 2027').date).toBe(null);
    expect(slipWithDate('28-10-2026 00:00')).toMatchObject({ date: '2026-10-28', time: '00:00' });
    expect(slipWithDate('28 Oct 2026 24:00').time).toBe(null);
  });
  it('суммы: «1,234.00 บาท», «THB 1,234.56», пробел в тысячах, огромная', () => {
    const amt = (a) => P([['Transfer successful'], ['28 Oct 2026 17:04'], ['Amount'], [a, 0.5, 0.04]]).amount;
    expect(amt('1,234.00 บาท')).toBe(1234);
    expect(amt('THB 1,234.56')).toBe(1234.56);
    expect(amt('1 234.00 บาท')).toBe(1234);
    expect(amt('12,345,678.90 THB')).toBe(12345678.9);
    expect(amt('500.00฿')).toBe(500);
  });
  it('комиссия / остаток / кешбэк рядом с суммой не путаются', () => {
    expect(P([['Transfer successful'], ['28 Oct 2026 17:04'], ['Fee 10.00 THB'], ['Amount 250.00 THB']]).amount).toBe(250);
    expect(P([['Transfer successful'], ['28 Oct 2026 17:04'], ['฿ 250.00', 0.4, 0.04], ['Available balance ฿ 12,000.00', 0.4, 0.06]]).amount).toBe(250);
    expect(P([['ชำระเงินสำเร็จ'], ['28 ต.ค. 69 17:04'], ['ยอดเงินคงเหลือ 9,500.00 บาท'], ['จำนวนเงิน 500.00 บาท']]).amount).toBe(500);
    expect(P([['Payment successful'], ['28 Oct 2026 17:04'], ['Cashback 5.00 THB'], ['Total 95.00 THB']]).amount).toBe(95);
  });
  it('счёт: Grand Total важнее Sub Total, VAT', () => {
    const s = P([['TAX INVOICE'], ['ABC Co., Ltd.'], ['Date 28/10/2026'], ['Sub Total 1,000.00'], ['VAT 7% 70.00'], ['Grand Total 1,070.00']]);
    expect(s).toMatchObject({ kind: 'document', amount: 1070 });
    expect(P([['ใบเสร็จรับเงิน'], ['วันที่ 28/10/2569'], ['รวมเงิน 1,000.00'], ['ภาษีมูลค่าเพิ่ม 7% 70.00'], ['รวมทั้งสิ้น 1,070.00']]).amount).toBe(1070);
  });
  it('титулы и маски в именах', () => {
    expect(tidyName('นางสาว มาลี สวยงาม')).toBe('มาลี สวยงาม');
    expect(tidyName('Mr. JOHN SMITH')).toBe('John Smith');
    expect(tidyName('MISS AMONRAT BANTH****')).toBe('Amonrat Banth');
    expect(tidyName('TOPS-C2B Tops Kamala')).toBe('Tops Kamala');
  });
  it('меню / список цен / история операций — не слип', () => {
    expect(P([['Menu'], ['Pad Thai ฿ 120.00', 0.1, 0.05], ['Mango sticky rice ฿ 90.00']]).isSlip).toBe(false);
    expect(P([['Transaction history'], ['28 Oct 2026 Transfer -500.00'], ['27 Oct 2026 Tops -1,200.00']]).isSlip).toBe(false);
  });
});

describe('QA slips: найденные баги', () => {
  // slips.js:194 — только D/M/Y; ISO и «месяц первым» не распознаются → date null → без провайдера не слип
  it('ISO-дата «2026-10-28» (Grab e-receipt, многие чеки)', () => {
    expect(slipWithDate('2026-10-28 14:22').date).toBe('2026-10-28');
  });
  it('английский «Oct 28, 2026» (ShopeePay и др.) — слип не распознан', () => {
    const s = P([['ShopeePay'], ['Payment Successful'], ['฿120.00'], ['Oct 28, 2026 14:22']]);
    expect(s).toMatchObject({ isSlip: true, date: '2026-10-28' });
  });
  it('полное тайское название месяца «28 ตุลาคม 2569»', () => {
    expect(slipWithDate('28 ตุลาคม 2569').date).toBe('2026-10-28');
  });
  it('время с AM/PM: «12:30 AM» → 00:30, «9.30 PM» → 21:30', () => {
    expect(slipWithDate('28 Oct 2026 12:30 AM').time).toBe('00:30');
    expect(slipWithDate('28 Oct 2026, 9.30 PM').time).toBe('21:30');
  });
  // slips.js:99 MONEY требует ровно 2 знака после точки
  it('сумма без копеек: «฿ 50», «50 THB», «฿ 1,200»', () => {
    const amt = (a) => P([['Transfer successful'], ['28 Oct 2026 17:04'], ['Amount'], [a, 0.5, 0.04]]).amount;
    expect([amt('฿ 50'), amt('50 THB'), amt('฿ 1,200')]).toEqual([50, 50, 1200]);
  });
  // slips.js:96 AMOUNT_LABEL /total/ ловит «Subtotal» раньше, чем «Total»
  it('чек ресторана: Subtotal → Service → VAT → Total (берёт Subtotal 1000 вместо 1177)', () => {
    const s = P([['Restaurant ABC'], ['Receipt'], ['Date: 28/10/2026'], ['Subtotal 1,000.00'], ['Service charge 10% 100.00'], ['VAT 7% 77.00'], ['Total 1,177.00']]);
    expect(s.amount).toBe(1177);
  });
  it('чек со скидкой: Total 500 → Discount → Net 450 (берёт 500)', () => {
    expect(P([['Receipt'], ['Date: 28/10/2026'], ['Total 500.00'], ['Discount 50.00'], ['Net 450.00']]).amount).toBe(450);
  });
  // slips.js:123 склейка «цифра пробел 2-3 цифры» сливает время/количество с суммой
  it('время и сумма в одной строке: «14:22 500.00 THB» → 22500', () => {
    expect(P([['Payment successful'], ['28/10/2026 14:22 500.00 THB']]).amount).toBe(500);
  });
  it('количество перед суммой: «Total 3 57.00» → 357', () => {
    expect(P([['RECEIPT'], ['28/10/2026'], ['Total 3 57.00']]).amount).toBe(57);
  });
  // slips.js:98 SLIP_WORDS слишком общие («completed», «reference», «transaction»)
  it('скриншот переписки с суммой и словом «completed» — не слип', () => {
    expect(P([['Mom'], ['Did you transfer 500.00 baht?'], ['Yes, completed'], ['28 Oct 2026 17:04']]).isSlip).toBe(false);
  });
  it('экран баланса K PLUS — не слип (сейчас: слип на 25 300)', () => {
    expect(P([['K PLUS'], ['Available balance'], ['฿ 25,300.00', 0.4, 0.05], ['28 Oct 2026']]).isSlip).toBe(false);
  });
  it('бронь билета («Booking reference») — не слип', () => {
    expect(P([['Thai Airways'], ['Booking reference ABCD1234'], ['Departure 28 Oct 2026 14:00'], ['Total fare 3,500.00 THB']]).isSlip).toBe(false);
  });
  it('входящий перевод («Received», «+1,000.00») — не расход', () => {
    expect(P([['K PLUS'], ['Received'], ['28 Oct 2026 10:00'], ['+ 1,000.00 THB']]).isSlip).toBe(false);
  });
  // slips.js:251 — единственная найденная сторона считается получателем, даже если это отправитель
  it('нечитаемое имя получателя → получателем становится отправитель', () => {
    const s = P([['Transfer successful'], ['28 Oct 2026 17:04'], ['฿ 500.00', 0.4, 0.05], ['ANDREI KAZIMOV'], ['xxx-x-x1234-x'], ['K* * *'], ['xxx-xxx-5678']]);
    expect(s.receiver).not.toBe('Andrei Kazimov');
  });
  // slips.js:273 — запасной «продавец» берёт строку с датой / суммой
  it('продавец бумажного чека не может быть строкой «Date: …»', () => {
    const s = P([['Receipt'], ['Date: 28/10/2026'], ['Total 500.00']]);
    expect(s.receiver ?? '').not.toMatch(/date/i);
  });
  // slips.js:229-231 — капитализация
  it('tidyName: бренды и апострофы («KFC», «MCDONALD\'S», «บริษัท ABC»)', () => {
    expect([tidyName('KFC'), tidyName("MCDONALD'S"), tidyName('บริษัท ABC จำกัด')]).toEqual(['KFC', "McDonald's", 'บริษัท ABC จำกัด']);
  });
});

describe('QA категории', () => {
  const cat = (n, extra = '') => guessCategoryId(n, CATS, (x) => x, extra);
  it('базовые магазины', () => {
    expect(cat('Tops Kamala')).toBe('Groceries');
    expect(cat('Shell Kathu')).toBe('Transport');
    expect(cat('Major Cineplex')).toBe('Entertainment');
    expect(cat('Boots')).toBe('Health');
  });
  // slips.js:309 — Housing /villa\b/ стоит раньше Groceries /villa\s*market/
  it('Villa Market → Groceries (сейчас Housing)', () => {
    expect(cat('Villa Market')).toBe('Groceries');
  });
  // подстроки без границ слова: grab/shell/bolt/major
  it('имена людей не должны давать категорию (Shelly, Grabowski, Bolton, Majorca)', () => {
    expect([cat('Shelly Brown'), cat('Grabowski Jan'), cat('Grace Bolton'), cat('Majorca Lee')]).toEqual([null, null, null, null]);
  });
  it('перевод человеку с «совпадающим» именем всё равно «Перевод · …»', () => {
    expect(slipDescription({ receiver: 'Shelly Brown', text: 'PromptPay' }, 'Перевод')).toBe('Перевод · Shelly Brown');
  });
  // «Central Food Retail Co.,Ltd.» — юрлицо Tops: Restaurants (/food/) раньше Clothing/Groceries
  it('чек Tops (юрлицо Central Food Retail) → Groceries', () => {
    expect(cat('Central Food Retail')).toBe('Groceries');
  });
  it('slipCategoryId: перевод человеку → Other', () => {
    expect(slipCategoryId({ receiver: 'Somchai', kind: 'slip', text: 'PromptPay' }, CATS)).toBe('Other');
  });
});

describe('QA PromptPay QR', () => {
  const pp = (inner, more = '') => withCrc(f('00', '01') + f('01', '12') + f('29', f('00', 'A000000677010111') + inner) + f('53', '764') + more + f('58', 'TH'));
  it('CRC16 — эталон CCITT-FALSE', () => { expect(crc16('123456789')).toBe('29B1'); });
  it('телефон / ID / e-wallet / сумма', () => {
    expect(parsePromptPayQr(pp(f('01', '0066812345678'), f('54', '150.50')))).toMatchObject({ crcOk: true, amount: 150.5, currency: 'THB', target: { type: 'phone', id: '0066812345678' } });
    expect(parsePromptPayQr(pp(f('02', '1234567890123'))).target).toEqual({ type: 'national_id', id: '1234567890123' });
    expect(parsePromptPayQr(pp(f('03', '004000000000000'))).target).toEqual({ type: 'ewallet', id: '004000000000000' });
  });
  it('оплата счёта (тег 30), имя 59, город 60, доп. данные 62, CRC в нижнем регистре', () => {
    const bill = withCrc(f('00', '01') + f('01', '12') + f('30', f('00', 'A000000677010112') + f('01', '010753600031501') + f('02', 'REF1')) + f('53', '764') + f('54', '1794.74') + f('58', 'TH') + f('59', 'TOPS KAMALA') + f('60', 'PHUKET') + f('62', f('05', 'INV123')));
    expect(parsePromptPayQr(bill)).toMatchObject({ crcOk: true, amount: 1794.74, merchant: 'Tops Kamala', city: 'PHUKET', target: { type: 'biller', id: '010753600031501', ref: 'REF1' } });
    expect(parsePromptPayQr(bill.slice(0, -4) + bill.slice(-4).toLowerCase()).crcOk).toBe(true);
    expect(parsePromptPayQr(bill.slice(0, -4) + '0000').crcOk).toBe(false);
  });
  it('битые длины TLV, не-EMV строки, нулевая/отрицательная сумма', () => {
    expect(parsePromptPayQr('000201010212' + '2999abc')).toBe(null);
    expect(parsePromptPayQr('https://example.com')).toBe(null);
    expect(parsePromptPayQr(pp(f('01', '0066812345678'), f('54', '0'))).amount).toBe(null);
    expect(parsePromptPayQr(pp(f('01', '0066812345678'), f('54', '-5'))).amount).toBe(null);
  });
  // slips.js:13 — Number(' 5') === 5: длина с пробелом/знаком принимается
  it('длина TLV не из двух цифр («00 5abcde») отвергается', () => {
    expect(parseTlv('00 5abcde')).toBe(null);
  });
  it('QR проверки слипа', () => {
    expect(parseSlipVerifyQr('0046000600000101030250225APF261028170424OB74ODTAG15102TH9104FB22')).toEqual({ bankCode: '025', transRef: 'APF261028170424OB74ODTAG1' });
  });
  // slips.js:43 — «1e3» проходит Number(); EMVCo допускает только цифры и точку
  it('сумма «1e3» отвергается', () => {
    expect(parsePromptPayQr(pp(f('01', '0066812345678'), f('54', '1e3'))).amount).toBe(null);
  });
  // slips.js:25 — CRC по кодам UTF-16, а не по байтам UTF-8: QR с тайским именем (тег 59/64) всегда crcOk=false
  it('CRC по UTF-8 байтам для тайского имени', () => {
    const body = f('00', '01') + f('01', '11') + f('53', '764') + f('58', 'TH') + f('59', 'ร้าน') + '6304';
    const bytes = new TextEncoder().encode(body);
    let crc = 0xffff;
    for (const b of bytes) { crc ^= b << 8; for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; }
    const utf8Crc = crc.toString(16).toUpperCase().padStart(4, '0');
    expect(parsePromptPayQr(body + utf8Crc)?.crcOk).toBe(true);
  });
});

describe('QA голос', () => {
  const v = (s) => parseVoiceExpense(s, { categories: CATS, now: NOW });
  it('работает: числа словами, «к», валюта, дни, плательщик', () => {
    expect(v('тысяча двести такси')).toMatchObject({ amount: 1200, description: 'Такси', categoryId: 'Transport' });
    expect(v('полторы тысячи аренда')).toMatchObject({ amount: 1500, categoryId: 'Housing' });
    expect(v('1.5к массаж').amount).toBe(1500);
    expect(v('сто двадцать пять бат кофе')).toMatchObject({ amount: 125, description: 'Кофе' });
    expect(v('a hundred coffee').amount).toBe(100);
    expect(v('two thousand five hundred rent').amount).toBe(2500);
    expect(v('grab 250 yesterday shared')).toMatchObject({ amount: 250, date: '2026-10-27', payer: 'shared' });
    expect(v('позавчера аптека 300')).toMatchObject({ date: '2026-10-26', categoryId: 'Health' });
    expect(v('кофе мой 90').payer).toBe('me');
    expect(v('80 кофе')).toMatchObject({ amount: 80, description: 'Кофе' });
    expect(v('кофе к обеду 120')).toMatchObject({ amount: 120, description: 'Кофе к обеду' });
    expect(v('кофе').amount).toBe(null);
    expect(v('такси 0').amount).toBe(null);
  });
  // voice.js:87 — «yesterday» съедается как отдельное слово раньше проверки фразы (строка 96)
  it('«day before yesterday taxi 100» → позавчера, описание «Taxi»', () => {
    expect(v('day before yesterday taxi 100')).toMatchObject({ date: '2026-10-26', description: 'Taxi' });
  });
  // voice.js:83 — «с половиной» обрывает число
  it('«две с половиной тысячи продукты» → 2500', () => {
    expect(v('две с половиной тысячи продукты')).toMatchObject({ amount: 2500, description: 'Продукты' });
  });
  it('«twelve fifty lunch» → 12.50 (сейчас 62)', () => {
    expect(v('twelve fifty lunch').amount).toBe(12.5);
  });
  // voice.js:80 — первое число в фразе всегда сумма
  it('количество перед суммой: «кофе за 2 чашки 120», «такси на 3 человек 300»', () => {
    expect([v('кофе за 2 чашки 120').amount, v('такси на 3 человек 300').amount]).toEqual([120, 300]);
  });
  it('«yesterday’s dinner 300» → вчера', () => {
    expect(v('yesterday’s dinner 300').date).toBe('2026-10-27');
  });
  it('«вода 40» (питьевая) не должна уходить в «Жильё»', () => {
    expect(v('вода 40').categoryId).not.toBe('Housing');
  });
});
