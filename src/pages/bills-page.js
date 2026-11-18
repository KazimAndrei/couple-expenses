// «Платежи»: счета и подписки пары — календарь ближайших платежей, кто отвечает, сколько это в месяц и в год.
// Расчёты — lib/bills.js; данные — таблица recurring_expenses и расходы, привязанные к платежам.
import { route, navigate } from '../lib/router.js';
import { getState, isSolo } from '../lib/store.js';
import { addExpense, createRecurringExpense, deleteRecurringExpense, getExpensesInRange, getRecurringExpenses, getRecurringPayments, updateRecurringExpense } from '../lib/supabase.js';
import { billStatus, billTotals, detectRecurring, monthlyCost, upcomingBills, yearlyCost } from '../lib/bills.js';
import { monthKeys } from '../lib/reports.js';
import { catTile, currentMonth, escapeHtml, formatMoney, icon, moneyHtml, todayStr } from '../lib/utils.js';
import { categoryLabel, getLang, t } from '../lib/i18n.js';
import { memberDisplayLabel, resolveMemberSides } from '../lib/member-filters.js';
import { renderTabBar } from '../components/tab-bar.js';
import { enableModalSwipe } from '../components/modal-swipe.js';
import { showToast } from '../services/toast.js';
import { getReadableError } from '../services/errors.js';
import { hapticSelect, hapticSuccess } from '../services/haptics.js';
import { soundAdd, soundDelete } from '../services/sounds.js';

const e = escapeHtml;
let view = 'calendar';

const locale = () => (getLang() === 'en' ? 'en-US' : 'ru-RU');
const parseYmd = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
const monthShort = (ymd) => new Intl.DateTimeFormat(locale(), { month: 'short' }).format(parseYmd(ymd)).replace('.', '');
const monthLong = (index) => new Intl.DateTimeFormat(locale(), { month: 'long' }).format(new Date(2026, index, 1));

function whenLabel(status) {
  if (status.overdue) return t('bills.overdue', { days: -status.daysLeft });
  if (status.paid) return t('bills.paid');
  if (status.daysLeft === 0) return t('bills.today');
  if (status.daysLeft === 1) return t('bills.tomorrow');
  return t('bills.inDays', { days: status.daysLeft });
}

// Данные экрана: платежи, оплаты этого года и траты за полгода (для поиска подписок)
export async function loadBills(coupleId) {
  const now = new Date();
  const [bills, payments] = await Promise.all([
    getRecurringExpenses(coupleId),
    getRecurringPayments(coupleId, `${now.getFullYear()}-01-01`),
  ]);
  return { bills, payments };
}

