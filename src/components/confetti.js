// Конфетти на достижение цели: десятки лёгких DOM-частиц на CSS-анимации,
// без библиотек. Сам удаляет за собой контейнер.
const COLORS = ['#1d9e75', '#e8735a', '#f5b942', '#7f77dd', '#2fbfb3', '#ff8fb1'];

export function burstConfetti(count = 90) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  for (let i = 0; i < count; i += 1) {
    const p = document.createElement('i');
    const dx = (Math.random() - 0.5) * 2;
    p.style.setProperty('--x', `${50 + dx * 38}vw`);
    p.style.setProperty('--dx', `${dx * 30}vw`);
    p.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`);
    p.style.setProperty('--d', `${1.6 + Math.random() * 1.2}s`);
    p.style.setProperty('--delay', `${Math.random() * 0.25}s`);
    p.style.background = COLORS[i % COLORS.length];
    if (i % 3 === 0) p.style.borderRadius = '50%';
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3400);
}
