// Реакции и реплики под тратой: значки в строке списка и блок в карточке расхода.
import { getState } from '../lib/store.js';
import { addExpenseComment, deleteExpenseReaction, setExpenseReaction } from '../lib/supabase.js';
import { REACTION_EMOJIS, nextReaction, summarizeReactions, withMyEmoji } from '../lib/reactions.js';
import { escapeHtml, icon } from '../lib/utils.js';
import { memberDisplayLabel, resolveMemberSides } from '../lib/member-filters.js';
import { t } from '../lib/i18n.js';
import { hapticSelect, hapticSuccess } from '../services/haptics.js';
import { showToast } from '../services/toast.js';
import { getReadableError } from '../services/errors.js';

const e = escapeHtml;

// Значки в строке траты: эмодзи обоих и счётчик реплик
export function reactionBadgesHtml(expense) {
  const { emojis, comments } = summarizeReactions(expense.expense_reactions, getState().profile?.id);
  if (!emojis.length && !comments.length) return '';
  return `<span class="tx-reacts">${emojis.map((r) => `<i>${e(r.emoji)}</i>`).join('')}${comments.length ? `<i class="tx-reacts-count">${icon('message-circle', 11, 'currentColor', 2.4)}${comments.length}</i>` : ''}</span>`;
}

// Блок в карточке расхода. onChange — перерисовать список под карточкой.
export function mountExpenseReactions(host, expense, { onChange } = {}) {
  const { profile, members } = getState();
  const sides = resolveMemberSides(members);
  const sideOf = (id) => (id === sides.memberB?.id ? 'b' : 'a');
  const nameOf = (id) => memberDisplayLabel((members || []).find((m) => m.id === id)) || '';
  let busy = false;

  const render = () => {
    const { emojis, comments, myEmoji } = summarizeReactions(expense.expense_reactions, profile?.id);
    const partnerEmoji = emojis.find((r) => !r.mine);
    host.innerHTML = `
      <div class="react-bar" role="group" aria-label="${t('react.title')}">
        ${REACTION_EMOJIS.map((em) => `<button type="button" class="react-btn ${myEmoji === em ? 'on' : ''}" data-emoji="${em}" aria-pressed="${myEmoji === em}">${em}</button>`).join('')}
      </div>
      ${partnerEmoji ? `<div class="react-partner">${t('react.partnerReacted', { name: e(nameOf(partnerEmoji.author_id)), emoji: e(partnerEmoji.emoji) })}</div>` : ''}
      ${comments.length ? `<div class="react-thread">
        ${comments.map((c) => `
        <div class="react-msg ${c.mine ? 'mine' : ''}">
          <div class="mini-avatar ${sideOf(c.author_id) === 'b' ? 'b' : ''}">${e((nameOf(c.author_id) || '?')[0])}</div>
          <div class="react-bubble">${e(c.comment)}</div>
          ${c.mine ? `<button type="button" class="react-del" data-del="${c.id}" aria-label="${t('common.delete')}">${icon('x', 13)}</button>` : ''}
        </div>`).join('')}
      </div>` : ''}
      <form class="react-form">
        <input type="text" class="form-input" maxlength="280" placeholder="${t('react.placeholder')}" autocomplete="off" aria-label="${t('react.placeholder')}">
        <button type="submit" class="icon-btn" aria-label="${t('react.send')}">${icon('send', 17)}</button>
      </form>`;
    // Только что отправленная реплика должна быть видна, а не под сгибом
    const thread = host.querySelector('.react-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;

    host.querySelectorAll('.react-btn').forEach((btn) => {
      btn.addEventListener('click', () => run(async () => {
        const emoji = nextReaction(myEmoji, btn.dataset.emoji);
        hapticSelect();
        const row = await setExpenseReaction(expense, emoji);
        expense.expense_reactions = withMyEmoji(expense.expense_reactions, profile?.id, row);
      }));
    });
    host.querySelectorAll('.react-del').forEach((btn) => {
      btn.addEventListener('click', () => run(async () => {
        await deleteExpenseReaction(btn.dataset.del);
        expense.expense_reactions = (expense.expense_reactions || []).filter((r) => r.id !== btn.dataset.del);
      }));
    });
    host.querySelector('.react-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const text = host.querySelector('.react-form input').value.trim();
      if (!text) return;
      run(async () => {
        const row = await addExpenseComment(expense, text);
        expense.expense_reactions = [...(expense.expense_reactions || []), row];
        hapticSuccess();
      });
    });
  };

  // Одно действие за раз: двойное нажатие не должно создать две записи
  const run = async (action) => {
    if (busy) return;
    busy = true;
    try {
      await action();
      render();
      onChange?.();
    } catch (err) {
      showToast(t('common.error', { msg: getReadableError(err) }));
    } finally {
      busy = false;
    }
  };

  render();
}
