import './styles/app.css';
import { supabase, getSession, getProfile, getExpenses, addExpense, deleteExpense, getCategories, getBudgets, getGoals, addGoal, addGoalContribution, getMonthlyTotals, getPayerTotals, createCouple, joinCouple, signOut, signInAnonymously, authWithInviteCode, subscribeToExpenses, subscribeToGoals } from './lib/supabase.js';
import { formatMoney, formatMonth, formatDate, currentMonth, prevMonth, nextMonth, todayStr, groupByDate, pct, icon } from './lib/utils.js';
import { route, navigate, startRouter, getCurrentPath } from './lib/router.js';
import { getState, setState, subscribe } from './lib/store.js';

let realtimeChannel = null;

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function renderTabBar() {
  const path = getCurrentPath();
  return `
    <nav class="tab-bar">
      <button class="tab ${path === '/' ? 'active' : ''}" onclick="location.hash='/'">
        ${icon('home', 22)}<span>Главная</span>
      </button>
      <button class="tab ${path === '/analytics' ? 'active' : ''}" onclick="location.hash='/analytics'">
        ${icon('pie-chart', 22)}<span>Аналитика</span>
      </button>
      <button class="tab ${path === '/goals' ? 'active' : ''}" onclick="location.hash='/goals'">
        ${icon('target', 22)}<span>Цели</span>
      </button>
      <button class="tab ${path === '/profile' ? 'active' : ''}" onclick="location.hash='/profile'">
        ${icon('user', 22)}<span>Профиль</span>
      </button>
    </nav>
  `;
}

