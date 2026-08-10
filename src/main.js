import './styles/app.css';
import { supabase, ensureAuthenticated } from './lib/supabase.js';
import { navigate, startRouter, getCurrentPath } from './lib/router.js';
import { setState } from './lib/store.js';
import { currentMonth } from './lib/utils.js';
import { registerServiceWorker } from './services/pwa.js';
import { initNativePush } from './services/native-push.js';
import { exposeToastGlobally } from './services/toast.js';
import { diagError, diagStep, initDiagnostics } from './services/diagnostics.js';
import { registerAuthSetupRoutes } from './pages/auth-setup-page.js';
import { registerHomeRoute } from './pages/home-page.js';
import { registerAnalyticsRoute } from './pages/analytics-page.js';
import { registerGoalsRoute } from './pages/goals-page.js';
import { registerProfileRoute } from './pages/profile-page.js';

registerAuthSetupRoutes();
registerHomeRoute();
registerAnalyticsRoute();
registerGoalsRoute();
registerProfileRoute();

function renderBootLoader(app) {
  app.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
}

function renderBootFallback(app) {
  app.innerHTML = `
    <div class="loading-fallback">
      <div class="loading-fallback-title">Долго загружается</div>
      <div class="loading-fallback-text">Проверьте интернет и перезапустите приложение</div>
      <button class="btn btn-primary" id="btn-restart-app" style="max-width: 280px;">Перезапустить приложение</button>
    </div>
  `;
  document.getElementById('btn-restart-app')?.addEventListener('click', () => {
    window.location.reload();
  });
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
async function init() {
  const app = document.getElementById('app');
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

  diagStep('init: router start');
  startRouter();

  try {
    diagStep('init: reading session');
    const result = await withTimeout(ensureAuthenticated(), 15000, 'ensureAuthenticated');
    if (result?.profile?.couple_id) {
      diagStep('init: authenticated');
      setState({ user: result.session.user, profile: result.profile, couple: result.profile.couples || null, currentMonth: currentMonth(), loading: false });
      initNativePush();
      navigate('/');
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
    navigate('/auth');
  } finally {
    clearTimeout(bootFallbackTimer);
  }
}

function setupOfflineBanner() {
  const banner = document.createElement('div');
  banner.className = 'offline-banner';
  banner.textContent = 'Нет подключения к интернету';
  document.body.appendChild(banner);
  const update = () => banner.classList.toggle('visible', !navigator.onLine);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

initDiagnostics();
exposeToastGlobally();
setupOfflineBanner();
init();
