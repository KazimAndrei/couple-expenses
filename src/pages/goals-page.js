import { route, navigate } from '../lib/router.js';
import { getState, setState } from '../lib/store.js';
import { addGoal, addGoalContribution, deleteGoal, getGoals, updateGoal } from '../lib/supabase.js';
import { escapeHtml, formatDate, formatMoney, icon, pct } from '../lib/utils.js';
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
      <div class="modal-handle"></div><div class="modal-title">${e(goal.name)}</div>
      <div style="text-align:center;margin-bottom:16px;color:var(--c-text-secondary);font-size:14px;">${t('goals.progress', { current: formatMoney(goal.current_amount, couple.currency), target: formatMoney(goal.target_amount, couple.currency) })}</div>
      <div class="form-group"><label class="form-label">${t('goals.topUp')}</label><input type="number" class="form-input amount" id="contrib-amount" placeholder="0" inputmode="decimal"></div>
      <button class="btn btn-primary" id="btn-save-contrib">${t('goals.topUp')}</button>
      <button class="btn btn-secondary" id="btn-edit-goal" style="margin-top:8px;">${t('goals.editGoal')}</button>
      <button class="btn btn-danger" id="btn-delete-goal" style="margin-top:8px;">${t('goals.deleteGoal')}</button>
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
      showToast(t('goals.toppedUp'));
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
    app.innerHTML = `
      <div class="page-enter">
        <div class="header">
          <div class="header-title">${t('goals.title')}</div>
          <button class="header-action" id="btn-add-goal">${icon('plus', 20)}</button>
        </div>
        ${goals.length === 0 ? `
          <div class="empty-state">${icon('target', 48, 'var(--c-text-muted)')}<p>${t('goals.empty')}</p><button class="btn btn-primary" id="btn-empty-add-goal" style="margin-top: 12px; max-width: 240px;">${t('goals.createGoal')}</button></div>
        ` : goals.map(g => {
          const percentage = pct(g.current_amount, g.target_amount);
          return `
            <div class="goal-card" data-id="${g.id}">
              <div class="goal-header"><div class="goal-name">${icon(g.icon, 18, 'var(--c-accent)')} ${e(g.name)}</div><div class="goal-pct">${percentage}%</div></div>
              <div class="goal-track"><div class="goal-fill" style="width: ${Math.min(percentage, 100)}%"></div></div>
              <div class="goal-amounts">${t('goals.amounts', { current: formatMoney(g.current_amount, state.couple.currency), target: formatMoney(g.target_amount, state.couple.currency) })}${g.deadline ? t('goals.until', { date: formatDate(g.deadline) }) : ''}</div>
            </div>`;
        }).join('')}
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
