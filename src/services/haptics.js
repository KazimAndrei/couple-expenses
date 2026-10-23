import { Capacitor } from '@capacitor/core';

// Тактильный отклик только в нативной оболочке: в браузере плагина нет, а отсутствие
// вибрации никогда не должно ломать действие, которое её вызвало.
let mod = null;
async function load() {
  if (!Capacitor.isNativePlatform()) return null;
  if (!mod) mod = import('@capacitor/haptics').catch(() => null);
  return mod;
}

export async function hapticTap() {
  try { const m = await load(); await m?.Haptics.impact({ style: m.ImpactStyle.Light }); } catch { /* без отклика */ }
}

export async function hapticSelect() {
  try { const m = await load(); await m?.Haptics.selectionChanged(); } catch { /* без отклика */ }
}

export async function hapticSuccess() {
  try { const m = await load(); await m?.Haptics.notification({ type: m.NotificationType.Success }); } catch { /* без отклика */ }
}

export async function hapticWarning() {
  try { const m = await load(); await m?.Haptics.notification({ type: m.NotificationType.Warning }); } catch { /* без отклика */ }
}
