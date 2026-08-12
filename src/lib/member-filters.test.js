import { describe, it, expect } from 'vitest';
import {
  MISSING_PARTNER_ID,
  filterExpensesByMemberChip,
  memberDisplayLabel,
  resolveMemberSides,
  resolvePayerLabel,
  resolvePayerSide,
  expenseJoinedProfileName,
} from './member-filters.js';

const members = [
  { id: 'id-a', display_name: 'Аня', avatar_url: null, created_at: '2026-01-01' },
  { id: 'id-b', display_name: 'Борис', avatar_url: null, created_at: '2026-01-02' },
];

describe('resolveMemberSides', () => {
  it('первый по created_at = memberA, второй = memberB', () => {
    const sides = resolveMemberSides(members);
    expect(sides.memberA?.id).toBe('id-a');
    expect(sides.memberB?.id).toBe('id-b');
    expect(sides.pairOrder).toEqual(['id-a', 'id-b']);
  });

  it('порядок стабилен независимо от порядка массива', () => {
    const sides = resolveMemberSides([members[1], members[0]]);
    expect(sides.memberA?.id).toBe('id-a');
    expect(sides.memberB?.id).toBe('id-b');
  });

  it('неполная пара: один участник → memberB = null', () => {
    const sides = resolveMemberSides([members[0]]);
    expect(sides.memberA?.id).toBe('id-a');
    expect(sides.memberB).toBe(null);
  });

  it('пустой список участников', () => {
    const sides = resolveMemberSides([]);
    expect(sides.memberA).toBe(null);
    expect(sides.memberB).toBe(null);
  });
});

describe('memberDisplayLabel', () => {
  it('возвращает display_name', () => {
    expect(memberDisplayLabel(members[0])).toBe('Аня');
  });

  it('fallback на нейтральное «Partner» без имени', () => {
    expect(memberDisplayLabel({ id: 'x', display_name: '' })).toBe('Partner');
    expect(memberDisplayLabel(null)).toBe('Partner');
  });
});

describe('filterExpensesByMemberChip (manual checklist as tests)', () => {
  const sides = resolveMemberSides(members);
  const expenses = [
    { id: '1', split: 'equal', paid_by: 'id-a', amount: '100', description: 'Общее' },
    { id: '2', split: 'full_payer', paid_by: 'id-a', amount: '50', description: 'Платит первый' },
    { id: '3', split: 'full_payer', paid_by: 'id-b', amount: '30', description: 'Платит второй' },
    { id: '4', split: 'full_payer', paid_by: 'old-a-uuid', amount: '20', description: 'Legacy', profiles: { display_name: 'Аня' } },
    { id: '5', split: 'full_payer', paid_by: 'old-b-uuid', amount: '15', description: 'Legacy', profiles: { display_name: 'Борис' } },
  ];

  it('Все: показывает все расходы', () => {
    expect(filterExpensesByMemberChip(expenses, null, sides)).toHaveLength(5);
    expect(filterExpensesByMemberChip(expenses, undefined, sides)).toHaveLength(5);
  });

  it('memberA: full_payer участника + legacy UUID с его display_name; Общее не попадает', () => {
    const out = filterExpensesByMemberChip(expenses, sides.memberA?.id, sides);
    expect(out.map((e) => e.id)).toEqual(['2', '4']);
  });

  it('memberB: full_payer участника + legacy UUID с его display_name; Общее не попадает', () => {
    const out = filterExpensesByMemberChip(expenses, sides.memberB?.id, sides);
    expect(out.map((e) => e.id)).toEqual(['3', '5']);
  });

  it('плейсхолдер не присоединившегося партнёра даёт пустой список', () => {
    expect(filterExpensesByMemberChip(expenses, MISSING_PARTNER_ID, sides)).toEqual([]);
  });

  it('неполная пара: фильтр по единственному участнику работает', () => {
    const soloSides = resolveMemberSides([members[0]]);
    const out = filterExpensesByMemberChip(expenses, soloSides.memberA?.id, soloSides);
    expect(out.map((e) => e.id)).toEqual(['2', '4']);
  });

  it('legacy filterBy (не id участника) фильтрует по точному paid_by', () => {
    const out = filterExpensesByMemberChip(expenses, 'old-a-uuid', sides);
    expect(out.map((e) => e.id)).toEqual(['4']);
  });
});

describe('resolvePayerLabel', () => {
  const sides = resolveMemberSides(members);

  it('equal → Shared', () => {
    expect(resolvePayerLabel({ split: 'equal', paid_by: 'id-a' }, sides)).toBe('Shared');
  });

  it('известный id memberA → его display_name', () => {
    expect(resolvePayerLabel({ split: 'full_payer', paid_by: 'id-a' }, sides)).toBe('Аня');
  });

  it('известный id memberB → его display_name', () => {
    expect(resolvePayerLabel({ split: 'full_payer', paid_by: 'id-b' }, sides)).toBe('Борис');
  });

  it('неизвестный paid_by, но profiles.display_name совпадает с участником → имя участника', () => {
    const exp = { split: 'full_payer', paid_by: 'old-uuid', profiles: { display_name: 'Аня' } };
    expect(resolvePayerLabel(exp, sides)).toBe('Аня');
  });

  it('неизвестный paid_by с чужим display_name → показываем joined-имя как есть', () => {
    const exp = { split: 'full_payer', paid_by: 'old-uuid', profiles: { display_name: 'Гость' } };
    expect(resolvePayerLabel(exp, sides)).toBe('Гость');
  });

  it('участник без display_name → нейтральный fallback «Partner»', () => {
    const m = [
      { id: 'id-a', display_name: '', avatar_url: null, created_at: '2026-01-01' },
      { id: 'id-b', display_name: 'Борис', avatar_url: null, created_at: '2026-01-02' },
    ];
    const s = resolveMemberSides(m);
    expect(resolvePayerLabel({ split: 'full_payer', paid_by: 'id-a' }, s)).toBe('Partner');
  });

  it('удалённый участник: snapshot-имя показывается как есть', () => {
    const exp = { split: 'full_payer', paid_by: null, paid_by_snapshot_name: 'Вика' };
    expect(resolvePayerLabel(exp, sides)).toBe('Вика');
  });

  it('нет никакой информации → пустая строка', () => {
    expect(resolvePayerLabel({ split: 'full_payer', paid_by: 'old-uuid' }, sides)).toBe('');
  });

  it('expenseJoinedProfileName: profiles-массив из PostgREST', () => {
    expect(
      expenseJoinedProfileName({
        profiles: [{ display_name: 'Аня' }],
      }),
    ).toBe('Аня');
  });
});

describe('resolvePayerSide', () => {
  const sides = resolveMemberSides(members);

  it('null sides → null', () => {
    expect(resolvePayerSide('id-a', null)).toBe(null);
  });

  it('id memberA → a', () => {
    expect(resolvePayerSide('id-a', sides)).toBe('a');
  });

  it('id memberB → b', () => {
    expect(resolvePayerSide('id-b', sides)).toBe('b');
  });

  it('legacy UUID + display_name участника (без учёта регистра) → его сторона', () => {
    expect(resolvePayerSide('old-uuid', sides, 'Аня')).toBe('a');
    expect(resolvePayerSide('old-uuid', sides, 'борис')).toBe('b');
  });

  it('совсем неизвестный → null', () => {
    expect(resolvePayerSide('old-uuid', sides)).toBe(null);
    expect(resolvePayerSide('old-uuid', sides, '')).toBe(null);
    expect(resolvePayerSide('old-uuid', sides, 'Гость')).toBe(null);
  });
});
