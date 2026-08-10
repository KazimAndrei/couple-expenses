import { route, navigate } from '../lib/router.js';
import { getState, setState } from '../lib/store.js';
import { deleteBudget, deleteIncomeEntry, getBudgets, getCoupleMembers, getExpenses, getIncomeEntries, upsertBudget } from '../lib/supabase.js';
import { currentMonth, escapeHtml, formatDateTime, formatMoney, formatMonth, icon, pct, prevMonth, safeColor } from '../lib/utils.js';
import { t } from '../lib/i18n.js';
import { renderTabBar } from '../components/tab-bar.js';
import { showToast } from '../services/toast.js';
import { getReadableError } from '../services/errors.js';
import { enableModalSwipe } from '../components/modal-swipe.js';
import {
  MISSING_PARTNER_ID,
  expenseJoinedProfileName,
  filterExpensesByMemberChip,
  memberDisplayLabel,
  resolveMemberSides,
  resolvePayerSide,
} from '../lib/member-filters.js';

const e = escapeHtml;

function showAddBudgetModal() {
  const { categories, couple, currentMonth: month } = getState();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (event) => { if (event.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">${t('analytics.newBudget')}</div>
      <div class="form-group"><label class="form-label">${t('common.category')}</label>
        <select class="form-input" id="budget-cat">${categories.map(c => `<option value="${c.id}">${e(c.name)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label class="form-label">${t('analytics.limit', { currency: couple.currency })}</label>
        <input type="number" class="form-input" id="budget-limit" placeholder="10000" inputmode="numeric">
      </div>
      <button class="btn btn-primary" id="btn-save-budget">${t('common.save')}</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  enableModalSwipe(backdrop);
  document.getElementById('btn-save-budget').onclick = async () => {
    const categoryId = document.getElementById('budget-cat').value;
    const limit = parseFloat(document.getElementById('budget-limit').value);
    if (!limit || limit <= 0) { showToast(t('analytics.enterLimit')); return; }
    try {
      await upsertBudget({ couple_id: couple.id, category_id: categoryId, month: `${month}-01`, limit_amount: limit });
      backdrop.remove();
      showToast(t('analytics.budgetAdded'));
      navigate('/analytics');
    } catch (err) {
      showToast(t('common.error', { msg: getReadableError(err) }));
    }
  };
}

export function registerAnalyticsRoute() {
  route('/analytics', async (app) => {
    const state = getState();
    if (!state.couple) { navigate('/'); return; }
    const month = state.currentMonth || currentMonth();
    const previous = prevMonth(month);
    let expenses = [];
    let prevExpenses = [];
    let members = state.members || [];
    let budgets = [];
    let incomeEntries = [];
    const settled = await Promise.allSettled([
      getExpenses(state.couple.id, month),
      getExpenses(state.couple.id, previous),
      getCoupleMembers(state.couple.id),
      getBudgets(state.couple.id, month),
      getIncomeEntries(state.couple.id, month),
    ]);
    const take = (i, fallback) => {
      const r = settled[i];
      if (r.status === 'fulfilled') return r.value;
      console.error('Analytics load partial failure:', r.reason);
      return fallback;
    };
    expenses = take(0, []);
    prevExpenses = take(1, []);
    members = take(2, state.members || []);
    budgets = take(3, []);
    incomeEntries = take(4, []);
    setState({ budgets, members, incomeEntries });

    const filterBy = state.analyticsFilterBy || null;
    const sides = resolveMemberSides(members);
    const { memberA, memberB } = sides;
    const filteredExpenses = filterExpensesByMemberChip(expenses, filterBy, sides);

    const grandTotal = filteredExpenses.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
    const prevTotal = prevExpenses.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
    const trendPct = prevTotal > 0 ? Math.round(((grandTotal - prevTotal) / prevTotal) * 100) : 0;

    const resolvePayerId = (expense) => {
      const side = resolvePayerSide(expense.paid_by, sides, expenseJoinedProfileName(expense));
      if (side === 'a') return memberA?.id || expense.paid_by;
      if (side === 'b') return memberB?.id || expense.paid_by;
      return expense.paid_by;
    };
    const payerMap = new Map();
    if (memberA) payerMap.set(memberA.id, { id: memberA.id, payer_name: memberDisplayLabel(memberA), total_paid: 0 });
    if (memberB) payerMap.set(memberB.id, { id: memberB.id, payer_name: memberDisplayLabel(memberB), total_paid: 0 });
    for (const expense of expenses) {
      const targetId = resolvePayerId(expense);
      const existing = payerMap.get(targetId);
      if (existing) {
        existing.total_paid += parseFloat(expense.amount);
      }
    }
    const payerTotals = [...payerMap.values()].filter(p => !filterBy || p.id === filterBy);

    const catMap = new Map();
    for (const expense of filteredExpenses) {
      const categoryId = expense.category_id || 'other';
      const existing = catMap.get(categoryId) || {
        category_id: categoryId,
        category_name: expense.categories?.name || t('common.other'),
        category_color: expense.categories?.color || '#888780',
        total: 0,
      };
      existing.total += parseFloat(expense.amount);
      catMap.set(categoryId, existing);
    }
    const sortedCats = [...catMap.values()].sort((a, b) => b.total - a.total);
    const topCategory = sortedCats[0] || null;

    const incomeAuthorLabel = (uid) => {
      const m = (members || []).find((x) => x.id === uid);
      if (!m) return '—';
      return memberDisplayLabel(m);
    };

    const selectedMemberLabel = filterBy === memberA?.id
      ? memberDisplayLabel(memberA)
      : (filterBy === memberB?.id ? memberDisplayLabel(memberB) : null);
    const memberChip = (m) => {
      const label = memberDisplayLabel(m);
      const avatarUrl = m.avatar_url || (m.id === state.profile?.id ? state.profile?.avatar_url : null);
      const avatar = avatarUrl
        ? `<img src="${avatarUrl}" class="filter-avatar" alt="">`
        : `<div class="filter-avatar filter-avatar-initials">${e(label[0] || '')}</div>`;
      return `<button class="filter-chip ${filterBy === m.id ? 'active' : ''}" data-filter="${m.id}">${avatar} ${e(label)}</button>`;
    };
    const memberChips = [memberA, memberB].filter(Boolean).map(memberChip);
    if (memberChips.length < 2) {
      memberChips.push(`<button class="filter-chip" data-filter="${MISSING_PARTNER_ID}" data-disabled="true">${t('home.partnerNotJoined')}</button>`);
    }
    app.innerHTML = `
      <div class="page-enter">
        <div class="header"><div><div class="header-title">${t('analytics.title')}</div><div class="header-sub">${formatMonth(month)}</div></div></div>
        <div class="filter-sticky">
          <div class="filter-bar" style="padding: 8px 16px 12px;">
            <button class="filter-chip ${!filterBy ? 'active' : ''}" data-filter="all">${t('home.all')}</button>
            ${memberChips.join('\n            ')}
          </div>
        </div>
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-label">${selectedMemberLabel ? t('analytics.totalOf', { name: e(selectedMemberLabel) }) : t('analytics.total')}</div><div class="stat-value">${formatMoney(grandTotal, state.couple.currency)}</div></div>
          <div class="stat-card"><div class="stat-label">${t('analytics.avgPerDay')}</div><div class="stat-value">${formatMoney(grandTotal / 30, state.couple.currency)}</div></div>
          <div class="stat-card"><div class="stat-label">${t('analytics.vsPrevMonth')}</div><div class="stat-value">${trendPct > 0 ? '+' : ''}${trendPct}%</div></div>
          <div class="stat-card"><div class="stat-label">${t('analytics.topCategory')}</div><div class="stat-value" style="font-size:14px;">${e(topCategory?.category_name || '—')}</div></div>
          ${payerTotals.map(p => `
            <div class="stat-card"><div class="stat-label">${t('analytics.paid', { name: e(p.payer_name) })}</div><div class="stat-value">${formatMoney(p.total_paid, state.couple.currency)}</div></div>
          `).join('')}
        </div>
        <div class="section-header"><span class="section-title">${t('analytics.incomeSection')}</span></div>
        <div class="income-entries-analytics" style="padding:0 16px 16px;">
          ${incomeEntries.length === 0 ? `<div class="empty-state" style="padding:16px 0;"><p style="margin:0;font-size:14px;color:var(--c-text-secondary);">${t('analytics.noIncome')}</p></div>` : incomeEntries.map((ent) => `
            <div class="income-entry-row" data-income-id="${e(ent.id)}" data-income-amount="${e(String(ent.amount))}" style="display:flex;justify-content:space-between;align-items:center;font-size:14px;padding:10px 0;border-bottom:1px solid var(--c-border);gap:10px;flex-wrap:wrap;">
              <span style="color:var(--c-text-secondary);">${e(formatDateTime(ent.created_at))}</span>
              <span style="font-weight:600;">${e(incomeAuthorLabel(ent.created_by))}</span>
              <span style="display:flex;align-items:center;gap:8px;">
                <span style="font-weight:600;white-space:nowrap;">${formatMoney(ent.amount, state.couple.currency)}</span>
                <button class="btn-income-delete" type="button" aria-label="${t('analytics.deleteEntryAria')}" style="background:none;border:none;padding:4px;cursor:pointer;color:var(--c-danger,#e24b4a);display:inline-flex;align-items:center;">${icon('trash-2', 16, 'currentColor')}</button>
              </span>
            </div>
          `).join('')}
        </div>
        <div class="section-header"><span class="section-title">${t('analytics.byCategory')}</span></div>
        <div class="cat-bars">
          ${sortedCats.map(c => `
            <div class="cat-bar-row">
              <div class="cat-bar-dot" style="background: ${safeColor(c.category_color)}"></div>
              <div class="cat-bar-name">${e(c.category_name)}</div>
              <div class="cat-bar-track"><div class="cat-bar-fill" style="width: ${pct(c.total, grandTotal)}%; background: ${safeColor(c.category_color)};"></div></div>
              <div class="cat-bar-amount">${formatMoney(c.total, state.couple.currency)}</div>
            </div>
          `).join('')}
          ${sortedCats.length === 0 ? `<div class="empty-state"><p>${t('analytics.noData')}</p><button class="btn btn-primary" id="btn-empty-add-expense" style="margin-top: 12px; max-width: 240px;">${t('home.addExpense')}</button></div>` : ''}
        </div>
        <div class="section-header"><span class="section-title">${t('analytics.budgets')}</span><button class="section-action" id="btn-add-budget">${t('analytics.addAction')}</button></div>
        <div id="budgets-list">
          ${budgets.length === 0 ? `<div class="empty-state"><p>${t('analytics.noBudgets')}</p><button class="btn btn-primary" id="btn-empty-add-budget" style="margin-top: 12px; max-width: 240px;">${t('analytics.addBudget')}</button></div>` : budgets.map(b => {
            const spent = sortedCats.find(c => c.category_id === b.category_id)?.total || 0;
            const percentage = pct(spent, b.limit_amount);
            const fillClass = percentage > 100 ? 'over' : percentage > 80 ? 'warn' : '';
            return `
              <div class="budget-card" data-budget-id="${b.id}">
                <div class="budget-header">
                  <div class="budget-name"><span style="color: ${safeColor(b.categories?.color)}">${icon(b.categories?.icon || 'more-horizontal', 16, safeColor(b.categories?.color))}</span>${e(b.categories?.name || t('analytics.categoryFallback'))}</div>
                  <div class="budget-amounts">${formatMoney(spent)} / ${formatMoney(b.limit_amount)}</div>
                </div>
                <div class="budget-track"><div class="budget-fill ${fillClass}" style="width: ${Math.min(percentage, 100)}%; background: ${!fillClass ? safeColor(b.categories?.color || '#1d9e75') : ''};"></div></div>
                <div class="budget-pct">${t('analytics.pctUsed', { pct: percentage })}</div>
              </div>`;
          }).join('')}
        </div>
      </div>
      ${renderTabBar()}
    `;
    app.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        if (chip.dataset.disabled === 'true') {
          showToast(t('home.partnerNotJoined'));
          return;
        }
        const selected = chip.dataset.filter;
        setState({ analyticsFilterBy: selected === 'all' ? null : selected });
        navigate('/analytics');
      });
    });
    app.querySelectorAll('.income-entry-row .btn-income-delete').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const row = btn.closest('.income-entry-row');
        const id = row?.dataset.incomeId;
        const amountStr = row?.dataset.incomeAmount || '';
        const amountFmt = formatMoney(parseFloat(amountStr || '0'), state.couple.currency);
        if (!id) return;
        if (!confirm(t('analytics.confirmDeleteIncome', { amount: amountFmt }))) return;
        try {
          await deleteIncomeEntry(id);
          showToast(t('analytics.incomeDeleted'));
          navigate('/analytics');
        } catch (err) {
          showToast(t('common.error', { msg: getReadableError(err) }));
        }
      });
    });
    document.getElementById('btn-add-budget')?.addEventListener('click', showAddBudgetModal);
    document.getElementById('btn-empty-add-budget')?.addEventListener('click', showAddBudgetModal);
    document.getElementById('btn-empty-add-expense')?.addEventListener('click', () => navigate('/'));
    app.querySelectorAll('.budget-card[data-budget-id]').forEach(card => {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        const budgetId = card.dataset.budgetId;
        const bd = document.createElement('div');
        bd.className = 'modal-backdrop';
        bd.onclick = (ev) => { if (ev.target === bd) bd.remove(); };
        bd.innerHTML = `
          <div class="modal-sheet">
            <div class="modal-handle"></div>
            <div class="modal-title">${t('analytics.manageBudget')}</div>
            <button class="btn btn-danger" id="btn-confirm-delete-budget">${t('analytics.deleteBudget')}</button>
            <button class="btn btn-secondary" id="btn-cancel-delete-budget" style="margin-top:8px;">${t('common.cancel')}</button>
          </div>
        `;
        document.body.appendChild(bd);
        enableModalSwipe(bd);
        document.getElementById('btn-cancel-delete-budget').onclick = () => bd.remove();
        document.getElementById('btn-confirm-delete-budget').onclick = async () => {
          try {
            await deleteBudget(budgetId);
            bd.remove();
            showToast(t('analytics.budgetDeleted'));
            navigate('/analytics');
          } catch (err) { showToast(t('common.error', { msg: getReadableError(err) })); }
        };
      });
    });
  });
}
