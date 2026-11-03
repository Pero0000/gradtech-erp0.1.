import { useEffect, useState } from 'react';

export function useOverviewLayout() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 768px)');
    const update = () => {
      setEnabled(document.documentElement.dataset.layout === 'pregledni' && desktopQuery.matches);
    };

    update();
    desktopQuery.addEventListener('change', update);
    window.addEventListener('tm-layout-change', update);
    return () => {
      desktopQuery.removeEventListener('change', update);
      window.removeEventListener('tm-layout-change', update);
    };
  }, []);

  return enabled;
}

