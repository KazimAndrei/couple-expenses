import { route, navigate, getCurrentPath } from '../lib/router.js';
import { getState, setState } from '../lib/store.js';
import { addExpense, addExpenseToGoal, addIncomeEntry, createRecurringExpense, deleteExpense, getCoupleMembers, getGoals, getIncome as fetchIncome, getIncomeEntries, subscribeToExpenses, updateExpense, uploadReceipt, receiptUrl } from '../lib/supabase.js';
import { enqueueExpense, isNetworkError } from '../services/offline-queue.js';
import { CURRENCIES, catTile, currentMonth, escapeHtml, formatDate, formatDateTime, formatMoney, formatMonth, groupByDate, icon, moneyHtml, nextMonth, prevMonth, quickAmounts, safeColor, todayStr } from '../lib/utils.js';
import { hapticSelect, hapticSuccess, hapticTap } from '../services/haptics.js';
import { t, categoryLabel } from '../lib/i18n.js';
import { renderTabBar } from '../components/tab-bar.js';
import { showToast } from '../services/toast.js';
import { loadAll, loadExpenses } from '../services/data-loader.js';
import { getReadableError } from '../services/errors.js';
import { enableModalSwipe } from '../components/modal-swipe.js';
import { openCategorySheet, attachLongPress } from '../components/category-sheet.js';
import {
  MISSING_PARTNER_ID,
  expenseJoinedProfileName,
  filterExpensesByMemberChip,
  memberDisplayLabel,
  resolveMemberSides,
  resolvePayerLabel,
  resolvePayerSide,
} from '../lib/member-filters.js';


const e = escapeHtml;
let realtimeChannel = null;
let membersRefreshTimer = null;
let membersVisibilityHandler = null;
const LAST_EXPENSE_PREFS_KEY = 'ce_last_expense_prefs_v1';

function getIncomeFromState() {
  return getState().monthlyIncome || 0;
}

