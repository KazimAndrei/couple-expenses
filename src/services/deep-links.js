// Ссылки coupleexpenses://… из виджетов и расширения «Поделиться»:
//   add            — форма нового расхода
//   add?mode=voice — сразу голосовой ввод, mode=qr — сканер QR
//   import         — проверить присланное через «Поделиться»
//   home, goals, analytics — открыть экран (нажатие на виджет)
// Капаситор-плагина App у нас нет — URL отдаёт наш нативный плагин Capture.
import { Capacitor } from '@capacitor/core';
import { Capture } from './capture.js';
import { getState } from '../lib/store.js';
import { navigate } from '../lib/router.js';


function handle(raw) {
  let url;
  try { url = new URL(raw); } catch { return; }
  if (url.protocol !== 'coupleexpenses:') return;
  const action = (url.host || url.pathname.replace(/^\/+/, '')).toLowerCase();
  const run = () => {
    if (!getState().couple) return false;
    if (action === 'add') {
      const mode = url.searchParams.get('mode');
      window.dispatchEvent(new CustomEvent('ce:add-expense', { detail: { autostart: ['voice', 'qr'].includes(mode) ? mode : null } }));
    } else if (action === 'import') {
      window.dispatchEvent(new Event('ce:check-payments'));
    } else if (['home', 'goals', 'analytics'].includes(action)) {
      // Нажали на виджет — открываем экран, который он показывает
      navigate(action === 'home' ? '/' : `/${action}`);
    }
    return true;
  };
  // На холодном старте ждём, пока загрузится пара
  if (run()) return;
  let tries = 0;
  const timer = setInterval(() => {
    if (run() || ++tries > 240) clearInterval(timer); // до минуты: Face ID и медленный вход
  }, 250);
}

export function initDeepLinks() {
  if (!Capacitor.isNativePlatform()) return;
  Capture.addListener('openUrl', (e) => handle(e.url)).catch(() => {});
  Capture.takeLaunchUrl().then((r) => { if (r?.url) handle(r.url); }).catch(() => {});
}
