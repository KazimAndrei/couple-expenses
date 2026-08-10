import { describe, it, expect } from 'vitest';
import {
  MISSING_ANDREI_ID,
  MISSING_POLINA_ID,
  filterExpensesByMemberChip,
  pickPayerUiMembers,
  resolveMemberSides,
  resolvePayerLabel,
  resolvePayerSide,
  expenseJoinedProfileName,
} from './member-filters.js';

const members = [
  { id: 'id-a', display_name: 'Андрей', avatar_url: null },
  { id: 'id-b', display_name: 'Полина', avatar_url: null },
];

describe('resolveMemberSides', () => {
  it('maps names to Andrei/Polina id sets', () => {
    const sides = resolveMemberSides(members, 'id-a');
    expect(sides.memberA?.id).toBe('id-a');
    expect(sides.memberB?.id).toBe('id-b');
    expect(sides.andreiIds.has('id-a')).toBe(true);
    expect(sides.polinaIds.has('id-b')).toBe(true);
  });

  it('does not put Polina in Andrei slot when Andrei name does not match', () => {
    const m = [
      { id: 'p', display_name: 'Полина', avatar_url: null },
      { id: 'a', display_name: 'User', avatar_url: null },
    ];
    const sides = resolveMemberSides(m, 'p');
    expect(sides.memberA?.id).toBe('a');
    expect(sides.memberB?.id).toBe('p');
  });
});

describe('pickPayerUiMembers', () => {
  it('returns one Andrei when two profiles differ only by script', () => {
    const m = [
      { id: 'x', display_name: 'Andrei', avatar_url: 'https://a.png' },
      { id: 'y', display_name: 'Андрей', avatar_url: null },
      { id: 'z', display_name: 'Полина', avatar_url: null },
    ];
    const { andrei, polina } = pickPayerUiMembers(m, 'z');
    expect(andrei?.id).toBe('x');
    expect(polina?.id).toBe('z');
  });
});

describe('filterExpensesByMemberChip (manual checklist as tests)', () => {
  const sides = resolveMemberSides(members, 'id-a');
  const expenses = [
    { id: '1', split: 'equal', paid_by: 'id-a', amount: '100', description: 'Общее' },
    { id: '2', split: 'full_payer', paid_by: 'id-a', amount: '50', description: 'Андрей платит' },
    { id: '3', split: 'full_payer', paid_by: 'id-b', amount: '30', description: 'Полина платит' },
    { id: '4', split: 'full_payer', paid_by: 'old-andrei-uuid', amount: '20', description: 'Legacy', profiles: { display_name: 'Андрей' } },
    { id: '5', split: 'full_payer', paid_by: 'old-polina-uuid', amount: '15', description: 'Legacy', profiles: { display_name: 'Polina' } },
  ];

  it('Все: показывает все расходы', () => {
    expect(filterExpensesByMemberChip(expenses, null, sides)).toHaveLength(5);
    expect(filterExpensesByMemberChip(expenses, undefined, sides)).toHaveLength(5);
  });

  it('Андрей: full_payer Андрея + legacy UUID с display_name Андрей; Общее не попадает', () => {
    const out = filterExpensesByMemberChip(expenses, sides.memberA?.id, sides);
    expect(out.map((e) => e.id)).toEqual(['2', '4']);
  });

  it('Полина: full_payer Полины + legacy UUID с display_name Polina; Общее не попадает', () => {
    const out = filterExpensesByMemberChip(expenses, sides.memberB?.id, sides);
    expect(out.map((e) => e.id)).toEqual(['3', '5']);
  });

  it('плейсхолдеры отключённых чипов дают пустой список', () => {
    expect(filterExpensesByMemberChip(expenses, MISSING_ANDREI_ID, sides)).toEqual([]);
    expect(filterExpensesByMemberChip(expenses, MISSING_POLINA_ID, sides)).toEqual([]);
  });
});

