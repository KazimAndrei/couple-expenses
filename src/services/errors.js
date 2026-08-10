import { t } from '../lib/i18n.js';

export function getReadableError(err, fallback) {
  const raw = err?.message || String(err || '');
  const lower = raw.toLowerCase();
  if (!raw) return fallback ?? t('errors.unknown');
  if (lower.includes('network') || lower.includes('fetch')) return t('errors.network');
  if (lower.includes('jwt') || lower.includes('auth') || lower.includes('unauthorized')) return t('errors.auth');
  if (lower.includes('permission') || lower.includes('forbidden') || lower.includes('rls')) return t('errors.permission');
  if (lower.includes('duplicate') || lower.includes('already exists') || lower.includes('unique')) return t('errors.duplicate');
  return raw;
}