// ---- Add Expense Modal ----
function showAddExpenseModal() {
  const { categories, profile, couple } = getState();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">Новый расход</div>
      <div class="form-group">
        <input type="number" class="form-input amount" id="exp-amount" placeholder="0" inputmode="decimal" autocomplete="off">
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
              <div class="cat-dot" style="background: ${c.color}20">
                ${icon(c.icon, 16, c.color)}
              </div>
              ${c.name}
            </div>
          `).join('')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Кто платит</label>
        <select class="form-input" id="exp-payer">
          <option value="${profile?.id}">Я</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Дата</label>
        <input type="date" class="form-input" id="exp-date" value="${todayStr()}">
      </div>
      <div class="form-group">
        <label class="form-label">Деление</label>
        <div class="split-options">
          <div class="split-option selected" data-split="equal" onclick="selectSplit(this)">50/50</div>
          <div class="split-option" data-split="full_payer" onclick="selectSplit(this)">100% я</div>
          <div class="split-option" data-split="full_other" onclick="selectSplit(this)">100% партнёр</div>
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
        amount, description,
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

async function loadExpenses() {
  const { couple } = getState();
  if (!couple) return;
  const month = getState().currentMonth || currentMonth();
  const expenses = await getExpenses(couple.id, month);
  setState({ expenses, currentMonth: month });
}

async function loadAll() {
  const { couple } = getState();
  if (!couple) return;
  const month = getState().currentMonth || currentMonth();
  const [expenses, categories, budgets, goals] = await Promise.all([
    getExpenses(couple.id, month),
    getCategories(couple.id),
    getBudgets(couple.id, month),
    getGoals(couple.id),
  ]);
  setState({ expenses, categories, budgets, goals, currentMonth: month });
}

// ---- Auth page ----
route('/auth', async (app) => {
  const savedCode = localStorage.getItem('ce_invite_code');
  const savedName = localStorage.getItem('ce_display_name');
  
  app.innerHTML = `
    <div class="auth-page page-enter">
      <div class="auth-logo">${icon('heart', 48, 'var(--c-accent)')}</div>
      <div class="auth-title">CoupleExpenses</div>
      <div class="auth-sub">Совместный учёт расходов<br>для вас двоих</div>
      <div class="auth-form">
        <div class="form-group">
          <label class="form-label">Ваше имя</label>
          <input type="text" class="form-input" id="auth-name" placeholder="Андрей" value="${savedName || ''}" autocomplete="name">
        </div>
        <div class="form-group">
          <label class="form-label">Ключ пары</label>
          <input type="text" class="form-input" id="auth-code" placeholder="Введите ключ или создайте новую пару" value="${savedCode || ''}" autocomplete="off" style="text-align:center; font-size: 18px; letter-spacing: 2px;">
        </div>
        <button class="btn btn-primary" style="margin-top: 12px;" id="btn-enter">Войти</button>
        <div class="auth-divider">или</div>
        <button class="btn btn-secondary" id="btn-new-couple">Создать новую пару</button>
      </div>
    </div>
  `;

  document.getElementById('btn-enter').onclick = async () => {
    const name = document.getElementById('auth-name').value.trim();
    const code = document.getElementById('auth-code').value.trim();
    if (!name) { showToast('Введите имя'); return; }
    if (!code) { showToast('Введите ключ пары'); return; }
    try {
      document.getElementById('btn-enter').textContent = 'Входим...';
      document.getElementById('btn-enter').disabled = true;
      const couple = await authWithInviteCode(code, name);
      const profile = await getProfile();
      setState({ user: (await getSession())?.user, profile, couple: profile?.couples || couple, currentMonth: currentMonth(), loading: false });
      showToast('Добро пожаловать!');
      navigate('/');
    } catch (err) {
      showToast('Ошибка: ' + err.message);
      document.getElementById('btn-enter').textContent = 'Войти';
      document.getElementById('btn-enter').disabled = false;
    }
  };

  document.getElementById('btn-new-couple').onclick = async () => {
    const name = document.getElementById('auth-name').value.trim();
    if (!name) { showToast('Введите имя'); return; }
    try {
      document.getElementById('btn-new-couple').textContent = 'Создаём...';
      document.getElementById('btn-new-couple').disabled = true;
      // Create anonymous session first
      let session = await getSession();
      if (!session) {
        const result = await supabase.auth.signInAnonymously();
        if (result.error) throw new Error('Auth: ' + result.error.message);
        if (!result.data?.session) throw new Error('Anonymous Sign-In не включён. Включи в Supabase → Authentication → Providers → Anonymous Sign-In');
        session = result.data.session;
        // Wait for trigger to create profile
        await new Promise(r => setTimeout(r, 1000));
      }
      // Update display name
      await supabase.from('profiles').update({ display_name: name }).eq('id', session.user.id);
      // Create couple
      const couple = await createCouple();
      localStorage.setItem('ce_invite_code', couple.invite_code);
      localStorage.setItem('ce_display_name', name);
      const profile = await getProfile();
      setState({ user: session.user, profile, couple: profile?.couples || couple, currentMonth: currentMonth(), loading: false });
      // Show invite code
      showToast('Пара создана! Ключ: ' + couple.invite_code);
      navigate('/');
    } catch (err) {
      showToast('Ошибка: ' + err.message);
      document.getElementById('btn-new-couple').textContent = 'Создать новую пару';
      document.getElementById('btn-new-couple').disabled = false;
    }
  };
});

// ---- Setup page ----
route('/setup', async (app) => {
  app.innerHTML = `
    <div class="setup-page page-enter">
      <div style="margin-bottom: 24px">${icon('heart', 40, 'var(--c-accent)')}</div>
      <div class="setup-title">Настройка пары</div>
      <div class="setup-sub">Создайте общее пространство или присоединитесь к партнёру</div>
      <div class="setup-options">
        <div class="setup-card" id="btn-create"><h3>Создать пару</h3><p>Получите код приглашения для партнёра</p></div>
        <div class="setup-card" id="btn-join"><h3>Присоединиться</h3><p>Введите код от партнёра</p></div>
      </div>
      <div id="setup-form" style="max-width: 320px; margin: 24px auto 0; display: none;"></div>
    </div>
  `;
  document.getElementById('btn-create').onclick = async () => {
    try {
      const couple = await createCouple();
      document.getElementById('setup-form').style.display = 'block';
      document.getElementById('setup-form').innerHTML = `
        <p style="font-size: 14px; color: var(--c-text-secondary); margin-bottom: 8px;">Код приглашения:</p>
        <div class="invite-code">${couple.invite_code}</div>
        <button class="btn btn-secondary btn-small" onclick="navigator.clipboard.writeText('${couple.invite_code}').then(()=>window.showToast('Скопировано'))">Скопировать</button>
        <button class="btn btn-primary" style="margin-top: 16px;" onclick="location.hash='/'">Начать</button>
      `;
      const profile = await getProfile();
      setState({ couple, profile });
    } catch (err) { showToast('Ошибка: ' + err.message); }
  };
  document.getElementById('btn-join').onclick = () => {
    document.getElementById('setup-form').style.display = 'block';
    document.getElementById('setup-form').innerHTML = `
      <div class="form-group">
        <label class="form-label">Код приглашения</label>
        <input type="text" class="form-input" id="join-code" placeholder="abc123" autocomplete="off" style="text-align:center; font-size: 20px; letter-spacing: 2px;">
      </div>
      <button class="btn btn-primary" id="btn-join-submit">Присоединиться</button>
    `;
    document.getElementById('btn-join-submit').onclick = async () => {
      const code = document.getElementById('join-code').value.trim();
      if (!code) { showToast('Введите код'); return; }
      try {
        const couple = await joinCouple(code);
        const profile = await getProfile();
        setState({ couple, profile });
        showToast('Вы присоединились!');
        navigate('/');
      } catch (err) { showToast('Ошибка: ' + err.message); }
    };
  };
  window.showToast = showToast;
});

// ---- Main (expenses) page ----
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
  return () => { if (realtimeChannel) { realtimeChannel.unsubscribe(); realtimeChannel = null; } };
});

function renderHome(app) {
  const { expenses, currentMonth: month, couple } = getState();
  const total = expenses.reduce((s, e) => s + parseFloat(e.amount), 0);
  const grouped = groupByDate(expenses);
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
      <div class="summary-card">
        <div class="summary-label">Общие расходы</div>
        <div class="summary-total">${formatMoney(total, couple?.currency)}</div>
        <div class="summary-badge">${icon('trending-down', 14)} ${expenses.length} транзакций</div>
      </div>
      <div class="tx-section">
        ${grouped.length === 0 ? `
          <div class="empty-state">${icon('credit-card', 48, 'var(--c-text-muted)')}<p>Нет расходов за этот месяц</p></div>
        ` : grouped.map(([date, items]) => `
          <div class="tx-day-header">${formatDate(date)}</div>
          ${items.map(exp => {
            const cat = exp.categories;
            const bgColor = (cat?.color || '#888780') + '18';
            const splitLabel = exp.split === 'equal' ? '50/50' : exp.split === 'full_payer' ? exp.profiles?.display_name : exp.split === 'full_other' ? 'Партнёр' : 'Кастом';
            return `
              <div class="tx-item" data-id="${exp.id}">
                <div class="tx-icon" style="background: ${bgColor}">${icon(cat?.icon || 'more-horizontal', 18, cat?.color || '#888780')}</div>
                <div class="tx-info"><div class="tx-name">${exp.description}</div><div class="tx-cat">${cat?.name || 'Другое'}</div></div>
                <div><div class="tx-amount negative">-${formatMoney(exp.amount, exp.currency)}</div><div class="tx-who">${splitLabel}</div></div>
              </div>`;
          }).join('')}
        `).join('')}
      </div>
    </div>
    <button class="fab" id="add-exp-btn">${icon('plus', 28)}</button>
    ${renderTabBar()}
  `;
  document.getElementById('add-exp-btn').onclick = showAddExpenseModal;
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
        deleteExpense(item.dataset.id).then(() => { loadExpenses().then(() => renderHome(app)); showToast('Удалено'); });
      }
    };
  });
}