describe('resolvePayerLabel', () => {
  const sides = resolveMemberSides(members, 'id-a');

  it('equal → Общее', () => {
    expect(resolvePayerLabel({ split: 'equal', paid_by: 'id-a' }, sides)).toBe('Общее');
  });

  it('known andreiId → Андрей', () => {
    expect(resolvePayerLabel({ split: 'full_payer', paid_by: 'id-a' }, sides)).toBe('Андрей');
  });

  it('known polinaId → Полина', () => {
    expect(resolvePayerLabel({ split: 'full_payer', paid_by: 'id-b' }, sides)).toBe('Полина');
  });

  it('unknown paid_by but profiles.display_name contains "Андрей" → Андрей', () => {
    const exp = { split: 'full_payer', paid_by: 'old-uuid', profiles: { display_name: 'Андрей' } };
    expect(resolvePayerLabel(exp, sides)).toBe('Андрей');
  });

  it('unknown paid_by and no display_name → empty string', () => {
    const exp = { split: 'full_payer', paid_by: 'old-uuid' };
    expect(resolvePayerLabel(exp, sides)).toBe('');
  });

  it('Полина с отображаемым именем «Личное» — full_payer показывает Полина', () => {
    const m = [
      { id: 'id-a', display_name: 'Андрей', avatar_url: null },
      { id: 'id-b', display_name: 'Личное', avatar_url: null },
    ];
    const sidesPolina = resolveMemberSides(m, 'id-a');
    expect(sidesPolina.memberB?.id).toBe('id-b');
    expect(resolvePayerLabel({ split: 'full_payer', paid_by: 'id-b' }, sidesPolina)).toBe('Полина');
  });

  it('Андрей в профиле «Личное»: у второго участника не показываем сырое «Личное»', () => {
    const m = [
      { id: 'id-a', display_name: 'Личное', avatar_url: null, created_at: '2026-01-01' },
      { id: 'id-b', display_name: 'Полина', avatar_url: null, created_at: '2026-01-02' },
    ];
    const sidesFromPolina = resolveMemberSides(m, 'id-b');
    const exp = {
      split: 'full_payer',
      paid_by: 'id-a',
      profiles: { display_name: 'Личное' },
    };
    expect(resolvePayerLabel(exp, sidesFromPolina)).toBe('Андрей');
  });

  it('expenseJoinedProfileName: profiles-массив из PostgREST', () => {
    expect(
      expenseJoinedProfileName({
        profiles: [{ display_name: 'Личное' }],
      }),
    ).toBe('Личное');
  });
});

describe('resolvePayerSide', () => {
  const sides = resolveMemberSides(members, 'id-a');

  it('null sides → null', () => {
    expect(resolvePayerSide('id-a', null)).toBe(null);
  });

  it('known andreiId → a', () => {
    expect(resolvePayerSide('id-a', sides)).toBe('a');
  });

  it('known polinaId → b', () => {
    expect(resolvePayerSide('id-b', sides)).toBe('b');
  });

  it('unknown UUID + display_name "Андрей" → a', () => {
    expect(resolvePayerSide('old-uuid', sides, 'Андрей')).toBe('a');
  });

  it('unknown UUID + display_name "polina" → b', () => {
    expect(resolvePayerSide('old-uuid', sides, 'polina')).toBe('b');
  });

  it('memberA/memberB id beat overlapping andreiIds/polinaIds', () => {
    const overlapSides = {
      memberA: { id: 'u1' },
      memberB: { id: 'u2' },
      andreiIds: new Set(['u1', 'u2']),
      polinaIds: new Set(['u1', 'u2']),
    };
    expect(resolvePayerSide('u1', overlapSides)).toBe('a');
    expect(resolvePayerSide('u2', overlapSides)).toBe('b');
  });

  it('completely unknown → null', () => {
    expect(resolvePayerSide('old-uuid', sides)).toBe(null);
    expect(resolvePayerSide('old-uuid', sides, '')).toBe(null);
  });
});
