import { clearQueue } from './offline-queue.js';
import { unregisterNativePush } from './native-push.js';
import { logOutPurchases } from './purchases.js';

// Всё, что должно умереть вместе с сессией. Раньше эти ключи чистились в разных местах
// по-разному, и часть переживала выход: флаг пропуска пейволла давал следующему аккаунту
// бесплатное создание пары, а чужой инвайт-код автоматически подставлялся новому юзеру.
const SESSION_KEYS = ['ce_paywall_skip', 'ce_setup_name'];
const LOCAL_KEYS = ['ce_pending_invite', 'ce_pending_currency', 'ce_biometric_lock', 'ce_data_cache_v1'];

export async function clearSessionState() {
  for (const k of SESSION_KEYS) {
    try { sessionStorage.removeItem(k); } catch { /* приватный режим */ }
  }
  for (const k of LOCAL_KEYS) {
    try { localStorage.removeItem(k); } catch { /* приватный режим */ }
  }
  try { clearQueue(); } catch { /* очередь уже пуста */ }
  await unregisterNativePush().catch(() => {});
  await logOutPurchases().catch(() => {});
}
