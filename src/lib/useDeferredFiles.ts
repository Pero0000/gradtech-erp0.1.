import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

export function useDeferredFiles<T>(key: string, enabled: boolean, load: () => Promise<T[]>) {
  const [state, setState] = useState<{ key: string; data: T[]; loading: boolean; error: unknown }>({
    key, data: [], loading: false, error: null,
  });
  const currentKey = useRef(key);
  currentKey.current = key;
  const mounted = useRef(false);
  const pending = useRef(new Map<string, Promise<void>>());
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();
    const existing = pending.current.get(key);
    if (existing) return existing;
    setState((current) => ({
      key, data: current.key === key ? current.data : [], loading: true, error: null,
    }));
    const request = Promise.resolve().then(load).then(
      (data) => {
        if (mounted.current && currentKey.current === key) {
          setState({ key, data, loading: false, error: null });
        }
      },
      (error: unknown) => {
        if (mounted.current && currentKey.current === key) {
          setState((current) => ({
            key, data: current.key === key ? current.data : [], loading: false, error,
          }));
        }
      },
    ).finally(() => { pending.current.delete(key); });
    pending.current.set(key, request);
    return request;
  }, [enabled, key, load]);

  useEffect(() => { void refresh(); }, [refresh]);

  const setData = useCallback((update: SetStateAction<T[]>) => {
    if (!mounted.current || currentKey.current !== key) return;
    setState((current) => {
      const data = current.key === key ? current.data : [];
      return {
        ...current, key, data: typeof update === 'function' ? update(data) : update,
      };
    });
  }, [key]);

  return {
    data: state.key === key ? state.data : [],
    loading: state.key === key && state.loading,
    error: state.key === key ? state.error : null,
    refresh,
    setData,
  };
}
