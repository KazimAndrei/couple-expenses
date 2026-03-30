import { route, navigate } from '../lib/router.js';
import { getState, setState } from '../lib/store.js';
import { getBudgets, getCoupleMembers, getExpenses, upsertBudget } from '../lib/supabase.js';
import { currentMonth, escapeHtml, formatMoney, formatMonth, icon, pct, safeColor } from '../lib/utils.js';
import { renderTabBar } from '../components/tab-bar.js';
import { showToast } from '../services/toast.js';

const e = escapeHtml;

function showAddBudgetModal() {
  const { categories, couple, currentMonth: month } = getState();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (event) => { if (event.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">Новый бюджет</div>
      <div class="form-group"><label class="form-label">Категория</label>
        <select class="form-input" id="budget-cat">${categories.map(c => `<option value="${c.id}">${e(c.name)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label class="form-label">Лимит (${couple.currency})</label>
        <input type="number" class="form-input" id="budget-limit" placeholder="10000" inputmode="numeric">
      </div>
      <button class="btn btn-primary" id="btn-save-budget">Сохранить</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('btn-save-budget').onclick = async () => {
    const categoryId = document.getElementById('budget-cat').value;
    const limit = parseFloat(document.getElementById('budget-limit').value);
    if (!limit || limit <= 0) { showToast('Введите лимит'); return; }
    try {
      await upsertBudget({ couple_id: couple.id, category_id: categoryId, month: `${month}-01`, limit_amount: limit });
      backdrop.remove();
      showToast('Бюджет добавлен');
      navigate('/analytics');
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  };
}

export function registerAnalyticsRoute() {
  route('/analytics', async (app) => {
    const state = getState();
    if (!state.couple) { navigate('/'); return; }
    const month = state.currentMonth || currentMonth();
    let expenses = [];
    let members = state.members || [];
    let budgets = [];
    try {
      [expenses, members, budgets] = await Promise.all([
        getExpenses(state.couple.id, month),
        getCoupleMembers(state.couple.id),
        getBudgets(state.couple.id, month),
      ]);
      setState({ budgets, members });
    } catch (err) {
      console.error('Analytics load error:', err);
    }

    const filterBy = state.analyticsFilterBy || null;
    const filteredExpenses = filterBy ? expenses.filter(expense => expense.paid_by === filterBy) : expenses;
    const grandTotal = filteredExpenses.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);

    const payerMap = new Map((members || []).map(member => [member.id, {
      id: member.id,
      payer_name: member.display_name || 'Пользователь',
      total_paid: 0,
    }]));
    for (const expense of expenses) {
      const existing = payerMap.get(expense.paid_by) || { id: expense.paid_by, payer_name: expense.profiles?.display_name || 'Пользователь', total_paid: 0 };
      existing.total_paid += parseFloat(expense.amount);
      payerMap.set(expense.paid_by, existing);
    }
    const payerTotals = [...payerMap.values()].filter(p => !filterBy || p.id === filterBy);

    const catMap = new Map();
    for (const expense of filteredExpenses) {
      const categoryId = expense.category_id || 'other';
      const existing = catMap.get(categoryId) || {
        category_id: categoryId,
        category_name: expense.categories?.name || 'Другое',
        category_color: expense.categories?.color || '#888780',
        total: 0,
      };
      existing.total += parseFloat(expense.amount);
      catMap.set(categoryId, existing);
    }
    const sortedCats = [...catMap.values()].sort((a, b) => b.total - a.total);

    const nameCounts = new Map();
    for (const member of members || []) {
      const key = member.display_name || 'Пользователь';
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
    const memberLabel = (member) => {
      const baseName = member?.display_name || 'Пользователь';
      if ((nameCounts.get(baseName) || 0) <= 1) return baseName;
      return member.id === state.profile?.id ? `${baseName} (вы)` : `${baseName} (партнер)`;
    };
    const selectedMember = filterBy ? members.find(member => member.id === filterBy) : null;
    app.innerHTML = `
      <div class="page-enter">
        <div class="header"><div><div class="header-title">Аналитика</div><div class="header-sub">${formatMonth(month)}</div></div></div>
        <div class="filter-bar" style="padding: 8px 16px 12px;">
          <button class="filter-chip ${!filterBy ? 'active' : ''}" data-filter="all">Общие</button>
          ${(members || []).map(member => {
            const memberName = memberLabel(member);
            const memberAvatar = member?.avatar_url
              ? `<img src="${e(member.avatar_url)}" class="filter-avatar">`
              : `<div class="filter-avatar filter-avatar-initials">${e(memberName[0] || 'U')}</div>`;
            return `<button class="filter-chip ${filterBy === member.id ? 'active' : ''}" data-filter="${member.id}">${memberAvatar} ${e(memberName)}</button>`;
          }).join('')}
        </div>
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-label">${selectedMember ? `Всего у ${e(memberLabel(selectedMember))}` : 'Всего'}</div><div class="stat-value">${formatMoney(grandTotal, state.couple.currency)}</div></div>
          <div class="stat-card"><div class="stat-label">Среднее/день</div><div class="stat-value">${formatMoney(grandTotal / 30, state.couple.currency)}</div></div>
          ${payerTotals.map(p => `
            <div class="stat-card"><div class="stat-label">${e(p.payer_name)} оплатил(а)</div><div class="stat-value">${formatMoney(p.total_paid, state.couple.currency)}</div></div>
          `).join('')}
        </div>
        <div class="section-header"><span class="section-title">По категориям</span></div>
        <div class="cat-bars">
          ${sortedCats.map(c => `
            <div class="cat-bar-row">
              <div class="cat-bar-dot" style="background: ${safeColor(c.category_color)}"></div>
              <div class="cat-bar-name">${e(c.category_name)}</div>
              <div class="cat-bar-track"><div class="cat-bar-fill" style="width: ${pct(c.total, grandTotal)}%; background: ${safeColor(c.category_color)};"></div></div>
              <div class="cat-bar-amount">${formatMoney(c.total, state.couple.currency)}</div>
            </div>
          `).join('')}
          ${sortedCats.length === 0 ? '<div class="empty-state"><p>Нет данных</p></div>' : ''}
        </div>
        <div class="section-header"><span class="section-title">Бюджеты</span><button class="section-action" id="btn-add-budget">+ Добавить</button></div>
        <div id="budgets-list">
          ${budgets.length === 0 ? '<div class="empty-state"><p>Бюджеты не настроены</p></div>' : budgets.map(b => {
            const spent = sortedCats.find(c => c.category_id === b.category_id)?.total || 0;
            const percentage = pct(spent, b.limit_amount);
            const fillClass = percentage > 100 ? 'over' : percentage > 80 ? 'warn' : '';
            return `
              <div class="budget-card">
                <div class="budget-header">
                  <div class="budget-name"><span style="color: ${safeColor(b.categories?.color)}">${icon(b.categories?.icon || 'more-horizontal', 16, safeColor(b.categories?.color))}</span>${e(b.categories?.name || 'Категория')}</div>
                  <div class="budget-amounts">${formatMoney(spent)} / ${formatMoney(b.limit_amount)}</div>
                </div>
                <div class="budget-track"><div class="budget-fill ${fillClass}" style="width: ${Math.min(percentage, 100)}%; background: ${!fillClass ? safeColor(b.categories?.color || '#1d9e75') : ''};"></div></div>
                <div class="budget-pct">${percentage}% использовано</div>
              </div>`;
          }).join('')}
        </div>
      </div>
      ${renderTabBar()}
    `;
    app.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const selected = chip.dataset.filter;
        setState({ analyticsFilterBy: selected === 'all' ? null : selected });
        navigate('/analytics');
      });
    });
    document.getElementById('btn-add-budget')?.addEventListener('click', showAddBudgetModal);
  });
}
