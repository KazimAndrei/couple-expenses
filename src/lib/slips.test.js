import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { crc16, guessCategoryId, parsePromptPayQr, parseSlip, parseSlipVerifyQr, slipCategoryId, slipDescription, tidyName } from './slips.js';

const fixtureUrl = (name) => new URL(`../../scripts/fixtures/slips/${name}.ocr.json`, import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(fixtureUrl(name), 'utf8'));
// Настоящие слипы с личными данными в git не попадают — без них эти тесты пропускаются
const hasReal = ['truemoney_promptpay', 'krungthai_merchant', 'invoice_rent'].every((n) => existsSync(fixtureUrl(n)));
const NOW = new Date('2026-10-28T20:00:00+07:00');
const f = (id, v) => id + String(v.length).padStart(2, '0') + v;
const withCrc = (body) => body + '6304' + crc16(body + '6304');

describe.skipIf(!hasReal)('реальные слипы (Apple Vision)', () => {
  it('TrueMoney → PromptPay перевод', () => {
    const s = parseSlip(fixture('truemoney_promptpay'), NOW);
    expect(s.isSlip).toBe(true);
    expect(s.amount).toBe(115);
    expect(s.date).toBe('2026-10-28');
    expect(s.time).toBe('17:04');
    expect(s.provider).toBe('TrueMoney');
    expect(s.receiver).toBe('Amonrat Banth');
    expect(s.key).toBe('ref:APF261028170424OB74ODTAG1');
    expect(slipDescription(s, 'Перевод')).toBe('Перевод · Amonrat Banth');
  });

  it('Krungthai → оплата в магазине: берём Amount, а не Fee', () => {
    const s = parseSlip(fixture('krungthai_merchant'), NOW);
    expect(s.isSlip).toBe(true);
    expect(s.amount).toBe(1794.74);
    expect(s.date).toBe('2026-10-25');
    expect(s.time).toBe('11:59');
    expect(s.provider).toBe('Krungthai');
    expect(s.receiver).toBe('Tops Kamala');
    expect(s.key).toBe('ref:C20261025629811216268');
    expect(slipDescription(s, 'Перевод')).toBe('Tops Kamala');
  });
});

describe('тайский текст и разные форматы', () => {
  const L = (rows) => ({ lines: rows.map((r, i) => ({ t: r[0], x: r[1] ?? 0.1, y: 0.1 + i * 0.05, w: 0.3, h: r[2] ?? 0.02 })), qr: [] });

  it('K PLUS по-тайски, буддийский год, сумма в бахтах, комиссия рядом', () => {
    const s = parseSlip(L([
      ['โอนเงินสำเร็จ'], ['28 ต.ค. 69 17:04 น.'], ['นาย สมชาย ใจดี'], ['ธ.กสิกรไทย'], ['xxx-x-x1234-x'],
      ['น.ส. มาลี สวยงาม'], ['พร้อมเพย์'], ['xxx-xxx-5678'], ['จำนวน: 250.00 บาท'], ['ค่าธรรมเนียม: 0.00 บาท'],
    ]), NOW);
    expect(s.isSlip).toBe(true);
    expect(s.amount).toBe(250);
    expect(s.date).toBe('2026-10-28');
    expect(s.time).toBe('17:04');
    expect(s.provider).toBe('K PLUS');
    expect(s.receiver).toBe('มาลี สวยงาม');
  });

  it('OCR без точек в месяце и полный год BE', () => {
    const s = parseSlip(L([['ชำระเงินสำเร็จ'], ['5 มค 2570 09:15'], ['฿ 1,200.50', 0.4, 0.05]]), NOW);
    expect(s.date).toBe('2027-01-05');
    expect(s.amount).toBe(1200.5);
  });

  it('несуществующая дата и время вместо года', () => {
    expect(parseSlip(L([['Payment completed'], ['Date 31/02/2026'], ['Amount 10.00 THB']]), NOW).date).toBe(null);
    const s = parseSlip(L([['Payment completed'], ['5 May, 14:30'], ['Amount 10.00 THB']]), NOW);
    expect(s.date).toBe(null);
  });

  it('обычное фото без признаков слипа — не слип', () => {
    expect(parseSlip(L([['Happy birthday'], ['Total 12.00']]), NOW).isSlip).toBe(false);
    expect(parseSlip({}, NOW).isSlip).toBe(false);
  });
});

