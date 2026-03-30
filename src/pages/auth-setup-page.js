import { route, navigate } from '../lib/router.js';
import { getState, setState } from '../lib/store.js';
import { createCouple, getProfile, getSession, joinCouple, authWithInviteCode, supabase } from '../lib/supabase.js';
import { currentMonth, escapeHtml, icon } from '../lib/utils.js';
import { showToast } from '../services/toast.js';

const e = escapeHtml;

export function registerAuthSetupRoutes() {
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
            <input type="text" class="form-input" id="auth-name" placeholder="Андрей" value="${e(savedName || '')}" autocomplete="name">
          </div>
          <div class="form-group">
            <label class="form-label">Ключ пары</label>
            <input type="text" class="form-input" id="auth-code" placeholder="Введите ключ или создайте новую пару" value="${e(savedCode || '')}" autocomplete="off" style="text-align:center; font-size: 18px; letter-spacing: 2px;">
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
        let session = await getSession();
        if (!session) {
          const result = await supabase.auth.signInAnonymously();
          if (result.error) throw new Error('Auth: ' + result.error.message);
          if (!result.data?.session) throw new Error('Anonymous Sign-In не включён. Включи в Supabase → Authentication → Providers → Anonymous Sign-In');
          session = result.data.session;
          await new Promise(r => setTimeout(r, 1000));
        }
        await supabase.from('profiles').update({ display_name: name }).eq('id', session.user.id);
        const couple = await createCouple();
        localStorage.setItem('ce_invite_code', couple.invite_code);
        localStorage.setItem('ce_display_name', name);
        const profile = await getProfile();
        setState({ user: session.user, profile, couple: profile?.couples || couple, currentMonth: currentMonth(), loading: false });
        showToast('Пара создана! Ключ: ' + couple.invite_code);
        navigate('/');
      } catch (err) {
        showToast('Ошибка: ' + err.message);
        document.getElementById('btn-new-couple').textContent = 'Создать новую пару';
        document.getElementById('btn-new-couple').disabled = false;
      }
    };
  });

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
          <div class="invite-code">${e(couple.invite_code)}</div>
          <button class="btn btn-secondary btn-small" id="btn-copy-invite-code">Скопировать</button>
          <button class="btn btn-primary" style="margin-top: 16px;" onclick="location.hash='/'">Начать</button>
        `;
        document.getElementById('btn-copy-invite-code')?.addEventListener('click', () => {
          navigator.clipboard.writeText(couple.invite_code).then(() => window.showToast('Скопировано'));
        });
        const profile = await getProfile();
        setState({ couple, profile });
      } catch (err) {
        showToast('Ошибка: ' + err.message);
      }
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
        } catch (err) {
          showToast('Ошибка: ' + err.message);
        }
      };
    };
  });
}
