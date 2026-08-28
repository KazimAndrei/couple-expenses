import { addCategory, updateCategory, deleteCategory } from '../lib/supabase.js';
import { categoryIcons, escapeHtml, icon, safeColor } from '../lib/utils.js';
import { categoryLabel, t } from '../lib/i18n.js';
import { showToast } from '../services/toast.js';
import { getReadableError } from '../services/errors.js';
import { enableModalSwipe } from './modal-swipe.js';

const e = escapeHtml;

export const CATEGORY_COLORS = [
  '#EF9F27', '#E24B4A', '#7F77DD', '#378ADD', '#D4537E', '#1D9E75',
  '#D85A30', '#534AB7', '#888780', '#2BBBAD', '#FF6F61', '#6B5B95',
];

/**
 * Лист категории: создание (category = null) и редактирование одним кодом —
 * поля и превью в обоих случаях одинаковые.
 * @param {object|null} category редактируемая категория
 * @param {string} coupleId
 * @param {(action: 'created'|'updated'|'deleted') => void} onDone
 */
export function openCategorySheet({ category = null, coupleId, sortOrder = 1, onDone }) {
  const editing = Boolean(category);
  const startIcon = category?.icon && categoryIcons.includes(category.icon) ? category.icon : categoryIcons[0];
  const startColor = category?.color ? safeColor(category.color) : CATEGORY_COLORS[0];
  // У сидовых категорий в базе лежит английское имя, а на экране — перевод. Показываем
  // перевод, но в базу пишем только если пользователь действительно правил поле: иначе
  // смена одного лишь цвета переименовала бы «Groceries» в «Продукты» и сломала бы
  // отображение для партнёра с другим языком.
  const shownName = editing ? categoryLabel(category.name) : '';

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (ev) => { if (ev.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">${editing ? t('home.editCategory') : t('home.newCategory')}</div>
      <div class="cat-preview">
        <div class="cat-preview-dot" id="cat-preview-dot" style="background:${startColor}18">${icon(startIcon, 30, startColor)}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('home.icon')}</label>
        <div class="icon-grid" id="icon-picker">
          ${categoryIcons.map((n) => `
            <button type="button" class="icon-pick ${n === startIcon ? 'selected' : ''}" data-icon="${n}" aria-label="${n}">${icon(n, 22)}</button>
          `).join('')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('home.color')}</label>
        <div class="color-row" id="color-picker">
          ${CATEGORY_COLORS.map((c) => `<button type="button" class="color-dot ${c === startColor ? 'selected' : ''}" data-color="${c}" style="background:${c};" aria-label="${c}"></button>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('common.name')}</label>
        <input type="text" class="form-input" id="cat-name" placeholder="${t('home.catNamePlaceholder')}" autocomplete="off" value="${e(shownName)}">
      </div>
      <button class="btn btn-primary" id="btn-save-cat">${editing ? t('common.save') : t('common.create')}</button>
      ${editing ? `<button class="btn btn-danger" style="margin-top:8px;" id="btn-delete-cat">${t('home.deleteCategory')}</button>` : ''}
    </div>
  `;
  document.body.appendChild(backdrop);
  enableModalSwipe(backdrop);

  const pickedIcon = () => backdrop.querySelector('#icon-picker .icon-pick.selected')?.dataset.icon || startIcon;
  const pickedColor = () => backdrop.querySelector('#color-picker .color-dot.selected')?.dataset.color || startColor;

  const refreshPreview = () => {
    const dot = backdrop.querySelector('#cat-preview-dot');
    const col = pickedColor();
    dot.style.background = `${col}18`;
    dot.innerHTML = icon(pickedIcon(), 30, col);
  };

  backdrop.querySelectorAll('#icon-picker .icon-pick').forEach((opt) => {
    opt.addEventListener('click', () => {
      backdrop.querySelectorAll('#icon-picker .icon-pick').forEach((o) => o.classList.remove('selected'));
      opt.classList.add('selected');
      refreshPreview();
    });
  });
  backdrop.querySelectorAll('#color-picker .color-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      backdrop.querySelectorAll('#color-picker .color-dot').forEach((d) => d.classList.remove('selected'));
      dot.classList.add('selected');
      refreshPreview();
    });
  });

  backdrop.querySelector('#btn-save-cat').onclick = async () => {
    const btn = backdrop.querySelector('#btn-save-cat');
    const typed = backdrop.querySelector('#cat-name').value.trim();
    if (!typed) { showToast(t('common.enterTitle')); return; }
    btn.disabled = true;
    try {
      if (editing) {
        const patch = { icon: pickedIcon(), color: pickedColor() };
        if (typed !== shownName) patch.name = typed;
        await updateCategory(category.id, patch);
        backdrop.remove();
        onDone?.('updated');
      } else {
        await addCategory({ couple_id: coupleId, name: typed, icon: pickedIcon(), color: pickedColor(), sort_order: sortOrder });
        backdrop.remove();
        onDone?.('created');
      }
    } catch (err) {
      showToast(t('common.error', { msg: getReadableError(err) }));
      btn.disabled = false;
    }
  };

  backdrop.querySelector('#btn-delete-cat')?.addEventListener('click', () => {
    const confirmBackdrop = document.createElement('div');
    confirmBackdrop.className = 'modal-backdrop';
    confirmBackdrop.onclick = (ev) => { if (ev.target === confirmBackdrop) confirmBackdrop.remove(); };
    confirmBackdrop.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-title">${t('home.deleteCategory')}</div>
        <p style="font-size:14px; color:var(--c-text-secondary); margin-bottom:16px;">${t('home.deleteCategoryWarning', { name: e(shownName) })}</p>
        <button class="btn btn-danger" id="btn-confirm-cat-delete">${t('common.delete')}</button>
        <button class="btn btn-secondary" style="margin-top:8px;" id="btn-cancel-cat-delete">${t('common.cancel')}</button>
      </div>
    `;
    document.body.appendChild(confirmBackdrop);
    enableModalSwipe(confirmBackdrop);
    confirmBackdrop.querySelector('#btn-cancel-cat-delete').onclick = () => confirmBackdrop.remove();
    confirmBackdrop.querySelector('#btn-confirm-cat-delete').onclick = async () => {
      const btn = confirmBackdrop.querySelector('#btn-confirm-cat-delete');
      btn.disabled = true;
      try {
        await deleteCategory(category.id);
        confirmBackdrop.remove();
        backdrop.remove();
        onDone?.('deleted');
      } catch (err) {
        showToast(t('common.error', { msg: getReadableError(err) }));
        btn.disabled = false;
      }
    };
  });
}

/**
 * Долгое нажатие по плитке категории. Мышь и палец ведут себя одинаково,
 * а обычный тап (выбор категории) при этом не должен срабатывать.
 */
export function attachLongPress(el, handler, ms = 500) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  // Один жест — одно открытие: на десктопе правый клик присылает и pointerdown,
  // и contextmenu, а WebKit умеет присылать contextmenu ещё и на долгий тап.
  // Без этого флага лист открывался бы дважды.
  let fired = false;

  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };

  const fire = (ev) => {
    if (fired) return;
    fired = true;
    cancel();
    el.dataset.longPressed = '1';
    el.classList.remove('pressing');
    handler(ev);
  };

  el.addEventListener('pointerdown', (ev) => {
    // Только основная кнопка: правый клик обслуживается через contextmenu
    if (ev.button !== 0) return;
    fired = false;
    startX = ev.clientX; startY = ev.clientY;
    cancel();
    timer = setTimeout(() => { timer = null; fire(ev); }, ms);
    el.classList.add('pressing');
  });

  // Палец уехал — это скролл, а не удержание
  el.addEventListener('pointermove', (ev) => {
    if (!timer) return;
    if (Math.abs(ev.clientX - startX) > 10 || Math.abs(ev.clientY - startY) > 10) {
      cancel();
      el.classList.remove('pressing');
    }
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => {
    el.addEventListener(type, () => { cancel(); el.classList.remove('pressing'); });
  });

  // Правый клик на десктопе — тот же жест
  el.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    fire(ev);
  });
}
