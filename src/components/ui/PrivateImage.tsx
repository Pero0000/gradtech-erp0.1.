import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { getPrivateFileUrl } from '@/lib/api';
import { downloadFile } from '@/lib/downloadFile';

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Izvornu datoteku nije moguće učitati.';
}

export function PrivateImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [state, setState] = useState<{ path: string; url: string | null; error: string | null }>({
    path, url: null, error: null,
  });
  const [retry, setRetry] = useState(0);
  const failedPath = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    setState({ path, url: null, error: null });
    void getPrivateFileUrl(path, 3600, failedPath.current === path).then(
      (url) => {
        if (active) setState({ path, url, error: null });
      },
      (reason: unknown) => {
        if (active) setState({ path, url: null, error: message(reason) });
      },
    );
    return () => { active = false; };
  }, [path, retry]);

  const error = state.path === path ? state.error : null;
  const url = state.path === path ? state.url : null;
  const onError = useCallback(() => {
    failedPath.current = path;
    setState({ path, url: null, error: 'Fotografiju nije moguće prikazati.' });
  }, [path]);
  if (error) return (
    <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      {error}
      <button type="button" onClick={() => setRetry((value) => value + 1)} className="ml-2 underline">Pokušaj ponovno</button>
    </div>
  );
  if (!url) return <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">Učitavanje fotografije…</p>;
  return <img src={url} alt={alt} className={className} onError={onError} />;
}

export function PrivateFileLink({ path, children, className, filename }: {
  path: string; children: ReactNode; className?: string; filename?: string;
}) {
  const pending = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(null);
    let tab: Window | null = null;
    try {
      if (!filename) {
        tab = window.open('about:blank', '_blank');
        if (!tab) throw new Error('Preglednik je blokirao otvaranje datoteke. Dopusti otvaranje nove kartice i pokušaj ponovno.');
        tab.opener = null;
      }
      const url = await getPrivateFileUrl(path);
      if (filename) await downloadFile(url, filename);
      else if (tab) tab.location.replace(url);
    } catch (reason) {
      tab?.close();
      setError(message(reason));
    } finally {
      pending.current = false;
      setLoading(false);
    }
  };
  return (
    <>
      <button type="button" onClick={() => void open()} disabled={loading} className={className} aria-busy={loading}>
        {children}
      </button>
      {error && <span role="alert" className="block rounded bg-amber-50 p-2 text-sm text-amber-900">{error}</span>}
    </>
  );
}
