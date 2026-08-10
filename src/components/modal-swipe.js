export function enableModalSwipe(backdrop) {
  const sheet = backdrop.querySelector('.modal-sheet');
  if (!sheet) return;

  let startY = 0;
  let startX = 0;
  let deltaY = 0;
  let active = false;
  let canClose = false;

  const reset = () => {
    sheet.style.transition = 'transform 0.2s ease';
    sheet.style.transform = '';
    backdrop.style.transition = 'background 0.2s ease';
    backdrop.style.background = '';
  };

  sheet.addEventListener('touchstart', (e) => {
    if (!e.touches[0]) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    deltaY = 0;
    active = false;
    canClose = sheet.scrollTop <= 0;
    sheet.style.transition = '';
    backdrop.style.transition = '';
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    if (!canClose || !e.touches[0]) return;
    const dy = e.touches[0].clientY - startY;
    const dx = e.touches[0].clientX - startX;
    if (!active) {
      if (dy < 8 || dy <= Math.abs(dx)) return;
      active = true;
    }
    if (dy <= 0) return;
    deltaY = Math.min(dy, 220);
    sheet.style.transform = `translateY(${deltaY}px)`;
    const alpha = Math.max(0.15, 0.45 - deltaY / 500);
    backdrop.style.background = `rgba(0,0,0,${alpha})`;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  sheet.addEventListener('touchend', () => {
    if (!active) return;
    if (deltaY >= 120) {
      backdrop.remove();
      return;
    }
    reset();
  });

  sheet.addEventListener('touchcancel', reset);
}
