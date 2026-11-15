import { describe, it, expect } from 'vitest';
import { nextReaction, summarizeReactions, withMyEmoji } from './reactions.js';

const ME = 'me';
const PARTNER = 'p';
const rows = [
  { id: '3', author_id: ME, comment: 'вкусно было', created_at: '2026-11-03T10:00:00Z' },
  { id: '1', author_id: PARTNER, emoji: '❤️', created_at: '2026-11-01T10:00:00Z' },
  { id: '2', author_id: ME, emoji: '😂', created_at: '2026-11-02T10:00:00Z' },
  { id: '4', author_id: PARTNER, comment: 'повторим', created_at: '2026-11-04T10:00:00Z' },
];

describe('summarizeReactions', () => {
  it('делит на эмодзи и реплики, по времени, с пометкой своих', () => {
    const s = summarizeReactions(rows, ME);
    expect(s.emojis.map((r) => [r.emoji, r.mine])).toEqual([['❤️', false], ['😂', true]]);
    expect(s.comments.map((r) => r.comment)).toEqual(['вкусно было', 'повторим']);
    expect(s.myEmoji).toBe('😂');
  });
  it('пусто и мусор не ломают', () => {
    expect(summarizeReactions(undefined, ME)).toEqual({ emojis: [], comments: [], myEmoji: null });
    expect(summarizeReactions(null, ME).myEmoji).toBeNull();
  });
});

describe('nextReaction', () => {
  it('повторное нажатие снимает, другое — заменяет', () => {
    expect(nextReaction('❤️', '❤️')).toBeNull();
    expect(nextReaction('❤️', '😂')).toBe('😂');
    expect(nextReaction(null, '👍')).toBe('👍');
  });
});

describe('withMyEmoji', () => {
  it('заменяет свою эмодзи, чужую и реплики не трогает', () => {
    const next = withMyEmoji(rows, ME, { id: '9', author_id: ME, emoji: '🔥' });
    expect(next.filter((r) => r.emoji).map((r) => r.emoji).sort()).toEqual(['❤️', '🔥'].sort());
    expect(next.filter((r) => r.comment)).toHaveLength(2);
  });
  it('снятие убирает только свою', () => {
    expect(withMyEmoji(rows, ME, null).filter((r) => r.emoji).map((r) => r.id)).toEqual(['1']);
  });
});
