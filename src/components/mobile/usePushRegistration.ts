import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/lib/supabase';
import { getPushInstallationProof, PUSH_REGISTRATION_KEY, forgetPushRegistration, rememberPushRegistration, storePendingPushOrder } from '@/lib/pushNotifications';

export function usePushRegistration(userId: string, companyId: string) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !userId || !companyId) return;
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
        if (platform !== 'android' && platform !== 'ios') return;

        const registrationListener = await PushNotifications.addListener('registration', async ({ value }) => {
          if (!active) return;
          const installationProof = getPushInstallationProof();
          let previousToken: string | null = null;
          try {
            const saved = JSON.parse(localStorage.getItem(PUSH_REGISTRATION_KEY) ?? 'null') as
              | { platform?: string; token?: string }
              | null;
            if (saved?.platform === platform && saved.token !== value) {
              previousToken = saved.token ?? null;
            }
          } catch {
            localStorage.removeItem(PUSH_REGISTRATION_KEY);
          }
          const { error: saveError } = await supabase.rpc('register_app_push_token', {
            p_token: value,
            p_platform: platform,
            p_previous_token: previousToken,
            p_installation_proof: installationProof,
          });
          if (saveError) {
            if (active) setError(`Push token nije spremljen: ${saveError.message}`);
            return;
          }
          rememberPushRegistration({ userId, token: value, platform, installationProof });
          if (active) setError(null);
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
            storePendingPushOrder(userId, nalogId);
            window.dispatchEvent(new CustomEvent('gradtech:open-mobile-work-order', { detail: nalogId }));
          }
        });
        addRemover(() => { void actionListener.remove(); });
        if (disposed) return;

        if (platform === 'android') {
          await PushNotifications.createChannel({
            id: 'radni-nalozi',
            name: 'Radni nalozi',
            description: 'Dodijeljeni i promijenjeni radni nalozi',
            importance: 5,
            visibility: 1,
            vibration: true,
            lights: true,
          });
        }

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
      forgetPushRegistration(userId);
    };
  }, [companyId, userId]);

  return error;
}
