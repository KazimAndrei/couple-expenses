import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase.js';
import { diagError, diagStep } from './diagnostics.js';

let initialized = false;

export async function initNativePush() {
  if (!Capacitor.isNativePlatform() || initialized) return;
  initialized = true;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') { diagStep('push: permission denied'); return; }

    PushNotifications.addListener('registration', async ({ value }) => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.from('device_push_tokens').upsert({
          user_id: user.id,
          token: value,
          platform: 'ios',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,token' });
        diagStep('push: token registered');
      } catch (err) {
        diagError('push token save failed', err);
      }
    });
    PushNotifications.addListener('registrationError', (err) => {
      diagError('push registration failed', err);
    });

    await PushNotifications.register();
  } catch (err) {
    initialized = false;
    diagError('push init failed', err);
  }
}
