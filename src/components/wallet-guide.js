// Инструкция: автоматизация «Команд», которая передаёт оплаты Apple Pay в приложение (WalletPaymentIntent.swift).
// Создать автоматизацию за пользователя iOS не позволяет — только показать шаги и открыть «Команды».
import { t } from '../lib/i18n.js';
import { enableModalSwipe } from './modal-swipe.js';

const STEPS = [1, 2, 3, 4, 5];

export function openWalletGuide() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-sheet has-footer">
      <div class="sheet-body">
        <div class="modal-handle"></div>
        <div class="modal-title">${t('wallet.guideTitle')}</div>
        <p class="capture-sub">${t('wallet.guideSub')}</p>
        <div class="howto-steps wallet-steps">
          ${STEPS.map((n) => `<div class="howto-step"><span class="howto-num">${n}</span><span>${t(`wallet.step${n}`)}</span></div>`).join('')}
        </div>
        <p class="capture-sub" style="margin-top:14px;">${t('wallet.note')}</p>
      </div>
      <div class="sheet-footer">
        <button class="btn btn-primary" id="btn-open-shortcuts">${t('wallet.openShortcuts')}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  enableModalSwipe(backdrop);
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#btn-open-shortcuts').addEventListener('click', () => { window.location.href = 'shortcuts://'; });
}
