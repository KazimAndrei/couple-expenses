import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase.js';
import { diagError, diagStep } from './diagnostics.js';
import { getLang } from '../lib/i18n.js';

let initialized = false;
let currentToken = null;

// Шаги регистрации пушей — в diagnostics-панель (window.showDiagnostics в dev)
const dbg = (msg) => diagStep(`push: ${msg}`);

export async function initNativePush() {
  dbg(`enter (native=${Capacitor.isNativePlatform()}, initialized=${initialized})`);
  if (!Capacitor.isNativePlatform() || initialized) return;
  initialized = true;
  try {
    dbg('importing plugin…');
    const { PushNotifications } = await import('@capacitor/push-notifications');
    dbg('plugin imported');

    let perm = await PushNotifications.checkPermissions();
    dbg(`perm: ${perm.receive}`);
    if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') {
      // Сбрасываем флаг: пользователь может разрешить уведомления в настройках iOS,
      // и тогда повторная попытка должна сработать без перезапуска приложения
      initialized = false;
      diagStep('push: permission denied'); dbg('denied'); return;
    }

    PushNotifications.addListener('registration', async ({ value }) => {
      dbg(`token received (${value?.length ?? 0} chars)`);
      currentToken = value;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { dbg('no user at save'); return; }
        const { error } = await supabase.from('device_push_tokens').upsert({
          user_id: user.id,
          token: value,
          platform: 'ios',
          lang: getLang(), // язык интерфейса → язык пушей
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,token' });
        if (error) { dbg(`save error: ${error.message}`); diagError('push token save failed', error); return; }
        diagStep('push: token registered');
        dbg('token saved ✓');
      } catch (err) {
        dbg(`save threw: ${err?.message || err}`);
        diagError('push token save failed', err);
      }
    });
    PushNotifications.addListener('registrationError', (err) => {
      dbg(`registration error: ${JSON.stringify(err)}`);
      diagError('push registration failed', err);
    });

    dbg('calling register()');
    await PushNotifications.register();
  } catch (err) {
    initialized = false;
    dbg(`init failed: ${err?.message || err}`);
    diagError('push init failed', err);
  }
}


// При выходе токен нужно отвязать: иначе следующий пользователь этого телефона
// получал бы пуши о расходах чужой пары.
export async function unregisterNativePush() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (currentToken) {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (userId) {
        await supabase.from('device_push_tokens').delete().eq('user_id', userId).eq('token', currentToken);
      }
    }
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.removeAllListeners().catch(() => {});
  } catch (err) {
    diagError('push unregister failed', err);
  } finally {
    currentToken = null;
    initialized = false;
  }
}
