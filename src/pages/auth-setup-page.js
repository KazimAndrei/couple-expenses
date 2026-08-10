import { route, navigate, getQueryParam } from '../lib/router.js';
import { setState } from '../lib/store.js';
import { createCouple, getProfile, getSession, joinCouple, signInWithApple, signInAsGuest, updateDisplayName, inviteLink, GUEST_ENABLED } from '../lib/supabase.js';
import { currentMonth, escapeHtml, icon } from '../lib/utils.js';
import { showToast } from '../services/toast.js';
import { getReadableError } from '../services/errors.js';
import { initNativePush } from '../services/native-push.js';

const e = escapeHtml;
const PENDING_INVITE_KEY = 'ce_pending_invite';

const appleLogo = `<svg width="18" height="18" viewBox="0 0 17 20" fill="currentColor" aria-hidden="true"><path d="M14.13 10.62c.02 2.9 2.55 3.86 2.58 3.88-.02.07-.4 1.38-1.33 2.73-.8 1.17-1.63 2.33-2.94 2.36-1.29.02-1.7-.76-3.17-.76-1.47 0-1.93.73-3.14.78-1.27.05-2.23-1.26-3.04-2.42C1.44 14.8.17 10.44 1.87 7.53c.84-1.45 2.35-2.36 3.98-2.39 1.24-.02 2.42.84 3.17.84.76 0 2.19-1.03 3.69-.88.63.03 2.39.25 3.52 1.91-.09.06-2.1 1.23-2.1 3.61ZM11.71 3.5c.67-.81 1.12-1.94 1-3.06-.97.04-2.14.64-2.83 1.45-.62.72-1.16 1.87-1.02 2.97 1.08.08 2.18-.55 2.85-1.36Z"/></svg>`;

async function enterApp(couple) {
  const profile = await getProfile();
  const session = await getSession();
  setState({
    user: session?.user || null,
    profile,
    couple: profile?.couples || couple || null,
    currentMonth: currentMonth(),
    loading: false,
  });
  initNativePush();
  navigate('/');
}

