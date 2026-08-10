import { t } from './i18n.js';

/** Placeholder id for a partner who has not joined the couple yet (disabled chip). */
export const MISSING_PARTNER_ID = '__missing_partner__';

/** Normalize profile id for comparisons (UUID string quirks). */
export function pid(id) {
  return String(id ?? '').trim();
}

/** display_name from Supabase join `profiles!paid_by` (object or array). */
export function expenseJoinedProfileName(expense) {
  const p = expense?.profiles;
  if (!p) return undefined;
  if (Array.isArray(p)) return p[0]?.display_name;
  return p.display_name;
}

function normalizedName(name) {
  return (name || '').trim().toLowerCase();
}

/** Stable member order (same couple across reloads): created_at, then id. */
function sortMembersStable(list) {
  return [...list].sort((a, b) => {
    const ca = a.created_at || '';
    const cb = b.created_at || '';
    if (ca !== cb) return String(ca).localeCompare(String(cb));
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

/**
 * UI label for a couple member: display_name, otherwise a neutral fallback.
 * @param {{ display_name?: string } | null | undefined} member
 */
export function memberDisplayLabel(member) {
  const name = (member?.display_name || '').trim();
  return name || t('common.partner');
}

/**
 * Resolve the two sides of the couple from actual profiles.
 * Order is stable: first by created_at (first joined = memberA, second = memberB).
 * No name guessing/canonicalization — display_name is only used for UI labels.
 * @param {Array<{ id: string, display_name?: string, avatar_url?: string | null, created_at?: string }>} members
 */
export function resolveMemberSides(members) {
  const list = sortMembersStable(members || []);
  const memberA = list[0] || null;
  const memberB = list[1] || null;
  const pairOrder = list.map((m) => pid(m.id)).filter(Boolean);
  return { memberA, memberB, pairOrder };
}

/**
 * Determine which side a paid_by UUID belongs to: 'a' (memberA), 'b' (memberB), or null.
 * Uses ids first; for legacy expenses (paid_by points to a recreated/old profile row)
 * falls back to matching the joined profiles.display_name against current member names.
 * @param {string} paidBy
 * @param {ReturnType<typeof resolveMemberSides>} sides
 * @param {string} [displayName] - profiles.display_name from the expense join
 * @returns {'a' | 'b' | null}
 */
export function resolvePayerSide(paidBy, sides, displayName) {
  if (!sides) return null;
  const p = pid(paidBy);
  if (!p) return null;
  if (sides.memberA && p === pid(sides.memberA.id)) return 'a';
  if (sides.memberB && p === pid(sides.memberB.id)) return 'b';
  const name = normalizedName(displayName);
  if (name) {
    if (sides.memberA && name === normalizedName(sides.memberA.display_name)) return 'a';
    if (sides.memberB && name === normalizedName(sides.memberB.display_name)) return 'b';
  }
  return null;
}

/**
 * Resolve a human-readable payer label for one expense row.
 * Falls back to the snapshot name of a deleted member, then to the joined
 * profiles.display_name, then to ''.
 * @param {{ split: string, paid_by: string, profiles?: { display_name?: string }, paid_by_snapshot_name?: string }} expense
 * @param {ReturnType<typeof resolveMemberSides>} sides
 */
export function resolvePayerLabel(expense, sides) {
  if (expense.split === 'equal') return t('common.shared');
  const joinedName = expenseJoinedProfileName(expense);
  const side = resolvePayerSide(expense.paid_by, sides, joinedName);
  if (side === 'a') return memberDisplayLabel(sides.memberA);
  if (side === 'b') return memberDisplayLabel(sides.memberB);
  // Snapshot-имя (профиль удалён, paid_by=null, joinedName=null)
  const snapshot = expense.paid_by_snapshot_name;
  if (snapshot) return snapshot;
  return joinedName || '';
}

/**
 * Filter expenses by top filter chip (all / memberA / memberB / legacy paid_by).
 * Shared (`split === 'equal'`) never appears under individual member filters.
 * Uses `resolvePayerSide` so expenses with legacy/old profile UUIDs are matched correctly.
 * @param {Array<{ split: string, paid_by: string, amount?: string, profiles?: { display_name?: string } }>} expenses
 * @param {string | null | undefined} filterBy
 * @param {ReturnType<typeof resolveMemberSides>} sides
 */
export function filterExpensesByMemberChip(expenses, filterBy, sides) {
  const { memberA, memberB } = sides;
  if (!filterBy) return expenses;
  if (filterBy === MISSING_PARTNER_ID) return [];
  if (memberA && filterBy === memberA.id) {
    return expenses.filter(
      (expense) =>
        expense.split === 'full_payer' &&
        resolvePayerSide(expense.paid_by, sides, expenseJoinedProfileName(expense)) === 'a',
    );
  }
  if (memberB && filterBy === memberB.id) {
    return expenses.filter(
      (expense) =>
        expense.split === 'full_payer' &&
        resolvePayerSide(expense.paid_by, sides, expenseJoinedProfileName(expense)) === 'b',
    );
  }
  return expenses.filter((expense) => expense.paid_by === filterBy);
}
