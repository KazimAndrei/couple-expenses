export function getReadableError(err, fallback = 'Неизвестная ошибка') {
  const raw = err?.message || String(err || '');
  const lower = raw.toLowerCase();
  if (!raw) return fallback;
  if (lower.includes('network') || lower.includes('fetch')) return 'Проблема с сетью. Проверь интернет и попробуй снова.';
  if (lower.includes('jwt') || lower.includes('auth') || lower.includes('unauthorized')) return 'Ошибка авторизации. Выйдите и войдите снова.';
  if (lower.includes('permission') || lower.includes('forbidden') || lower.includes('rls')) return 'Недостаточно прав для этой операции.';
  if (lower.includes('duplicate') || lower.includes('already exists') || lower.includes('unique')) return 'Такая запись уже существует.';
  return raw;
}
