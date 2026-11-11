import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '@/auth/useAuth';
import { overviewCountModules } from './api';
import { createOverview } from './overview';
import { OVERVIEW_CHANGED } from './overviewEvents';
import { sendPushNotifications } from './obavijesti';
import { loadPostavke } from './postavke';

export function useOverview() {
  const { profile, company, canAccess } = useAuth();
  const enabled = Boolean(profile?.approved && company?.id);
  const store = useMemo(() => {
    if (!enabled || !company?.id || !profile?.id) return createOverview([], false);
    return createOverview(
      overviewCountModules.filter((module) => canAccess(module)),
      canAccess('obavijesti') || canAccess('dashboard'),
    );
  }, [enabled, company?.id, profile?.id, canAccess]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    store.ensure();
    let debounce: number | undefined;
    const invalidate = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => store.invalidate(), 300);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') store.refreshIfStale();
    };
    const settingsChanged = () => store.settingsChanged();
    window.addEventListener(OVERVIEW_CHANGED, invalidate);
    window.addEventListener('vozila-obavijest-updated', invalidate);
    window.addEventListener('tm-notification-settings-changed', settingsChanged);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void store.refresh();
    }, 30 * 60_000);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(timer);
      window.removeEventListener(OVERVIEW_CHANGED, invalidate);
      window.removeEventListener('vozila-obavijest-updated', invalidate);
      window.removeEventListener('tm-notification-settings-changed', settingsChanged);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, store]);

  useEffect(() => {
    if (enabled && canAccess('obavijesti') && loadPostavke().push) sendPushNotifications(snapshot.items);
  }, [enabled, canAccess, snapshot.items]);

  return { ...snapshot, refresh: store.refresh, resolve: store.resolve };
}
