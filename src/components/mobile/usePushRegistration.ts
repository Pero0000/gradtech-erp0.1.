import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/lib/supabase';

export function usePushRegistration(userId: string) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !userId) return;
    let active = true;
    let disposed = false;
    const removers: Array<() => void> = [];
    const removeListeners = () => {
      disposed = true;
      for (const remove of removers) remove();
      removers.length = 0;
    };
    const addRemover = (remove: () => void) => {
      if (disposed) remove();
      else removers.push(remove);
    };
    setError(null);

    void (async () => {
      try {
        const platform = Capacitor.getPlatform();
        if (platform === 'android') {
          const { error: tokenError } = await supabase
            .from('app_push_tokens')
            .delete()
            .eq('user_id', userId)
            .eq('platform', 'android');
          if (active && tokenError) setError(`Android push je isključen, ali stari token nije uklonjen: ${tokenError.message}`);
          return;
        }
        if (platform !== 'ios') return;

        const registrationListener = await PushNotifications.addListener('registration', async ({ value }) => {
          if (!active) return;
          const { error: saveError } = await supabase
            .from('app_push_tokens')
            .upsert({ user_id: userId, token: value, platform }, { onConflict: 'user_id,token' });
          if (active) setError(saveError ? `Push token nije spremljen: ${saveError.message}` : null);
        });
        addRemover(() => { void registrationListener.remove(); });
        if (disposed) return;

        const errorListener = await PushNotifications.addListener('registrationError', (reason) => {
          if (active) setError(reason.error ?? 'Registracija push obavijesti nije uspjela.');
        });
        addRemover(() => { void errorListener.remove(); });
        if (disposed) return;

        const actionListener = await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
          const nalogId = notification.data?.nalog_id;
          if (active && typeof nalogId === 'string') {
            window.dispatchEvent(new CustomEvent('tmcolor:open-mobile-work-order', { detail: nalogId }));
          }
        });
        addRemover(() => { void actionListener.remove(); });
        if (disposed) return;

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
        removeListeners();
      }
    })();

    return () => {
      active = false;
      removeListeners();
    };
  }, [userId]);

  return error;
}
