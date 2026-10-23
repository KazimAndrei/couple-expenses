import { route, navigate } from '../lib/router.js';
import { getState, setState } from '../lib/store.js';
import { deleteBudget, deleteIncomeEntry, getBudgets, getCoupleMembers, getExpenses, getIncomeEntries, upsertBudget } from '../lib/supabase.js';
import { PARTNER_COLORS, catTile, currentMonth, escapeHtml, formatDateTime, formatMoney, formatMonth, icon, moneyHtml, pct, prevMonth, safeColor } from '../lib/utils.js';
import { t, categoryLabel } from '../lib/i18n.js';
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
        <select class="form-input" id="budget-cat">${categories.map(c => `<option value="${c.id}">${e(categoryLabel(c.name))}</option>`).join('')}</select>
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
    // Накопления в цель — не траты: на главной они уже исключены, здесь раздували сумму,
  // среднее в день и категорию «Другое» (у них нет category_id)
  const isGoalExpense = (x) => Array.isArray(x.goal_contributions) && x.goal_contributions.length > 0;
  const spendable = expenses.filter((x) => !isGoalExpense(x));
  // Доход и накопления — общие для пары, поэтому считаются по всем записям, без чипа участника
  const incomeTotal = incomeEntries.reduce((sum, ent) => sum + parseFloat(ent.amount || 0), 0);
  const savedTotal = expenses.filter(isGoalExpense).reduce((sum, x) => sum + parseFloat(x.amount || 0), 0);
  const coupleSpent = spendable.reduce((sum, x) => sum + parseFloat(x.amount || 0), 0);
  const leftover = incomeTotal - coupleSpent - savedTotal;
  const spentPct = incomeTotal > 0 ? Math.min(100, Math.round((coupleSpent / incomeTotal) * 100)) : 0;
  const savedPct = incomeTotal > 0 ? Math.min(100 - spentPct, Math.round((savedTotal / incomeTotal) * 100)) : 0;
  const filteredExpenses = filterExpensesByMemberChip(spendable, filterBy, sides);

    const grandTotal = filteredExpenses.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
    // Для прошедшего месяца — все его дни, для текущего — сколько прошло: деление на
  // фиксированные 30 занижало среднее в начале месяца в разы
  const [avgY, avgM] = month.split('-').map(Number);
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === avgY && now.getMonth() + 1 === avgM;
  const daysForAverage = isCurrentMonth ? now.getDate() : new Date(avgY, avgM, 0).getDate();

  const prevFiltered = filterExpensesByMemberChip(prevExpenses.filter((x) => !isGoalExpense(x)), filterBy, sides);
  const prevTotal = prevFiltered.reduce((sum, expense) => sum + parseFloat(expense.amount), 0);
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
        category_name: categoryLabel(expense.categories?.name) || t('common.other'),
        category_color: expense.categories?.color || '#888780',
        category_icon: expense.categories?.icon || 'more-horizontal',
        total: 0,
      };
      existing.total += parseFloat(expense.amount);
      catMap.set(categoryId, existing);
    }
    const sortedCats = [...catMap.values()].sort((a, b) => b.total - a.total);
    const topCategory = sortedCats[0] || null;

    // Бюджеты заводятся на пару целиком, поэтому их прогресс не должен зависеть
    // от выбранного чипа участника
    const coupleCatMap = new Map();
    for (const expense of spendable) {
      const categoryId = expense.category_id || 'other';
      const acc = coupleCatMap.get(categoryId) || { category_id: categoryId, total: 0 };
      acc.total += parseFloat(expense.amount);
      coupleCatMap.set(categoryId, acc);
    }
    const coupleCats = [...coupleCatMap.values()];

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
        ${!filterBy ? `
        <div class="money-flow">
          <div class="money-flow-head">
            <div>
              <div class="money-flow-label">${t('analytics.income')}</div>
              <div class="money-flow-income">${formatMoney(incomeTotal, state.couple.currency)}</div>
            </div>
            <div style="text-align:right;">
              <div class="money-flow-label">${leftover >= 0 ? t('analytics.leftover') : t('analytics.overspent')}</div>
              <div class="money-flow-left ${leftover < 0 ? 'negative' : ''}">${formatMoney(Math.abs(leftover), state.couple.currency)}</div>
            </div>
          </div>
          ${incomeTotal > 0 ? `
            <div class="money-flow-bar">
              <div class="money-flow-seg spent" style="width:${spentPct}%"></div>
              <div class="money-flow-seg saved" style="width:${savedPct}%"></div>
            </div>
            <div class="money-flow-legend">
              <span><i class="dot spent"></i>${t('analytics.spent')} ${formatMoney(coupleSpent, state.couple.currency)} · ${spentPct}%</span>
              ${savedTotal > 0 ? `<span><i class="dot saved"></i>${t('analytics.saved')} ${formatMoney(savedTotal, state.couple.currency)}</span>` : ''}
            </div>
          ` : `<div class="money-flow-hint">${t('analytics.noIncomeHint')}</div>`}
        </div>` : ''}
        <div class="stats-row">
          <div class="stat-card"><div class="stat-label">${t('analytics.avgShort')}</div><div class="stat-value">${formatMoney(grandTotal / daysForAverage, state.couple.currency)}</div></div>
          <div class="stat-card"><div class="stat-label">${t('analytics.vsPrevShort')}</div><div class="stat-value ${prevTotal > 0 ? (trendPct > 0 ? 'up' : trendPct < 0 ? 'down' : '') : ''}">${prevTotal > 0 ? `${trendPct !== 0 ? icon(trendPct > 0 ? 'arrow-up-right' : 'arrow-down-right', 15, 'currentColor', 2.6) : ''}${Math.abs(trendPct)}%` : '—'}</div></div>
          <div class="stat-card"><div class="stat-label">${t('analytics.txCount')}</div><div class="stat-value">${filteredExpenses.length}</div></div>
        </div>
        <div class="card">
          <div class="card-title"><span>${t('analytics.byCategory')}</span></div>
          ${sortedCats.length === 0 ? `<div class="empty-state" style="padding:20px 8px;"><p>${t('analytics.noData')}</p><button class="btn btn-primary" id="btn-empty-add-expense" style="margin-top: 12px; max-width: 240px;">${t('home.addExpense')}</button></div>` : `
          <div class="donut-wrap">
            <div class="donut">
              ${(() => {
                // Кольцо из сегментов: длина дуги = доля категории, между сегментами зазор
                const r = 80;
                const c = 2 * Math.PI * r;
                const gap = sortedCats.length > 1 ? 3 : 0;
                let offset = 0;
                const segs = sortedCats.map((cat) => {
                  const len = Math.max(0, (cat.total / grandTotal) * c - gap);
                  const seg = `<circle class="seg" r="${r}" cx="100" cy="100" stroke="${safeColor(cat.category_color)}" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"></circle>`;
                  offset += (cat.total / grandTotal) * c;
                  return seg;
                }).join('');
                return `<svg viewBox="0 0 200 200"><circle r="${r}" cx="100" cy="100" stroke="var(--c-surface-alt)"></circle>${segs}</svg>`;
              })()}
              <div class="donut-center">
                <div class="donut-total">${moneyHtml(grandTotal, state.couple.currency)}</div>
                <div class="donut-sub">${selectedMemberLabel ? e(selectedMemberLabel) : t('analytics.ofMonth')}</div>
              </div>
            </div>
          </div>
          ${sortedCats.map(c => `
            <div class="legend-row">
              ${catTile(c.category_icon, c.category_color, 34)}
              <div class="legend-main">
                <div class="legend-top"><span>${e(c.category_name)}</span><span class="legend-amount">${formatMoney(c.total, state.couple.currency)}</span></div>
                <div class="legend-bar"><i style="width:${pct(c.total, sortedCats[0].total)}%;background:${safeColor(c.category_color)}"></i></div>
              </div>
              <div class="legend-pct">${pct(c.total, grandTotal)}%</div>
            </div>
          `).join('')}`}
        </div>
        ${!filterBy && payerTotals.length === 2 && (payerTotals[0].total_paid + payerTotals[1].total_paid) > 0 ? (() => {
          const [pa, pb] = payerTotals;
          const avatarFor = (p, side) => {
            const m = (members || []).find((x) => x.id === p.id);
            const url = m?.avatar_url || (m?.id === state.profile?.id ? state.profile?.avatar_url : null);
            return url ? `<img class="mini-avatar" src="${url}" alt="">` : `<div class="mini-avatar ${side}">${e((p.payer_name || '?')[0])}</div>`;
          };
          return `
        <div class="card">
          <div class="card-title"><span>${t('analytics.whoPaid')}</span></div>
          <div class="payers-bar">
            <i style="flex-grow:${pa.total_paid};background:${PARTNER_COLORS.a}"></i>
            <i style="flex-grow:${pb.total_paid};background:${PARTNER_COLORS.b}"></i>
          </div>
          <div class="payers-legend">
            <div class="payer-stat">${avatarFor(pa, '')}<div><div class="payer-stat-name">${e(pa.payer_name)} · ${pct(pa.total_paid, pa.total_paid + pb.total_paid)}%</div><div class="payer-stat-sum">${formatMoney(pa.total_paid, state.couple.currency)}</div></div></div>
            <div class="payer-stat">${avatarFor(pb, 'b')}<div><div class="payer-stat-name">${e(pb.payer_name)} · ${pct(pb.total_paid, pa.total_paid + pb.total_paid)}%</div><div class="payer-stat-sum">${formatMoney(pb.total_paid, state.couple.currency)}</div></div></div>
          </div>
        </div>`;
        })() : ''}
        <div class="section-header"><span class="section-title">${t('analytics.budgets')}</span><button class="section-action" id="btn-add-budget">${t('analytics.addAction')}</button></div>
        <div id="budgets-list">
          ${budgets.length === 0 ? `<div class="empty-state" style="padding:20px 24px;"><p>${t('analytics.noBudgets')}</p><button class="btn btn-primary" id="btn-empty-add-budget" style="margin-top: 12px; max-width: 240px;">${t('analytics.addBudget')}</button></div>` : budgets.map(b => {
            // Бюджет ставится на пару, поэтому считаем по всем тратам, а не по выбранному участнику
            const spent = coupleCats.find(c => c.category_id === b.category_id)?.total || 0;
            const percentage = pct(spent, b.limit_amount);
            // Цвет — по статусу, а не по категории: красный значит «превышен», а не «рестораны»
            const status = percentage > 100 ? 'over' : percentage >= 80 ? 'warn' : '';
            const left = b.limit_amount - spent;
            const pace = isCurrentMonth ? Math.round((now.getDate() / new Date(avgY, avgM, 0).getDate()) * 100) : null;
            return `
              <div class="budget-card" data-budget-id="${b.id}">
                <div class="budget-header">
                  ${catTile(b.categories?.icon || 'more-horizontal', b.categories?.color || '#888780', 36)}
                  <div class="budget-main">
                    <div class="budget-name">${e(categoryLabel(b.categories?.name) || t('analytics.categoryFallback'))}</div>
                    <div class="budget-amounts">${formatMoney(spent, state.couple.currency)} / ${formatMoney(b.limit_amount, state.couple.currency)}</div>
                  </div>
                  <div class="budget-pct ${status}">${percentage}%</div>
                </div>
                <div class="budget-track">
                  <div class="budget-fill ${status}" style="width:${Math.min(percentage, 100)}%"></div>
                  ${pace !== null ? `<div class="budget-pace" style="left:calc(${pace}% - 1px)"></div>` : ''}
                </div>
                <div class="budget-foot"><span>${left >= 0 ? t('analytics.leftAmount', { amount: formatMoney(left, state.couple.currency) }) : t('analytics.overAmount', { amount: formatMoney(-left, state.couple.currency) })}</span></div>
              </div>`;
          }).join('')}
        </div>
        <div class="section-header"><span class="section-title">${t('analytics.incomeSection')}</span></div>
        <div class="card income-entries-analytics" style="padding:6px 16px;">
          ${incomeEntries.length === 0 ? `<div style="padding:12px 0;font-size:14px;color:var(--c-text-secondary);">${t('analytics.noIncome')}</div>` : incomeEntries.map((ent) => {
            const who = incomeAuthorLabel(ent.created_by);
            const side = ent.created_by === memberB?.id ? 'b' : '';
            return `
            <div class="income-entry income-entry-row" data-income-id="${e(ent.id)}" data-income-amount="${e(String(ent.amount))}">
              <div class="mini-avatar ${side}">${e((who || '?')[0])}</div>
              <div class="income-entry-main">
                <div class="income-entry-who">${e(who)}</div>
                <div class="income-entry-date">${e(formatDateTime(ent.created_at))}</div>
              </div>
              <div class="income-entry-amount">+${formatMoney(ent.amount, state.couple.currency)}</div>
              <button class="btn-income-delete" type="button" aria-label="${t('analytics.deleteEntryAria')}">${icon('trash-2', 17, 'currentColor')}</button>
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
