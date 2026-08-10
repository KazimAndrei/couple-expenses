export function showToast(msg, options = {}) {
  const { actionLabel, onAction, durationMs = 3000 } = options;
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  const text = document.createElement('span');
  text.textContent = msg;
  t.appendChild(text);
  if (actionLabel && typeof onAction === 'function') {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'toast-action';
    actionBtn.type = 'button';
    actionBtn.textContent = actionLabel;
    actionBtn.onclick = () => {
      try {
        onAction();
      } finally {
        t.remove();
      }
    };
    t.appendChild(actionBtn);
  }
  document.body.appendChild(t);
  setTimeout(() => t.remove(), durationMs);
}

export function exposeToastGlobally() {
  window.showToast = showToast;
}
