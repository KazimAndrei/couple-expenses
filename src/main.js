import './styles/app.css';
import { supabase, ensureAuthenticated } from './lib/supabase.js';
import { navigate, startRouter, getCurrentPath } from './lib/router.js';
import { setState } from './lib/store.js';
import { currentMonth } from './lib/utils.js';
import { registerServiceWorker } from './services/pwa.js';
import { initNativePush } from './services/native-push.js';
import { initTheme } from './services/theme.js';
import { isBiometricEnabled, unlockWithBiometrics } from './services/biometric.js';
import { flushQueue } from './services/offline-queue.js';
import { loadExpenses } from './services/data-loader.js';
import { showToast } from './services/toast.js';
import { exposeToastGlobally } from './services/toast.js';
import { diagError, diagStep, initDiagnostics } from './services/diagnostics.js';
import { t } from './lib/i18n.js';
import { registerAuthSetupRoutes } from './pages/auth-setup-page.js';
import { registerHomeRoute } from './pages/home-page.js';
import { registerAnalyticsRoute } from './pages/analytics-page.js';
import { registerGoalsRoute } from './pages/goals-page.js';
import { registerProfileRoute } from './pages/profile-page.js';
import { registerPaywallRoute } from './pages/paywall-page.js';

registerAuthSetupRoutes();
registerHomeRoute();
registerAnalyticsRoute();
registerGoalsRoute();
registerProfileRoute();
registerPaywallRoute();

function renderBootLoader(app) {
  app.innerHTML = `
    <div class="loading boot-splash-wrap">
      <img class="boot-splash" src="/splash/splash-${1 + Math.floor(Math.random() * BOOT_SPLASH_COUNT)}.jpg" alt="">
    </div>
  `;
}

function renderBootFallback(app) {
  app.innerHTML = `
    <div class="loading-fallback">
      <div class="loading-fallback-title">${t('boot.slowTitle')}</div>
      <div class="loading-fallback-text">${t('boot.slowText')}</div>
      <button class="btn btn-primary" id="btn-restart-app" style="max-width: 280px;">${t('boot.restart')}</button>
    </div>
  `;
  document.getElementById('btn-restart-app')?.addEventListener('click', () => {
    window.location.reload();
  });
}

// Face ID-гейт: не пускаем дальше заставки, пока не пройдена биометрия
async function ensureUnlocked(app) {
  if (!isBiometricEnabled()) return;
  let ok = await unlockWithBiometrics(t('boot.locked'));
  while (!ok) {
    await new Promise((resolve) => {
      app.innerHTML = `
        <div class="loading-fallback">
          <div class="loading-fallback-title">${t('boot.locked')}</div>
          <button class="btn btn-primary" id="btn-unlock" style="max-width: 280px;">${t('boot.unlock')}</button>
        </div>
      `;
      document.getElementById('btn-unlock').onclick = resolve;
    });
    ok = await unlockWithBiometrics(t('boot.locked'));
  }
}

async function syncOfflineQueue() {
  const sent = await flushQueue();
  if (sent > 0) {
    showToast(t('home.offlineSynced'));
    try { await loadExpenses(); } catch { /* подтянется при следующем рендере */ }
  }
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
    }),
  ]);
}

// ---- INIT ----
// Заставка: случайный кадр из public/splash при каждом запуске.
// 4s при входе в дашборд (залогинен), 2.2s перед экраном логина
const BOOT_SPLASH_COUNT = 7;
const BOOT_SPLASH_LOGGED_IN_MS = 4000;
const BOOT_SPLASH_AUTH_MS = 2200;

async function init() {
  const app = document.getElementById('app');
  const bootStart = Date.now();
  const minBootSplash = (minMs) => new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, minMs - (Date.now() - bootStart)));
  });
  renderBootLoader(app);
  diagStep('init: start');
  let bootFallbackShown = false;
  const bootFallbackTimer = setTimeout(() => {
    if (!app.querySelector('.loading')) return;
    bootFallbackShown = true;
    diagStep('init: showing loading fallback');
    renderBootFallback(app);
  }, 9000);

  registerServiceWorker();
  diagStep('init: service worker check done');

  supabase.auth.onAuthStateChange((event) => {
    diagStep(`auth change: ${event}`);
    if (event === 'SIGNED_OUT') {
      setState({ user: null, profile: null, couple: null, loading: false });
      navigate('/auth');
    }
  });

  try {
    diagStep('init: reading session');
    const result = await withTimeout(ensureAuthenticated(), 15000, 'ensureAuthenticated');
    // Данные получены — fallback «долго загружается» больше не нужен,
    // иначе он сработает поверх намеренно удерживаемой заставки
    clearTimeout(bootFallbackTimer);
    // Роутер стартует только после минимального окна заставки — иначе он сразу перерисует экран
    await minBootSplash(result?.profile?.couple_id ? BOOT_SPLASH_LOGGED_IN_MS : BOOT_SPLASH_AUTH_MS);
    if (result) await ensureUnlocked(app);
    diagStep('init: router start');
    startRouter();
    if (result?.profile?.couple_id) {
      diagStep('init: authenticated');
      setState({ user: result.session.user, profile: result.profile, couple: result.profile.couples || null, currentMonth: currentMonth(), loading: false });
      initNativePush();
      navigate('/');
      syncOfflineQueue();
    } else if (result) {
      diagStep('init: authenticated, no couple');
      setState({ user: result.session.user, profile: result.profile, loading: false });
      navigate('/setup');
    } else {
      diagStep('init: not authenticated');
      setState({ loading: false });
      if (!getCurrentPath().startsWith('/invite')) navigate('/auth');
    }
  } catch (err) {
    console.error('Init error:', err);
    diagError('init failed', err);
    setState({ loading: false });
    if (bootFallbackShown) {
      renderBootFallback(app);
      return;
    }
    startRouter();
    navigate('/auth');
  } finally {
    clearTimeout(bootFallbackTimer);
  }
}

function setupOfflineBanner() {
  const banner = document.createElement('div');
  banner.className = 'offline-banner';
  banner.textContent = t('boot.offline');
  document.body.appendChild(banner);
  const update = () => banner.classList.toggle('visible', !navigator.onLine);
  window.addEventListener('online', () => syncOfflineQueue());
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

initTheme();
initDiagnostics();
exposeToastGlobally();
setupOfflineBanner();
init();

// Разовая проверка канала до StoreKit (VITE_RC_DEBUG=1) — пишет результат в консоль устройства
if (import.meta.env.VITE_RC_DEBUG === '1') {
  import('./services/purchases.js').then(async (m) => {
    const { Capacitor } = await import('@capacitor/core');
    console.error('[rc] available:', m.purchasesAvailable(),
      '| нативный плагин:', Capacitor.isPluginAvailable('Purchases'),
      '| платформа:', Capacitor.getPlatform());
    console.error('[rc] probe:', await m.probeProducts());
  }).catch((err) => console.error('[rc] module failed:', err?.message || err));
}
