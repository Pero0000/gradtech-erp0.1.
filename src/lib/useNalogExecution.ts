import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '@/auth/useAuth';
import { createNalogExecutionCache, type NalogExecutionCache } from './nalogExecution';

export function useNalogExecutionCache() {
  const { profile, company, canAccess } = useAuth();
  return useMemo(createNalogExecutionCache, [profile?.id, company?.id, canAccess]);
}

export function useNalogExecution(id: string, sharedCache?: NalogExecutionCache) {
  const localCache = useNalogExecutionCache();
  const cache = sharedCache ?? localCache;
  const execution = cache.get(id);
  const snapshot = useSyncExternalStore(execution.subscribe, execution.getSnapshot, execution.getSnapshot);
  useEffect(() => execution.retain(), [execution]);
  return { execution, snapshot };
}
