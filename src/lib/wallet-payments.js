// Оплаты Apple Pay из автоматизации «Команд» (ios/App/App/WalletPaymentIntent.swift): сумма приходит строкой
// вместе с валютой, в формате языка телефона — «฿110.00», «THB 110.00», «1 234,50 ₽», «$1,234.56».
import { CURRENCIES } from './utils.js';

const SYMBOLS = { '฿': 'THB', '₽': 'RUB', '€': 'EUR', '£': 'GBP', '$': 'USD', '₸': 'KZT', '₴': 'UAH', '¥': 'JPY', '₩': 'KRW', '₹': 'INR', '₫': 'VND' };

export function parseWalletAmount(raw) {
  const text = String(raw ?? '').trim();
  const digits = text.match(/\d[\d\s.,'’  ]*/)?.[0].replace(/[\s'’  ]/g, '').replace(/[.,]$/, '') || '';
  const code = text.match(/\b[A-Za-z]{3}\b/)?.[0].toUpperCase();
  const currency = (code && (CURRENCIES[code] ? code : null)) || Object.entries(SYMBOLS).find(([s]) => text.includes(s))?.[1] || null;
  if (!digits) return { amount: null, currency };
  // Десятичный разделитель — последний, если после него 1–2 цифры; «1,234» и «1.234» — тысячи
  const sep = digits.match(/[.,](\d{1,2})$/);
  const whole = sep ? digits.slice(0, -sep[0].length) : digits;
  const amount = Number(`${whole.replace(/[.,]/g, '')}${sep ? `.${sep[1]}` : ''}`);
  return { amount: amount > 0 ? amount : null, currency };
}

// Название из выписки: «EVP* The Empower 888» → «The Empower 888», «SQ *Blue Cafe» → «Blue Cafe»
export function tidyMerchant(raw) {
  return String(raw ?? '').replace(/^\s*[A-Za-z0-9]{2,8}\s?\*\s*/, '').replace(/\s+/g, ' ').trim();
}

const pad = (n) => String(n).padStart(2, '0');

// Запись из входящих → строка листа «Нашли оплаты» (та же форма, что у слипа)
export function walletItemToPayment({ id, amount, merchant, card, created }) {
  const at = new Date(Number(created) || Date.now());
  const parsed = parseWalletAmount(amount);
  return {
    source: 'wallet',
    walletId: id,
    created: at.getTime(),
    slip: {
      kind: 'wallet',
      isSlip: true,
      amount: parsed.amount,
      currency: parsed.currency,
      date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
      time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
      receiver: tidyMerchant(merchant) || null,
      provider: card || 'Apple Pay',
      reference: null,
      key: `wallet:${id}`,
      text: String(merchant ?? ''),
    },
  };
}
