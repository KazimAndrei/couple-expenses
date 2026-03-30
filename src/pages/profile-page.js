import { route, navigate } from '../lib/router.js';
import { getState, setState } from '../lib/store.js';
import { getProfile, signOut, supabase } from '../lib/supabase.js';
import { escapeHtml, icon } from '../lib/utils.js';
import { renderTabBar } from '../components/tab-bar.js';
import { showToast } from '../services/toast.js';

const e = escapeHtml;

function showCoupleSettingsModal() {
  const { couple } = getState();
  if (!couple) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (event) => { if (event.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">Настройки пары</div>
      <div class="form-group">
        <label class="form-label">Название</label>
        <input type="text" class="form-input" id="couple-name" value="${e(couple.name || 'Our Budget')}" autocomplete="off">
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
          <input type="text" class="form-input" value="${e(couple.invite_code)}" readonly style="flex:1;text-align:center;font-size:18px;letter-spacing:2px;font-weight:600;">
          <button class="btn btn-secondary btn-small" id="btn-copy-couple-code">Копировать</button>
        </div>
      </div>
      <button class="btn btn-primary" id="btn-save-couple">Сохранить</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('btn-copy-couple-code')?.addEventListener('click', () => {
    navigator.clipboard.writeText(couple.invite_code).then(() => window.showToast('Скопировано'));
  });
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
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  };
}

export function registerProfileRoute() {
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
            <div><div class="profile-name">${e(state.profile.display_name)}</div><div class="profile-email">${state.couple ? 'Ключ: ' + e(state.couple.invite_code) : ''}</div></div>
          </div>
          ${state.couple ? `
            <div class="profile-menu-item" id="btn-invite">${icon('link', 20)}<span>Код приглашения: <strong>${e(state.couple.invite_code)}</strong></span></div>
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
}
