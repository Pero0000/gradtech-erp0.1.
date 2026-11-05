import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { formatHrDateTime } from '@/lib/localization';
import { useRequestScope } from '@/lib/useRequestScope';
import { HistoryButton, HistoryDialog } from './HistoryDialog';
import {
  fetchWorkOrderItemChangeHistory,
  restoreWorkOrderItemChange,
  type WorkOrderItemChangeHistory as HistoryEntry,
} from '@/lib/api';

const errorText = (reason: unknown) => reason && typeof reason === 'object' && 'message' in reason
  ? String(reason.message) : 'Povijest stavki radnog naloga nije dostupna.';

function describe(data: Record<string, unknown>) {
  const resolved = data.gotovo === true || data.uzeto === true;
  const type = data.tip === 'materijal' ? 'Materijal' : data.tip === 'alat' ? 'Alat' : 'Stroj';
  const hours = data.tip === 'stroj' ? ` · ${data.sati == null ? '—' : String(data.sati)} h` : '';
  return `${type}: ${String(data.naziv ?? 'Stavka')} · ${resolved ? 'riješeno' : 'otvoreno'}${hours}`;
}

export function WorkOrderItemChangeHistory({ nalogId, onRestore }: {
  nalogId: string;
  onRestore: () => Promise<void>;
}) {
  const { canAccess } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestScope = useRequestScope();
  const restoreScope = useRequestScope();

  const load = useCallback(async (before?: string) => {
    const isCurrent = requestScope.start();
    if (!isCurrent()) return;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchWorkOrderItemChangeHistory(nalogId, before);
      if (!isCurrent()) return;
      setItems((current) => before ? [...current, ...page] : page);
      setHasMore(page.length === 50);
    } catch (reason) {
      if (isCurrent()) setError(errorText(reason));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [nalogId, requestScope]);

  useEffect(() => {
    if (open) void load();
    return () => requestScope.invalidate();
  }, [open, load, requestScope]);

  const restore = async (item: HistoryEntry) => {
    if (restoring || !item.can_restore) return;
    if (!window.confirm([
      'Vratiti prethodno stanje materijala ili alata?',
      `Sada: ${describe(item.after_data)}`,
      `Vratiti na: ${describe(item.before_data)}`,
      'Promjene na strojevima, vezama i obračunu sati nisu obuhvaćene.',
    ].join('\n'))) return;
    const isCurrent = restoreScope.start();
    if (!isCurrent()) return;
    setRestoring(item.id);
    setError(null);
    setNotice(null);
    try {
      await restoreWorkOrderItemChange(item.id);
      if (!isCurrent()) return;
      setNotice('Promjena stavke radnog naloga je vraćena.');
      await load();
      if (!isCurrent()) return;
      try {
        await onRestore();
      } catch (reason) {
        if (isCurrent()) setError(`Promjena je vraćena, ali stavke nisu osvježene: ${errorText(reason)}`);
      }
    } catch (reason) {
      if (isCurrent()) setError(errorText(reason));
    } finally {
      if (isCurrent()) setRestoring(null);
    }
  };

  if (!canAccess('radni_nalozi', 'edit')) return null;
  return <>
    <HistoryButton onClick={() => setOpen(true)} ariaLabel="Povijest materijala i alata (30 dana)" />
    <HistoryDialog open={open} onClose={() => setOpen(false)} title="Povijest materijala i alata (30 dana)">
      <p className="text-xs text-slate-500">
        Vraćaju se samo promjene naziva i oznake riješeno na materijalu/alatu aktivnog naloga.
        Za zaključene naloge, strojeve, dodavanje/brisanje i promjene veza povrat nije dostupan.
      </p>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{notice}</p>}
      <button type="button" disabled={loading || restoring !== null} onClick={() => void load()}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50">Osvježi</button>
      {loading && <p role="status" className="text-sm text-slate-500">Učitavanje…</p>}
      {!loading && !error && items.length === 0 && <p className="text-sm text-slate-500">Nema evidentiranih izmjena.</p>}
      {items.map((item) => <article key={item.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
        <p className="text-xs text-slate-500">{formatHrDateTime(new Date(item.created_at))} · {item.actor_name}</p>
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <p><span className="font-medium">Prije:</span> {describe(item.before_data)}</p>
          <p><span className="font-medium">Poslije:</span> {describe(item.after_data)}</p>
        </div>
        {item.reversed_at ? <p className="text-xs text-emerald-700">Vraćeno {formatHrDateTime(new Date(item.reversed_at))}</p> : <>
          <p className="text-xs text-slate-500">Moguće vratiti do {formatHrDateTime(new Date(item.expires_at))}.</p>
          {!item.can_restore && <p className="text-xs text-amber-800">{item.blocked_reason ?? 'Stavka ima noviju promjenu.'}</p>}
          <button type="button" disabled={!item.can_restore || loading || restoring !== null}
            onClick={() => void restore(item)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-sky-700 disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" /> Vrati promjenu
          </button>
        </>}
      </article>)}
      {hasMore && items.length > 0 && <button type="button" disabled={loading || restoring !== null}
        onClick={() => void load(items[items.length - 1].sequence)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50">Starije promjene</button>}
    </HistoryDialog>
  </>;
}
