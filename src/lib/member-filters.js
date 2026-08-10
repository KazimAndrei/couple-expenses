import { t } from './i18n.js';

/** Placeholder ids when member row is missing (disabled chips). */
export const MISSING_ANDREI_ID = '__missing_andrei__';
export const MISSING_POLINA_ID = '__missing_polina__';

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

export function nameLooksAndrei(displayName) {
  const n = normalizedName(displayName);
  return n.includes('андрей') || n.includes('andrei');
}

export function nameLooksPolina(displayName) {
  const n = normalizedName(displayName);
  return n.includes('полина') || n.includes('polina') || n.includes('поліна');
}

function pickBestMember(list, profileId) {
  return (
    list.find((m) => m.avatar_url) || list.find((m) => m.id === profileId) || list[0] || null
  );
}

/** Stable order for two-member fallback (same couple across reloads). */
function sortMembersStable(list) {
  return [...list].sort((a, b) => {
    const ca = a.created_at || '';
    const cb = b.created_at || '';
    if (ca !== cb) return String(ca).localeCompare(String(cb));
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

/**
 * Resolve "Андрей" / "Полина" sides and id sets for filters (same rules as home + analytics).
 * Never puts the current user in the "Андрей" slot unless their name matches Andrei
 * (fixes: two "Андрей" / missing Polina when Polina was wrongly used as Andrei).
 * @param {Array<{ id: string, display_name?: string, avatar_url?: string | null }>} members
 * @param {string | undefined} profileId
 */
export function resolveMemberSides(members, profileId) {
  const list = members || [];
  const me = list.find((member) => member.id === profileId) || null;
  const andreiCandidates = list.filter((member) => nameLooksAndrei(member.display_name));
  const polinaCandidates = list.filter((member) => nameLooksPolina(member.display_name));
  const andreiIdSet = new Set(andreiCandidates.map((m) => m.id));

  let memberA =
    pickBestMember(andreiCandidates, profileId) ||
    (me && nameLooksAndrei(me.display_name) ? me : null) ||
    null;
  let memberB =
    pickBestMember(polinaCandidates, profileId) ||
    (me && nameLooksPolina(me.display_name) ? me : null) ||
    null;

  if (memberB?.id === memberA?.id) memberB = null;

  if (!memberB && memberA) {
    const others = list.filter((m) => m.id !== memberA.id);
    const notAndreiNamed = others.filter((m) => !andreiIdSet.has(m.id));
    memberB = pickBestMember(notAndreiNamed, profileId) || null;
  }
  if (!memberA && memberB) {
    const others = list.filter((m) => m.id !== memberB.id);
    const notPolinaNamed = others.filter((m) => !polinaCandidates.some((p) => p.id === m.id));
    memberA = pickBestMember(notPolinaNamed, profileId) || pickBestMember(others, profileId) || null;
  }
  if (memberA && memberB?.id === memberA.id) memberB = null;

  if (!memberA && !memberB && list.length === 2) {
    const s = sortMembersStable(list);
    memberA = s[0];
    memberB = s[1];
  } else if (memberA && !memberB && list.length === 2) {
    memberB = list.find((m) => m.id !== memberA.id) || null;
  } else if (!memberA && memberB && list.length === 2) {
    memberA = list.find((m) => m.id !== memberB.id) || null;
  }

  if (memberB?.id === memberA?.id) memberB = null;

  const andreiIds = new Set(andreiCandidates.map((m) => pid(m.id)));
  if (memberA && !andreiIds.has(pid(memberA.id))) andreiIds.add(pid(memberA.id));
  const polinaIds = new Set(polinaCandidates.map((m) => pid(m.id)));
  if (memberB && !polinaIds.has(pid(memberB.id))) polinaIds.add(pid(memberB.id));

  const pairOrder =
    list.length === 2 ? sortMembersStable(list).map((m) => pid(m.id)).filter(Boolean) : null;

  return { memberA, memberB, andreiIds, polinaIds, pairOrder };
}

/**
 * One profile per side for payer UI (add modal chips, edit &lt;select&gt;): avoids two "Андрей"
 * when names differ only by script ("Andrei" vs "Андрей").
 * @param {Array<{ id: string, display_name?: string, avatar_url?: string | null }>} members
 * @param {string | undefined} profileId
 * @returns {{ andrei: object | null, polina: object | null, sides: ReturnType<typeof resolveMemberSides> }}
 */
export function pickPayerUiMembers(members, profileId) {
  const sides = resolveMemberSides(members, profileId);
  const list = members || [];
  const pick = (predicate) =>
    pickBestMember(list.filter(predicate), profileId);
  const andrei = pick((m) => resolvePayerSide(m.id, sides) === 'a');
  const polina = pick((m) => resolvePayerSide(m.id, sides) === 'b');
  return { andrei, polina, sides };
}

/**
 * Determine which "side" a paid_by UUID belongs to: 'a' (Андрей), 'b' (Полина), or null.
 * Uses id sets first, then falls back to profiles.display_name from the Supabase join.
 * @param {string} paidBy
 * @param {{ memberA?: { id: string } | null, memberB?: { id: string } | null, andreiIds: Set<string>, polinaIds: Set<string> }} sides
 * @param {string} [displayName] - profiles.display_name from the expense join
 * @returns {'a' | 'b' | null}
 */
export function resolvePayerSide(paidBy, sides, displayName) {
  if (!sides) return null;
  const p = pid(paidBy);
  if (!p) return null;
  if (sides.memberA && p === pid(sides.memberA.id)) return 'a';
  if (sides.memberB && p === pid(sides.memberB.id)) return 'b';
  if (sides.andreiIds.has(p)) return 'a';
  if (sides.polinaIds.has(p)) return 'b';
  if (nameLooksAndrei(displayName)) return 'a';
  if (nameLooksPolina(displayName)) return 'b';
  if (sides.pairOrder?.length === 2) {
    if (p === pid(sides.pairOrder[0])) return 'a';
    if (p === pid(sides.pairOrder[1])) return 'b';
  }
  return null;
}

/**
 * Resolve a human-readable payer label for one expense row.
 * Falls back to profiles.display_name from the joined relation, then to ''.
 * @param {{ split: string, paid_by: string, profiles?: { display_name?: string } }} expense
 * @param {ReturnType<typeof resolveMemberSides>} sides
 */
/** Raw payer name from DB that is a personal-book placeholder, not a person name. */
function looksLikePersonalPlaceholder(name) {
  const n = normalizedName(name);
  return n.startsWith('личн') || n === 'личный' || n === 'personal' || n === 'private';
}

export function resolvePayerLabel(expense, sides) {
  if (expense.split === 'equal') return t('common.shared');
  const joinedName = expenseJoinedProfileName(expense);
  const side = resolvePayerSide(expense.paid_by, sides, joinedName);
  if (side === 'a') return 'Андрей';
  if (side === 'b') return 'Полина';
  const payerId = pid(expense.paid_by);
  if (joinedName && looksLikePersonalPlaceholder(joinedName)) {
    if (sides.memberA && payerId === pid(sides.memberA.id)) return 'Андрей';
    if (sides.memberB && payerId === pid(sides.memberB.id)) return 'Полина';
    if (sides.pairOrder?.length === 2) {
      if (payerId === pid(sides.pairOrder[0])) return 'Андрей';
      if (payerId === pid(sides.pairOrder[1])) return 'Полина';
    }
    return 'Полина';
  }
  // Fallback на snapshot-имя (если профиль удалён, paid_by=null, joinedName=null)
  const snapshot = expense.paid_by_snapshot_name;
  if (snapshot) {
    if (nameLooksAndrei(snapshot)) return 'Андрей';
    if (nameLooksPolina(snapshot)) return 'Полина';
    return snapshot;
  }
  return joinedName || '';
}

/**
 * Filter expenses by top filter chip (Все / Андрей / Полина / legacy paid_by).
 * Shared (`split === 'equal'`) never appears under individual member filters.
 * Uses `resolvePayerSide` so expenses with legacy/old profile UUIDs are matched correctly.
 * @param {Array<{ split: string, paid_by: string, amount?: string, profiles?: { display_name?: string } }>} expenses
 * @param {string | null | undefined} filterBy
 * @param {ReturnType<typeof resolveMemberSides>} sides
 */
export function filterExpensesByMemberChip(expenses, filterBy, sides) {
  const { memberA, memberB } = sides;
  if (!filterBy) return expenses;
  if (filterBy === MISSING_ANDREI_ID || filterBy === MISSING_POLINA_ID) return [];
  if (filterBy === memberA?.id) {
    return expenses.filter(
      (expense) =>
        expense.split === 'full_payer' &&
        resolvePayerSide(expense.paid_by, sides, expenseJoinedProfileName(expense)) === 'a',
    );
  }
  if (filterBy === memberB?.id) {
    return expenses.filter(
      (expense) =>
        expense.split === 'full_payer' &&
        resolvePayerSide(expense.paid_by, sides, expenseJoinedProfileName(expense)) === 'b',
    );
  }
  return expenses.filter((expense) => expense.paid_by === filterBy);
}
