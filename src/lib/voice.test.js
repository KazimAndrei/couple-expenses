import { describe, it, expect } from 'vitest';
import { parseVoiceExpense } from './voice.js';

const cats = [
  { id: 'g', name: 'Продукты' }, { id: 'r', name: 'Рестораны' }, { id: 't', name: 'Transport' }, { id: 'h', name: 'Жильё' },
];
const canon = { Продукты: 'Groceries', Рестораны: 'Restaurants', Жильё: 'Housing' };
const labelOf = (n) => canon[n] || n;
const now = new Date(2026, 9, 28, 12);
const p = (text) => parseVoiceExpense(text, { categories: cats, labelOf, now });

describe('голосовой ввод', () => {
  it('«кофе 120»', () => {
    expect(p('Кофе 120')).toMatchObject({ amount: 120, description: 'Кофе', categoryId: 'r', date: '2026-10-28', payer: null });
  });
  it('вчера, бат, пробел в тысячах, магазин', () => {
    expect(p('вчера продукты в Tops 1 800 бат')).toMatchObject({ amount: 1800, description: 'Продукты в Tops', categoryId: 'g', date: '2026-10-27' });
  });
  it('числа словами', () => {
    expect(p('такси двести пятьдесят')).toMatchObject({ amount: 250, categoryId: 't', description: 'Такси' });
    expect(p('аренда сорок две тысячи шестьсот двадцать восемь')).toMatchObject({ amount: 42628, categoryId: 'h' });
    expect(p('полторы тысячи массаж')).toMatchObject({ amount: 1500, description: 'Массаж' });
  });
  it('английский, общее, копейки', () => {
    expect(p('paid 4.50 for coffee yesterday shared')).toMatchObject({ amount: 4.5, description: 'Coffee', categoryId: 'r', date: '2026-10-27', payer: 'shared' });
    expect(p('Grab 2k')).toMatchObject({ amount: 2000, categoryId: 't' });
    expect(p('groceries one hundred and twenty')).toMatchObject({ amount: 120, categoryId: 'g' });
  });
  it('позавчера, личное, «потратил на»', () => {
    expect(p('позавчера потратил на одежду 900 личное')).toMatchObject({ amount: 900, description: 'Одежду', date: '2026-10-26', payer: 'me' });
  });
  it('предлог «к» — не тысяча', () => {
    expect(p('подарок к дню рождения 500')).toMatchObject({ amount: 500, description: 'Подарок к дню рождения' });
    expect(p('такси 2к')).toMatchObject({ amount: 2000 });
  });
  it('без суммы', () => {
    expect(p('продукты').amount).toBe(null);
    expect(p('').description).toBe('');
  });
});
