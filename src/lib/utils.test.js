import { describe, expect, it } from 'vitest';
import { escapeHtml, formatExpenseDateRow, nextMonth, pct, prevMonth, safeColor } from './utils.js';

describe('date helpers', () => {
  it('handles year boundaries for prevMonth and nextMonth', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(nextMonth('2025-12')).toBe('2026-01');
  });

  it('formats expense row date as DD.MM.YYYY', () => {
    expect(formatExpenseDateRow('2026-03-31')).toBe('31.03.2026');
    expect(formatExpenseDateRow('2026-03-31T00:00:00.000Z')).toBe('31.03.2026');
    expect(formatExpenseDateRow('')).toBe('');
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
