import { diagError, diagStep } from '../services/diagnostics.js';
import { t } from './i18n.js';

const routes = {};
let currentCleanup = null;

export function route(path, handler) {
  routes[path] = handler;
}

export function navigate(path) {
  window.location.hash = path;
}

export function getCurrentPath() {
  return window.location.hash.slice(1) || '/';
}

export function getQueryParam(name) {
  const query = getCurrentPath().split('?')[1] || '';
  return new URLSearchParams(query).get(name);
}

async function handleRoute() {
  const path = getCurrentPath().split('?')[0];
  diagStep(`route: ${path}`);
  const app = document.getElementById('app');
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }
  const handler = routes[path] || routes['/'];
  try {
    if (handler) {
      const cleanup = await handler(app);
      if (typeof cleanup === 'function') {
        currentCleanup = cleanup;
      }
    }
  } catch (err) {
    console.error('Route handler error:', err);
    diagError(`route failed: ${path}`, err);
    app.innerHTML = `
      <div class="empty-state" style="padding-top: 120px;">
        <p>${t('router.loadFailed')}</p>
        <button class="btn btn-primary" style="margin-top: 12px; max-width: 280px;" id="btn-route-retry">${t('router.retry')}</button>
      </div>
    `;
    document.getElementById('btn-route-retry')?.addEventListener('click', () => {
      handleRoute();
    });
  }
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}