function readLastExpensePrefs() {
  try {
    return JSON.parse(localStorage.getItem(LAST_EXPENSE_PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveLastExpensePrefs(prefs) {
  localStorage.setItem(LAST_EXPENSE_PREFS_KEY, JSON.stringify(prefs));
}

function applyAdvancedFilters(expenses, filters) {
  const query = (filters.searchQuery || '').trim().toLowerCase();
  const categoryId = filters.categoryFilter || null;
  const minAmount = filters.amountMin ? parseFloat(filters.amountMin) : null;
  const maxAmount = filters.amountMax ? parseFloat(filters.amountMax) : null;
  const dateFrom = filters.dateFrom || null;
  const dateTo = filters.dateTo || null;

  return expenses.filter((expense) => {
    if (query && !`${expense.description || ''}`.toLowerCase().includes(query)) return false;
    if (categoryId && expense.category_id !== categoryId) return false;
    const amount = parseFloat(expense.amount);
    if (Number.isFinite(minAmount) && amount < minAmount) return false;
    if (Number.isFinite(maxAmount) && amount > maxAmount) return false;
    if (dateFrom && expense.expense_date < dateFrom) return false;
    if (dateTo && expense.expense_date > dateTo) return false;
    return true;
  });
}

async function showAddExpenseModal() {
  const { categories, profile, couple, members } = getState();
  let goals = [];
  try {
    goals = (await getGoals(couple.id)).filter((g) => !g.completed);
  } catch { /* цели не критичны для формы расхода */ }
  const lastPrefs = readLastExpensePrefs();
  const sides = resolveMemberSides(members);
  const payerMembers = [sides.memberA, sides.memberB].filter(Boolean);
  const defaultCategoryId = categories.find(c => c.id === lastPrefs.categoryId)?.id || categories[0]?.id;
  const defaultDate = todayStr();
  const defaultPayerId = lastPrefs.payerId === 'shared' ? 'shared' : (payerMembers.some((m) => m.id === lastPrefs.payerId) ? lastPrefs.payerId : 'shared');

  const currSymbol = CURRENCIES[couple?.currency]?.[0] || couple?.currency || '$';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (event) => { if (event.target === backdrop) backdrop.remove(); };
  const sideOf = (memberId) => (memberId === sides.memberB?.id ? 'b' : 'a');
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">${t('home.newExpense')}</div>
      <label class="amount-hero" for="exp-amount">
        <span class="amount-currency">${e(currSymbol)}</span>
        <input type="number" id="exp-amount" placeholder="0" inputmode="decimal" autocomplete="off" min="0" step="0.01" aria-label="${t('common.amount')}">
      </label>
      <div class="quick-amounts">
        ${quickAmounts(couple?.currency).map((v) => `<button type="button" class="quick-amount" data-add="${v}">+${v}</button>`).join('')}
      </div>
      <div class="form-group">
        <input type="text" class="form-input" id="exp-desc" placeholder="${t('home.descPlaceholder')}" autocomplete="off" aria-label="${t('home.description')}">
      </div>
      <div class="form-group">
        <label class="form-label">${t('common.category')}</label>
        <div class="cat-grid" id="cat-grid">
          ${categories.map((c, i) => `
            <div class="cat-option ${c.id === defaultCategoryId || (i === 0 && !defaultCategoryId) ? 'selected' : ''}" data-id="${c.id}">
              ${catTile(c.icon, c.color, 46)}
              <span class="cat-name">${e(categoryLabel(c.name))}</span>
            </div>
          `).join('')}
          <div class="cat-option cat-option-add" id="btn-add-category">
            <span class="add-tile">${icon('plus', 20)}</span>
            <span class="cat-name">${t('common.add')}</span>
          </div>
        </div>
      </div>
      ${goals.length ? `
      <div class="form-group">
        <label class="form-label">${t('home.goalLabel')}</label>
        <select class="form-input" id="exp-goal">
          <option value="">${t('home.goalNone')}</option>
          ${goals.map((g) => `<option value="${g.id}">${e(g.name)}</option>`).join('')}
        </select>
      </div>
      ` : ''}
      <div class="form-group">
        <label class="form-label">${t('home.whoPays')}</label>
        <div class="payer-options">
          <div class="payer-option ${!defaultPayerId || defaultPayerId === 'shared' ? 'selected' : ''}" data-id="shared">
            <div class="payer-avatar payer-avatar-initials shared">${icon('heart', 13, '#fff', 2.4)}</div><span>${t('common.shared')}</span>
          </div>
          ${payerMembers.map((m) => {
            const label = memberDisplayLabel(m);
            const avatarUrl = m.avatar_url || (m.id === profile?.id ? profile?.avatar_url : null);
            return `
          <div class="payer-option ${defaultPayerId === m.id ? 'selected' : ''}" data-id="${m.id}">
            ${avatarUrl
              ? `<img src="${avatarUrl}" class="payer-avatar" alt="">`
              : `<div class="payer-avatar payer-avatar-initials ${sideOf(m.id)}">${e(label[0] || '')}</div>`}<span>${e(label)}</span>
          </div>`;
          }).join('')}
        </div>
      </div>
      <div class="form-group meta-chips">
        <label class="meta-chip" id="date-chip">
          ${icon('calendar', 16)}<span id="date-chip-label">${e(formatDate(defaultDate))}</span>
          <input type="date" id="exp-date" value="${defaultDate}" aria-label="${t('common.date')}">
        </label>
        <button type="button" class="meta-chip" id="btn-attach-receipt">${icon('camera', 16)}<span id="receipt-name">${t('home.receipt')}</span></button>
        <input type="file" id="receipt-input" accept="image/*" style="display:none;">
        <label class="meta-chip" id="recurring-chip">
          <input type="checkbox" id="exp-recurring">
          ${icon('repeat', 16)}<span>${t('home.repeatShort')}</span>
        </label>
      </div>
      <div class="sheet-footer">
        <button class="btn btn-primary" id="btn-save-exp">${t('common.add')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  enableModalSwipe(backdrop);
  const amountInput = document.getElementById('exp-amount');

  // Поле суммы растёт по ширине числа, чтобы символ валюты стоял вплотную к нему
  const fitAmount = () => {
    const len = Math.max(1, (amountInput.value || amountInput.placeholder || '0').length);
    amountInput.style.width = `${len + 0.4}ch`;
  };
  amountInput.addEventListener('input', fitAmount);
  fitAmount();

  backdrop.querySelectorAll('.quick-amount').forEach((btn) => {
    btn.addEventListener('click', () => {
      const add = Number(btn.dataset.add || 0);
      const current = parseFloat(amountInput?.value || '0') || 0;
      amountInput.value = String(Math.round((current + add) * 100) / 100);
      fitAmount();
      hapticTap();
    });
  });

  const dateInput = document.getElementById('exp-date');
  dateInput.addEventListener('change', () => {
    document.getElementById('date-chip-label').textContent = dateInput.value ? formatDate(dateInput.value) : t('common.date');
    document.getElementById('date-chip').classList.toggle('on', !!dateInput.value && dateInput.value !== defaultDate);
  });
  const recurringInput = document.getElementById('exp-recurring');
  recurringInput.addEventListener('change', () => {
    document.getElementById('recurring-chip').classList.toggle('on', recurringInput.checked);
    hapticSelect();
  });

  setTimeout(() => document.getElementById('exp-amount')?.focus(), 300);
  const reopenAfterCategoryChange = async (action) => {
    backdrop.remove();
    await loadAll();
    showToast(t(action === 'deleted' ? 'home.categoryDeleted'
      : action === 'updated' ? 'home.categoryUpdated' : 'home.categoryAdded'));
    showAddExpenseModal();
  };

  backdrop.querySelector('#btn-add-category')?.addEventListener('click', () => {
    openCategorySheet({
      coupleId: couple.id,
      sortOrder: categories.length + 1,
      onDone: reopenAfterCategoryChange,
    });
  });

  backdrop.querySelectorAll('.cat-option:not(#btn-add-category)').forEach(opt => {
    opt.addEventListener('click', () => {
      // После долгого нажатия открылся лист редактирования — обычный выбор не нужен
      if (opt.dataset.longPressed === '1') { delete opt.dataset.longPressed; return; }
      backdrop.querySelectorAll('.cat-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      hapticSelect();
    });
    // Зажать плитку — переименовать, сменить цвет и значок или удалить категорию
    attachLongPress(opt, () => {
      const category = categories.find((c) => c.id === opt.dataset.id);
      if (!category) return;
      openCategorySheet({ category, coupleId: couple.id, onDone: reopenAfterCategoryChange });
    });
  });
  backdrop.querySelectorAll('.payer-option').forEach(opt => {
    opt.addEventListener('click', () => {
      backdrop.querySelectorAll('.payer-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      hapticSelect();
    });
  });

  const receiptInput = document.getElementById('receipt-input');
  document.getElementById('btn-attach-receipt').addEventListener('click', () => receiptInput.click());
  receiptInput.addEventListener('change', () => {
    const f = receiptInput.files?.[0];
    document.getElementById('receipt-name').textContent = f ? t('home.receiptShort') : t('home.receipt');
    document.getElementById('btn-attach-receipt').classList.toggle('on', !!f);
  });

  const goalSelect = document.getElementById('exp-goal');
  goalSelect?.addEventListener('change', () => {
    const goal = goals.find((g) => g.id === goalSelect.value);
    const descInput = document.getElementById('exp-desc');
    const catGrid = document.getElementById('cat-grid');
    // Расход в цель фиксируется статьёй с названием цели, категория не участвует
    if (goal) {
      if (!descInput.value.trim() || goals.some((g) => g.name === descInput.value.trim())) {
        descInput.value = goal.name;
      }
      catGrid.style.opacity = '0.4';
      catGrid.style.pointerEvents = 'none';
    } else {
      catGrid.style.opacity = '';
      catGrid.style.pointerEvents = '';
    }
  });

  document.getElementById('btn-save-exp').onclick = async () => {
    const amount = parseFloat(document.getElementById('exp-amount').value);
    const description = document.getElementById('exp-desc').value.trim();
    const categoryEl = backdrop.querySelector('.cat-option.selected:not(#btn-add-category)');
    const payerEl = backdrop.querySelector('.payer-option.selected');
    const date = document.getElementById('exp-date').value;
    const recurring = document.getElementById('exp-recurring').checked;
    const goalId = goalSelect?.value || null;
    if (!amount || amount <= 0) { showToast(t('common.enterAmount')); return; }
    if (!description && !goalId) { showToast(t('home.enterDescription')); return; }

    const isShared = payerEl?.dataset.id === 'shared';
    const paidById = isShared ? profile.id : (payerEl?.dataset.id || profile.id);
    // Расход фиксируется за тем, кто оплатил; «Общее» — совместная трата пары
    const split = isShared ? 'equal' : 'full_payer';
    const splitPct = 50;

    // Чек грузим до создания расхода; его отсутствие — не повод терять запись
    let receiptPath = null;
    const receiptFile = receiptInput.files?.[0];
    if (receiptFile) {
      try {
        receiptPath = await uploadReceipt(receiptFile, couple.id);
      } catch (upErr) {
        showToast(t('common.error', { msg: getReadableError(upErr) }));
      }
    }

    const expensePayload = {
      couple_id: couple.id,
      category_id: categoryEl?.dataset.id,
      paid_by: paidById,
      amount,
      description,
      split,
      split_payer_pct: splitPct,
      expense_date: date,
      currency: couple.currency || 'USD',
      receipt_url: receiptPath,
    };

    let created = null;
    try {
      if (goalId) {
        created = await addExpenseToGoal({
          goal_id: goalId,
          amount,
          paid_by: paidById,
          split: isShared ? 'equal' : split,
          expense_date: date,
          description,
        });
        // RPC возвращает голую строку expenses — доклеиваем связь для optimistic-рендера как накопления
        created.goal_contributions = [{ goal_id: goalId, goals: { name: goals.find((g) => g.id === goalId)?.name || description } }];
        if (receiptPath) {
          try { created = { ...created, ...(await updateExpense(created.id, { receipt_url: receiptPath })) }; } catch { /* чек не критичен */ }
        }
      } else {
        created = await addExpense(expensePayload);
      }
    } catch (err) {
      if (!goalId && isNetworkError(err)) {
        // Нет сети: кладём в очередь, отправится при появлении соединения.
        // Сразу показываем расход в списке — иначе выглядело так, будто запись пропала,
        // и пользователь вводил её повторно.
        enqueueExpense(expensePayload);
        const pending = {
          ...expensePayload,
          id: `pending-${crypto.randomUUID()}`,
          categories: categories.find((c) => c.id === expensePayload.category_id) || null,
          profiles: { display_name: memberDisplayLabel(members.find((m) => m.id === paidById)) },
        };
        setState({ expenses: [pending, ...(getState().expenses || [])] });
        backdrop.remove();
        showToast(t('home.savedOffline'));
        return;
      }
      showToast(t('common.error', { msg: getReadableError(err) }));
      return;
    }

    // Главный расход сохранён. Дальнейшие шаги — best-effort, не должны выглядеть как сбой основного.
    saveLastExpensePrefs({
      categoryId: categoryEl?.dataset.id || null,
      payerId: payerEl?.dataset.id || 'shared',
    });

    // Оптимистично кладём созданный расход в state, чтобы UI обновился даже если loadExpenses упадёт
    const stateNow = getState();
    if (Array.isArray(stateNow.expenses) && !stateNow.expenses.some((e) => e.id === created.id)) {
      setState({ expenses: [created, ...stateNow.expenses] });
    }

    if (recurring && !goalId) {
      try {
        await createRecurringExpense({
          couple_id: couple.id,
          category_id: categoryEl?.dataset.id,
          paid_by: paidById,
          amount,
          description,
          split,
          split_payer_pct: splitPct,
          currency: couple.currency || 'USD',
          day_of_month: Number(date.slice(8, 10)),
        });
      } catch (recErr) {
        showToast(t('home.recurringNotCreated', { msg: getReadableError(recErr) }));
      }
    }

    backdrop.remove();
    hapticSuccess();
    showToast(t('home.expenseAdded'), {
      actionLabel: t('common.undo'),
      durationMs: 5000,
      onAction: async () => {
        try {
          await deleteExpense(created.id);
          await loadExpenses();
          if (getCurrentPath() === '/') {
            renderHome(document.getElementById('app'));
          }
          showToast(t('home.addUndone'));
        } catch (undoErr) {
          showToast(t('home.undoFailed', { msg: undoErr.message }));
        }
      },
    });
    if (getCurrentPath() === '/') {
      renderHome(document.getElementById('app'));
    }
    try {
      await loadExpenses();
      const path = getCurrentPath();
      if (path === '/') {
        renderHome(document.getElementById('app'));
      } else if (path === '/analytics' || (path === '/goals' && goalId)) {
        // «+» доступна с любого экрана — экран, который показывает эту трату, перерисовываем
        navigate(path);
      }
    } catch {
      // optimistic insert уже показал расход; перезагрузка случится при следующем переходе/realtime
    }
  };
}

function showHomeFiltersModal() {
  const { categories, amountMin, amountMax, dateFrom, dateTo, categoryFilter } = getState();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (event) => { if (event.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">${t('home.filters')}</div>
      <div class="form-group">
        <label class="form-label">${t('common.category')}</label>
        <select class="form-input" id="filter-category">
          <option value="">${t('home.allCategories')}</option>
          ${categories.map(c => `<option value="${c.id}" ${categoryFilter === c.id ? 'selected' : ''}>${e(categoryLabel(c.name))}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">${t('home.amountFrom')}</label>
        <input type="number" class="form-input" id="filter-min" value="${amountMin || ''}" placeholder="0">
      </div>
      <div class="form-group">
        <label class="form-label">${t('home.amountTo')}</label>
        <input type="number" class="form-input" id="filter-max" value="${amountMax || ''}" placeholder="100000">
      </div>
      <div class="form-group">
        <label class="form-label">${t('home.dateFrom')}</label>
        <input type="date" class="form-input" id="filter-date-from" value="${dateFrom || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">${t('home.dateTo')}</label>
        <input type="date" class="form-input" id="filter-date-to" value="${dateTo || ''}">
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-secondary" id="btn-reset-filters">${t('common.reset')}</button>
        <button class="btn btn-primary" id="btn-apply-filters">${t('common.apply')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  enableModalSwipe(backdrop);
  document.getElementById('btn-reset-filters').onclick = () => {
    setState({ categoryFilter: null, amountMin: null, amountMax: null, dateFrom: null, dateTo: null });
    backdrop.remove();
    renderHome(document.getElementById('app'));
  };
  document.getElementById('btn-apply-filters').onclick = () => {
    setState({
      categoryFilter: document.getElementById('filter-category').value || null,
      amountMin: document.getElementById('filter-min').value || null,
      amountMax: document.getElementById('filter-max').value || null,
      dateFrom: document.getElementById('filter-date-from').value || null,
      dateTo: document.getElementById('filter-date-to').value || null,
    });
    backdrop.remove();
    renderHome(document.getElementById('app'));
  };
}

function showExpenseActionsModal(expense, app) {
  const { categories, members, profile } = getState();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (event) => { if (event.target === backdrop) backdrop.remove(); };
  const sheetCat = expense.categories;
  const sheetPayer = resolvePayerLabel(expense, resolveMemberSides(members));
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="expense-sheet-head">
        ${catTile(sheetCat?.icon || 'more-horizontal', sheetCat?.color || '#888780', 56)}
        <div class="expense-sheet-amount num">${moneyHtml(expense.amount, expense.currency)}</div>
        <div class="modal-title" style="margin:0;">${e(expense.description)}</div>
        <div class="expense-sheet-meta">${e(categoryLabel(sheetCat?.name) || t('common.other'))} · ${e(formatDate(expense.expense_date))} · ${e(sheetPayer)}</div>
      </div>
      <div class="action-list">
        ${expense.receipt_url ? `<button class="action-row" id="btn-view-receipt">${icon('image', 20)}${t('home.viewReceipt')}</button>` : ''}
        <button class="action-row" id="btn-edit-expense">${icon('edit', 20)}${t('common.edit')}</button>
        <button class="action-row" id="btn-duplicate-expense">${icon('copy', 20)}${t('home.duplicate')}</button>
        <button class="action-row danger" id="btn-delete-expense">${icon('trash-2', 20)}${t('common.delete')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  enableModalSwipe(backdrop);

  const openEdit = async () => {
    backdrop.remove();
    const editBackdrop = document.createElement('div');
    editBackdrop.className = 'modal-backdrop';
    editBackdrop.onclick = (event) => { if (event.target === editBackdrop) editBackdrop.remove(); };
    editBackdrop.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-title">${t('home.editExpense')}</div>
        <div class="form-group"><label class="form-label">${t('common.amount')}</label><input type="number" class="form-input" id="edit-amount" value="${expense.amount}"></div>
        <div class="form-group"><label class="form-label">${t('home.description')}</label><input type="text" class="form-input" id="edit-desc" value="${e(expense.description)}"></div>
        <div class="form-group"><label class="form-label">${t('common.category')}</label>
          <select class="form-input" id="edit-category">${categories.map(c => `<option value="${c.id}" ${expense.category_id === c.id ? 'selected' : ''}>${e(categoryLabel(c.name))}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label class="form-label">${t('home.whoPays')}</label>
          <select class="form-input" id="edit-paid-by">
            <option value="shared" ${expense.split === 'equal' ? 'selected' : ''}>${t('common.shared')}</option>
            ${(() => {
              const sides = resolveMemberSides(members);
              const { memberA: mA, memberB: mB } = sides;
              const expSide = expense.split !== 'equal'
                ? resolvePayerSide(expense.paid_by, sides, expenseJoinedProfileName(expense))
                : null;
              const opts = [];
              if (mA) {
                const sel = expense.split !== 'equal' && (expense.paid_by === mA.id || expSide === 'a');
                opts.push(`<option value="${mA.id}" ${sel ? 'selected' : ''}>${e(memberDisplayLabel(mA))}</option>`);
              }
              if (mB) {
                const sel = expense.split !== 'equal' && (expense.paid_by === mB.id || expSide === 'b');
                opts.push(`<option value="${mB.id}" ${sel ? 'selected' : ''}>${e(memberDisplayLabel(mB))}</option>`);
              }
              const used = new Set([mA?.id, mB?.id].filter(Boolean));
              for (const m of members || []) {
                if (used.has(m.id)) continue;
                if (resolvePayerSide(m.id, sides) === 'a' || resolvePayerSide(m.id, sides) === 'b') continue;
                const sel = expense.split !== 'equal' && expense.paid_by === m.id;
                opts.push(`<option value="${m.id}" ${sel ? 'selected' : ''}>${e(m.display_name || t('common.member'))}</option>`);
              }
              return opts.join('');
            })()}
          </select>
        </div>
        <div class="form-group"><label class="form-label">${t('common.date')}</label><input type="date" class="form-input" id="edit-date" value="${expense.expense_date}"></div>
        <button class="btn btn-primary" id="btn-save-expense-edit">${t('common.save')}</button>
      </div>
    `;
    document.body.appendChild(editBackdrop);
    enableModalSwipe(editBackdrop);
    document.getElementById('btn-save-expense-edit').onclick = async () => {
      try {
        const editPayerVal = document.getElementById('edit-paid-by').value;
        const editIsShared = editPayerVal === 'shared';
        await updateExpense(expense.id, {
          amount: parseFloat(document.getElementById('edit-amount').value),
          description: document.getElementById('edit-desc').value.trim(),
          category_id: document.getElementById('edit-category').value,
          paid_by: editIsShared ? (expense.paid_by || profile?.id) : editPayerVal,
          split: editIsShared ? 'equal' : 'full_payer',
          expense_date: document.getElementById('edit-date').value,
        });
        editBackdrop.remove();
        await loadExpenses();
        renderHome(app);
        showToast(t('home.expenseUpdated'));
      } catch (err) {
        showToast(t('common.error', { msg: getReadableError(err) }));
      }
    };
  };

  document.getElementById('btn-view-receipt')?.addEventListener('click', async () => {
    // Бакет чеков приватный — открываем по временной подписанной ссылке
    const url = await receiptUrl(expense.receipt_url).catch(() => null);
    if (url) window.open(url, '_blank');
    else showToast(t('common.error', { msg: t('errors.network') }));
  });
  document.getElementById('btn-edit-expense').onclick = openEdit;
  document.getElementById('btn-duplicate-expense').onclick = async () => {
    try {
      await addExpense({
        couple_id: expense.couple_id,
        category_id: expense.category_id,
        paid_by: expense.paid_by,
        amount: parseFloat(expense.amount),
        description: `${expense.description}${t('home.duplicateSuffix')}`,
        split: expense.split,
        expense_date: todayStr(),
        currency: expense.currency,
      });
      backdrop.remove();
      await loadExpenses();
      renderHome(app);
      showToast(t('home.expenseDuplicated'));
    } catch (err) {
      showToast(t('common.error', { msg: getReadableError(err) }));
    }
  };
  document.getElementById('btn-delete-expense').onclick = async () => {
    try {
      await deleteExpense(expense.id);
      backdrop.remove();
      await loadExpenses();
      renderHome(app);
      showToast(t('home.deleted'));
    } catch (err) {
      showToast(t('common.error', { msg: getReadableError(err) }));
    }
  };
}

// Итог месяца «досчитывается» от прошлого показанного значения — при добавлении траты
// видно, как сумма выросла. Только при реальном изменении, не на каждый перерендер.
let lastHeroTotal = null;
let lastHeroKey = null;
function animateHeroTotal(currency) {
  const el = document.getElementById('hero-total');
  if (!el) return;
  const target = Number(el.dataset.value) || 0;
  const key = `${getState().currentMonth}|${getState().filterBy || ''}`;
  const from = lastHeroKey === key && lastHeroTotal !== null ? lastHeroTotal : 0;
  lastHeroTotal = target;
  lastHeroKey = key;
  if (from === target || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const started = performance.now();
  const duration = 650;
  const step = (now) => {
    const k = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - k, 3);
    el.innerHTML = moneyHtml(from + (target - from) * eased, currency);
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}


function renderHome(app) {
  const { expenses, currentMonth: month, couple, profile, members, filterBy, searchQuery } = getState();
  const sides = resolveMemberSides(members);
  const { memberA, memberB } = sides;
  const filtered = filterExpensesByMemberChip(expenses, filterBy, sides);
  const filteredAdvanced = applyAdvancedFilters(filtered, getState());
  // Расходы-накопления (отложено в цель) не считаем тратами месяца
  const isGoalExpense = (x) => Array.isArray(x.goal_contributions) && x.goal_contributions.length > 0;
  const spendable = filteredAdvanced.filter((x) => !isGoalExpense(x));
  const total = spendable.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
  const totalAll = expenses.filter((x) => !isGoalExpense(x)).reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
  const grouped = groupByDate(filteredAdvanced);
  const selectedMemberLabel = filterBy === memberA?.id
    ? memberDisplayLabel(memberA)
    : (filterBy === memberB?.id ? memberDisplayLabel(memberB) : t('home.totalLabel'));
  const memberChip = (m) => {
    const label = memberDisplayLabel(m);
    const avatarUrl = m.avatar_url || (m.id === profile?.id ? profile?.avatar_url : null);
    const avatar = avatarUrl
      ? `<img src="${avatarUrl}" class="filter-avatar" alt="">`
      : `<div class="filter-avatar filter-avatar-initials">${e(label[0] || '')}</div>`;
    return `<button class="filter-chip ${filterBy === m.id ? 'active' : ''}" data-filter="${m.id}">${avatar} ${e(label)}</button>`;
  };
  const memberChips = [memberA, memberB].filter(Boolean).map(memberChip);
  if (memberChips.length < 2) {
    memberChips.push(`<button class="filter-chip" data-filter="${MISSING_PARTNER_ID}" data-disabled="true">${t('home.partnerNotJoined')}</button>`);
  }
  // Доля каждого в тратах месяца: «только A», «только B» и совместные
  const coupleSpendable = expenses.filter((x) => !isGoalExpense(x));
  const splitTotals = { a: 0, b: 0, shared: 0 };
  for (const x of coupleSpendable) {
    const amount = parseFloat(x.amount) || 0;
    if (x.split === 'equal') { splitTotals.shared += amount; continue; }
    const side = resolvePayerSide(x.paid_by, sides, expenseJoinedProfileName(x));
    if (side === 'b') splitTotals.b += amount; else splitTotals.a += amount;
  }
  const splitSum = splitTotals.a + splitTotals.b + splitTotals.shared;
  const income = getIncomeFromState();
  const incomeLeft = income - totalAll;
  const incomePct = income > 0 ? Math.min(100, Math.round((totalAll / income) * 100)) : 0;
  const [mY, mM] = month.split('-').map(Number);
  const nowDate = new Date();
  const isThisMonth = nowDate.getFullYear() === mY && nowDate.getMonth() + 1 === mM;
  const daysElapsed = isThisMonth ? nowDate.getDate() : new Date(mY, mM, 0).getDate();
  const hasAdvancedFilters = !!(getState().categoryFilter || getState().amountMin || getState().amountMax || getState().dateFrom || getState().dateTo);
  const heroLabel = filterBy ? t('home.expensesOf', { name: selectedMemberLabel }) : t('home.spentTogether');

  const payerBadge = (exp) => {
    if (exp.split === 'equal') return `<span class="payer-badge shared">${icon('heart', 9, '#fff', 3)}</span>`;
    const side = resolvePayerSide(exp.paid_by, sides, expenseJoinedProfileName(exp));
    const member = side === 'b' ? memberB : memberA;
    const url = member?.avatar_url || (member?.id === profile?.id ? profile?.avatar_url : null);
    const label = resolvePayerLabel(exp, sides);
    return `<span class="payer-badge ${side === 'b' ? 'b' : ''}" title="${e(label)}">${url ? `<img src="${url}" alt="">` : e((label || '?')[0])}</span>`;
  };

  app.innerHTML = `
    <div class="page-enter">
      <div class="header">
        <div class="header-row">
          <div class="header-title">${t('home.title')}</div>
          <div class="month-switch">
            <button id="prev-month" aria-label="‹">${icon('chevron-left', 16, 'currentColor', 2.4)}</button>
            <span>${formatMonth(month)}</span>
            <button id="next-month" aria-label="›">${icon('chevron-right', 16, 'currentColor', 2.4)}</button>
          </div>
        </div>
      </div>
      <div class="hero">
        <div class="hero-label">${e(heroLabel)}</div>
        <div class="hero-total" id="hero-total" data-value="${total}">${moneyHtml(total, couple?.currency)}</div>
        <div class="hero-meta">${t('home.txCount', { count: spendable.length })}${total > 0 ? ` · ${t('home.perDay', { amount: formatMoney(total / Math.max(1, daysElapsed), couple?.currency) })}` : ''}</div>
        ${!filterBy && splitSum > 0 ? `
        <div class="hero-split">
          <div class="split-bar">
            ${splitTotals.a > 0 ? `<i class="a" style="flex-grow:${splitTotals.a}"></i>` : ''}
            ${splitTotals.shared > 0 ? `<i class="shared" style="flex-grow:${splitTotals.shared}"></i>` : ''}
            ${splitTotals.b > 0 ? `<i class="b" style="flex-grow:${splitTotals.b}"></i>` : ''}
          </div>
          <div class="split-legend">
            <span><i class="split-dot" style="background:#7ff0c9"></i>${e(memberA ? memberDisplayLabel(memberA) : '')} <b>${formatMoney(splitTotals.a, couple?.currency)}</b></span>
            ${splitTotals.shared > 0 ? `<span><i class="split-dot" style="background:linear-gradient(90deg,#7ff0c9,#ffb39f)"></i>${t('common.shared')} <b>${formatMoney(splitTotals.shared, couple?.currency)}</b></span>` : ''}
            ${memberB ? `<span><i class="split-dot" style="background:#ffb39f"></i>${e(memberDisplayLabel(memberB))} <b>${formatMoney(splitTotals.b, couple?.currency)}</b></span>` : ''}
          </div>
        </div>` : ''}
        <div class="hero-income" id="income-card">
          <div class="hero-income-text">
            ${income > 0
              ? (incomeLeft >= 0
                ? t('home.leftOfIncome', { left: formatMoney(incomeLeft, couple?.currency), income: formatMoney(income, couple?.currency) })
                : t('home.overIncome', { amount: formatMoney(-incomeLeft, couple?.currency) }))
              : t('home.addIncome')}
            ${income > 0 ? `<div class="hero-income-track"><i class="${incomeLeft < 0 ? 'over' : ''}" style="width:${incomePct}%"></i></div>` : ''}
          </div>
          <button class="hero-income-btn" id="btn-edit-income" aria-label="${t('home.monthIncome')}">${icon(income > 0 ? 'wallet' : 'plus', 17, '#fff', 2.2)}</button>
        </div>
      </div>
      <div class="search-row">
        <label class="search-field">
          ${icon('search', 17)}
          <input class="form-input" id="home-search" placeholder="${t('home.searchPlaceholder')}" value="${e(searchQuery || '')}" aria-label="${t('home.search')}">
        </label>
        <button class="icon-btn" id="btn-open-filters" aria-label="${t('home.filters')}">${icon('sliders', 18)}${hasAdvancedFilters ? '<i class="dot"></i>' : ''}</button>
      </div>
      <div class="filter-sticky">
        <div class="filter-bar">
          <button class="filter-chip ${!filterBy ? 'active' : ''}" data-filter="all">${t('home.all')}</button>
          ${memberChips.join('\n          ')}
        </div>
      </div>
      <div class="tx-section">
        ${grouped.length === 0 ? `
          <div class="empty-state">
            ${catTile('wallet', '#1d9e75', 64)}
            <p style="margin-top:14px;">${t('home.emptyMonth')}</p>
            <button class="btn btn-primary" id="btn-empty-add-expense" style="margin-top: 14px; max-width: 240px;">${t('home.addExpense')}</button>
          </div>
        ` : grouped.map(([date, items]) => {
          const dayTotal = items.filter((x) => !isGoalExpense(x)).reduce((sum, x) => sum + parseFloat(x.amount), 0);
          return `
          <div class="tx-day">
            <div class="tx-day-header"><span>${formatDate(date)}</span>${dayTotal > 0 ? `<span class="tx-day-total">${formatMoney(dayTotal, couple?.currency)}</span>` : ''}</div>
            <div class="tx-day-card">
          ${items.map(exp => {
            const payerName = resolvePayerLabel(exp, sides);
            if (isGoalExpense(exp)) {
              const goalName = exp.goal_contributions[0]?.goals?.name || exp.description;
              return `
                <div class="tx-swipe-row" data-id="${exp.id}">
                  <button class="tx-delete-btn" type="button">${t('common.delete')}</button>
                  <div class="tx-item">
                    ${catTile('target', '#1d9e75', 42).slice(0, -'</span>'.length)}${payerBadge(exp)}</span>
                    <div class="tx-info">
                      <div class="tx-name">${t('home.savedToGoal', { name: e(goalName) })}</div>
                      <div class="tx-cat">${t('home.savingLabel')} · ${e(payerName)}</div>
                    </div>
                    <div class="tx-amount saving">+${moneyHtml(exp.amount, exp.currency)}</div>
                  </div>
                </div>`;
            }
            const cat = exp.categories;
            const tile = catTile(cat?.icon || 'more-horizontal', cat?.color || '#888780', 42);
            return `
              <div class="tx-swipe-row" data-id="${exp.id}">
                <button class="tx-delete-btn" type="button">${t('common.delete')}</button>
                <div class="tx-item">
                  ${tile.slice(0, -'</span>'.length)}${payerBadge(exp)}</span>
                  <div class="tx-info">
                    <div class="tx-name">${e(exp.description)}</div>
                    <div class="tx-cat">${exp.receipt_url ? icon('paperclip', 12) : ''}${e(categoryLabel(cat?.name) || t('common.other'))} · ${e(payerName)}</div>
                  </div>
                  <div class="tx-amount">${moneyHtml(exp.amount, exp.currency)}</div>
                </div>
              </div>`;
          }).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    ${renderTabBar()}
  `;
  animateHeroTotal(couple?.currency);
  document.getElementById('btn-edit-income')?.addEventListener('click', () => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.onclick = (ev) => { if (ev.target === backdrop) backdrop.remove(); };
    const incomeEntries = getState().incomeEntries || [];
    const members = getState().members || [];
    const authorLabel = (uid) => {
      const m = members.find((x) => x.id === uid);
      if (!m) return '—';
      return memberDisplayLabel(m);
    };
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-title">${t('home.monthIncome')}</div>
        <div class="income-entries-block" style="max-height:240px;overflow-y:auto;margin-bottom:14px;">
          ${incomeEntries.length === 0 ? `<p style="font-size:13px;color:var(--c-text-secondary);margin:0;">${t('home.incomeEmptyHint')}</p>` : incomeEntries.map((ent) => {
            const side = ent.created_by === resolveMemberSides(members).memberB?.id ? 'b' : '';
            const who = authorLabel(ent.created_by);
            return `
            <div class="income-entry">
              <div class="mini-avatar ${side}">${e((who || '?')[0])}</div>
              <div class="income-entry-main">
                <div class="income-entry-who">${e(who)}</div>
                <div class="income-entry-date">${e(formatDateTime(ent.created_at))}</div>
              </div>
              <div class="income-entry-amount">+${formatMoney(ent.amount, couple?.currency)}</div>
            </div>`;
          }).join('')}
        </div>
        <div class="form-group">
          <label class="form-label">${t('home.addIncomeLabel', { currency: couple?.currency || 'USD' })}</label>
          <input type="number" class="form-input" id="income-add" placeholder="0" inputmode="decimal" min="0" step="0.01" style="font-size:24px;font-weight:700;text-align:center;">
        </div>
        <button class="btn btn-primary" id="btn-save-income">${t('common.add')}</button>
      </div>
    `;
    document.body.appendChild(backdrop);
    enableModalSwipe(backdrop);
    setTimeout(() => document.getElementById('income-add')?.focus(), 300);
    document.getElementById('btn-save-income').onclick = async () => {
      const val = parseFloat(document.getElementById('income-add').value) || 0;
      if (!val || val <= 0) { showToast(t('home.enterAmountPositive')); return; }
      try {
        await addIncomeEntry(couple?.id, month, val);
        const [newTotal, entries] = await Promise.all([
          fetchIncome(couple?.id, month),
          getIncomeEntries(couple?.id, month),
        ]);
        setState({ monthlyIncome: newTotal, incomeEntries: entries });
        backdrop.remove();
        renderHome(app);
        showToast(t('home.incomeAdded'));
      } catch (err) {
        showToast(t('common.error', { msg: getReadableError(err) }));
      }
    };
  });
  document.getElementById('btn-open-filters')?.addEventListener('click', showHomeFiltersModal);
  let searchDebounce = null;
  document.getElementById('home-search')?.addEventListener('input', (event) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      setState({ searchQuery: event.target.value });
      renderHome(app);
    }, 250);
  });
  document.getElementById('btn-empty-add-expense')?.addEventListener('click', showAddExpenseModal);
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.onclick = () => {
      if (chip.dataset.disabled === 'true') {
        showToast(t('home.partnerNotJoined'));
        return;
      }
      const filter = chip.dataset.filter;
      setState({ filterBy: filter === 'all' ? null : filter });
      renderHome(app);
    };
  });
  document.getElementById('prev-month').onclick = () => {
    setState({ currentMonth: prevMonth(month) });
    loadAll().then(() => renderHome(app));
  };
  document.getElementById('next-month').onclick = () => {
    setState({ currentMonth: nextMonth(month) });
    loadAll().then(() => renderHome(app));
  };
  let suppressClickUntil = 0;
  const deleteById = async (expenseId) => {
    const expenseData = expenses.find(ex => ex.id === expenseId);
    try {
      await deleteExpense(expenseId);
      await loadExpenses();
      renderHome(app);
      showToast(t('home.deleted'), {
        actionLabel: t('common.undo'),
        durationMs: 5000,
        onAction: async () => {
          if (!expenseData) return;
          try {
            await addExpense({
              couple_id: expenseData.couple_id,
              category_id: expenseData.category_id,
              paid_by: expenseData.paid_by,
              amount: parseFloat(expenseData.amount),
              description: expenseData.description,
              split: expenseData.split,
              expense_date: expenseData.expense_date,
              currency: expenseData.currency,
            });
            await loadExpenses();
            if (getCurrentPath() === '/') renderHome(app);
            showToast(t('home.restored'));
          } catch { showToast(t('home.restoreFailed')); }
        },
      });
    } catch (err) {
      showToast(t('common.error', { msg: getReadableError(err) }));
    }
  };

  let openedRow = null;
  const closeRow = (row) => {
    const item = row?.querySelector('.tx-item');
    row?.classList.remove('open');
    if (item) {
      item.classList.remove('swiping');
      item.style.transform = '';
    }
  };
  const openRow = (row) => {
    if (!row) return;
    if (openedRow && openedRow !== row) closeRow(openedRow);
    const item = row.querySelector('.tx-item');
    if (!item) return;
    row.classList.add('open');
    item.classList.add('swiping');
    item.style.transform = 'translateX(-96px)';
    openedRow = row;
  };

  app.querySelectorAll('.tx-swipe-row[data-id]').forEach(row => {
    let startX = 0;
    let startY = 0;
    let deltaX = 0;
    let swiping = false;
    let startOffset = 0;
    const expenseId = row.dataset.id;
    const item = row.querySelector('.tx-item');
    const deleteBtn = row.querySelector('.tx-delete-btn');
    if (!item || !deleteBtn) return;

    const resetSwipe = () => {
      item.classList.remove('swiping');
      if (row.classList.contains('open')) {
        item.style.transform = 'translateX(-96px)';
      } else {
        item.style.transform = '';
      }
    };

    item.addEventListener('touchstart', (event) => {
      if (!event.touches[0]) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      startOffset = row.classList.contains('open') ? -96 : 0;
      deltaX = 0;
      swiping = false;
    }, { passive: true });

    item.addEventListener('touchmove', (event) => {
      if (!event.touches[0]) return;
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;

      if (!swiping) {
        if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
        swiping = true;
      }

      deltaX = Math.min(0, Math.max(-96, startOffset + dx));
      item.classList.add('swiping');
      item.style.transform = `translateX(${deltaX}px)`;
      if (event.cancelable) event.preventDefault();
    }, { passive: false });

    item.addEventListener('touchend', async () => {
      if (!swiping) return;
      if (deltaX <= -56) {
        openRow(row);
      } else {
        if (openedRow === row) openedRow = null;
        closeRow(row);
      }
    });

    item.addEventListener('touchcancel', () => {
      resetSwipe();
    });

    deleteBtn.onclick = async (event) => {
      event.stopPropagation();
      suppressClickUntil = Date.now() + 350;
      await deleteById(expenseId);
    };

    item.onclick = () => {
      if (Date.now() < suppressClickUntil) return;
      if (row.classList.contains('open')) {
        if (openedRow === row) openedRow = null;
        closeRow(row);
        return;
      }
      if (openedRow) {
        closeRow(openedRow);
        openedRow = null;
      }
      const expense = expenses.find(ex => ex.id === expenseId);
      if (!expense) return;
      showExpenseActionsModal(expense, app);
    };
  });
}

export function registerHomeRoute() {
  // «+» в таб-баре шлёт событие — лист расхода открывается с любого экрана
  window.addEventListener('ce:add-expense', () => {
    if (!getState().couple || document.querySelector('.modal-backdrop')) return;
    hapticTap();
    showAddExpenseModal();
  });
  route('/', async (app) => {
    const state = getState();
    if (!state.profile) { navigate('/auth'); return; }
    if (!state.couple) { navigate('/setup'); return; }
    const month = state.currentMonth || currentMonth();
    setState({ currentMonth: month });
    await loadAll();
    renderHome(app);
    if (realtimeChannel) realtimeChannel.unsubscribe();
    if (membersRefreshTimer) clearInterval(membersRefreshTimer);
    if (membersVisibilityHandler) {
      document.removeEventListener('visibilitychange', membersVisibilityHandler);
      membersVisibilityHandler = null;
    }
    realtimeChannel = subscribeToExpenses(state.couple.id, async () => {
      await loadExpenses();
      if (getCurrentPath() === '/') renderHome(app);
    });
    const refreshMembers = async () => {
      try {
        const newMembers = await getCoupleMembers(state.couple.id);
        const oldMembers = getState().members || [];
        const changed = JSON.stringify(newMembers.map(m => [m.id, m.display_name, m.avatar_url])) !==
                         JSON.stringify(oldMembers.map(m => [m.id, m.display_name, m.avatar_url]));
        if (changed) {
          setState({ members: newMembers });
          if (getCurrentPath() === '/') renderHome(app);
        }
      } catch {
        // ignore transient sync errors
      }
    };
    membersRefreshTimer = setInterval(refreshMembers, 30000);
    membersVisibilityHandler = () => {
      if (!document.hidden) refreshMembers();
    };
    document.addEventListener('visibilitychange', membersVisibilityHandler);
    return () => {
      if (realtimeChannel) {
        realtimeChannel.unsubscribe();
        realtimeChannel = null;
      }
      if (membersRefreshTimer) {
        clearInterval(membersRefreshTimer);
        membersRefreshTimer = null;
      }
      if (membersVisibilityHandler) {
        document.removeEventListener('visibilitychange', membersVisibilityHandler);
        membersVisibilityHandler = null;
      }
    };
  });
}
