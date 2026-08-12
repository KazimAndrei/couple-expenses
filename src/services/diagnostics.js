const entries = [];
let panelEl = null;
const enabled = import.meta.env.DEV;

function now() {
  return new Date().toLocaleTimeString('ru-RU', { hour12: false });
}

function pushEntry(type, message) {
  entries.push(`[${now()}] ${type}: ${message}`);
  if (entries.length > 30) entries.shift();
}

function ensurePanel() {
  if (panelEl) return panelEl;
  panelEl = document.createElement('div');
  panelEl.id = 'ce-diagnostics';
  panelEl.style.cssText = [
    'position:fixed',
    'left:12px',
    'right:12px',
    'bottom:calc(84px + env(safe-area-inset-bottom, 0px))',
    'max-height:40dvh',
    'overflow:auto',
    'z-index:9999',
    'padding:10px 12px',
    'border-radius:10px',
    'background:rgba(20,20,19,0.92)',
    'color:#f1f1ed',
    'font:12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
    'white-space:pre-wrap',
    'display:none',
    'border:1px solid rgba(255,255,255,0.15)',
  ].join(';');
  document.body.appendChild(panelEl);
  return panelEl;
}

function renderPanel(forceVisible = false) {
  const panel = ensurePanel();
  panel.textContent = entries.join('\n');
  if (forceVisible) panel.style.display = 'block';
}

export function initDiagnostics() {
  if (!enabled) return;
  ensurePanel();
  window.showDiagnostics = () => {
    renderPanel(true);
  };
}

export function diagStep(message) {
  if (!enabled) return;
  pushEntry('STEP', message);
  renderPanel(false);
}

export function diagError(message, err) {
  const detail = err?.message || String(err || 'unknown');
  // Ошибки всегда в консоль (видны в Xcode/Capacitor логах); панель — только в dev
  console.error(`[diag] ${message}:`, detail);
  if (!enabled) return;
  pushEntry('ERROR', `${message} -> ${detail}`);
  renderPanel(true);
}