// ---- Analytics page ----
route('/analytics', async (app) => {
  const state = getState();
  if (!state.couple) { navigate('/'); return; }
  const month = state.currentMonth || currentMonth();
  let catTotals = [], payerTotals = [], budgets = [];
  try {
    [catTotals, payerTotals, budgets] = await Promise.all([
      getMonthlyTotals(state.couple.id, month),
      getPayerTotals(state.couple.id, month),
      getBudgets(state.couple.id, month),
    ]);
    setState({ budgets });
  } catch (err) {
    console.error('Analytics load error:', err);
  }
  const grandTotal = catTotals.reduce((s, c) => s + parseFloat(c.total), 0);
  const sortedCats = [...catTotals].sort((a, b) => b.total - a.total);
  app.innerHTML = `
    <div class="page-enter">
      <div class="header"><div><div class="header-title">Аналитика</div><div class="header-sub">${formatMonth(month)}</div></div></div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">Всего</div><div class="stat-value">${formatMoney(grandTotal, state.couple.currency)}</div></div>
        <div class="stat-card"><div class="stat-label">Среднее/день</div><div class="stat-value">${formatMoney(grandTotal / 30, state.couple.currency)}</div></div>
        ${payerTotals.map(p => `
          <div class="stat-card"><div class="stat-label">${p.payer_name} оплатил(а)</div><div class="stat-value">${formatMoney(p.total_paid, state.couple.currency)}</div></div>
        `).join('')}
      </div>
      <div class="section-header"><span class="section-title">По категориям</span></div>
      <div class="cat-bars">
        ${sortedCats.map(c => `
          <div class="cat-bar-row">
            <div class="cat-bar-dot" style="background: ${c.category_color}"></div>
            <div class="cat-bar-name">${c.category_name}</div>
            <div class="cat-bar-track"><div class="cat-bar-fill" style="width: ${pct(c.total, grandTotal)}%; background: ${c.category_color};"></div></div>
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
                <div class="budget-name"><span style="color: ${b.categories?.color}">${icon(b.categories?.icon || 'more-horizontal', 16, b.categories?.color)}</span>${b.categories?.name || 'Категория'}</div>
                <div class="budget-amounts">${formatMoney(spent)} / ${formatMoney(b.limit_amount)}</div>
              </div>
              <div class="budget-track"><div class="budget-fill ${fillClass}" style="width: ${Math.min(percentage, 100)}%; background: ${!fillClass ? b.categories?.color || 'var(--c-accent)' : ''};"></div></div>
              <div class="budget-pct">${percentage}% использовано</div>
            </div>`;
        }).join('')}
      </div>
    </div>
    ${renderTabBar()}
  `;
  document.getElementById('btn-add-budget')?.addEventListener('click', showAddBudgetModal);
});

