import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase.js';
import { diagError, diagStep } from './diagnostics.js';
import { showToast } from './toast.js';

let initialized = false;

// Видимая диагностика регистрации пушей — только в dev-сборках (гостевой флаг)
const PUSH_DEBUG = import.meta.env.VITE_ENABLE_GUEST === '1';
const dbg = (msg) => { if (PUSH_DEBUG) showToast(`[push] ${msg}`); };

export async function initNativePush() {
  if (!Capacitor.isNativePlatform() || initialized) return;
  initialized = true;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    let perm = await PushNotifications.checkPermissions();
    dbg(`perm: ${perm.receive}`);
    if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') { diagStep('push: permission denied'); dbg('denied'); return; }

    PushNotifications.addListener('registration', async ({ value }) => {
      dbg(`token received (${value?.length ?? 0} chars)`);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { dbg('no user at save'); return; }
        const { error } = await supabase.from('device_push_tokens').upsert({
          user_id: user.id,
          token: value,
          platform: 'ios',
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
