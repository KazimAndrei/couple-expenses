import { describe, expect, it } from 'vitest';
import { escapeHtml, formatExpenseDateRow, formatMoney, nextMonth, pct, prevMonth, safeColor } from './utils.js';

describe('date helpers', () => {
  it('handles year boundaries for prevMonth and nextMonth', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(nextMonth('2025-12')).toBe('2026-01');
  });

  // Тесты идут без localStorage, поэтому язык — дефолтный английский (en-US)
  it('formats expense row date in the locale order', () => {
    expect(formatExpenseDateRow('2026-03-31')).toBe('03/31/2026');
    expect(formatExpenseDateRow('2026-03-31T00:00:00.000Z')).toBe('03/31/2026');
    expect(formatExpenseDateRow('')).toBe('');
  });
});

describe('money formatting', () => {
  it('puts the currency symbol where the locale wants it and keeps cents', () => {
    expect(formatMoney(128.4, 'USD')).toBe('$128.40');
    expect(formatMoney(1234.5, 'EUR')).toBe('€1,234.50');
  });

  it('drops the fraction for currencies that have none', () => {
    expect(formatMoney(1234, 'JPY')).toBe('¥1,234');
  });

  it('survives an unknown currency code instead of throwing', () => {
    expect(formatMoney(10, 'XYZ')).toContain('10');
    expect(formatMoney(NaN, 'USD')).toBe('— $');
  });
});

describe('math helpers', () => {
  it('returns rounded percent and handles zero totals', () => {
    expect(pct(45, 100)).toBe(45);
    expect(pct(1, 3)).toBe(33);
    expect(pct(10, 0)).toBe(0);
  });
});

describe('security helpers', () => {
  it('escapes special HTML characters', () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('validates colors and falls back when invalid', () => {
    expect(safeColor('#A1B2C3')).toBe('#A1B2C3');
    expect(safeColor('rgb(0,0,0)', '#123456')).toBe('#123456');
  });
});
