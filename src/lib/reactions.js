// Реакции и реплики под тратой (таблица expense_reactions): строка — либо эмодзи, либо комментарий.
export const REACTION_EMOJIS = ['❤️', '😂', '😮', '👍', '🙏', '🔥'];

const byTime = (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''));

// { emojis: [{ id, emoji, author_id, mine }], comments: [...по времени], myEmoji }
export function summarizeReactions(reactions, myId) {
  const list = Array.isArray(reactions) ? reactions : [];
  const emojis = list.filter((r) => r.emoji).sort(byTime).map((r) => ({ ...r, mine: r.author_id === myId }));
  const comments = list.filter((r) => r.comment).sort(byTime).map((r) => ({ ...r, mine: r.author_id === myId }));
  return { emojis, comments, myEmoji: emojis.find((r) => r.mine)?.emoji || null };
}

// Что получится после нажатия на эмодзи: та же — снять, другая — заменить
export function nextReaction(current, tapped) {
  return current === tapped ? null : tapped;
}

// Локальная копия списка после смены своей эмодзи — чтобы экран обновился до ответа сервера
export function withMyEmoji(reactions, myId, row) {
  const rest = (reactions || []).filter((r) => !(r.emoji && r.author_id === myId));
  return row ? [...rest, row] : rest;
}