function showAddBudgetModal() {
  const { categories, couple, currentMonth: month } = getState();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">Новый бюджет</div>
      <div class="form-group"><label class="form-label">Категория</label>
        <select class="form-input" id="budget-cat">${categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
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
      const { upsertBudget } = await import('./lib/supabase.js');
      await upsertBudget({ couple_id: couple.id, category_id: categoryId, month: `${month}-01`, limit_amount: limit });
      backdrop.remove(); showToast('Бюджет добавлен'); navigate('/analytics');
    } catch (err) { showToast('Ошибка: ' + err.message); }
  };
}

// ---- Goals page ----
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
        <div class="header-title">Общие цели</div>
        <button class="header-action" id="btn-add-goal">${icon('plus', 20)}</button>
      </div>
      ${goals.length === 0 ? `
        <div class="empty-state">${icon('target', 48, 'var(--c-text-muted)')}<p>Создайте первую общую цель</p></div>
      ` : goals.map(g => {
        const percentage = pct(g.current_amount, g.target_amount);
        return `
          <div class="goal-card" data-id="${g.id}">
            <div class="goal-header"><div class="goal-name">${icon(g.icon, 18, 'var(--c-accent)')} ${g.name}</div><div class="goal-pct">${percentage}%</div></div>
            <div class="goal-track"><div class="goal-fill" style="width: ${Math.min(percentage, 100)}%"></div></div>
            <div class="goal-amounts">${formatMoney(g.current_amount, state.couple.currency)} из ${formatMoney(g.target_amount, state.couple.currency)}${g.deadline ? ` — до ${formatDate(g.deadline)}` : ''}</div>
          </div>`;
      }).join('')}
    </div>
    ${renderTabBar()}
  `;
  document.getElementById('btn-add-goal')?.addEventListener('click', showAddGoalModal);
  app.querySelectorAll('.goal-card[data-id]').forEach(card => { card.onclick = () => showContributeModal(card.dataset.id); });
});

function showAddGoalModal() {
  const { couple } = getState();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div><div class="modal-title">Новая цель</div>
      <div class="form-group"><label class="form-label">Название</label><input type="text" class="form-input" id="goal-name" placeholder="Отпуск в Японию" autocomplete="off"></div>
      <div class="form-group"><label class="form-label">Целевая сумма (${couple.currency})</label><input type="number" class="form-input" id="goal-target" placeholder="120000" inputmode="numeric"></div>
      <div class="form-group"><label class="form-label">Дедлайн (опционально)</label><input type="date" class="form-input" id="goal-deadline"></div>
      <button class="btn btn-primary" id="btn-save-goal">Создать</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('btn-save-goal').onclick = async () => {
    const name = document.getElementById('goal-name').value.trim();
    const target = parseFloat(document.getElementById('goal-target').value);
    const deadline = document.getElementById('goal-deadline').value || null;
    if (!name) { showToast('Введите название'); return; }
    if (!target || target <= 0) { showToast('Введите сумму'); return; }
    try { await addGoal({ couple_id: couple.id, name, target_amount: target, deadline }); backdrop.remove(); showToast('Цель создана'); navigate('/goals'); }
    catch (err) { showToast('Ошибка: ' + err.message); }
  };
}

function showContributeModal(goalId) {
  const { goals, couple } = getState();
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div><div class="modal-title">Пополнить: ${goal.name}</div>
      <div style="text-align:center;margin-bottom:16px;color:var(--c-text-secondary);font-size:14px;">Прогресс: ${formatMoney(goal.current_amount, couple.currency)} из ${formatMoney(goal.target_amount, couple.currency)}</div>
      <div class="form-group"><input type="number" class="form-input amount" id="contrib-amount" placeholder="0" inputmode="decimal"></div>
      <button class="btn btn-primary" id="btn-save-contrib">Пополнить</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  setTimeout(() => document.getElementById('contrib-amount')?.focus(), 300);
  document.getElementById('btn-save-contrib').onclick = async () => {
    const amount = parseFloat(document.getElementById('contrib-amount').value);
    if (!amount || amount <= 0) { showToast('Введите сумму'); return; }
    try { await addGoalContribution(goalId, amount); backdrop.remove(); showToast('Пополнено'); navigate('/goals'); }
    catch (err) { showToast('Ошибка: ' + err.message); }
  };
}

// ---- Profile page ----
route('/profile', async (app) => {
  const state = getState();
  if (!state.profile) { navigate('/auth'); return; }
  const initials = (state.profile.display_name || 'U').slice(0, 2).toUpperCase();
  app.innerHTML = `
    <div class="page-enter">
      <div class="header"><div class="header-title">Профиль</div></div>
      <div class="profile-section">
        <div class="profile-card">
          <div class="profile-avatar">${initials}</div>
          <div><div class="profile-name">${state.profile.display_name}</div><div class="profile-email">${state.couple ? 'Ключ: ' + state.couple.invite_code : ''}</div></div>
        </div>
        ${state.couple ? `
          <div class="profile-menu-item" id="btn-invite">${icon('link', 20)}<span>Код приглашения: <strong>${state.couple.invite_code}</strong></span></div>
          <div class="profile-menu-item" id="btn-settings">${icon('settings', 20)}<span>Настройки пары</span></div>
        ` : ''}
        <div class="profile-menu-item danger" id="btn-logout">${icon('log-out', 20)}<span>Выйти</span></div>
      </div>
    </div>
    ${renderTabBar()}
  `;
  document.getElementById('btn-invite')?.addEventListener('click', () => {
    navigator.clipboard.writeText(state.couple.invite_code)
      .then(() => showToast('Код скопирован'))
      .catch(() => showToast(state.couple.invite_code));
  });
  document.getElementById('btn-settings')?.addEventListener('click', showCoupleSettingsModal);
  document.getElementById('btn-logout').onclick = async () => {
    await signOut();
    localStorage.removeItem('ce_invite_code');
    localStorage.removeItem('ce_display_name');
    setState({ user: null, profile: null, couple: null });
    navigate('/auth');
  };
});

function showCoupleSettingsModal() {
  const { couple } = getState();
  if (!couple) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">Настройки пары</div>
      <div class="form-group">
        <label class="form-label">Название</label>
        <input type="text" class="form-input" id="couple-name" value="${couple.name || 'Our Budget'}" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Основная валюта</label>
        <select class="form-input" id="couple-currency">
          <option value="THB" ${couple.currency === 'THB' ? 'selected' : ''}>THB (฿)</option>
          <option value="RUB" ${couple.currency === 'RUB' ? 'selected' : ''}>RUB (₽)</option>
          <option value="USD" ${couple.currency === 'USD' ? 'selected' : ''}>USD ($)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Код приглашения для партнёра</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" class="form-input" value="${couple.invite_code}" readonly style="flex:1;text-align:center;font-size:18px;letter-spacing:2px;font-weight:600;">
          <button class="btn btn-secondary btn-small" onclick="navigator.clipboard.writeText('${couple.invite_code}').then(()=>window.showToast('Скопировано'))">Копировать</button>
        </div>
      </div>
      <button class="btn btn-primary" id="btn-save-couple">Сохранить</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('btn-save-couple').onclick = async () => {
    const name = document.getElementById('couple-name').value.trim();
    const currency = document.getElementById('couple-currency').value;
    if (!name) { showToast('Введите название'); return; }
    try {
      const { error } = await supabase.from('couples').update({ name, currency }).eq('id', couple.id);
      if (error) throw error;
      const profile = await getProfile();
      setState({ couple: profile?.couples || couple, profile });
      backdrop.remove();
      showToast('Настройки сохранены');
      navigate('/profile');
    } catch (err) { showToast('Ошибка: ' + err.message); }
  };
}

// ---- INIT ----
async function init() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN') {
      const profile = await getProfile();
      if (profile?.couple_id) {
        setState({ user: session.user, profile, couple: profile.couples || null, currentMonth: currentMonth(), loading: false });
        if (getCurrentPath() === '/auth') navigate('/');
      }
    } else if (event === 'SIGNED_OUT') {
      setState({ user: null, profile: null, couple: null, loading: false });
      navigate('/auth');
    }
  });

  try {
    const session = await getSession();
    if (session?.user) {
      const profile = await getProfile();
      if (profile && profile.couple_id) {
        setState({ user: session.user, profile, couple: profile.couples || null, currentMonth: currentMonth(), loading: false });
        // User is logged in and has a couple — go to home
      } else if (profile && !profile.couple_id) {
        // User exists but no couple — check if we have saved invite code
        const savedCode = localStorage.getItem('ce_invite_code');
        const savedName = localStorage.getItem('ce_display_name');
        if (savedCode) {
          try {
            const couple = await authWithInviteCode(savedCode, savedName || 'User');
            const refreshedProfile = await getProfile();
            setState({ user: session.user, profile: refreshedProfile, couple: refreshedProfile?.couples || couple, currentMonth: currentMonth(), loading: false });
          } catch {
            setState({ loading: false });
            navigate('/auth');
          }
        } else {
          setState({ user: session.user, profile, couple: null, currentMonth: currentMonth(), loading: false });
          navigate('/auth');
        }
      } else {
        // No profile — create one
        const { error } = await supabase.from('profiles').upsert({
          id: session.user.id,
          display_name: localStorage.getItem('ce_display_name') || 'User',
        });
        if (error) console.error('Create profile error:', error);
        setState({ loading: false });
        navigate('/auth');
      }
    } else {
      // No session — check if we have saved credentials for auto-login
      const savedCode = localStorage.getItem('ce_invite_code');
      const savedName = localStorage.getItem('ce_display_name');
      if (savedCode) {
        try {
          const couple = await authWithInviteCode(savedCode, savedName || 'User');
          const newSession = await getSession();
          const profile = await getProfile();
          setState({ user: newSession?.user, profile, couple: profile?.couples || couple, currentMonth: currentMonth(), loading: false });
        } catch {
          setState({ loading: false });
          navigate('/auth');
        }
      } else {
        setState({ loading: false });
        navigate('/auth');
      }
    }
  } catch (err) {
    console.error('Init error:', err);
    setState({ loading: false });
    navigate('/auth');
  }

  startRouter();
}

window.showToast = showToast;
init();
