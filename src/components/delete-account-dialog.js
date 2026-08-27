import { deleteMyAccount } from '../lib/supabase.js';
import { navigate } from '../lib/router.js';
import { setState } from '../lib/store.js';
import { t } from '../lib/i18n.js';
import { showToast } from '../services/toast.js';
import { getReadableError } from '../services/errors.js';
import { enableModalSwipe } from './modal-swipe.js';

// Общий диалог удаления аккаунта. Живёт отдельно, потому что вызывается с двух
// экранов: из профиля и с экрана настройки пары. Второй важен для App Review —
// пользователь, который вошёл, но ещё не создал пару, до профиля не доходит,
// и без этой кнопки удалить аккаунт ему было нечем (Guideline 5.1.1(v)).
export function openDeleteAccountDialog() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.onclick = (ev) => { if (ev.target === backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">${t('profile.deleteAccount')}</div>
      <p style="font-size:14px; color:var(--c-text-secondary); margin-bottom:16px;">${t('profile.deleteAccountWarning')}</p>
      <button class="btn btn-danger" id="btn-confirm-delete">${t('profile.deleteAccountConfirm')}</button>
      <button class="btn btn-secondary" style="margin-top:8px;" id="btn-cancel-delete">${t('common.cancel')}</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  enableModalSwipe(backdrop);

  document.getElementById('btn-cancel-delete').onclick = () => backdrop.remove();
  document.getElementById('btn-confirm-delete').onclick = async () => {
    const btn = document.getElementById('btn-confirm-delete');
    btn.disabled = true;
    try {
      await deleteMyAccount();
      localStorage.clear();
      setState({ user: null, profile: null, couple: null });
      navigate('/auth');
      backdrop.remove();
      showToast(t('profile.accountDeleted'));
    } catch (err) {
      showToast(t('common.error', { msg: getReadableError(err) }));
      btn.disabled = false;
    }
  };
}
