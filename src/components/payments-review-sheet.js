// Лист «Нашли оплаты»: слипы из Фото и присланные через «Поделиться».
// Каждую строку можно поправить (сумма, описание, категория) или снять галочку; добавляем одним нажатием.
import { getState, isSolo } from '../lib/store.js';
import { addExpense, uploadReceipt } from '../lib/supabase.js';
import { CURRENCIES, escapeHtml, formatDate, icon, todayStr } from '../lib/utils.js';
import { categoryLabel, t } from '../lib/i18n.js';
import { slipCategoryId, slipDescription } from '../lib/slips.js';
import { memberDisplayLabel, resolveMemberSides } from '../lib/member-filters.js';
import { enableModalSwipe } from './modal-swipe.js';
import { clearInbox, markSeen, photoBlob, seenKeys } from '../services/capture.js';
import { showToast } from '../services/toast.js';
import { hapticSelect, hapticSuccess } from '../services/haptics.js';
import { soundAdd } from '../services/sounds.js';
import { getReadableError } from '../services/errors.js';

const e = escapeHtml;

export function openPaymentsReviewSheet(items, { onDone, defaultPayerId = 'shared', defaultCategoryId = null } = {}) {
  const { categories, couple, profile, members } = getState();
  const sides = resolveMemberSides(members);
  const payerMembers = [sides.memberA, sides.memberB].filter(Boolean);
  const cur = CURRENCIES[couple?.currency]?.[0] || couple?.currency || '';
  const otherCurrency = couple?.currency && couple.currency !== 'THB';

  const rows = items.map((it, i) => ({
    ...it,
    idx: i,
    checked: !it.alreadyAdded,
    description: slipDescription(it.slip, t('capture.transfer')) || t('capture.payment'),
    categoryId: slipCategoryId(it.slip, categories, categoryLabel, defaultCategoryId),
  }));

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const meta = (s) => [s.provider, s.date ? formatDate(s.date) : null, s.time].filter(Boolean).join(' · ');
  backdrop.innerHTML = `
    <div class="modal-sheet has-footer">
     <div class="sheet-body">
      <div class="modal-handle"></div>
      <div class="modal-title">${t('capture.foundTitle', { n: rows.length })}</div>
      <p class="capture-sub">${t(otherCurrency ? 'capture.foundSubCurrency' : 'capture.foundSub', { cur: couple?.currency || '' })}</p>
      <div class="pay-list">
        ${rows.map((r) => `
        <div class="pay-row ${r.checked ? 'on' : ''}" data-idx="${r.idx}">
          <button type="button" class="pay-check" aria-label="${t('capture.include')}">${icon('check', 14, '#fff', 3)}</button>
          <div class="pay-thumb" data-thumb="${r.idx}"></div>
          <div class="pay-main">
            <input class="pay-desc" value="${e(r.description)}" aria-label="${t('home.description')}">
            <div class="pay-meta">${r.alreadyAdded ? `<b class="pay-dup">${t('capture.alreadyShort')}</b> · ` : ''}${e(meta(r.slip))}</div>
            <select class="pay-cat" aria-label="${t('common.category')}">
              ${categories.map((c) => `<option value="${c.id}" ${c.id === r.categoryId ? 'selected' : ''}>${e(categoryLabel(c.name))}</option>`).join('')}
            </select>
          </div>
          <label class="pay-amount"><span>${e(cur)}</span><input type="number" inputmode="decimal" step="0.01" min="0" value="${r.slip.amount ?? ''}" aria-label="${t('common.amount')}"></label>
        </div>`).join('')}
      </div>
      ${isSolo() ? '' : `
      <div class="form-group" style="margin-top:14px;">
        <label class="form-label">${t('home.whoPays')}</label>
        <div class="payer-options">
          <div class="payer-option ${defaultPayerId === 'shared' ? 'selected' : ''}" data-id="shared">
            <div class="payer-avatar payer-avatar-initials shared">${icon('heart', 13, '#fff', 2.4)}</div><span>${t('common.shared')}</span>
          </div>
          ${payerMembers.map((m) => `
          <div class="payer-option ${defaultPayerId === m.id ? 'selected' : ''}" data-id="${m.id}">
            <div class="payer-avatar payer-avatar-initials ${m.id === sides.memberB?.id ? 'b' : 'a'}">${e(memberDisplayLabel(m)[0] || '')}</div><span>${e(memberDisplayLabel(m))}</span>
          </div>`).join('')}
        </div>
      </div>`}
     </div>
      <div class="sheet-footer">
        <button class="btn btn-primary" id="btn-add-payments"></button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  enableModalSwipe(backdrop);

  const objectUrls = [];
  let finished = false;
  let attempted = false; // пытались добавлять — значит, решение по строкам принято
  const close = async (added) => {
    if (finished) return;
    finished = true;
    // Закрыли не добавляя — это отказ от всех; после попытки — снимаем галочки-отказы,
    // а не записавшиеся из-за сети остаются (предложим снова)
    const done = attempted ? rows.filter((r) => r.added || !r.checked) : rows;
    markSeen(done.flatMap(seenKeys));
    await clearInbox(done);
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    backdrop.remove();
    onDone?.(added);
  };
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) close(0); });
  // Свайп вниз удаляет лист сам — ловим это, чтобы отметить слипы просмотренными
  new MutationObserver((_, obs) => {
    if (!backdrop.isConnected) { obs.disconnect(); if (!finished) close(0); }
  }).observe(document.body, { childList: true });

  // Миниатюры: картинка из входящих уже есть, из Фото — подгружаем лениво
  rows.forEach(async (r) => {
    try {
      const blob = r.blob || (r.assetId ? await photoBlob(r.assetId) : null);
      if (!blob) return;
      r.blob = blob;
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      const el = backdrop.querySelector(`[data-thumb="${r.idx}"]`);
      if (el) el.style.backgroundImage = `url(${url})`;
    } catch { /* миниатюра не обязательна */ }
  });

  const btn = backdrop.querySelector('#btn-add-payments');
  const refresh = () => {
    const n = rows.filter((r) => r.checked).length;
    btn.textContent = n ? t('capture.addN', { n }) : t('capture.skipAll');
  };
  refresh();

  // Поле суммы по ширине числа — символ валюты стоит вплотную
  const fit = (input) => { input.style.width = `${Math.max(2, (input.value || '0').length) + 0.6}ch`; };
  backdrop.querySelectorAll('.pay-amount input').forEach((input) => {
    fit(input);
    input.addEventListener('input', () => fit(input));
  });

  backdrop.querySelectorAll('.pay-row').forEach((rowEl) => {
    const r = rows[Number(rowEl.dataset.idx)];
    rowEl.querySelector('.pay-check').addEventListener('click', () => {
      r.checked = !r.checked;
      rowEl.classList.toggle('on', r.checked);
      hapticSelect();
      refresh();
    });
  });
  backdrop.querySelectorAll('.payer-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      backdrop.querySelectorAll('.payer-option').forEach((o) => o.classList.remove('selected'));
      opt.classList.add('selected');
      hapticSelect();
    });
  });

  btn.addEventListener('click', async () => {
    const chosen = rows.filter((r) => r.checked);
    if (!chosen.length) { close(0); return; }
    // Читаем правки из полей
    for (const r of chosen) {
      const rowEl = backdrop.querySelector(`.pay-row[data-idx="${r.idx}"]`);
      r.amount = parseFloat(rowEl.querySelector('.pay-amount input').value);
      r.description = rowEl.querySelector('.pay-desc').value.trim() || t('capture.payment');
      r.categoryId = rowEl.querySelector('.pay-cat').value;
    }
    const bad = chosen.find((r) => !(r.amount > 0));
    if (bad) {
      showToast(t('common.enterAmount'));
      backdrop.querySelector(`.pay-row[data-idx="${bad.idx}"] .pay-amount input`)?.focus();
      return;
    }
    const payerId = backdrop.querySelector('.payer-option.selected')?.dataset.id || (isSolo() ? profile.id : 'shared');
    const isShared = payerId === 'shared';
    btn.disabled = true;
    attempted = true;
    btn.textContent = t('capture.adding');
    let added = 0;
    const created = [];
    for (const r of chosen) {
      try {
        let receiptPath = null;
        if (r.blob) {
          try { receiptPath = await uploadReceipt(r.blob, couple.id); } catch { /* чек не критичен */ }
        }
        created.push(await addExpense({
          couple_id: couple.id,
          category_id: r.categoryId,
          paid_by: isShared ? profile.id : payerId,
          amount: Math.round(r.amount * 100) / 100,
          description: r.description,
          split: isShared ? 'equal' : 'full_payer',
          split_payer_pct: 50,
          expense_date: r.slip.date && r.slip.date <= todayStr() ? r.slip.date : todayStr(),
          currency: couple.currency || 'USD',
          receipt_url: receiptPath,
        }));
        added += 1;
        r.added = true;
        // Сразу помечаем добавленным — если приложение закроют посреди списка, слип не задвоится
        markSeen(seenKeys(r));
        await clearInbox([r]);
      } catch (err) {
        showToast(t('common.error', { msg: getReadableError(err) }));
        break;
      }
    }
    if (added) {
      hapticSuccess();
      soundAdd();
      showToast(t('capture.added', { n: added }));
    }
    if (added < chosen.length) {
      // Часть не записалась (сеть) — оставляем лист открытым с непрошедшими
      chosen.slice(0, added).forEach((r) => {
        r.checked = false;
        backdrop.querySelector(`.pay-row[data-idx="${r.idx}"]`)?.remove();
      });
      btn.disabled = false;
      refresh();
      onDone?.(added, created);
      return;
    }
    await close(added);
  });
}
