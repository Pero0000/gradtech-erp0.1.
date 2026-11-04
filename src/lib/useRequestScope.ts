import { useEffect, useMemo } from 'react';

export function createRequestScope() {
  let active = false;
  let version = 0;
  return {
    activate() {
      active = true;
    },
    deactivate() {
      active = false;
      version += 1;
    },
    invalidate() {
      version += 1;
    },
    start() {
      const requestVersion = ++version;
      return () => active && requestVersion === version;
    },
  };
}

export function useRequestScope() {
  const scope = useMemo(createRequestScope, []);
  useEffect(() => {
    scope.activate();
    return () => scope.deactivate();
  }, [scope]);
  return scope;
}
