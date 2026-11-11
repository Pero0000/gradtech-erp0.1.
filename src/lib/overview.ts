import { fetchOverviewCounts, type OverviewCountModule, type OverviewCounts } from './api';
import { buildObavijesti, loadObavijestiSource, type Obavijest, type Source } from './obavijesti';
import { loadPostavke } from './postavke';

export interface OverviewSnapshot {
  counts: OverviewCounts;
  source: Source | null;
  items: Obavijest[];
  countsError: string | null;
  notificationsError: string | null;
  notificationsLoading: boolean;
}

const errorText = (reason: unknown) =>
  reason instanceof Error ? reason.message
    : typeof reason === 'object' && reason !== null && 'message' in reason
      ? String(reason.message) : String(reason);

export function createOverview(modules: readonly OverviewCountModule[], notifications: boolean) {
  let snapshot: OverviewSnapshot = {
    counts: { gradilista: 0, radnici: 0, vozila: 0, raspored: 0, troskovi: 0, radni_nalozi: 0 },
    source: null, items: [], countsError: null, notificationsError: null,
    notificationsLoading: notifications,
  };
  const listeners = new Set<() => void>();
  const publish = (next: Partial<OverviewSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  };
  let countsPending: Promise<void> | null = null;
  let notificationsPending: Promise<void> | null = null;
  let countsDirty = false;
  let notificationsDirty = false;
  let started = false;
  let lastRefresh = 0;

  const refreshCounts = (): Promise<void> => {
    if (countsPending) return countsPending;
    countsDirty = false;
    countsPending = fetchOverviewCounts(modules).then(
      (counts) => publish({ counts, countsError: null }),
      (reason: unknown) => publish({ countsError: errorText(reason) }),
    ).finally(() => {
      countsPending = null;
      if (countsDirty) void refreshCounts();
    });
    return countsPending;
  };
  const refreshNotifications = (): Promise<void> => {
    if (!notifications) return Promise.resolve();
    if (notificationsPending) return notificationsPending;
    notificationsDirty = false;
    publish({ notificationsLoading: true });
    notificationsPending = loadObavijestiSource().then(
      (source) => publish({
        source, items: buildObavijesti(source, loadPostavke()),
        notificationsError: null, notificationsLoading: false,
      }),
    ).catch((reason: unknown) => {
      publish({ notificationsError: errorText(reason), notificationsLoading: false });
    }).finally(() => {
      notificationsPending = null;
      if (notificationsDirty) void refreshNotifications();
    });
    return notificationsPending;
  };
  const refresh = () => {
    started = true;
    lastRefresh = Date.now();
    return Promise.all([refreshCounts(), refreshNotifications()]);
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    ensure() { if (!started) void refresh(); },
    refresh,
    refreshIfStale() { if (Date.now() - lastRefresh >= 60_000) void refresh(); },
    invalidate() {
      countsDirty = Boolean(countsPending);
      notificationsDirty = Boolean(notificationsPending);
      void refresh();
    },
    settingsChanged() {
      if (snapshot.source) publish({ items: buildObavijesti(snapshot.source, loadPostavke()) });
    },
    resolve(id: string) {
      const source = snapshot.source ? {
        ...snapshot.source,
        voziloObavijesti: snapshot.source.voziloObavijesti.filter((item) => item.id !== id),
        gorivoAnomalije: snapshot.source.gorivoAnomalije.filter((item) => item.id !== id),
      } : null;
      publish({ source, items: snapshot.items.filter((item) =>
        item.voziloObavijestId !== id && item.voziloGorivoAnomalijaId !== id) });
    },
  };
}
