import { route, navigate } from '../lib/router.js';
import { getState, setState } from '../lib/store.js';
import { fetchAllExpensesForExport, getCoupleMembers, getProfile, inviteLink, signOut, supabase, uploadAvatar } from '../lib/supabase.js';
import { reencodeImage } from '../lib/image.js';
import { applyTheme, getThemePref } from '../services/theme.js';
import { isBiometricEnabled, setBiometricEnabled, unlockWithBiometrics } from '../services/biometric.js';
import { coupleHasAccess } from '../services/purchases.js';
import { clearSessionState } from '../services/session-cleanup.js';
import { Capacitor } from '@capacitor/core';
import { CURRENCIES, currencyName, escapeHtml, icon } from '../lib/utils.js';
import { LANG_LABELS, categoryLabel, getLang, setLang, t } from '../lib/i18n.js';
import { renderTabBar } from '../components/tab-bar.js';
import { showToast } from '../services/toast.js';
import { getReadableError } from '../services/errors.js';
import { enableModalSwipe } from '../components/modal-swipe.js';
import { openDeleteAccountDialog } from '../components/delete-account-dialog.js';

const e = escapeHtml;

// Подписи темы берём из словаря
const themeLabel = (pref) => t(`theme.${pref}`);

const AVATAR_SIZE = 256;

async function updateAvatar(file, profileId) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast(t('profile.chooseImage'));
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast(t('profile.fileTooBig'));
    return;
  }
  try {
    // Раньше при сбое загрузки картинка сохранялась в колонку как base64 data-URL;
    // после ограничения avatar_url в 500 символов такой фолбэк молча ронял запись,
    // поэтому ошибку загрузки теперь показываем честно.
    const blob = await reencodeImage(file, { maxSide: AVATAR_SIZE, square: true });
    const path = await uploadAvatar(blob, profileId);
    const { error } = await supabase.from('profiles').update({ avatar_url: path }).eq('id', profileId);
    if (error) throw error;
    const refreshedProfile = await getProfile();
    const coupleId = refreshedProfile?.couple_id || getState().couple?.id;
    let nextMembers = getState().members;
    if (coupleId) {
      try {
        nextMembers = await getCoupleMembers(coupleId);
      } catch {
        nextMembers = getState().members;
      }
    }
    setState({ profile: refreshedProfile, members: nextMembers });
    showToast(t('profile.photoUpdated'));
    navigate('/profile');
  } catch (err) {
    showToast(t('common.error', { msg: getReadableError(err) }));
  }
}

async function removeAvatar(profileId) {
  try {
    // Сначала сам файл: очистка только колонки оставляла картинку лежать в бакете
    await supabase.storage.from('avatars').remove([`${profileId}/avatar.jpg`]).catch(() => {});
    const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', profileId);
    if (error) throw error;
    const refreshedProfile = await getProfile();
    const coupleId = refreshedProfile?.couple_id || getState().couple?.id;
    let nextMembers = getState().members;
    if (coupleId) {
      try {
        nextMembers = await getCoupleMembers(coupleId);
      } catch {
        nextMembers = getState().members;
      }
    }
    setState({ profile: refreshedProfile, members: nextMembers });
    showToast(t('profile.photoRemoved'));
    navigate('/profile');
  } catch (err) {
    showToast(t('common.error', { msg: getReadableError(err) }));
  }
}

