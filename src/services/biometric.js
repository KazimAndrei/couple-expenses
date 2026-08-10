import { Capacitor } from '@capacitor/core';
import { diagError } from './diagnostics.js';

const BIOMETRIC_KEY = 'ce_biometric_lock';

export function isBiometricEnabled() {
  return localStorage.getItem(BIOMETRIC_KEY) === '1';
}

export function setBiometricEnabled(on) {
  if (on) localStorage.setItem(BIOMETRIC_KEY, '1');
  else localStorage.removeItem(BIOMETRIC_KEY);
}

export async function biometricAvailable() {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    const info = await BiometricAuth.checkBiometry();
    return info.isAvailable;
  } catch {
    return false;
  }
}

// true — разблокировано (или биометрия недоступна), false — юзер не прошёл
export async function unlockWithBiometrics(reason) {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    const info = await BiometricAuth.checkBiometry();
    if (!info.isAvailable) return true; // нет Face ID — не блокируем
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: '',
      allowDeviceCredential: true,
      iosFallbackTitle: '',
    });
    return true;
  } catch (err) {
    diagError('biometric unlock failed', err);
    return false;
  }
}