function openBillSheet(bill, { onDone, prefill = {} } = {}) {
  const { couple, categories, members, profile } = getState();
  const solo = isSolo();
  const sides = resolveMemberSides(members);
  const payers = [sides.memberA, sides.memberB].filter(Boolean);
  const src = bill || { kind: 'bill', period: 'month', day_of_month: new Date().getDate(), auto_add: false, remind: true, split: 'equal', ...prefill };
  const isSub = () => backdrop.querySelector('.segc-btn[data-kind].on')?.dataset.kind === 'subscription';
  const payerId = src.split === 'equal' && !solo ? 'shared' : (src.paid_by || profile.id);
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (ev) => { if (ev.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet has-footer">
     <div class="sheet-body">
      <div class="modal-handle"></div>
      <div class="modal-title">${t(bill ? 'bills.editTitle' : 'bills.newTitle')}</div>
      <div class="segc" role="tablist">
        <button type="button" class="segc-btn ${src.kind !== 'subscription' ? 'on' : ''}" data-kind="bill">${t('bills.kindBill')}</button>
        <button type="button" class="segc-btn ${src.kind === 'subscription' ? 'on' : ''}" data-kind="subscription">${t('bills.kindSub')}</button>
      </div>
      <div class="form-group"><label class="form-label">${t('common.name')}</label>
        <input type="text" class="form-input" id="bill-name" value="${e(src.description || '')}" placeholder="${t('bills.namePlaceholder')}" autocomplete="off"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">${t('common.amount')} (${e(couple.currency)})</label>
          <input type="number" class="form-input" id="bill-amount" value="${src.amount ?? ''}" placeholder="0" inputmode="decimal" min="0" step="0.01"></div>
        <div class="form-group"><label class="form-label">${t('bills.period')}</label>
          <select class="form-input" id="bill-period">
            <option value="month" ${src.period !== 'year' ? 'selected' : ''}>${t('bills.periodMonth')}</option>
            <option value="year" ${src.period === 'year' ? 'selected' : ''}>${t('bills.periodYear')}</option>
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">${t('bills.day')}</label>
          <select class="form-input" id="bill-day">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${Number(src.day_of_month) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>
        <div class="form-group" id="bill-month-wrap"><label class="form-label">${t('bills.month')}</label>
          <select class="form-input" id="bill-month">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${(Number(src.month_of_year) || new Date().getMonth() + 1) === i + 1 ? 'selected' : ''}>${e(monthLong(i))}</option>`).join('')}</select></div>
      </div>
      <div class="form-group"><label class="form-label">${t('common.category')}</label>
        <select class="form-input" id="bill-category">${categories.map((c) => `<option value="${c.id}" ${src.category_id === c.id ? 'selected' : ''}>${e(categoryLabel(c.name))}</option>`).join('')}</select></div>
      ${solo ? '' : `<div class="form-group"><label class="form-label">${t('bills.responsible')}</label>
        <div class="payer-options">
          <div class="payer-option ${payerId === 'shared' ? 'selected' : ''}" data-id="shared"><div class="payer-avatar payer-avatar-initials shared">${icon('heart', 13, '#fff', 2.4)}</div><span>${t('common.shared')}</span></div>
          ${payers.map((m) => `<div class="payer-option ${payerId === m.id ? 'selected' : ''}" data-id="${m.id}"><div class="payer-avatar payer-avatar-initials ${m.id === sides.memberB?.id ? 'b' : 'a'}">${e((memberDisplayLabel(m) || '?')[0])}</div><span>${e(memberDisplayLabel(m))}</span></div>`).join('')}
        </div></div>`}
      <label class="toggle-row"><span><b>${t('bills.autoAdd')}</b><small>${t('bills.autoAddHint')}</small></span><input type="checkbox" id="bill-auto" ${src.auto_add ? 'checked' : ''}></label>
      <label class="toggle-row" id="bill-remind-row"><span><b>${t('bills.remind')}</b><small>${t('bills.remindHint')}</small></span><input type="checkbox" id="bill-remind" ${src.remind !== false ? 'checked' : ''}></label>
      ${bill ? `<div class="action-list" style="margin-top:14px;">
        ${!bill.auto_add ? `<button class="action-row" id="btn-bill-paid">${icon('check', 20)}${t('bills.markPaid')}</button>` : ''}
        <button class="action-row danger" id="btn-bill-delete">${icon('trash-2', 20)}${t('common.delete')}</button>
      </div>` : ''}
     </div>
      <div class="sheet-footer"><button class="btn btn-primary" id="btn-bill-save">${t(bill ? 'common.save' : 'common.add')}</button></div>
    </div>`;
  document.body.appendChild(backdrop);
  enableModalSwipe(backdrop);

  const sync = () => {
    backdrop.querySelector('#bill-month-wrap').hidden = backdrop.querySelector('#bill-period').value !== 'year';
    // Напоминание нужно только там, где расход не появляется сам
    backdrop.querySelector('#bill-remind-row').hidden = backdrop.querySelector('#bill-auto').checked;
  };
  backdrop.querySelector('#bill-period').addEventListener('change', sync);
  backdrop.querySelector('#bill-auto').addEventListener('change', sync);
  sync();
  backdrop.querySelectorAll('.segc-btn').forEach((btn) => btn.addEventListener('click', () => {
    backdrop.querySelectorAll('.segc-btn').forEach((b) => b.classList.toggle('on', b === btn));
    // Подписка списывается сама — предлагаем автодобавление, но только при создании
    if (!bill) { backdrop.querySelector('#bill-auto').checked = isSub(); sync(); }
    hapticSelect();
  }));
  backdrop.querySelectorAll('.payer-option').forEach((opt) => opt.addEventListener('click', () => {
    backdrop.querySelectorAll('.payer-option').forEach((o) => o.classList.toggle('selected', o === opt));
    hapticSelect();
  }));

  const finish = (message) => { backdrop.remove(); if (message) showToast(message); onDone?.(); };
  const fail = (err) => showToast(t('common.error', { msg: getReadableError(err) }));

  backdrop.querySelector('#btn-bill-save').addEventListener('click', async () => {
    const description = backdrop.querySelector('#bill-name').value.trim();
    const amount = parseFloat(backdrop.querySelector('#bill-amount').value);
    if (!description) { showToast(t('common.enterTitle')); return; }
    if (!(amount > 0)) { showToast(t('common.enterAmount')); return; }
    const chosen = backdrop.querySelector('.payer-option.selected')?.dataset.id || profile.id;
    const shared = chosen === 'shared';
    const period = backdrop.querySelector('#bill-period').value;
    const payload = {
      description,
      amount,
      kind: isSub() ? 'subscription' : 'bill',
      period,
      day_of_month: Number(backdrop.querySelector('#bill-day').value),
      month_of_year: period === 'year' ? Number(backdrop.querySelector('#bill-month').value) : null,
      category_id: backdrop.querySelector('#bill-category').value || null,
      // За общий счёт отвечает тот, кто его завёл или вёл раньше; делится он пополам
      paid_by: shared ? (bill?.paid_by || profile.id) : chosen,
      split: shared ? 'equal' : 'full_payer',
      auto_add: backdrop.querySelector('#bill-auto').checked,
      remind: backdrop.querySelector('#bill-remind').checked,
    };
    try {
      if (bill) await updateRecurringExpense(bill.id, payload);
      else await createRecurringExpense({ ...payload, couple_id: couple.id, currency: couple.currency || 'USD', split_payer_pct: 50 });
      hapticSuccess();
      finish(t(bill ? 'bills.saved' : 'bills.added'));
    } catch (err) { fail(err); }
  });
  backdrop.querySelector('#btn-bill-paid')?.addEventListener('click', async () => {
    try {
      await payBill(bill);
      finish(t('bills.paidToast'));
    } catch (err) { fail(err); }
  });
  backdrop.querySelector('#btn-bill-delete')?.addEventListener('click', async () => {
    if (!window.confirm(t('bills.confirmDelete', { name: bill.description }))) return;
    try {
      await deleteRecurringExpense(bill.id);
      soundDelete();
      finish(t('bills.deleted'));
    } catch (err) { fail(err); }
  });
}

// «Оплачено»: расход сегодняшним числом, привязанный к платежу
async function payBill(bill) {
  const { couple } = getState();
  await addExpense({
    couple_id: couple.id,
    category_id: bill.category_id,
    paid_by: bill.paid_by,
    amount: Number(bill.amount),
    description: bill.description,
    split: bill.split,
    split_payer_pct: bill.split_payer_pct ?? 50,
    expense_date: todayStr(),
    currency: bill.currency || couple.currency || 'USD',
    recurring_id: bill.id,
  });
  hapticSuccess();
  soundAdd();
}

export function registerBillsRoute() {
  route('/bills', async (app) => {
    const state = getState();
    if (!state.couple) { navigate('/'); return; }
    const cur = state.couple.currency;
    const solo = isSolo();
    const sides = resolveMemberSides(state.members);
    let bills = [];
    let payments = [];
    let history = [];
    try {
      const months = monthKeys(currentMonth(), 6);
      const [data, past] = await Promise.all([
        loadBills(state.couple.id),
        getExpensesInRange(state.couple.id, `${months[0]}-01`, todayStr()).catch(() => []),
      ]);
      ({ bills, payments } = data);
      history = past;
    } catch (err) {
      showToast(t('common.error', { msg: getReadableError(err) }));
    }
    const reload = () => navigate('/bills');
    const catOf = (bill) => state.categories.find((c) => c.id === bill.category_id);
    const whoOf = (bill) => {
      if (solo) return '';
      if (bill.split === 'equal') return t('common.shared');
      return memberDisplayLabel(state.members.find((m) => m.id === bill.paid_by)) || '';
    };
    const sideClass = (bill) => (bill.split === 'equal' ? 'shared' : (bill.paid_by === sides.memberB?.id ? 'b' : 'a'));
    const totals = billTotals(bills);
    const list = upcomingBills(bills, payments);
    const subs = list.filter((x) => x.bill.kind === 'subscription').sort((a, b) => yearlyCost(b.bill) - yearlyCost(a.bill));
    const suggestions = detectRecurring(history, bills);

    const row = ({ bill, status }) => {
      const cat = catOf(bill);
      const meta = [categoryLabel(cat?.name) || t('common.other'), whoOf(bill), bill.auto_add ? t('bills.auto') : ''].filter(Boolean).join(' · ');
      return `
        <button type="button" class="bill-row ${status.overdue ? 'overdue' : ''} ${status.paid ? 'paid' : ''}" data-id="${bill.id}">
          <span class="bill-date"><b>${Number(status.due.slice(8))}</b><i>${e(monthShort(status.due))}</i></span>
          <span class="bill-main">
            <span class="bill-name">${e(bill.description)}${solo ? '' : `<i class="bill-who ${sideClass(bill)}"></i>`}</span>
            <span class="bill-meta">${e(meta)}</span>
          </span>
          <span class="bill-side">
            <b>${formatMoney(bill.amount, bill.currency || cur)}</b>
            <i class="bill-when">${status.paid ? icon('check', 11, 'currentColor', 3) : ''}${e(whenLabel(status))}</i>
          </span>
        </button>`;
    };
    const group = (title, items) => (items.length ? `<div class="section-header"><span class="section-title">${title}</span></div><div class="bill-list">${items.map(row).join('')}</div>` : '');
    const overdue = list.filter((x) => x.status.overdue);
    const week = list.filter((x) => !x.status.overdue && x.status.daysLeft <= 7);
    const later = list.filter((x) => !x.status.overdue && x.status.daysLeft > 7);

    app.innerHTML = `
      <div class="page-enter">
        <div class="header">
          <div class="header-row">
            <button class="header-action" id="btn-bills-back" aria-label="${t('common.back')}">${icon('chevron-left', 20)}</button>
            <div class="header-title" style="flex:1;">${t('bills.title')}</div>
            <button class="header-action" id="btn-bill-add" aria-label="${t('bills.newTitle')}">${icon('plus', 20)}</button>
          </div>
        </div>
        ${bills.length === 0 && suggestions.length === 0 ? `
          <div class="empty-state">${catTile('calendar', '#7f77dd', 64)}<p style="margin-top:14px;">${t('bills.empty')}</p>
            <button class="btn btn-primary" id="btn-bill-empty-add" style="margin-top:14px; max-width:260px;">${t('bills.addFirst')}</button></div>
        ` : `
          <div class="goals-summary bills-summary">
            <div class="hero-label">${t('bills.perMonth')}</div>
            <div class="hero-total">${moneyHtml(totals.monthly, cur)}</div>
            <div class="hero-meta">${t('bills.perYear', { amount: formatMoney(totals.yearly, cur) })}${totals.subscriptions ? ` · ${t('bills.subsYear', { amount: formatMoney(totals.subscriptionsYearly, cur) })}` : ''}</div>
          </div>
          <div class="segc segc-page">
            <button type="button" class="segc-btn ${view === 'calendar' ? 'on' : ''}" data-view="calendar">${t('bills.tabCalendar')}</button>
            <button type="button" class="segc-btn ${view === 'subs' ? 'on' : ''}" data-view="subs">${t('bills.tabSubs')}${totals.subscriptions ? ` · ${totals.subscriptions}` : ''}</button>
          </div>
          ${view === 'calendar' ? `
            ${list.length === 0 ? `<p class="bills-hint">${t('bills.noneYet')}</p>` : ''}
            ${group(t('bills.groupOverdue'), overdue)}
            ${group(t('bills.groupWeek'), week)}
            ${group(t('bills.groupLater'), later)}
          ` : `
            ${subs.length ? `<div class="bill-list">${subs.map(({ bill }) => `
              <button type="button" class="bill-row sub" data-id="${bill.id}">
                ${catTile(catOf(bill)?.icon || 'credit-card', catOf(bill)?.color || '#534AB7', 42)}
                <span class="bill-main"><span class="bill-name">${e(bill.description)}</span>
                  <span class="bill-meta">${t(bill.period === 'year' ? 'bills.subYearly' : 'bills.subMonthly', { amount: formatMoney(bill.amount, bill.currency || cur) })}</span></span>
                <span class="bill-side"><b>${formatMoney(yearlyCost(bill), bill.currency || cur)}</b><i class="bill-when">${t('bills.aYear')}</i></span>
              </button>`).join('')}</div>
              <p class="bills-hint">${t('bills.subsTotal', { month: formatMoney(totals.subscriptionsMonthly, cur), year: formatMoney(totals.subscriptionsYearly, cur) })}</p>`
            : `<p class="bills-hint">${t('bills.noSubs')}</p>`}
            ${suggestions.length ? `<div class="section-header"><span class="section-title">${t('bills.found')}</span></div>
              <p class="bills-hint" style="margin-top:-4px;">${t('bills.foundHint')}</p>
              <div class="bill-list">${suggestions.map((s, i) => `
              <div class="bill-row sub suggestion">
                ${catTile(s.categories?.icon || 'repeat', s.categories?.color || '#888780', 42)}
                <span class="bill-main"><span class="bill-name">${e(s.description)}</span>
                  <span class="bill-meta">${t('bills.foundMeta', { amount: formatMoney(s.amount, cur), months: s.months })}</span></span>
                <button type="button" class="btn btn-secondary btn-small" data-suggest="${i}">${t('common.add')}</button>
              </div>`).join('')}</div>` : ''}
          `}
        `}
      </div>
      ${renderTabBar()}`;

    document.getElementById('btn-bills-back').addEventListener('click', () => navigate('/analytics'));
    const add = () => openBillSheet(null, { onDone: reload, prefill: view === 'subs' ? { kind: 'subscription', auto_add: true } : {} });
    document.getElementById('btn-bill-add').addEventListener('click', add);
    document.getElementById('btn-bill-empty-add')?.addEventListener('click', add);
    app.querySelectorAll('.segc-btn[data-view]').forEach((btn) => btn.addEventListener('click', () => { view = btn.dataset.view; hapticSelect(); reload(); }));
    app.querySelectorAll('.bill-row[data-id]').forEach((el) => el.addEventListener('click', () => {
      const bill = bills.find((b) => b.id === el.dataset.id);
      if (bill) openBillSheet(bill, { onDone: reload });
    }));
    app.querySelectorAll('[data-suggest]').forEach((btn) => btn.addEventListener('click', () => {
      const s = suggestions[Number(btn.dataset.suggest)];
      openBillSheet(null, { onDone: reload, prefill: { kind: 'subscription', auto_add: true, description: s.description, amount: s.amount, category_id: s.category_id, paid_by: s.paid_by, split: s.split, day_of_month: s.day_of_month } });
    }));
  });
}

// Короткая сводка для других экранов: что просрочено и что на этой неделе
export function billsDigest(bills, payments, now = new Date()) {
  const list = upcomingBills(bills, payments, now).filter((x) => !x.bill.auto_add || x.status.daysLeft >= 0);
  return {
    overdue: list.filter((x) => x.status.overdue),
    soon: list.filter((x) => !x.status.overdue && !x.status.paid && x.status.daysLeft <= 3),
    next: list.find((x) => !x.status.paid && x.status.daysLeft >= 0) || null,
    totals: billTotals(bills),
    status: (bill) => billStatus(bill, payments, now),
    label: whenLabel,
    monthly: monthlyCost,
  };
}
