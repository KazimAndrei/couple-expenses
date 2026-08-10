import { Capacitor } from '@capacitor/core';

const THEME_KEY = 'ce_theme'; // 'system' | 'light' | 'dark'

export const THEME_LABELS = { system: 'Как в системе', light: 'Светлая', dark: 'Тёмная' };

export function getThemePref() {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

function effectiveTheme(pref) {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(pref) {
  localStorage.setItem(THEME_KEY, pref);
  if (pref === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = pref;
  }
  syncStatusBar(effectiveTheme(pref));
}

// Style.Dark = светлый текст статус-бара (для тёмного фона), Style.Light — наоборот
async function syncStatusBar(theme) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light });
  } catch {
    // плагин недоступен — тема всё равно применится в CSS
  }
}

export function initTheme() {
  applyTheme(getThemePref());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePref() === 'system') syncStatusBar(effectiveTheme('system'));
  });
}