export function registerAuthSetupRoutes() {
  // Инвайт-линк: #/invite?code=XXX — запоминаем код и ведём по флоу
  route('/invite', async () => {
    const code = getQueryParam('code');
    if (code) localStorage.setItem(PENDING_INVITE_KEY, code);
    const session = await getSession();
    navigate(session ? '/setup' : '/auth');
  });

  route('/auth', async (app) => {
    app.innerHTML = `
      <div class="welcome-splash" id="welcome-splash">
        <h1 class="welcome-title">CoupleExpenses</h1>
        <img src="/welcome.png" alt="" class="welcome-photo" onerror="this.style.display='none'">
        <div class="welcome-tap-hint">Нажмите, чтобы войти</div>
      </div>
      <div class="auth-page page-enter" id="auth-content" style="display:none;">
        <div class="auth-logo">${icon('heart', 48, 'var(--c-accent)')}</div>
        <div class="auth-title">CoupleExpenses</div>
        <div class="auth-sub">Совместный учёт расходов<br>для вас двоих</div>
        <div class="auth-form">
          <button class="btn btn-apple" id="btn-apple">${appleLogo}<span>Войти через Apple</span></button>
          ${GUEST_ENABLED ? '<button class="btn btn-secondary" style="margin-top:12px;" id="btn-guest">Войти как гость (dev)</button>' : ''}
        </div>
      </div>
    `;
    document.getElementById('welcome-splash').addEventListener('click', () => {
      document.getElementById('welcome-splash').style.display = 'none';
      document.getElementById('auth-content').style.display = 'block';
    });

    document.getElementById('btn-guest')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-guest');
      btn.disabled = true;
      try {
        await signInAsGuest();
        const profile = await getProfile();
        if (profile?.couple_id) {
          await enterApp(profile.couples);
        } else {
          navigate('/setup');
        }
      } catch (err) {
        showToast('Ошибка: ' + getReadableError(err));
        btn.disabled = false;
      }
    });

    document.getElementById('btn-apple').onclick = async () => {
      const btn = document.getElementById('btn-apple');
      btn.disabled = true;
      try {
        const result = await signInWithApple();
        if (!result) return; // web: ушли в OAuth-редирект
        const profile = await getProfile();
        if (profile?.couple_id) {
          await enterApp(profile.couples);
        } else {
          navigate('/setup');
        }
      } catch (err) {
        if (err?.message?.includes('1001') || err?.code === '1001') {
          // юзер закрыл окно Apple — не ошибка
        } else {
          showToast('Ошибка входа: ' + getReadableError(err));
        }
        btn.disabled = false;
      }
    };
  });

  route('/setup', async (app) => {
    const session = await getSession();
    if (!session) { navigate('/auth'); return; }
    const profile = await getProfile();
    if (profile?.couple_id) { await enterApp(profile.couples); return; }

    const pendingCode = localStorage.getItem(PENDING_INVITE_KEY) || '';
    const knownName = profile?.display_name && !['User', 'Пользователь'].includes(profile.display_name)
      ? profile.display_name : '';

    app.innerHTML = `
      <div class="setup-page page-enter">
        <div style="margin-bottom: 24px">${icon('heart', 40, 'var(--c-accent)')}</div>
        <div class="setup-title">Настройка пары</div>
        <div class="setup-sub">Создайте общее пространство или присоединитесь к партнёру</div>
        <div class="auth-form" style="max-width: 320px; margin: 0 auto;">
          <div class="form-group">
            <label class="form-label">Ваше имя</label>
            <input type="text" class="form-input" id="setup-name" placeholder="Андрей" value="${e(knownName)}" autocomplete="name">
          </div>
        </div>
        <div class="setup-options">
          ${pendingCode ? '' : '<div class="setup-card" id="btn-create"><h3>Создать пару</h3><p>Получите ссылку-приглашение для партнёра</p></div>'}
          <div class="setup-card" id="btn-join"><h3>Присоединиться</h3><p>${pendingCode ? 'Вас пригласили в пару' : 'Введите код от партнёра'}</p></div>
          ${pendingCode ? '<div class="setup-card" id="btn-create"><h3>Создать свою пару</h3><p>Не хочу присоединяться по приглашению</p></div>' : ''}
        </div>
        <div id="setup-form" style="max-width: 320px; margin: 24px auto 0; display: none;"></div>
      </div>
    `;

    const readName = () => document.getElementById('setup-name').value.trim();

    document.getElementById('btn-create').onclick = async () => {
      const name = readName();
      if (!name) { showToast('Введите имя'); return; }
      try {
        await updateDisplayName(name);
        const couple = await createCouple();
        localStorage.removeItem(PENDING_INVITE_KEY);
        const link = inviteLink(couple.invite_code);
        const form = document.getElementById('setup-form');
        form.style.display = 'block';
        form.innerHTML = `
          <p style="font-size: 14px; color: var(--c-text-secondary); margin-bottom: 8px;">Отправьте партнёру ссылку:</p>
          <div class="invite-code" style="font-size:13px; word-break:break-all;">${e(link)}</div>
          <button class="btn btn-secondary btn-small" id="btn-share-invite">Поделиться</button>
          <button class="btn btn-primary" style="margin-top: 16px;" id="btn-start">Начать</button>
        `;
        document.getElementById('btn-share-invite').onclick = async () => {
          if (navigator.share) {
            try { await navigator.share({ title: 'CoupleExpenses', text: 'Присоединяйся к нашей паре в CoupleExpenses', url: link }); } catch { /* отменили шаринг */ }
          } else {
            await navigator.clipboard.writeText(link);
            showToast('Ссылка скопирована');
          }
        };
        document.getElementById('btn-start').onclick = () => enterApp(couple);
      } catch (err) {
        showToast('Ошибка: ' + getReadableError(err));
      }
    };

    document.getElementById('btn-join').onclick = () => {
      const form = document.getElementById('setup-form');
      form.style.display = 'block';
      form.innerHTML = `
        <div class="form-group">
          <label class="form-label">Код приглашения</label>
          <input type="text" class="form-input" id="join-code" placeholder="abc123" value="${e(pendingCode)}" autocomplete="off" style="text-align:center; font-size: 20px; letter-spacing: 2px;">
        </div>
        <button class="btn btn-primary" id="btn-join-submit">Присоединиться</button>
      `;
      document.getElementById('btn-join-submit').onclick = async () => {
        const name = readName();
        const code = document.getElementById('join-code').value.trim();
        if (!name) { showToast('Введите имя'); return; }
        if (!code) { showToast('Введите код'); return; }
        const btn = document.getElementById('btn-join-submit');
        btn.textContent = 'Входим...';
        btn.disabled = true;
        try {
          await updateDisplayName(name);
          const couple = await joinCouple(code, name);
          localStorage.removeItem(PENDING_INVITE_KEY);
          showToast('Вы присоединились!');
          await enterApp(couple);
        } catch (err) {
          showToast('Ошибка: ' + getReadableError(err));
          btn.textContent = 'Присоединиться';
          btn.disabled = false;
        }
      };
      if (pendingCode) document.getElementById('btn-join-submit').focus();
    };

    if (pendingCode) document.getElementById('btn-join').click();
  });
}