function showCoupleSettingsModal() {
  const { couple } = getState();
  if (!couple) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (event) => { if (event.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">${t('profile.coupleSettings')}</div>
      <div class="form-group">
        <label class="form-label">${t('common.name')}</label>
        <input type="text" class="form-input" id="couple-name" value="${e(couple.name || 'Our Budget')}" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">${t('profile.mainCurrency')}</label>
        <select class="form-input" id="couple-currency">
          ${Object.entries(CURRENCIES).map(([code, [sym]]) =>
            `<option value="${code}" ${couple.currency === code ? 'selected' : ''}>${code} (${sym}) — ${currencyName(code)}</option>`
          ).join('')}
        </select>
        <p style="font-size:12px; color:var(--c-text-secondary); margin-top:6px;">${t('profile.currencyChangeWarning')}</p>
      </div>
      <div class="form-group">
        <label class="form-label">${t('profile.partnerInviteCode')}</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" class="form-input" value="${e(couple.invite_code)}" readonly style="flex:1;text-align:center;font-size:18px;letter-spacing:2px;font-weight:600;">
          <button class="btn btn-secondary btn-small" id="btn-copy-couple-code">${t('common.copy')}</button>
        </div>
      </div>
      <button class="btn btn-primary" id="btn-save-couple">${t('common.save')}</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  enableModalSwipe(backdrop);
  document.getElementById('btn-copy-couple-code')?.addEventListener('click', () => {
    navigator.clipboard.writeText(couple.invite_code).then(() => window.showToast(t('common.copied')));
  });
  document.getElementById('btn-save-couple').onclick = async () => {
    const name = document.getElementById('couple-name').value.trim();
    const currency = document.getElementById('couple-currency').value;
    if (!name) { showToast(t('common.enterTitle')); return; }
    try {
      const { error } = await supabase.from('couples').update({ name, currency }).eq('id', couple.id);
      if (error) throw error;
      const profile = await getProfile();
      setState({ couple: profile?.couples || couple, profile });
      backdrop.remove();
      showToast(t('profile.settingsSaved'));
      navigate('/profile');
    } catch (err) {
      showToast(t('common.error', { msg: getReadableError(err) }));
    }
  };
}

export function registerProfileRoute() {
  route('/profile', async (app) => {
    const state = getState();
    if (!state.profile) { navigate('/auth'); return; }
    const initials = (state.profile.display_name || 'U').slice(0, 2).toUpperCase();
    const avatarMarkup = state.profile.avatar_url
      ? `<img src="${e(state.profile.avatar_url)}" class="profile-avatar image" alt="avatar">`
      : `<div class="profile-avatar">${initials}</div>`;
    app.innerHTML = `
      <div class="page-enter">
        <div class="header"><div class="header-title">${t('profile.title')}</div></div>
        <div class="profile-section">
          <div class="profile-card">
            <div class="profile-avatar-wrap">
              ${avatarMarkup}
              <button class="profile-avatar-edit" id="btn-change-avatar" aria-label="${t('profile.changePhotoAria')}">${icon('settings', 14)}</button>
              <input type="file" id="avatar-input" accept="image/*" style="display:none;">
            </div>
            <div><div class="profile-name">${e(state.profile.display_name)}</div></div>
          </div>
          ${state.couple ? `<div class="profile-menu-item" id="sub-status" style="display:none;"></div>` : ''}
          <div class="profile-menu-item" id="btn-edit-name">${icon('user', 20)}<span>${t('profile.editName')}</span></div>
          ${state.profile.avatar_url ? `<div class="profile-menu-item" id="btn-remove-avatar">${icon('x', 20)}<span>${t('profile.removePhoto')}</span></div>` : ''}
          ${state.couple ? `
            <div class="profile-menu-item" id="btn-invite">${icon('heart', 20)}<span>${t('profile.sendInvite')}</span></div>
            <div class="profile-menu-item" id="btn-copy-code">${icon('link', 20)}<span>${t('profile.inviteCodeLabel')} <strong>${e(state.couple.invite_code)}</strong></span></div>
            <div class="profile-menu-item" id="btn-settings">${icon('settings', 20)}<span>${t('profile.coupleSettings')}</span></div>
          ` : ''}
          ${state.couple ? `
            <div class="profile-menu-item" id="btn-currency">${icon('credit-card', 20)}<span>${t('profile.currencyLabel')} <strong id="currency-current">${CURRENCIES[state.couple.currency]?.[0] || ''} ${e(state.couple.currency)}</strong></span></div>
          ` : ''}
          <div class="profile-menu-item" id="btn-theme">${icon('moon', 20)}<span>${t('profile.themeLabel')} <strong id="theme-current">${themeLabel(getThemePref())}</strong></span></div>
          <div class="profile-menu-item" id="btn-lang">${icon('globe', 20)}<span>${t('profile.languageLabel')} <strong id="lang-current">${LANG_LABELS[getLang()]}</strong></span></div>
          ${Capacitor.isNativePlatform() ? `
            <div class="profile-menu-item" id="btn-biometric">${icon('lock', 20)}<span>${t('profile.biometricLabel')} <strong id="biometric-current">${isBiometricEnabled() ? t('common.on') : t('common.off')}</strong></span></div>
          ` : ''}
          ${state.couple ? `<div class="profile-menu-item" id="btn-export-csv">${icon('copy', 20)}<span>${t('profile.exportCsv')}</span></div>` : ''}
          <div class="profile-menu-item danger" id="btn-logout">${icon('log-out', 20)}<span>${t('profile.logout')}</span></div>
          <div class="profile-menu-item danger" id="btn-delete-account">${icon('x', 20)}<span>${t('profile.deleteAccount')}</span></div>
        </div>
      </div>
      ${renderTabBar()}
    `;
    // Статус подписки: серверная правда через couple_access(), одинаково для владельца и партнёра
    if (state.couple) {
      coupleHasAccess().then((acc) => {
        const el = document.getElementById('sub-status');
        if (!el || !acc?.status) return;
        const lang = getLang() === 'ru' ? 'ru-RU' : 'en-US';
        const untilDate = acc.expires_at
          ? new Date(acc.expires_at).toLocaleDateString(lang, { day: 'numeric', month: 'short' })
          : null;
        let title = '';
        let detail = '';
        if (acc.status === 'grace') {
          title = t('profile.subGrace');
        } else if (!acc.has_access) {
          title = t('profile.subExpired');
        } else if (acc.is_trial) {
          title = t('profile.subTrial');
          const daysLeft = acc.expires_at
            ? Math.max(0, Math.ceil((new Date(acc.expires_at) - Date.now()) / 86400000))
            : null;
          if (daysLeft !== null) detail = t('profile.subTrialLeft', { days: daysLeft });
        } else {
          title = t('profile.subPremium');
          if (untilDate) detail = t(acc.will_renew ? 'profile.subRenews' : 'profile.subUntil', { date: untilDate });
        }
        if (acc.has_access && acc.is_owner === false) {
          detail = detail ? `${detail} · ${t('profile.subPaidByPartner')}` : t('profile.subPaidByPartner');
        }
        el.innerHTML = `${icon('star', 20)}<span>${e(title)}${detail ? ` <strong>${e(detail)}</strong>` : ''}</span>`;
        el.style.display = '';
      }).catch(() => { /* нет данных — строку не показываем */ });
    }

    document.getElementById('btn-change-avatar')?.addEventListener('click', () => {
      document.getElementById('avatar-input')?.click();
    });
    document.getElementById('avatar-input')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      await updateAvatar(file, state.profile.id);
      event.target.value = '';
    });
    document.getElementById('btn-edit-name')?.addEventListener('click', () => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.onclick = (ev) => { if (ev.target === backdrop) backdrop.remove(); };
      backdrop.innerHTML = `
        <div class="modal-sheet">
          <div class="modal-handle"></div>
          <div class="modal-title">${t('profile.editName')}</div>
          <div class="form-group"><input type="text" class="form-input" id="edit-display-name" value="${e(state.profile.display_name)}" autocomplete="name"></div>
          <button class="btn btn-primary" id="btn-save-name">${t('common.save')}</button>
        </div>
      `;
      document.body.appendChild(backdrop);
      enableModalSwipe(backdrop);
      document.getElementById('btn-save-name').onclick = async () => {
        const name = document.getElementById('edit-display-name').value.trim();
        if (!name) { showToast(t('common.enterName')); return; }
        try {
          const { error } = await supabase.from('profiles').update({ display_name: name }).eq('id', state.profile.id);
          if (error) throw error;
          const refreshed = await getProfile();
          setState({ profile: refreshed });
          backdrop.remove();
          showToast(t('profile.nameUpdated'));
          navigate('/profile');
        } catch (err) { showToast(t('common.error', { msg: getReadableError(err) })); }
      };
    });
    document.getElementById('btn-remove-avatar')?.addEventListener('click', async () => {
      await removeAvatar(state.profile.id);
    });
    document.getElementById('btn-invite')?.addEventListener('click', async () => {
      const link = inviteLink(state.couple.invite_code);
      if (navigator.share) {
        try { await navigator.share({ title: 'CoupleExpenses', text: t('invite.shareText'), url: link }); } catch { /* отменили шаринг */ }
      } else {
        navigator.clipboard.writeText(link)
          .then(() => showToast(t('common.linkCopied')))
          .catch(() => showToast(state.couple.invite_code));
      }
    });
    document.getElementById('btn-copy-code')?.addEventListener('click', () => {
      navigator.clipboard.writeText(state.couple.invite_code)
        .then(() => showToast(t('profile.codeCopied')))
        .catch(() => showToast(state.couple.invite_code));
    });
    document.getElementById('btn-theme')?.addEventListener('click', () => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.onclick = (ev) => { if (ev.target === backdrop) backdrop.remove(); };
      const current = getThemePref();
      backdrop.innerHTML = `
        <div class="modal-sheet">
          <div class="modal-handle"></div>
          <div class="modal-title">${t('profile.themeTitle')}</div>
          ${['system', 'light', 'dark'].map((pref) => `
            <button class="btn ${pref === current ? 'btn-primary' : 'btn-secondary'}" data-theme-option="${pref}" style="margin-bottom:8px;">${themeLabel(pref)}</button>
          `).join('')}
        </div>
      `;
      document.body.appendChild(backdrop);
      enableModalSwipe(backdrop);
      backdrop.querySelectorAll('[data-theme-option]').forEach((btn) => {
        btn.addEventListener('click', () => {
          applyTheme(btn.dataset.themeOption);
          document.getElementById('theme-current').textContent = themeLabel(btn.dataset.themeOption);
          backdrop.remove();
        });
      });
    });
    document.getElementById('btn-currency')?.addEventListener('click', () => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.onclick = (ev) => { if (ev.target === backdrop) backdrop.remove(); };
      backdrop.innerHTML = `
        <div class="modal-sheet">
          <div class="modal-handle"></div>
          <div class="modal-title">${t('profile.currencyTitle')}</div>
          <div class="form-group">
            <select class="form-input" id="currency-select">
              ${Object.entries(CURRENCIES).map(([code, [sym]]) =>
                `<option value="${code}" ${state.couple.currency === code ? 'selected' : ''}>${code} (${sym}) — ${currencyName(code)}</option>`
              ).join('')}
            </select>
          </div>
          <p style="font-size:12px; color:var(--c-text-secondary); margin-bottom:12px;">${t('profile.currencyChangeWarning')}</p>
          <button class="btn btn-primary" id="btn-save-currency">${t('common.save')}</button>
        </div>
      `;
      document.body.appendChild(backdrop);
      enableModalSwipe(backdrop);
      document.getElementById('btn-save-currency').onclick = async () => {
        const currency = document.getElementById('currency-select').value;
        try {
          const { error } = await supabase.from('couples').update({ currency }).eq('id', state.couple.id);
          if (error) throw error;
          const profile = await getProfile();
          setState({ couple: profile?.couples || state.couple, profile });
          backdrop.remove();
          showToast(t('profile.currencySaved'));
          navigate('/profile');
        } catch (err) {
          showToast(t('common.error', { msg: getReadableError(err) }));
        }
      };
    });
    document.getElementById('btn-biometric')?.addEventListener('click', async () => {
      const label = document.getElementById('biometric-current');
      if (isBiometricEnabled()) {
        setBiometricEnabled(false);
        label.textContent = t('common.off');
        return;
      }
      // Включаем только после успешной проверки Face ID — иначе можно запереть самого себя
      const ok = await unlockWithBiometrics(t('boot.locked'));
      if (ok) {
        setBiometricEnabled(true);
        label.textContent = t('common.on');
      }
    });
    document.getElementById('btn-lang')?.addEventListener('click', () => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.onclick = (ev) => { if (ev.target === backdrop) backdrop.remove(); };
      const current = getLang();
      backdrop.innerHTML = `
        <div class="modal-sheet">
          <div class="modal-handle"></div>
          <div class="modal-title">${t('profile.languageTitle')}</div>
          ${['ru', 'en'].map((lang) => `
            <button class="btn ${lang === current ? 'btn-primary' : 'btn-secondary'}" data-lang-option="${lang}" style="margin-bottom:8px;">${LANG_LABELS[lang]}</button>
          `).join('')}
        </div>
      `;
      document.body.appendChild(backdrop);
      enableModalSwipe(backdrop);
      backdrop.querySelectorAll('[data-lang-option]').forEach((btn) => {
        btn.addEventListener('click', () => {
          setLang(btn.dataset.langOption); // сохранит выбор и перезагрузит приложение
        });
      });
    });
    document.getElementById('btn-settings')?.addEventListener('click', showCoupleSettingsModal);
    document.getElementById('btn-export-csv')?.addEventListener('click', async () => {
      try {
        const rows = await fetchAllExpensesForExport(state.couple.id);
        const header = ['date', 'description', 'category', 'goal', 'amount', 'currency', 'split', 'paid_by'];
        // Значение, начинающееся с = + - @, Excel исполнит как формулу; описание вводит
        // партнёр, поэтому такие строки предваряем апострофом
        const csvEscape = (v) => {
          const raw = String(v ?? '');
          const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
          return `"${safe.replaceAll('"', '""')}"`;
        };
        const csv = [header.join(',')].concat(rows.map((r) => [
          r.expense_date,
          r.description,
          categoryLabel(r.categories?.name) || '',
          r.goal_contributions?.[0]?.goals?.name || '',
          r.amount,
          r.currency,
          r.split,
          r.paid_by_snapshot_name || '',
        ].map(csvEscape).join(','))).join('\n');
        const file = new File(['﻿' + csv], 'couple-expenses.csv', { type: 'text/csv' });
        if (navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file] }); } catch { /* отменили шаринг */ }
        } else {
          const url = URL.createObjectURL(file);
          const a = document.createElement('a');
          a.href = url; a.download = 'couple-expenses.csv';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
      } catch (err) {
        showToast(t('common.error', { msg: getReadableError(err) }));
      }
    });
    document.getElementById('btn-delete-account')?.addEventListener('click', openDeleteAccountDialog);
    document.getElementById('btn-logout').onclick = async () => {
      const btn = document.getElementById('btn-logout');
      btn.style.opacity = '0.6';
      // signOut бросает при протухшем токене или без сети — выйти всё равно нужно,
      // иначе кнопка выглядела мёртвой и пользователь оставался запертым в аккаунте
      try { await signOut(); } catch { /* локальную сессию всё равно чистим */ }
      await clearSessionState().catch(() => {});
      setState({ user: null, profile: null, couple: null });
      navigate('/auth');
    };
  });
}
