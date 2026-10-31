// Лист «Нашли оплаты»: слипы из Фото и присланные через «Поделиться».
// Каждую строку можно поправить (сумма, описание, категория) или снять галочку; добавляем одним нажатием.
import { getState, isSolo } from '../lib/store.js';
import { addExpense, uploadReceipt } from '../lib/supabase.js';
import { CURRENCIES, catTile, escapeHtml, formatDate, icon, todayStr } from '../lib/utils.js';
import { categoryLabel, t } from '../lib/i18n.js';
import { isPersonTransfer, slipCategoryId, slipDescription } from '../lib/slips.js';
import { memberDisplayLabel, resolveMemberSides } from '../lib/member-filters.js';
import { enableModalSwipe } from './modal-swipe.js';
import { clearInbox, markSeen, photoBlob, seenKeys } from '../services/capture.js';
import { showToast } from '../services/toast.js';
import { hapticSelect, hapticSuccess } from '../services/haptics.js';
import { soundAdd } from '../services/sounds.js';
import { getReadableError } from '../services/errors.js';

const e = escapeHtml;

export function openPaymentsReviewSheet(items, { onDone, defaultPayerId = 'shared', defaultCategoryId = null } = {}) {
  const { categories, couple, profile, members, expenses } = getState();
  const sides = resolveMemberSides(members);
  const payerMembers = [sides.memberA, sides.memberB].filter(Boolean);
  const cur = CURRENCIES[couple?.currency]?.[0] || couple?.currency || '';
  const otherCurrency = couple?.currency && couple.currency !== 'THB';

  // Переводу человеку — категорию, которую уже ставили этому получателю
  const pastCategoryId = (receiver) => {
    if (!receiver) return null;
    const needle = receiver.toLowerCase();
    const past = (expenses || []).find((x) => x.description?.toLowerCase().includes(needle) && categories.some((c) => c.id === x.category_id));
    return past?.category_id || null;
  };
  const rows = items.map((it, i) => {
    const person = isPersonTransfer(it.slip);
    return {
      ...it,
      idx: i,
      checked: !it.alreadyAdded,
      title: slipDescription(it.slip, t('capture.transfer')) || t('capture.payment'),
      // Название у перевода человеку пустое — его вводят сами; у магазина подставляем
      description: person ? '' : (slipDescription(it.slip) || ''),
      categoryId: (person && pastCategoryId(it.slip.receiver)) || slipCategoryId(it.slip, categories, categoryLabel, defaultCategoryId),
    };
  });

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
            <div class="pay-title">${e(r.title)}</div>
            <div class="pay-meta">${r.alreadyAdded ? `<b class="pay-dup">${t('capture.alreadyShort')}</b> · ` : ''}${e(meta(r.slip))}</div>
          </div>
          <label class="pay-amount"><span>${e(cur)}</span><input type="number" inputmode="decimal" step="0.01" min="0" value="${r.slip.amount ?? ''}" aria-label="${t('common.amount')}"></label>
          <div class="pay-extra">
            <input type="text" class="form-input pay-desc" value="${e(r.description)}" placeholder="${t('capture.namePlaceholder')}" autocomplete="off" aria-label="${t('home.description')}">
            <div class="pay-cats" role="radiogroup" aria-label="${t('common.category')}">
              ${categories.map((c) => `
              <button type="button" class="cat-option ${c.id === r.categoryId ? 'selected' : ''}" data-cat="${c.id}" role="radio" aria-checked="${c.id === r.categoryId}">
                ${catTile(c.icon, c.color, 38)}
                <span class="cat-name">${e(categoryLabel(c.name))}</span>
              </button>`).join('')}
            </div>
          </div>
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
    const strip = rowEl.querySelector('.pay-cats');
    strip.querySelectorAll('.cat-option').forEach((opt) => {
      opt.addEventListener('click', () => {
        strip.querySelectorAll('.cat-option').forEach((o) => { o.classList.remove('selected'); o.setAttribute('aria-checked', 'false'); });
        opt.classList.add('selected');
        opt.setAttribute('aria-checked', 'true');
        r.categoryId = opt.dataset.cat;
        hapticSelect();
      });
    });
    // Выбранная категория сразу видна, даже если она в конце ленты
    requestAnimationFrame(() => strip.querySelector('.selected')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
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
      r.description = rowEl.querySelector('.pay-desc').value.trim() || r.title;
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
