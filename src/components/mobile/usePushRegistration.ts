import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/lib/supabase';

export function usePushRegistration(userId: string) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    let removeListeners: (() => void) | undefined;

    void (async () => {
      try {
        const platform = Capacitor.getPlatform();
        if (platform !== 'ios' && platform !== 'android') return;

        const [registrationListener, errorListener, actionListener] = await Promise.all([
          PushNotifications.addListener('registration', async ({ value }) => {
            const { error: saveError } = await supabase
              .from('app_push_tokens')
              .upsert({ user_id: userId, token: value, platform }, { onConflict: 'user_id,token' });
            if (active) setError(saveError ? `Push token nije spremljen: ${saveError.message}` : null);
          }),
          PushNotifications.addListener('registrationError', (reason) => {
            if (active) setError(reason.error ?? 'Registracija push obavijesti nije uspjela.');
          }),
          PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
            const nalogId = notification.data?.nalog_id;
            if (active && typeof nalogId === 'string') {
              window.dispatchEvent(new CustomEvent('tmcolor:open-mobile-work-order', { detail: nalogId }));
            }
          }),
        ]);
        removeListeners = () => {
          void registrationListener.remove();
          void errorListener.remove();
          void actionListener.remove();
        };

        let permission = await PushNotifications.checkPermissions();
        if (permission.receive !== 'granted') permission = await PushNotifications.requestPermissions();
        if (permission.receive !== 'granted') {
          if (active) setError('Dopusti push obavijesti u postavkama mobitela da dobivaš nove radne naloge.');
          return;
        }
        await PushNotifications.register();
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Push obavijesti nije moguće uključiti.');
        }
      }
    })();

    return () => {
      active = false;
      removeListeners?.();
    };
  }, [userId]);

  return error;
}
