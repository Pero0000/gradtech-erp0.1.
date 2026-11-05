import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { formatHrDate, formatHrDateTime } from '@/lib/localization';
import { fetchPonudaChangeHistory, restorePonudaChange, type PonudaChangeHistory, type PonudaStavka } from '@/lib/ponude';
import { useRequestScope } from '@/lib/useRequestScope';
import { HistoryButton, HistoryDialog } from './HistoryDialog';

const fieldLabels: Record<string, string> = {
  naslov: 'Naslov', status: 'Status', datum: 'Datum', investitor_id: 'Investitor',
  objekt_id: 'Objekt', adresa_radova: 'Adresa radova', popust: 'Opći popust',
  pdv: 'PDV', napomene: 'Napomene', prikazi_popust: 'Prikaz popusta',
  prijenos_porezne_obveze: 'Prijenos porezne obveze',
};

const statuses: Record<string, string> = {
  nepotvrdena: 'Nepotvrđena', potvrdena: 'Potvrđena', odbijena: 'Odbijena',
};

const errorText = (reason: unknown) => reason && typeof reason === 'object' && 'message' in reason
  ? String(reason.message) : 'Povijest izmjena ponude nije dostupna.';

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Da' : 'Ne';
  if (typeof value === 'number') return value.toLocaleString('hr-HR');
  if (typeof value === 'string') {
    if (value in statuses) return statuses[value];
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatHrDate(value);
    return value;
  }
  return String(value);
}

function total(lines: PonudaStavka[]) {
  return lines.reduce((sum, line) => sum + Number(line.kolicina) * Number(line.cijena), 0);
}

function offerDescription(snapshot: Record<string, unknown>, lines: PonudaStavka[]) {
  const amount = total(lines).toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
  return `${String(snapshot.naslov ?? 'Ponuda')} · ${displayValue(snapshot.status)} · ${displayValue(snapshot.datum)} · ${lines.length} stavki · ${amount}`;
}

export function PonudaChangeHistoryPanel({ offerId, disabled = false, onRestore }: {
  offerId: string;
  disabled?: boolean;
  onRestore: () => Promise<void>;
}) {
  const { canAccess } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PonudaChangeHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
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
      const page = await fetchPonudaChangeHistory(offerId, before);
      if (!isCurrent()) return;
      setItems((current) => before ? [...current, ...page] : page);
      setHasMore(page.length === 50);
    } catch (reason) {
      if (isCurrent()) setError(errorText(reason));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [offerId, requestScope]);

  useEffect(() => {
    if (open) void load();
    return () => requestScope.invalidate();
  }, [open, load, requestScope]);

  const restore = async (item: PonudaChangeHistory) => {
    if (disabled || restoring || !item.can_restore) return;
    const confirmText = [
      'Vratiti prethodne podatke i stavke ponude?',
      `Sada: ${offerDescription(item.after_ponuda, item.after_stavke)}`,
      `Vratiti na: ${offerDescription(item.before_ponuda, item.before_stavke)}`,
      'Promjene kataloga stavki i gradilište nastalo iz ponude neće se mijenjati.',
      'Nespremljene izmjene obrasca bit će odbačene.',
    ].join('\n');
    if (!window.confirm(confirmText)) return;
    const isCurrent = restoreScope.start();
    if (!isCurrent()) return;
    setRestoring(item.id);
    setError(null);
    setNotice(null);
    try {
      await restorePonudaChange(item.id);
      if (!isCurrent()) return;
      setNotice('Izmjena ponude i stavki je vraćena.');
      await load();
      if (!isCurrent()) return;
      try {
        await onRestore();
      } catch (reason) {
        if (isCurrent()) setError(`Promjena je vraćena, ali prikaz nije osvježen: ${errorText(reason)}`);
      }
    } catch (reason) {
      if (isCurrent()) setError(errorText(reason));
    } finally {
      if (isCurrent()) setRestoring(null);
    }
  };

  if (!canAccess('ponude', 'edit')) return null;
  return <>
    <HistoryButton onClick={() => setOpen(true)} ariaLabel="Povijest izmjena ponude i stavki (30 dana)" />
    <HistoryDialog open={open} onClose={() => setOpen(false)} title="Povijest izmjena ponude i stavki (30 dana)">
      <p className="text-xs text-slate-500">Spremanje zaglavlja i stavki bilježi se zajedno. Vraćanje je moguće samo ako ponuda i stavke nisu naknadno mijenjane. Gradilište nastalo iz ponude i katalog stavki ne mijenjaju se.</p>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{notice}</p>}
      <button type="button" disabled={loading || restoring !== null} onClick={() => void load()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50">Osvježi</button>
      {loading && <p role="status" className="text-sm text-slate-500">Učitavanje…</p>}
      {!loading && !error && items.length === 0 && <p className="text-sm text-slate-500">Nema evidentiranih izmjena u zadnjih 30 dana.</p>}
      {items.map((item) => {
        const changedFields = Object.keys(fieldLabels).filter((field) =>
          JSON.stringify(item.before_ponuda[field]) !== JSON.stringify(item.after_ponuda[field]));
        const linesChanged = JSON.stringify(item.before_stavke) !== JSON.stringify(item.after_stavke);
        return <article key={item.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
          <p className="text-xs text-slate-500">{formatHrDateTime(new Date(item.created_at))} · {item.actor_name}</p>
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <p><span className="font-medium text-slate-700">Prije:</span> {offerDescription(item.before_ponuda, item.before_stavke)}</p>
            <p><span className="font-medium text-slate-700">Poslije:</span> {offerDescription(item.after_ponuda, item.after_stavke)}</p>
          </div>
          {changedFields.length > 0 && <ul className="text-xs text-slate-600">
            {changedFields.map((field) => <li key={field}>{fieldLabels[field]}: {displayValue(item.after_ponuda[field])} → {displayValue(item.before_ponuda[field])}</li>)}
          </ul>}
          {linesChanged && <p className="text-xs text-slate-600">Stavke ponude: {item.after_stavke.length} → {item.before_stavke.length} (vratit će se izvorni opisi, količine, cijene, rabati i redoslijed).</p>}
          {item.reversed_at ? <p className="text-xs text-emerald-700">Vraćeno {formatHrDateTime(new Date(item.reversed_at))}</p> : <>
            <p className="text-xs text-slate-500">Moguće vratiti do {formatHrDateTime(new Date(item.expires_at))}.</p>
            {!item.can_restore && <p className="text-xs text-amber-800">{item.blocked_reason ?? 'Ponuda ili stavke imaju noviju promjenu.'}</p>}
            <button type="button" disabled={disabled || !item.can_restore || loading || restoring !== null}
              onClick={() => void restore(item)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-sky-700 disabled:opacity-50">
              <RotateCcw className="h-3.5 w-3.5" /> Vrati ponudu i stavke
            </button>
          </>}
        </article>;
      })}
      {hasMore && <button type="button" disabled={loading || restoring !== null}
        onClick={() => void load(items[items.length - 1].sequence)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Starije promjene</button>}
    </HistoryDialog>
  </>;
}
