import { route, navigate, getCurrentPath } from '../lib/router.js';
import { getState, setState } from '../lib/store.js';
import { addCategory, addExpense, addExpenseToGoal, addIncomeEntry, createRecurringExpense, deleteExpense, getCoupleMembers, getGoals, getIncome as fetchIncome, getIncomeEntries, subscribeToExpenses, updateExpense } from '../lib/supabase.js';
import { CURRENCIES, availableIcons, currentMonth, escapeHtml, formatDate, formatDateTime, formatExpenseDateRow, formatMoney, formatMonth, groupByDate, icon, nextMonth, prevMonth, safeColor, todayStr } from '../lib/utils.js';
import { t } from '../lib/i18n.js';
import { renderTabBar } from '../components/tab-bar.js';
import { showToast } from '../services/toast.js';
import { loadAll, loadExpenses } from '../services/data-loader.js';
import { getReadableError } from '../services/errors.js';
import { enableModalSwipe } from '../components/modal-swipe.js';
import {
  MISSING_ANDREI_ID,
  MISSING_POLINA_ID,
  expenseJoinedProfileName,
  filterExpensesByMemberChip,
  pickPayerUiMembers,
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
  const { andrei: memberAndrei, polina: memberPolina } = pickPayerUiMembers(members, profile?.id);
  const andreiNameSafe = 'Андрей';
  const polinaNameSafe = 'Полина';
  const defaultCategoryId = categories.find(c => c.id === lastPrefs.categoryId)?.id || categories[0]?.id;
  const defaultDate = todayStr();
  const defaultPayerId = lastPrefs.payerId === 'shared' ? 'shared' : ([memberAndrei?.id, memberPolina?.id].includes(lastPrefs.payerId) ? lastPrefs.payerId : 'shared');

  const currSymbol = CURRENCIES[couple?.currency]?.[0] || couple?.currency || '$';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (event) => { if (event.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">${t('home.newExpense')}</div>
      <div class="form-group">
        <label class="form-label">${t('common.amount')}</label>
        <div class="amount-input-wrap">
          <span class="amount-currency">${currSymbol}</span>
          <input type="number" class="form-input amount" id="exp-amount" placeholder="0" inputmode="decimal" autocomplete="off" min="0" step="0.01">
        </div>
        <div class="quick-amounts">
          <button type="button" class="quick-amount" data-add="100">+100</button>
          <button type="button" class="quick-amount" data-add="500">+500</button>
          <button type="button" class="quick-amount" data-add="1000">+1000</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('home.description')}</label>
        <input type="text" class="form-input" id="exp-desc" placeholder="${t('home.descPlaceholder')}" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">${t('common.category')}</label>
        <div class="cat-grid" id="cat-grid">
          ${categories.map((c, i) => `
            <div class="cat-option ${c.id === defaultCategoryId || (i === 0 && !defaultCategoryId) ? 'selected' : ''}" data-id="${c.id}">
              <div class="cat-dot" style="background: ${safeColor(c.color)}20">
                ${icon(c.icon, 16, safeColor(c.color))}
              </div>
              ${e(c.name)}
            </div>
          `).join('')}
          <div class="cat-option cat-option-add" id="btn-add-category">
            <div class="cat-dot" style="background:var(--c-surface-alt)">${icon('plus', 16, 'var(--c-text-muted)')}</div>
            ${t('common.add')}
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
        <div class="payer-options" style="flex-wrap:wrap;">
          <div class="payer-option ${!defaultPayerId || defaultPayerId === 'shared' ? 'selected' : ''}" data-id="shared">
            <div class="payer-avatar payer-avatar-initials" style="background:var(--c-accent-dark);">${icon('heart', 14, '#fff')}</div><span>${t('common.shared')}</span>
          </div>
          <div class="payer-option ${defaultPayerId === memberAndrei?.id ? 'selected' : ''} ${memberAndrei ? '' : 'disabled'}" data-id="${memberAndrei?.id || ''}" data-disabled="${memberAndrei ? 'false' : 'true'}">
            ${(memberAndrei?.avatar_url || (memberAndrei?.id === profile?.id ? profile?.avatar_url : null))
              ? `<img src="${memberAndrei?.avatar_url || profile?.avatar_url}" class="payer-avatar" alt="">`
              : `<div class="payer-avatar payer-avatar-initials">${e((memberAndrei?.display_name || 'А')[0])}</div>`}<span>${andreiNameSafe}</span>
          </div>
          <div class="payer-option ${defaultPayerId === memberPolina?.id ? 'selected' : ''} ${memberPolina ? '' : 'disabled'}" data-id="${memberPolina?.id || ''}" data-disabled="${memberPolina ? 'false' : 'true'}">
            ${(memberPolina?.avatar_url || (memberPolina?.id === profile?.id ? profile?.avatar_url : null))
              ? `<img src="${memberPolina?.avatar_url || profile?.avatar_url}" class="payer-avatar" alt="">`
              : `<div class="payer-avatar payer-avatar-initials">${e((memberPolina?.display_name || 'П')[0])}</div>`}<span>${polinaNameSafe}</span>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('common.date')}</label>
        <input type="date" class="form-input" id="exp-date" value="${defaultDate}">
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;font-size:14px;">
          <input type="checkbox" id="exp-recurring">
          ${t('home.makeRecurring')}
        </label>
      </div>
      <button class="btn btn-primary" id="btn-save-exp" style="margin-top: 8px;">${t('common.add')}</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  enableModalSwipe(backdrop);
  const amountInput = document.getElementById('exp-amount');

  backdrop.querySelectorAll('.quick-amount').forEach((btn) => {
    btn.addEventListener('click', () => {
      const add = Number(btn.dataset.add || 0);
      const current = parseFloat(amountInput?.value || '0') || 0;
      amountInput.value = String(current + add);
    });
  });

  setTimeout(() => document.getElementById('exp-amount')?.focus(), 300);
  const catColors = ['#EF9F27','#E24B4A','#7F77DD','#378ADD','#D4537E','#1D9E75','#D85A30','#534AB7','#888780','#2BBBAD','#FF6F61','#6B5B95'];
  backdrop.querySelector('#btn-add-category')?.addEventListener('click', () => {
    const catBackdrop = document.createElement('div');
    catBackdrop.className = 'modal-backdrop';
    catBackdrop.onclick = (ev) => { if (ev.target === catBackdrop) catBackdrop.remove(); };
    catBackdrop.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-title">${t('home.newCategory')}</div>
        <div class="form-group"><label class="form-label">${t('common.name')}</label><input type="text" class="form-input" id="new-cat-name" placeholder="${t('home.catNamePlaceholder')}" autocomplete="off"></div>
        <div class="form-group"><label class="form-label">${t('home.icon')}</label>
          <div class="cat-grid" id="icon-picker">
            ${availableIcons.filter(n => !['plus','chevron-left','chevron-right','check','x','copy'].includes(n)).map((n, i) => `
              <div class="cat-option ${i === 0 ? 'selected' : ''}" data-icon="${n}">
                <div class="cat-dot" style="background:var(--c-surface-alt)">${icon(n, 16)}</div>
                <span style="font-size:10px;overflow:hidden;text-overflow:ellipsis;max-width:60px;">${n}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="form-group"><label class="form-label">${t('home.color')}</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;" id="color-picker">
            ${catColors.map((c, i) => `<div class="color-dot ${i === 0 ? 'selected' : ''}" data-color="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};border:2px solid transparent;cursor:pointer;"></div>`).join('')}
          </div>
        </div>
        <button class="btn btn-primary" id="btn-save-new-cat">${t('common.create')}</button>
      </div>
    `;
    document.body.appendChild(catBackdrop);
    enableModalSwipe(catBackdrop);
    catBackdrop.querySelectorAll('#icon-picker .cat-option').forEach(opt => {
      opt.addEventListener('click', () => {
        catBackdrop.querySelectorAll('#icon-picker .cat-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      });
    });
    catBackdrop.querySelectorAll('#color-picker .color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        catBackdrop.querySelectorAll('#color-picker .color-dot').forEach(d => d.style.borderColor = 'transparent');
        dot.style.borderColor = 'var(--c-text)';
        catBackdrop.querySelectorAll('#color-picker .color-dot').forEach(d => d.classList.remove('selected'));
        dot.classList.add('selected');
      });
    });
    document.getElementById('btn-save-new-cat').onclick = async () => {
      const name = document.getElementById('new-cat-name').value.trim();
      if (!name) { showToast(t('common.enterTitle')); return; }
      const selectedIcon = catBackdrop.querySelector('#icon-picker .cat-option.selected')?.dataset.icon || 'more-horizontal';
      const selectedColor = catBackdrop.querySelector('#color-picker .color-dot.selected')?.dataset.color || '#888780';
      try {
        await addCategory({ couple_id: couple.id, name, icon: selectedIcon, color: selectedColor, sort_order: categories.length + 1 });
        catBackdrop.remove();
        backdrop.remove();
        await loadAll();
        showToast(t('home.categoryAdded'));
        showAddExpenseModal();
      } catch (err) { showToast(t('common.error', { msg: getReadableError(err) })); }
    };
  });
  backdrop.querySelectorAll('.cat-option:not(#btn-add-category)').forEach(opt => {
    opt.addEventListener('click', () => {
      backdrop.querySelectorAll('.cat-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });
  backdrop.querySelectorAll('.payer-option').forEach(opt => {
    opt.addEventListener('click', () => {
      if (opt.dataset.disabled === 'true') {
        showToast(t('home.memberNotJoined', { name: opt.textContent.includes('Полина') ? 'Полина' : 'Андрей' }));
        return;
      }
      backdrop.querySelectorAll('.payer-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
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
    let created = null;
    try {
      const isShared = payerEl?.dataset.id === 'shared';
      const paidById = isShared ? profile.id : (payerEl?.dataset.id || profile.id);
      if (goalId) {
        created = await addExpenseToGoal({
          goal_id: goalId,
          amount,
          paid_by: paidById,
          split: isShared ? 'equal' : 'full_payer',
          expense_date: date,
          description,
        });
      } else {
        created = await addExpense({
          couple_id: couple.id,
          category_id: categoryEl?.dataset.id,
          paid_by: paidById,
          amount,
          description,
          split: isShared ? 'equal' : 'full_payer',
          expense_date: date,
          currency: couple.currency || 'THB',
        });
      }
    } catch (err) {
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
        const isShared = payerEl?.dataset.id === 'shared';
        const paidById = isShared ? profile.id : (payerEl?.dataset.id || profile.id);
        await createRecurringExpense({
          couple_id: couple.id,
          category_id: categoryEl?.dataset.id,
          paid_by: paidById,
          amount,
          description,
          split: isShared ? 'equal' : 'full_payer',
          currency: couple.currency || 'THB',
          day_of_month: Number(date.slice(8, 10)),
        });
      } catch (recErr) {
        showToast(t('home.recurringNotCreated', { msg: getReadableError(recErr) }));
      }
    }

    backdrop.remove();
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
      if (getCurrentPath() === '/') {
        renderHome(document.getElementById('app'));
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
          ${categories.map(c => `<option value="${c.id}" ${categoryFilter === c.id ? 'selected' : ''}>${e(c.name)}</option>`).join('')}
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
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">${e(expense.description)}</div>
      <button class="btn btn-secondary" id="btn-edit-expense">${t('common.edit')}</button>
      <button class="btn btn-secondary" id="btn-duplicate-expense" style="margin-top: 8px;">${t('home.duplicate')}</button>
      <button class="btn btn-danger" id="btn-delete-expense" style="margin-top: 8px;">${t('common.delete')}</button>
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
          <select class="form-input" id="edit-category">${categories.map(c => `<option value="${c.id}" ${expense.category_id === c.id ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label class="form-label">${t('home.whoPays')}</label>
          <select class="form-input" id="edit-paid-by">
            <option value="shared" ${expense.split === 'equal' ? 'selected' : ''}>${t('common.shared')}</option>
            ${(() => {
              const { andrei: mA, polina: mB, sides } = pickPayerUiMembers(members, profile?.id);
              const expSide = expense.split !== 'equal'
                ? resolvePayerSide(expense.paid_by, sides, expenseJoinedProfileName(expense))
                : null;
              const opts = [];
              if (mA) {
                const sel = expense.split !== 'equal' && (expense.paid_by === mA.id || expSide === 'a');
                opts.push(`<option value="${mA.id}" ${sel ? 'selected' : ''}>${e('Андрей')}</option>`);
              }
              if (mB) {
                const sel = expense.split !== 'equal' && (expense.paid_by === mB.id || expSide === 'b');
                opts.push(`<option value="${mB.id}" ${sel ? 'selected' : ''}>${e('Полина')}</option>`);
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

function renderHome(app) {
  const { expenses, currentMonth: month, couple, profile, members, filterBy, searchQuery } = getState();
  const sides = resolveMemberSides(members, profile?.id);
  const { memberA, memberB, andreiIds, polinaIds } = sides;
  const filtered = filterExpensesByMemberChip(expenses, filterBy, sides);
  const filteredAdvanced = applyAdvancedFilters(filtered, getState());
  const total = filteredAdvanced.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
  const totalAll = expenses.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
  const grouped = groupByDate(filteredAdvanced);
  const labelA = 'Андрей';
  const labelB = 'Полина';
  const selectedMemberLabel = filterBy === MISSING_ANDREI_ID
    ? 'Андрей'
    : (filterBy === MISSING_POLINA_ID ? 'Полина' : (filterBy === memberA?.id ? 'Андрей' : (filterBy === memberB?.id ? 'Полина' : t('home.totalLabel'))));
  const avatarUrlA = memberA?.avatar_url || (memberA?.id === profile?.id ? profile?.avatar_url : null);
  const avatarUrlB = memberB?.avatar_url || (memberB?.id === profile?.id ? profile?.avatar_url : null);
  const avatarA = avatarUrlA
    ? `<img src="${avatarUrlA}" class="filter-avatar" alt="">`
    : `<div class="filter-avatar filter-avatar-initials">${e((memberA?.display_name || 'А')[0])}</div>`;
  const avatarB = avatarUrlB
    ? `<img src="${avatarUrlB}" class="filter-avatar" alt="">`
    : `<div class="filter-avatar filter-avatar-initials">${e((memberB?.display_name || 'П')[0])}</div>`;
  app.innerHTML = `
    <div class="page-enter">
      <div class="header">
        <div><div class="header-title">${t('home.title')}</div></div>
        <button class="header-action" onclick="document.getElementById('add-exp-btn').click()">
          ${icon('bell', 20)}
        </button>
      </div>
      <div class="month-nav">
        <button id="prev-month">${icon('chevron-left', 18)}</button>
        <span class="month-label">${formatMonth(month)}</span>
        <button id="next-month">${icon('chevron-right', 18)}</button>
      </div>
      <div style="display:flex; gap:8px; padding:0 16px 10px;">
        <input class="form-input" id="home-search" placeholder="${t('home.searchPlaceholder')}" value="${e(searchQuery || '')}" style="flex:1;">
        <button class="btn btn-secondary btn-small" id="btn-open-filters" style="white-space:nowrap;">${t('home.filters')}</button>
      </div>
      <div class="filter-sticky">
        <div class="filter-bar">
          <button class="filter-chip ${!filterBy ? 'active' : ''}" data-filter="all">${t('home.all')}</button>
          <button class="filter-chip ${filterBy === (memberA?.id || MISSING_ANDREI_ID) ? 'active' : ''}" data-filter="${memberA?.id || MISSING_ANDREI_ID}" ${memberA ? '' : 'data-disabled="true"'}>${avatarA} ${labelA}</button>
          <button class="filter-chip ${filterBy === (memberB?.id || MISSING_POLINA_ID) ? 'active' : ''}" data-filter="${memberB?.id || MISSING_POLINA_ID}" ${memberB ? '' : 'data-disabled="true"'}>${avatarB} ${labelB}</button>
        </div>
      </div>
      <div class="income-card" id="income-card">
        <div class="income-row">
          <div>
            <div class="income-label">${t('home.monthIncome')}</div>
            <div class="income-value" id="income-display">${formatMoney(getIncomeFromState(), couple?.currency)}</div>
          </div>
          <button class="income-edit-btn" id="btn-edit-income">${icon('settings', 16)}</button>
        </div>
        <div class="income-bar-track"><div class="income-bar-fill" style="width:${getIncomeFromState() > 0 ? Math.min(100, Math.round(totalAll / getIncomeFromState() * 100)) : 0}%"></div></div>
        <div class="income-remaining">${getIncomeFromState() > 0 ? t('home.remaining', { amount: formatMoney(Math.max(0, getIncomeFromState() - totalAll), couple?.currency), pct: Math.max(0, Math.round((1 - totalAll / getIncomeFromState()) * 100)) }) : t('home.setIncomeHint')}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">${t('home.expensesOf', { name: selectedMemberLabel })}</div>
        <div class="summary-total">${formatMoney(total, couple?.currency)}</div>
        <div class="summary-badge">${icon('trending-down', 14)} ${t('home.txCount', { count: filteredAdvanced.length })}</div>
      </div>
      <div class="tx-section">
        ${grouped.length === 0 ? `
          <div class="empty-state">
            ${icon('credit-card', 48, 'var(--c-text-muted)')}
            <p>${t('home.emptyMonth')}</p>
            <button class="btn btn-primary" id="btn-empty-add-expense" style="margin-top: 12px; max-width: 240px;">${t('home.addExpense')}</button>
          </div>
        ` : grouped.map(([date, items]) => `
          <div class="tx-day-header">${formatDate(date)}</div>
          ${items.map(exp => {
            const cat = exp.categories;
            const catColor = safeColor(cat?.color || '#888780');
            const bgColor = catColor + '18';
            const payerName = resolvePayerLabel(exp, sides);
            const rowDate = formatExpenseDateRow(exp.expense_date);
            return `
              <div class="tx-swipe-row" data-id="${exp.id}">
                <button class="tx-delete-btn" type="button">${t('common.delete')}</button>
                <div class="tx-item">
                  <div class="tx-icon" style="background: ${bgColor}">${icon(cat?.icon || 'more-horizontal', 18, catColor)}</div>
                  <div class="tx-info">
                    <div class="tx-name">${e(exp.description)}</div>
                    <div class="tx-cat">${e(cat?.name || t('common.other'))}</div>
                    ${rowDate ? `<div class="tx-row-date">${rowDate}</div>` : ''}
                  </div>
                  <div><div class="tx-amount negative">-${formatMoney(exp.amount, exp.currency)}</div><div class="tx-who">${e(payerName)}</div></div>
                </div>
              </div>`;
          }).join('')}
        `).join('')}
      </div>
    </div>
    <button class="fab" id="add-exp-btn">${icon('plus', 28)}</button>
    ${renderTabBar()}
  `;
  document.getElementById('add-exp-btn').onclick = showAddExpenseModal;
  document.getElementById('btn-edit-income')?.addEventListener('click', () => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.onclick = (ev) => { if (ev.target === backdrop) backdrop.remove(); };
    const incomeEntries = getState().incomeEntries || [];
    const members = getState().members || [];
    const sides = resolveMemberSides(members, profile?.id);
    const authorLabel = (uid) => {
      const m = members.find((x) => x.id === uid);
      if (!m) return '—';
      if (m.id === sides.memberA?.id) return 'Андрей';
      if (m.id === sides.memberB?.id) return 'Полина';
      return m.display_name || t('common.member');
    };
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-handle"></div>
        <div class="modal-title">${t('home.monthIncome')}</div>
        <div class="income-entries-block" style="max-height:220px;overflow-y:auto;margin-bottom:12px;">
          ${incomeEntries.length === 0 ? `<p style="font-size:13px;color:var(--c-text-secondary);margin:0;">${t('home.incomeEmptyHint')}</p>` : incomeEntries.map((ent) => `
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:8px 0;border-bottom:1px solid var(--c-border);gap:8px;flex-wrap:wrap;">
              <span style="color:var(--c-text-secondary);">${e(formatDateTime(ent.created_at))}</span>
              <span style="font-weight:600;">${e(authorLabel(ent.created_by))}</span>
              <span style="font-weight:600;white-space:nowrap;">${formatMoney(ent.amount, couple?.currency)}</span>
            </div>
          `).join('')}
        </div>
        <div class="form-group">
          <label class="form-label">${t('home.addIncomeLabel', { currency: couple?.currency || 'THB' })}</label>
          <input type="number" class="form-input amount" id="income-add" placeholder="0" inputmode="decimal" min="0" step="0.01">
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
        showToast(t('home.memberNotJoined', { name: 'Полина' }));
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
