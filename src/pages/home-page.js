import { route, navigate, getCurrentPath } from '../lib/router.js';
import { getState, setState } from '../lib/store.js';
import { addExpense, deleteExpense, subscribeToExpenses } from '../lib/supabase.js';
import { currentMonth, escapeHtml, formatDate, formatMoney, formatMonth, groupByDate, icon, nextMonth, prevMonth, safeColor, todayStr } from '../lib/utils.js';
import { renderTabBar } from '../components/tab-bar.js';
import { showToast } from '../services/toast.js';
import { loadAll, loadExpenses } from '../services/data-loader.js';

const e = escapeHtml;
let realtimeChannel = null;

function showAddExpenseModal() {
  const { categories, profile, couple, members } = getState();
  const me = members.find(m => m.id === profile?.id);
  const meName = me?.display_name || 'Я';
  const partner = members.find(m => m.id !== profile?.id);
  const partnerName = partner?.display_name || 'Партнёр';
  const meNameSafe = e(meName);
  const partnerNameSafe = e(partnerName);
  const currSymbol = couple?.currency === 'THB' ? '฿' : couple?.currency === 'RUB' ? '₽' : '$';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (event) => { if (event.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">Новый расход</div>
      <div class="form-group">
        <div class="amount-input-wrap">
          <span class="amount-currency">${currSymbol}</span>
          <input type="number" class="form-input amount" id="exp-amount" placeholder="0" inputmode="decimal" autocomplete="off">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Описание</label>
        <input type="text" class="form-input" id="exp-desc" placeholder="Что купили?" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Категория</label>
        <div class="cat-grid" id="cat-grid">
          ${categories.map((c, i) => `
            <div class="cat-option ${i === 0 ? 'selected' : ''}" data-id="${c.id}" onclick="selectCat(this)">
              <div class="cat-dot" style="background: ${safeColor(c.color)}20">
                ${icon(c.icon, 16, safeColor(c.color))}
              </div>
              ${e(c.name)}
            </div>
          `).join('')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Кто платит</label>
        <div class="form-input" style="display:flex;align-items:center;justify-content:space-between;">
          <span>${meNameSafe}</span>
          <span style="font-size:12px;color:var(--c-text-secondary);">Текущий профиль</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Дата</label>
        <input type="date" class="form-input" id="exp-date" value="${todayStr()}">
      </div>
      <div class="form-group">
        <label class="form-label">Деление</label>
        <div class="split-options">
          <div class="split-option selected" data-split="equal" onclick="selectSplit(this)">50/50</div>
          <div class="split-option" data-split="full_payer" onclick="selectSplit(this)">100% ${meNameSafe}</div>
          ${partner ? `<div class="split-option" data-split="full_other" onclick="selectSplit(this)">100% ${partnerNameSafe}</div>` : ''}
        </div>
      </div>
      <button class="btn btn-primary" id="btn-save-exp" style="margin-top: 8px;">Добавить</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  setTimeout(() => document.getElementById('exp-amount')?.focus(), 300);
  window.selectCat = (el) => {
    backdrop.querySelectorAll('.cat-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
  };
  window.selectSplit = (el) => {
    backdrop.querySelectorAll('.split-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
  };
  document.getElementById('btn-save-exp').onclick = async () => {
    const amount = parseFloat(document.getElementById('exp-amount').value);
    const description = document.getElementById('exp-desc').value.trim();
    const categoryEl = backdrop.querySelector('.cat-option.selected');
    const splitEl = backdrop.querySelector('.split-option.selected');
    const date = document.getElementById('exp-date').value;
    if (!amount || amount <= 0) { showToast('Введите сумму'); return; }
    if (!description) { showToast('Введите описание'); return; }
    try {
      await addExpense({
        couple_id: couple.id,
        category_id: categoryEl?.dataset.id,
        paid_by: profile.id,
        amount,
        description,
        split: splitEl?.dataset.split || 'equal',
        expense_date: date,
        currency: couple.currency || 'THB',
      });
      backdrop.remove();
      showToast('Расход добавлен');
      await loadExpenses();
      if (getCurrentPath() === '/') {
        renderHome(document.getElementById('app'));
      }
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  };
}

function renderHome(app) {
  const { expenses, currentMonth: month, couple, profile, members, filterBy } = getState();
  const filtered = filterBy ? expenses.filter(expense => expense.paid_by === filterBy) : expenses;
  const total = filtered.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
  const grouped = groupByDate(filtered);
  const nameCounts = new Map();
  for (const member of members || []) {
    const key = member.display_name || 'Пользователь';
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }
  const memberLabel = (member) => {
    const baseName = member?.display_name || 'Пользователь';
    if ((nameCounts.get(baseName) || 0) <= 1) return baseName;
    return member.id === profile?.id ? `${baseName} (вы)` : `${baseName} (партнер)`;
  };
  const memberById = new Map((members || []).map(member => [member.id, member]));
  const selectedMember = filterBy ? memberById.get(filterBy) : null;
  app.innerHTML = `
    <div class="page-enter">
      <div class="header">
        <div><div class="header-title">Расходы</div></div>
        <button class="header-action" onclick="document.getElementById('add-exp-btn').click()">
          ${icon('bell', 20)}
        </button>
      </div>
      <div class="month-nav">
        <button id="prev-month">${icon('chevron-left', 18)}</button>
        <span class="month-label">${formatMonth(month)}</span>
        <button id="next-month">${icon('chevron-right', 18)}</button>
      </div>
      <div class="filter-bar">
        <button class="filter-chip ${!filterBy ? 'active' : ''}" data-filter="all">Все</button>
        ${(members || []).map(member => {
          const memberName = memberLabel(member);
          const memberAvatar = member?.avatar_url
            ? `<img src="${e(member.avatar_url)}" class="filter-avatar">`
            : `<div class="filter-avatar filter-avatar-initials">${e(memberName[0] || 'U')}</div>`;
          return `<button class="filter-chip ${filterBy === member.id ? 'active' : ''}" data-filter="${member.id}">${memberAvatar} ${e(memberName)}</button>`;
        }).join('')}
      </div>
      <div class="summary-card">
        <div class="summary-label">${selectedMember ? e(memberLabel(selectedMember)) : 'Общие'} расходы</div>
        <div class="summary-total">${formatMoney(total, couple?.currency)}</div>
        <div class="summary-badge">${icon('trending-down', 14)} ${filtered.length} транзакций</div>
      </div>
      <div class="tx-section">
        ${grouped.length === 0 ? `
          <div class="empty-state">${icon('credit-card', 48, 'var(--c-text-muted)')}<p>Нет расходов за этот месяц</p></div>
        ` : grouped.map(([date, items]) => `
          <div class="tx-day-header">${formatDate(date)}</div>
          ${items.map(exp => {
            const cat = exp.categories;
            const catColor = safeColor(cat?.color || '#888780');
            const bgColor = catColor + '18';
            const splitLabel = exp.split === 'equal' ? '50/50' : exp.split === 'full_payer' ? (exp.profiles?.display_name || '') : exp.split === 'full_other' ? (members?.find(member => member.id !== exp.paid_by)?.display_name || 'Партнёр') : 'Кастом';
            return `
              <div class="tx-item" data-id="${exp.id}">
                <div class="tx-icon" style="background: ${bgColor}">${icon(cat?.icon || 'more-horizontal', 18, catColor)}</div>
                <div class="tx-info"><div class="tx-name">${e(exp.description)}</div><div class="tx-cat">${e(cat?.name || 'Другое')}</div></div>
                <div><div class="tx-amount negative">-${formatMoney(exp.amount, exp.currency)}</div><div class="tx-who">${e(splitLabel)}</div></div>
              </div>`;
          }).join('')}
        `).join('')}
      </div>
    </div>
    <button class="fab" id="add-exp-btn">${icon('plus', 28)}</button>
    ${renderTabBar()}
  `;
  document.getElementById('add-exp-btn').onclick = showAddExpenseModal;
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.onclick = () => {
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
  app.querySelectorAll('.tx-item[data-id]').forEach(item => {
    item.onclick = () => {
      if (confirm('Удалить расход?')) {
        deleteExpense(item.dataset.id).then(() => {
          loadExpenses().then(() => renderHome(app));
          showToast('Удалено');
        });
      }
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
    realtimeChannel = subscribeToExpenses(state.couple.id, async () => {
      await loadExpenses();
      if (getCurrentPath() === '/') renderHome(app);
    });
    return () => {
      if (realtimeChannel) {
        realtimeChannel.unsubscribe();
        realtimeChannel = null;
      }
    };
  });
}
