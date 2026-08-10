import { route, navigate } from '../lib/router.js';
import { getState, setState } from '../lib/store.js';
import { getCoupleMembers, getProfile, inviteLink, signOut, supabase } from '../lib/supabase.js';
import { escapeHtml, icon } from '../lib/utils.js';
import { renderTabBar } from '../components/tab-bar.js';
import { showToast } from '../services/toast.js';
import { getReadableError } from '../services/errors.js';
import { enableModalSwipe } from '../components/modal-swipe.js';

const e = escapeHtml;

async function fileToBlob(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = objectUrl;
    });
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fileToDataUrl(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = objectUrl;
    });
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function uploadAvatarToStorage(file, profileId) {
  const ext = file.name?.split('.').pop() || 'jpg';
  const path = `avatars/${profileId}.${ext}`;
  const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
  if (uploadErr) throw uploadErr;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data?.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : null;
}

async function updateAvatar(file, profileId) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Выбери изображение');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('Файл слишком большой. Максимум 5MB');
    return;
  }
  try {
    let avatarUrl;
    try {
      avatarUrl = await uploadAvatarToStorage(await fileToBlob(file), profileId);
    } catch {
      avatarUrl = await fileToDataUrl(file);
    }
    const { error } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', profileId);
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
    showToast('Фото профиля обновлено');
    navigate('/profile');
  } catch (err) {
    showToast('Ошибка: ' + getReadableError(err));
  }
}

async function removeAvatar(profileId) {
  try {
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
    showToast('Фото удалено');
    navigate('/profile');
  } catch (err) {
    showToast('Ошибка: ' + getReadableError(err));
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
  enableModalSwipe(backdrop);
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
      showToast('Ошибка: ' + getReadableError(err));
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
        <div class="header"><div class="header-title">Профиль</div></div>
        <div class="profile-section">
          <div class="profile-card">
            <div class="profile-avatar-wrap">
              ${avatarMarkup}
              <button class="profile-avatar-edit" id="btn-change-avatar" aria-label="Изменить фото">${icon('settings', 14)}</button>
              <input type="file" id="avatar-input" accept="image/*" style="display:none;">
            </div>
            <div><div class="profile-name">${e(state.profile.display_name)}</div><div class="profile-email">${state.couple ? 'Ключ: ' + e(state.couple.invite_code) : ''}</div></div>
          </div>
          <div class="profile-menu-item" id="btn-edit-name">${icon('user', 20)}<span>Изменить имя</span></div>
          <div class="profile-menu-item" id="btn-remove-avatar">${icon('x', 20)}<span>Удалить фото</span></div>
          ${state.couple ? `
            <div class="profile-menu-item" id="btn-invite">${icon('link', 20)}<span>Код приглашения: <strong>${e(state.couple.invite_code)}</strong></span></div>
            <div class="profile-menu-item" id="btn-settings">${icon('settings', 20)}<span>Настройки пары</span></div>
          ` : ''}
          <div class="profile-menu-item danger" id="btn-logout">${icon('log-out', 20)}<span>Выйти</span></div>
        </div>
      </div>
      ${renderTabBar()}
    `;
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
          <div class="modal-title">Изменить имя</div>
          <div class="form-group"><input type="text" class="form-input" id="edit-display-name" value="${e(state.profile.display_name)}" autocomplete="name"></div>
          <button class="btn btn-primary" id="btn-save-name">Сохранить</button>
        </div>
      `;
      document.body.appendChild(backdrop);
      enableModalSwipe(backdrop);
      document.getElementById('btn-save-name').onclick = async () => {
        const name = document.getElementById('edit-display-name').value.trim();
        if (!name) { showToast('Введите имя'); return; }
        try {
          const { error } = await supabase.from('profiles').update({ display_name: name }).eq('id', state.profile.id);
          if (error) throw error;
          const refreshed = await getProfile();
          setState({ profile: refreshed });
          backdrop.remove();
          showToast('Имя обновлено');
          navigate('/profile');
        } catch (err) { showToast('Ошибка: ' + getReadableError(err)); }
      };
    });
    document.getElementById('btn-remove-avatar')?.addEventListener('click', async () => {
      await removeAvatar(state.profile.id);
    });
    document.getElementById('btn-invite')?.addEventListener('click', async () => {
      const link = inviteLink(state.couple.invite_code);
      if (navigator.share) {
        try { await navigator.share({ title: 'CoupleExpenses', text: 'Присоединяйся к нашей паре', url: link }); } catch { /* отменили шаринг */ }
      } else {
        navigator.clipboard.writeText(link)
          .then(() => showToast('Ссылка скопирована'))
          .catch(() => showToast(state.couple.invite_code));
      }
    });
    document.getElementById('btn-settings')?.addEventListener('click', showCoupleSettingsModal);
    document.getElementById('btn-logout').onclick = async () => {
      await signOut();
      setState({ user: null, profile: null, couple: null });
      navigate('/auth');
    };
  });
}
