import { route, navigate } from '../lib/router.js';
import { getState, setState } from '../lib/store.js';
import { addGoal, addGoalContribution, deleteGoal, getGoals, updateGoal } from '../lib/supabase.js';
import { catTile, escapeHtml, formatDate, formatMoney, icon, moneyHtml, pct } from '../lib/utils.js';
import { burstConfetti } from '../components/confetti.js';
import { hapticSuccess, hapticTap } from '../services/haptics.js';

// Цвет цели берём по порядку из палитры: у целей нет своего цвета в базе,
// а одинаково зелёные кольца сливались в одно.
const GOAL_COLORS = ['#1d9e75', '#7f77dd', '#e8735a', '#378add', '#d4537e', '#ef9f27'];
import { t } from '../lib/i18n.js';
import { renderTabBar } from '../components/tab-bar.js';
import { showToast } from '../services/toast.js';
import { getReadableError } from '../services/errors.js';
import { enableModalSwipe } from '../components/modal-swipe.js';

const e = escapeHtml;

function showAddGoalModal() {
  const { couple } = getState();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (event) => { if (event.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div><div class="modal-title">${t('goals.newGoal')}</div>
      <div class="form-group"><label class="form-label">${t('common.name')}</label><input type="text" class="form-input" id="goal-name" placeholder="${t('goals.namePlaceholder')}" autocomplete="off"></div>
      <div class="form-group"><label class="form-label">${t('goals.targetAmount', { currency: couple.currency })}</label><input type="number" class="form-input" id="goal-target" placeholder="120000" inputmode="numeric"></div>
      <div class="form-group"><label class="form-label">${t('goals.deadlineOptional')}</label><input type="date" class="form-input" id="goal-deadline"></div>
      <button class="btn btn-primary" id="btn-save-goal">${t('common.create')}</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  enableModalSwipe(backdrop);
  document.getElementById('btn-save-goal').onclick = async () => {
    const name = document.getElementById('goal-name').value.trim();
    const target = parseFloat(document.getElementById('goal-target').value);
    const deadline = document.getElementById('goal-deadline').value || null;
    if (!name) { showToast(t('common.enterTitle')); return; }
    if (!target || target <= 0) { showToast(t('common.enterAmount')); return; }
    try {
      await addGoal({ couple_id: couple.id, name, target_amount: target, deadline });
      backdrop.remove();
      showToast(t('goals.created'));
      navigate('/goals');
    } catch (err) {
      showToast(t('common.error', { msg: getReadableError(err) }));
    }
  };
}

function showGoalActionsModal(goalId) {
  const { goals, couple } = getState();
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (event) => { if (event.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="expense-sheet-head">
        ${catTile(goal.icon || 'target', GOAL_COLORS[Math.max(0, goals.indexOf(goal)) % GOAL_COLORS.length], 56)}
        <div class="modal-title" style="margin:0;">${e(goal.name)}</div>
        <div class="expense-sheet-meta">${t('goals.ofTarget', { current: formatMoney(goal.current_amount, couple.currency), target: formatMoney(goal.target_amount, couple.currency) })} · ${pct(goal.current_amount, goal.target_amount)}%</div>
      </div>
      <div class="form-group"><label class="form-label">${t('goals.topUp')}</label><input type="number" class="form-input amount" id="contrib-amount" placeholder="0" inputmode="decimal"></div>
      <button class="btn btn-primary" id="btn-save-contrib">${t('goals.topUp')}</button>
      <div class="action-list" style="margin-top:14px;">
        <button class="action-row" id="btn-edit-goal">${icon('edit', 20)}${t('goals.editGoal')}</button>
        <button class="action-row danger" id="btn-delete-goal">${icon('trash-2', 20)}${t('goals.deleteGoal')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  enableModalSwipe(backdrop);
  setTimeout(() => document.getElementById('contrib-amount')?.focus(), 300);
  document.getElementById('btn-save-contrib').onclick = async () => {
    const amount = parseFloat(document.getElementById('contrib-amount').value);
    if (!amount || amount <= 0) { showToast(t('common.enterAmount')); return; }
    try {
      await addGoalContribution(goalId, amount);
      backdrop.remove();
      const before = Number(goal.current_amount) || 0;
      const target = Number(goal.target_amount) || 0;
      if (target > 0 && before < target && before + amount >= target) {
        // Цель закрыта этим пополнением — отмечаем праздником, а не обычным тостом
        burstConfetti();
        hapticSuccess();
        showToast(t('goals.reachedToast', { name: goal.name }));
      } else {
        hapticTap();
        showToast(t('goals.toppedUp'));
      }
      navigate('/goals');
    } catch (err) { showToast(t('common.error', { msg: getReadableError(err) })); }
  };
  document.getElementById('btn-edit-goal').onclick = () => {
    backdrop.remove();
    const editBackdrop = document.createElement('div');
    editBackdrop.className = 'modal-backdrop';
    editBackdrop.onclick = (ev) => { if (ev.target === editBackdrop) editBackdrop.remove(); };
    editBackdrop.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-handle"></div><div class="modal-title">${t('goals.editGoal')}</div>
        <div class="form-group"><label class="form-label">${t('common.name')}</label><input type="text" class="form-input" id="edit-goal-name" value="${e(goal.name)}"></div>
        <div class="form-group"><label class="form-label">${t('goals.targetAmountShort')}</label><input type="number" class="form-input" id="edit-goal-target" value="${goal.target_amount}"></div>
        <div class="form-group"><label class="form-label">${t('goals.deadline')}</label><input type="date" class="form-input" id="edit-goal-deadline" value="${goal.deadline || ''}"></div>
        <button class="btn btn-primary" id="btn-save-goal-edit">${t('common.save')}</button>
      </div>
    `;
    document.body.appendChild(editBackdrop);
    enableModalSwipe(editBackdrop);
    document.getElementById('btn-save-goal-edit').onclick = async () => {
      const btn = document.getElementById('btn-save-goal-edit');
      if (btn.disabled) return;
      // Без этих проверок пустая сумма улетала как null и пользователь видел сырую
      // ошибку Postgres про not-null constraint
      const editName = document.getElementById('edit-goal-name').value.trim();
      const editTarget = parseFloat(document.getElementById('edit-goal-target').value);
      if (!editName) { showToast(t('common.enterTitle')); return; }
      if (!Number.isFinite(editTarget) || editTarget <= 0) { showToast(t('common.enterAmount')); return; }
      btn.disabled = true;
      try {
        await updateGoal(goal.id, {
          name: editName,
          target_amount: editTarget,
          deadline: document.getElementById('edit-goal-deadline').value || null,
        });
        editBackdrop.remove();
        showToast(t('goals.updated'));
        navigate('/goals');
      } catch (err) {
        showToast(t('common.error', { msg: getReadableError(err) }));
        btn.disabled = false;
      }
    };
  };
  document.getElementById('btn-delete-goal').onclick = async () => {
    // Удаление цели каскадом сносит все пополнения и необратимо — спрашиваем
    if (!window.confirm(t('goals.confirmDelete', { name: goal.name }))) return;
    try {
      await deleteGoal(goal.id);
      backdrop.remove();
      showToast(t('goals.deletedToast'));
      navigate('/goals');
    } catch (err) { showToast(t('common.error', { msg: getReadableError(err) })); }
  };
}

export function registerGoalsRoute() {
  route('/goals', async (app) => {
    const state = getState();
    if (!state.couple) { navigate('/'); return; }
    let goals = [];
    try {
      goals = await getGoals(state.couple.id);
      setState({ goals });
    } catch (err) {
      console.error('Goals load error:', err);
    }
    const cur = state.couple.currency;
    const totalSaved = goals.reduce((sum, g) => sum + (Number(g.current_amount) || 0), 0);
    const totalTarget = goals.reduce((sum, g) => sum + (Number(g.target_amount) || 0), 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    app.innerHTML = `
      <div class="page-enter">
        <div class="header">
          <div class="header-title">${t('goals.title')}</div>
          <button class="header-action" id="btn-add-goal" aria-label="${t('goals.newGoal')}">${icon('plus', 20)}</button>
        </div>
        ${goals.length === 0 ? `
          <div class="empty-state">${catTile('target', '#7f77dd', 64)}<p style="margin-top:14px;">${t('goals.empty')}</p><button class="btn btn-primary" id="btn-empty-add-goal" style="margin-top: 14px; max-width: 240px;">${t('goals.createGoal')}</button></div>
        ` : `
          <div class="goals-summary">
            <div class="hero-label">${t('goals.savedTogether')}</div>
            <div class="hero-total">${moneyHtml(totalSaved, cur)}</div>
            <div class="hero-meta">${t('goals.ofTotal', { amount: formatMoney(totalTarget, cur) })}</div>
            <div class="goals-summary-track"><i style="width:${Math.min(100, pct(totalSaved, totalTarget))}%"></i></div>
          </div>
          ${goals.map((g, i) => {
            const percentage = pct(g.current_amount, g.target_amount);
            const color = GOAL_COLORS[i % GOAL_COLORS.length];
            const done = percentage >= 100;
            const r = 28;
            const c = 2 * Math.PI * r;
            const dash = c * (1 - Math.min(percentage, 100) / 100);
            const tags = [];
            if (done) {
              tags.push(`<span class="goal-tag success">${icon('trophy', 12, 'currentColor', 2.4)}${t('goals.reached')}</span>`);
            } else if (g.deadline) {
              const deadline = new Date(`${g.deadline}T00:00:00`);
              const days = Math.round((deadline - today) / 86400000);
              tags.push(`<span class="goal-tag">${icon('calendar', 12, 'currentColor', 2.4)}${e(formatDate(g.deadline))} · ${days >= 0 ? t('goals.daysLeft', { days }) : t('goals.overdue')}</span>`);
              // Сколько откладывать в месяц, чтобы успеть к сроку
              const months = Math.max(1, Math.ceil(days / 30.4));
              const remaining = Math.max(0, Number(g.target_amount) - Number(g.current_amount));
              if (days > 0 && remaining > 0) tags.push(`<span class="goal-tag">${icon('repeat', 12, 'currentColor', 2.4)}${t('goals.perMonth', { amount: formatMoney(remaining / months, cur) })}</span>`);
            }
            return `
            <div class="goal-card ${done ? 'done' : ''}" data-id="${g.id}">
              <div class="goal-ring">
                <svg viewBox="0 0 64 64"><circle class="ring-bg" r="${r}" cx="32" cy="32"></circle><circle class="ring-fg" r="${r}" cx="32" cy="32" stroke="${color}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${dash.toFixed(2)}"></circle></svg>
                ${catTile(done ? 'trophy' : (g.icon || 'target'), color, 38)}
              </div>
              <div class="goal-body">
                <div class="goal-top"><div class="goal-name">${e(g.name)}</div><div class="goal-pct" style="color:${color}">${percentage}%</div></div>
                <div class="goal-amounts">${t('goals.ofTarget', { current: formatMoney(g.current_amount, cur), target: formatMoney(g.target_amount, cur) })}</div>
                ${tags.length ? `<div class="goal-tags">${tags.join('')}</div>` : ''}
              </div>
            </div>`;
          }).join('')}
        `}
      </div>
      ${renderTabBar()}
    `;
    document.getElementById('btn-add-goal')?.addEventListener('click', showAddGoalModal);
    document.getElementById('btn-empty-add-goal')?.addEventListener('click', showAddGoalModal);
    app.querySelectorAll('.goal-card[data-id]').forEach(card => {
      card.onclick = () => showGoalActionsModal(card.dataset.id);
    });
  });
}
