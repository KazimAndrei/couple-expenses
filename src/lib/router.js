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

async function handleRoute() {
  const path = getCurrentPath();
  const app = document.getElementById('app');
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }
  const handler = routes[path] || routes['/'];
  if (handler) {
    const cleanup = await handler(app);
    if (typeof cleanup === 'function') {
      currentCleanup = cleanup;
    }
  }
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}
