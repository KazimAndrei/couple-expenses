import { describe, it, expect } from 'vitest';
import { parseWalletAmount, tidyMerchant, walletItemToPayment } from './wallet-payments.js';

describe('parseWalletAmount', () => {
  it.each([
    ['THB 110.00', 110, 'THB'],
    ['฿110.00', 110, 'THB'],
    ['110,00 ฿', 110, 'THB'],
    ['$1,234.56', 1234.56, 'USD'],
    ['1 234,50 ₽', 1234.5, 'RUB'],
    ['1 234,50 ₽', 1234.5, 'RUB'],
    ['€1.234,50', 1234.5, 'EUR'],
    ['1,234 THB', 1234, 'THB'],
    ['1.234.567', 1234567, null],
    ['99', 99, null],
    ['0.99', 0.99, null],
  ])('%s', (raw, amount, currency) => {
    expect(parseWalletAmount(raw)).toEqual({ amount, currency });
  });

  it('нет суммы — поле останется пустым, строку заполнят вручную', () => {
    expect(parseWalletAmount('').amount).toBeNull();
    expect(parseWalletAmount('Amount').amount).toBeNull();
    expect(parseWalletAmount('฿0.00').amount).toBeNull();
  });
});

describe('tidyMerchant', () => {
  it.each([
    ['EVP* The Empower 888', 'The Empower 888'],
    ['SQ *Blue Cafe', 'Blue Cafe'],
    ['  Tops   Kamala ', 'Tops Kamala'],
    ['7-Eleven', '7-Eleven'],
  ])('%s', (raw, out) => expect(tidyMerchant(raw)).toBe(out));
});

describe('walletItemToPayment', () => {
  const created = new Date(2026, 10, 4, 10, 33).getTime();
  it('становится строкой листа с уникальным ключом и датой телефона', () => {
    const p = walletItemToPayment({ id: 'a-1', amount: 'THB 110.00', merchant: 'EVP* The Empower 888', card: 'RedotPay', created });
    expect(p.source).toBe('wallet');
    expect(p.slip).toMatchObject({ amount: 110, currency: 'THB', date: '2026-11-04', time: '10:33', receiver: 'The Empower 888', provider: 'RedotPay', key: 'wallet:a-1' });
  });
  it('без продавца и карты', () => {
    const p = walletItemToPayment({ id: 'a-2', amount: '$5', merchant: '', card: '', created });
    expect(p.slip.receiver).toBeNull();
    expect(p.slip.provider).toBe('Apple Pay');
  });
});
