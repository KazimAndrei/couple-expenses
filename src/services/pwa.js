export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    // Если есть waiting воркер с новой версией — активируем сразу и перезагружаем страницу,
    // чтобы пользователь не сидел на старом бандле дольше необходимого.
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          installing.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    // Регулярно проверяем обновления (раз в 5 минут)
    setInterval(() => reg.update().catch(() => {}), 5 * 60 * 1000);
  }).catch((err) => {
    console.error('SW register failed:', err);
  });
}
