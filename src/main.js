import './styles/app.css';
import { supabase, getSession, getProfile, authWithInviteCode, ensureAuthenticated } from './lib/supabase.js';
import { navigate, startRouter, getCurrentPath } from './lib/router.js';
import { setState } from './lib/store.js';
import { currentMonth } from './lib/utils.js';
import { registerServiceWorker } from './services/pwa.js';
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
let authRecoveryInProgress = false;

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

  authRecoveryInProgress = true;

  supabase.auth.onAuthStateChange(async (event, session) => {
    try {
      diagStep(`auth change: ${event}`);
      if (authRecoveryInProgress) return;
      if (event === 'SIGNED_IN') {
        const profile = await withTimeout(getProfile(), 10000, 'getProfile');
        if (profile?.couple_id) {
          setState({ user: session.user, profile, couple: profile.couples || null, currentMonth: currentMonth(), loading: false });
          if (getCurrentPath() === '/auth') navigate('/');
        }
      } else if (event === 'SIGNED_OUT') {
        if (localStorage.getItem('ce_invite_code')) {
          authRecoveryInProgress = true;
          try {
            const result = await withTimeout(ensureAuthenticated(), 15000, 'ensureAuthenticated');
            if (result) {
              setState({ user: result.session.user, profile: result.profile, couple: result.profile.couples || result.couple || null, currentMonth: currentMonth(), loading: false });
              navigate('/');
              return;
            }
          } catch {
            // recovery failed
          } finally {
            authRecoveryInProgress = false;
          }
        }
        setState({ user: null, profile: null, couple: null, loading: false });
        navigate('/auth');
      }
    } catch (err) {
      diagError('auth state change failed', err);
    }
  });

  diagStep('init: router start');
  startRouter();

  try {
    diagStep('init: reading session');
    const result = await withTimeout(ensureAuthenticated(), 15000, 'ensureAuthenticated');
    if (result) {
      diagStep('init: authenticated');
      setState({ user: result.session.user, profile: result.profile, couple: result.profile.couples || result.couple || null, currentMonth: currentMonth(), loading: false });
      navigate('/');
    } else {
      diagStep('init: not authenticated');
      setState({ loading: false });
      navigate('/auth');
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
    authRecoveryInProgress = false;
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
