// Короткие звуки интерфейса, синтезированные на лету через Web Audio — без аудиофайлов
// в бандле. Сессия «ambient»: уважает беззвучный режим iPhone и не глушит музыку.
const PREF_KEY = 'ce_sounds_v1';
let ctx = null;

export function soundsEnabled() {
  try { return localStorage.getItem(PREF_KEY) !== 'off'; } catch { return true; }
}

export function setSoundsEnabled(on) {
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch { /* без сохранения */ }
}

function audio() {
  if (!soundsEnabled()) return null;
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'ambient';
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

// Одна нота: синус с мягкой атакой и экспоненциальным затуханием
function note(ac, freq, start, duration, gain = 0.12, type = 'sine') {
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function play(fn) {
  const ac = audio();
  if (!ac) return;
  try { fn(ac, ac.currentTime + 0.01); } catch { /* звук не критичен */ }
}

/** Трата добавлена: короткий восходящий «поп» из двух нот. */
export function soundAdd() {
  play((ac, t) => { note(ac, 660, t, 0.12, 0.1); note(ac, 990, t + 0.07, 0.18, 0.09); });
}

/** Доход или пополнение цели: «монетка». */
export function soundCoin() {
  play((ac, t) => { note(ac, 1320, t, 0.09, 0.07, 'triangle'); note(ac, 1760, t + 0.06, 0.22, 0.07, 'triangle'); });
}

/** Удаление: мягкий нисходящий щелчок. */
export function soundDelete() {
  play((ac, t) => { note(ac, 440, t, 0.08, 0.08); note(ac, 294, t + 0.05, 0.14, 0.07); });
}

/** Цель достигнута: мажорное арпеджио. */
export function soundSuccess() {
  play((ac, t) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(ac, f, t + i * 0.09, 0.32, 0.08));
  });
}