describe('PromptPay QR', () => {
  it('динамический QR магазина: сумма, имя, CRC', () => {
    const body = f('00', '01') + f('01', '12') + f('30', f('00', 'A000000677010112') + f('01', '010753600031501') + f('02', 'INV123'))
      + f('53', '764') + f('54', '89.50') + f('58', 'TH') + f('59', 'TOPS-C2B TOPS KAMALA') + f('60', 'PHUKET');
    const payload = withCrc(body);
    const q = parsePromptPayQr(payload);
    expect(q.crcOk).toBe(true);
    expect(q.amount).toBe(89.5);
    expect(q.currency).toBe('THB');
    expect(q.merchant).toBe('Tops Kamala');
    expect(q.target).toEqual({ type: 'biller', id: '010753600031501', ref: 'INV123' });
  });

  it('статический QR человека без суммы, испорченный CRC', () => {
    const body = f('00', '01') + f('01', '11') + f('29', f('00', 'A000000677010111') + f('01', '0066812345678')) + f('53', '764') + f('58', 'TH');
    const q = parsePromptPayQr(body + '6304FFFF');
    expect(q.amount).toBe(null);
    expect(q.crcOk).toBe(false);
    expect(q.target).toEqual({ type: 'phone', id: '0066812345678' });
  });

  it('мусор — null', () => {
    expect(parsePromptPayQr('https://example.com')).toBe(null);
    expect(parsePromptPayQr('000201zz')).toBe(null);
    expect(parseSlipVerifyQr('hello')).toBe(null);
  });
});

describe('мелочи', () => {
  it('tidyName', () => {
    expect(tidyName('MISS AMONRAT BANTH****')).toBe('Amonrat Banth');
    expect(tidyName('ANDREI K* * *')).toBe('Andrei');
    expect(tidyName('TOPS-C2B Tops Kamala')).toBe('Tops Kamala');
  });
  it('guessCategoryId по канону ru/en', () => {
    const cats = [{ id: 'g', name: 'Продукты' }, { id: 't', name: 'Transport' }];
    const label = (n) => ({ Продукты: 'Groceries', Groceries: 'Groceries' }[n] || n);
    expect(guessCategoryId('Tops Kamala', cats, label)).toBe('g');
    expect(guessCategoryId('Grab', cats, label)).toBe('t');
    expect(guessCategoryId('Amonrat Banth', cats, label)).toBe(null);
  });
});

describe.skipIf(!hasReal)('бумажный счёт (фото)', () => {
  it('счёт за квартиру: Grand Total, дата документа, поставщик, «Жильё»', () => {
    const s = parseSlip(fixture('invoice_rent'), NOW);
    expect(s.isSlip).toBe(false);
    expect(s.kind).toBe('document');
    expect(s.amount).toBe(42628);
    expect(s.date).toBe('2026-10-08');
    expect(s.receiver).toBe('Phuket Property Management Service');
    const cats = [{ id: 'h', name: 'Housing' }, { id: 'g', name: 'Groceries' }];
    expect(guessCategoryId(s.receiver, cats, (n) => n, s.text)).toBe('h');
  });
});

describe('синтетический тайский слип K PLUS (Apple Vision, th-TH)', () => {
  it('тайский текст: сумма, BE-год, получатель, ref из QR', () => {
    const s = parseSlip(fixture('kplus_thai_synthetic'), NOW);
    expect(s).toMatchObject({ isSlip: true, kind: 'slip', amount: 250, date: '2026-10-28', time: '17:04', provider: 'K PLUS', receiver: 'มาลี สวยงาม' });
    expect(s.key).toBe('ref:016301170412BPM07421');
    expect(slipDescription(s, 'Перевод')).toBe('Перевод · มาลี สวยงาม');
  });
});

describe.skipIf(!hasReal)('slipCategoryId', () => {
  const cats = [{ id: 'g', name: 'Groceries' }, { id: 'h', name: 'Housing' }, { id: 'o', name: 'Other' }];
  it('магазин → по названию, перевод человеку → «Другое», счёт → по тексту', () => {
    expect(slipCategoryId(parseSlip(fixture('krungthai_merchant'), NOW), cats, (n) => n, 'h')).toBe('g');
    expect(slipCategoryId(parseSlip(fixture('truemoney_promptpay'), NOW), cats, (n) => n, 'h')).toBe('o');
    expect(slipCategoryId(parseSlip(fixture('invoice_rent'), NOW), cats, (n) => n, 'g')).toBe('h');
  });
  it('без «Другого» — запасная категория', () => {
    expect(slipCategoryId(parseSlip(fixture('truemoney_promptpay'), NOW), cats.slice(0, 2), (n) => n, 'h')).toBe('h');
  });
});
