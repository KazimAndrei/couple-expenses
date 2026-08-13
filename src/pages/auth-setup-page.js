import { route, navigate, getQueryParam } from '../lib/router.js';
import { setState } from '../lib/store.js';
import { createCouple, getProfile, getSession, joinCouple, signInWithApple, signOut, updateDisplayName, inviteLink } from '../lib/supabase.js';
import { CURRENCIES, currencyName, currentMonth, escapeHtml, icon } from '../lib/utils.js';
import { t, getLang, setLang, LANG_LABELS } from '../lib/i18n.js';
import { showToast } from '../services/toast.js';
import { getReadableError } from '../services/errors.js';
import { initNativePush } from '../services/native-push.js';
import { isPremiumActive, purchasesAvailable } from '../services/purchases.js';
import { renderPaywall } from './paywall-page.js';
import { clearSessionState } from '../services/session-cleanup.js';

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
      <div class="auth-page page-enter" id="auth-content">
        <div class="auth-logo">${icon('heart', 48, 'var(--c-accent)')}</div>
        <div class="auth-title">CoupleExpenses</div>
        <div class="auth-sub">${t('auth.subtitle')}</div>
        <div class="auth-form">
          <button class="btn btn-apple" id="btn-apple">${appleLogo}<span>${t('auth.signInApple')}</span></button>
          <div style="display:flex; gap:8px; margin-top:20px;">
            <div class="form-group" style="flex:1; margin:0;">
              <label class="form-label">${t('profile.languageTitle')}</label>
              <select class="form-input" id="auth-lang">
                ${['ru', 'en'].map((l) => `<option value="${l}" ${getLang() === l ? 'selected' : ''}>${LANG_LABELS[l]}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="flex:1; margin:0;">
              <label class="form-label">${t('profile.currencyTitle')}</label>
              <select class="form-input" id="auth-currency">
                ${Object.entries(CURRENCIES).map(([code, [sym]]) =>
                  `<option value="${code}" ${(localStorage.getItem('ce_pending_currency') || 'USD') === code ? 'selected' : ''}>${code} (${sym})</option>`
                ).join('')}
              </select>
            </div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('auth-lang').addEventListener('change', (ev) => {
      setLang(ev.target.value); // сохранит выбор и перезагрузит приложение на новом языке
    });
    document.getElementById('auth-currency').addEventListener('change', (ev) => {
      localStorage.setItem('ce_pending_currency', ev.target.value); // подхватится при создании пары
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
          btn.disabled = false;
          return;
        }
        // Сессия могла успешно создаться до сбоя — тогда не держим юзера на экране входа
        const session = await getSession().catch(() => null);
        if (session) {
          const profile = await getProfile().catch(() => null);
          if (profile?.couple_id) { await enterApp(profile.couples); return; }
          navigate('/setup');
          return;
        }
        showToast(t('auth.signInError', { msg: getReadableError(err) }));
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
    const typedName = sessionStorage.getItem('ce_setup_name') || '';
    const knownName = typedName || (profile?.display_name && !['User', 'Пользователь'].includes(profile.display_name)
      ? profile.display_name : '');

    app.innerHTML = `
      <div class="setup-page page-enter">
        <div style="margin-bottom: 24px">${icon('heart', 40, 'var(--c-accent)')}</div>
        <div class="setup-title">${t('setup.title')}</div>
        <div class="setup-sub">${t('setup.subtitle')}</div>
        <div class="auth-form" style="max-width: 320px; margin: 0 auto;">
          <div class="form-group">
            <label class="form-label">${t('setup.yourName')}</label>
            <input type="text" class="form-input" id="setup-name" placeholder="${t('setup.namePlaceholder')}" value="${e(knownName)}" autocomplete="name">
          </div>
        </div>
        <div class="setup-options">
          ${pendingCode ? '' : `<div class="setup-card" id="btn-create"><h3>${t('setup.createTitle')}</h3><p>${t('setup.createText')}</p></div>`}
          <div class="setup-card" id="btn-join"><h3>${t('setup.joinTitle')}</h3><p>${pendingCode ? t('setup.joinInvitedText') : t('setup.joinText')}</p></div>
          ${pendingCode ? `<div class="setup-card" id="btn-create"><h3>${t('setup.createOwnTitle')}</h3><p>${t('setup.createOwnText')}</p></div>` : ''}
        </div>
        <div id="setup-form" style="max-width: 320px; margin: 24px auto 0; display: none;"></div>
        <button class="paywall-link" id="btn-setup-logout" style="margin: 28px auto 0; display: block; background: none; border: none; color: var(--c-text-secondary); text-decoration: underline; font-size: 14px;">${t('profile.logout')}</button>
      </div>
    `;

    const readName = () => document.getElementById('setup-name').value.trim();
    document.getElementById('setup-name').addEventListener('input', (ev) => {
      sessionStorage.setItem('ce_setup_name', ev.target.value.trim());
    });

    // Выход прямо с экрана настройки: иначе гость без пары заперт на нём
    document.getElementById('btn-setup-logout').onclick = async () => {
      try { await signOut(); } catch { /* сессия уже недействительна — всё равно уходим */ }
      await clearSessionState().catch(() => {});
      navigate('/auth');
    };

    // Создание пары после того, как доступ подтверждён (оплатой или уже активной подпиской)
    const doCreateCouple = async (name) => {
      const btnCreate = document.getElementById('btn-create');
      if (btnCreate) {
        if (btnCreate.dataset.busy === '1') return;
        btnCreate.dataset.busy = '1';
        btnCreate.style.opacity = '0.6';
      }
      try {
        await updateDisplayName(name);
        const couple = await createCouple();
        localStorage.removeItem(PENDING_INVITE_KEY);
        sessionStorage.removeItem('ce_setup_name');
        const link = inviteLink(couple.invite_code);
        // Выбор уже сделан — карточки «создать / присоединиться» и поле имени убираем,
        // иначе экран выглядит так, будто пару предлагают создать второй раз
        const form = document.getElementById('setup-form');
        // Пару могли создать поверх пейволла (сразу после оплаты) — экрана настройки в DOM нет.
        // Тогда просто заходим в приложение: ссылка-приглашение доступна в профиле.
        if (!form) {
          showToast(t('setup.createdSubtitle'));
          await enterApp(couple);
          return;
        }
        document.querySelector('.setup-options')?.remove();
        document.querySelector('.setup-page .auth-form')?.remove();
        document.getElementById('btn-setup-logout')?.remove();
        const subtitle = document.querySelector('.setup-sub');
        if (subtitle) subtitle.textContent = t('setup.createdSubtitle');
        form.style.display = 'block';
        form.innerHTML = `
          <p style="font-size: 14px; color: var(--c-text-secondary); margin-bottom: 8px;">${t('setup.sendPartnerLink')}</p>
          <div class="invite-code" style="font-size:13px; word-break:break-all;">${e(link)}</div>
          <button class="btn btn-secondary btn-small" id="btn-share-invite">${t('setup.share')}</button>
          <button class="btn btn-primary" style="margin-top: 16px;" id="btn-start">${t('setup.start')}</button>
        `;
        document.getElementById('btn-share-invite').onclick = async () => {
          if (navigator.share) {
            try { await navigator.share({ title: 'CoupleExpenses', text: t('setup.shareText'), url: link }); } catch { /* отменили шаринг */ }
          } else {
            await navigator.clipboard.writeText(link);
            showToast(t('common.linkCopied'));
          }
        };
        document.getElementById('btn-start').onclick = () => enterApp(couple);
      } catch (err) {
        showToast(t('common.error', { msg: getReadableError(err) }));
      } finally {
        if (btnCreate) {
          btnCreate.dataset.busy = '0';
          btnCreate.style.opacity = '';
        }
      }
    };

    // Платит тот, кто создаёт пару. Приглашённый по ссылке сюда не попадает — у него доступ бесплатный.
    // Пейволл открываем синхронно: любой await до отрисовки может подвесить кнопку.
    const PAID_KEY = 'ce_paywall_skip';
    let creating = false; // guard живёт в замыкании: DOM-кнопки может не быть (поверх открыт пейволл)
    document.getElementById('btn-create').onclick = async () => {
      if (creating) return;
      const name = readName();
      if (!name) { showToast(t('common.enterName')); return; }

      if (!purchasesAvailable() || sessionStorage.getItem(PAID_KEY) === '1') {
        creating = true;
        try { await doCreateCouple(name); } finally { creating = false; }
        return;
      }

      // Подписка могла быть куплена раньше (переустановка, выход из пары) — тогда пейволл не нужен
      const alreadyPremium = await isPremiumActive().catch(() => false);
      if (alreadyPremium) {
        sessionStorage.setItem(PAID_KEY, '1');
        creating = true;
        try { await doCreateCouple(name); } finally { creating = false; }
        return;
      }

      updateDisplayName(name).catch(() => { /* имя сохраним и после оплаты */ });
      renderPaywall(app, {
        // Создаём пару прямо здесь: navigate + setTimeout запускали две параллельные
        // цепочки, из-за чего появлялась вторая пара или пропадала инвайт-ссылка
        onSuccess: async () => {
          sessionStorage.setItem(PAID_KEY, '1');
          if (creating) return;
          creating = true;
          try { await doCreateCouple(name); } finally { creating = false; }
        },
        onClose: () => navigate('/setup'),
      });
    };

    document.getElementById('btn-join').onclick = () => {
      const form = document.getElementById('setup-form');
      form.style.display = 'block';
      form.innerHTML = `
        <div class="form-group">
          <label class="form-label">${t('setup.inviteCode')}</label>
          <input type="text" class="form-input" id="join-code" placeholder="abc123" value="${e(pendingCode)}" autocomplete="off" style="text-align:center; font-size: 20px; letter-spacing: 2px;">
        </div>
        <button class="btn btn-primary" id="btn-join-submit">${t('setup.joinTitle')}</button>
      `;
      document.getElementById('btn-join-submit').onclick = async () => {
        const name = readName();
        const code = document.getElementById('join-code').value.trim();
        if (!name) { showToast(t('common.enterName')); return; }
        if (!code) { showToast(t('setup.enterCode')); return; }
        const btn = document.getElementById('btn-join-submit');
        btn.textContent = t('setup.joining');
        btn.disabled = true;
        try {
          await updateDisplayName(name);
          const couple = await joinCouple(code, name);
          localStorage.removeItem(PENDING_INVITE_KEY);
          sessionStorage.removeItem('ce_setup_name');
          showToast(t('setup.joined'));
          await enterApp(couple);
        } catch (err) {
          showToast(t('common.error', { msg: getReadableError(err) }));
          btn.textContent = t('setup.joinTitle');
          btn.disabled = false;
        }
      };
      if (pendingCode) document.getElementById('btn-join-submit').focus();
    };

    if (pendingCode) document.getElementById('btn-join').click();
  });
}
