// Анимированная инструкция к новой функции — показывается один раз, при первом нажатии.
// Те же сцены по кругу, что и в инструкции приглашения (стили .howto-*), текст — из i18n.
import { t } from '../lib/i18n.js';
import { icon } from '../lib/utils.js';
import { enableModalSwipe } from './modal-swipe.js';

const SEEN_KEY = 'ce_feature_intro_v1';

function readSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; }
}

function markIntroSeen(key) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...readSeen(), key])])); } catch { /* приватный режим */ }
}

const card = (title, sub, cat) => `
  <div class="fi-card">
    <span class="fi-card-icon">${icon(cat, 14, '#fff', 2.4)}</span>
    <span class="fi-card-text"><b>${title}</b><small>${sub}</small></span>
  </div>`;

const qrBox = () => `<div class="fi-qr">${Array.from({ length: 16 }, (_, i) => `<i class="${[0, 3, 5, 6, 9, 12, 15, 10].includes(i) ? 'on' : ''}"></i>`).join('')}<span class="fi-scanline"></span></div>`;

// Три сцены на функцию: что нажать → что происходит → что получится
const SCENES = {
  voice: () => [
    `<div class="howto-phone"><div class="fi-mic">${icon('mic', 22, '#fff', 2.4)}</div><i class="howto-tap"></i></div>`,
    `<div class="howto-phone"><div class="fi-wave">${'<i></i>'.repeat(7)}</div><div class="fi-say">${t('intro.voiceSay')}</div></div>`,
    `<div class="howto-phone">${card(t('intro.voiceCard'), t('intro.voiceCardSub'), 'coffee')}</div>`,
  ],
  qr: () => [
    `<div class="howto-phone"><div class="fi-btn">${icon('qr-code', 16, '#fff', 2.4)}<span>${t('capture.qr')}</span></div><i class="howto-tap"></i></div>`,
    `<div class="howto-phone">${qrBox()}</div>`,
    `<div class="howto-phone">${card(t('intro.qrCard'), t('intro.qrCardSub'), 'shopping-cart')}</div>`,
  ],
  scan: () => [
    `<div class="howto-phone"><div class="fi-btn">${icon('camera', 16, '#fff', 2.4)}<span>${t('capture.scan')}</span></div><i class="howto-tap"></i></div>`,
    `<div class="howto-phone"><div class="fi-doc"><i></i><i></i><i></i><b>42,628.00</b><span class="fi-scanline"></span></div></div>`,
    `<div class="howto-phone">${card(t('intro.scanCard'), t('intro.scanCardSub'), 'home')}</div>`,
  ],
  slips: () => [
    `<div class="howto-phone"><div class="fi-grid"><i></i><i class="slip"><b>฿</b></i><i></i><i></i><i class="slip"><b>฿</b></i><i></i></div></div>`,
    `<div class="howto-phone"><div class="fi-found">${icon('check', 12, '#fff', 3)}<span>${t('intro.slipsFound')}</span></div><div class="fi-rows"><i></i><i></i><i></i></div></div>`,
    `<div class="howto-phone"><div class="fi-btn wide">${t('intro.slipsAdd')}</div><i class="howto-tap"></i></div>`,
  ],
  share: () => [
    `<div class="howto-phone"><div class="fi-slip"><b>฿ 115.00</b><i></i><i></i></div><div class="fi-sharebtn">${icon('share', 14, '#fff', 2.4)}</div><i class="howto-tap fi-tap-share"></i></div>`,
    `<div class="howto-phone"><div class="fi-sheetrow"><span></span><span class="app">${icon('heart', 14, '#fff', 2.6)}</span><span></span></div><i class="howto-tap"></i></div>`,
    `<div class="howto-phone">${card(t('intro.shareCard'), t('intro.shareCardSub'), 'wallet')}</div>`,
  ],
};

export function introSeen(key) {
  return readSeen().includes(key);
}

// Показать инструкцию, если её ещё не видели. true — можно продолжать (кнопка «Понятно»
// или инструкция уже была), false — пользователь закрыл лист, действие не запускаем.
export function showFeatureIntro(key) {
  if (!SCENES[key] || introSeen(key)) return Promise.resolve(true);
  markIntroSeen(key);
  return new Promise((resolve) => {
    const scenes = SCENES[key]();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-sheet feature-intro">
        <div class="modal-handle"></div>
        <div class="howto fi-howto" aria-label="${t(`intro.${key}Title`)}">
          <div class="howto-title">${t(`intro.${key}Title`)}</div>
          <div class="howto-stage">
            ${scenes.map((html, i) => `<div class="howto-scene s${i + 1}">${html}</div>`).join('')}
          </div>
          <div class="howto-steps">
            ${[1, 2, 3].map((n) => `<div class="howto-step st${n}"><span class="howto-num">${n}</span><span>${t(`intro.${key}${n}`)}</span></div>`).join('')}
          </div>
        </div>
        <button class="btn btn-primary" id="btn-intro-ok">${t('intro.ok')}</button>
      </div>`;
    document.body.appendChild(backdrop);
    enableModalSwipe(backdrop);
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      observer.disconnect();
      backdrop.remove();
      resolve(ok);
    };
    // Свайп вниз убирает лист сам — тоже считаем закрытием
    const observer = new MutationObserver(() => { if (!backdrop.isConnected) finish(false); });
    observer.observe(document.body, { childList: true });
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) finish(false); });
    backdrop.querySelector('#btn-intro-ok').addEventListener('click', () => finish(true));
  });
}
