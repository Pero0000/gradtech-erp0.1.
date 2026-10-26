import { useEffect, useMemo, useState } from 'react';
import { Bell, BellRing, CheckCircle2, Search } from 'lucide-react';
import type { View } from '@/components/Sidebar';
import { loadObavijesti, relativeLabel, sendPushNotifications, type Obavijest, type ObavijestLevel } from '@/lib/obavijesti';
import { loadPostavke, obavijestTipovi, savePostavke } from '@/lib/postavke';

const levelStyle: Record<ObavijestLevel, { row: string; badge: string; label: string }> = {
  overdue: { row: 'border-red-600', badge: 'bg-red-600 text-white', label: 'Kasni' },
  today: { row: 'border-red-300', badge: 'bg-red-200 text-red-900', label: 'Danas' },
  soon: { row: 'border-red-100', badge: 'bg-red-50 text-red-700', label: 'Uskoro' },
  upcoming: { row: 'border-slate-200', badge: 'bg-slate-100 text-slate-600', label: 'Nadolazeće' },
};

export function ObavijestiView({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [items, setItems] = useState<Obavijest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grupa, setGrupa] = useState('');
  const [tip, setTip] = useState('');
  const [level, setLevel] = useState('');
  const [query, setQuery] = useState('');
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  useEffect(() => {
    loadObavijesti(loadPostavke())
      .then(setItems)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Greška pri učitavanju obavijesti.'))
      .finally(() => setLoading(false));
  }, []);

  const enablePush = async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      savePostavke({ ...loadPostavke(), push: true });
      sendPushNotifications(items);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((o) => (!grupa || o.grupa === grupa) && (!tip || o.tip === tip) && (!level || o.level === level)
      && (!q || `${o.title} ${o.detail} ${o.tipLabel}`.toLowerCase().includes(q)));
  }, [items, grupa, tip, level, query]);

  const countOf = (l: ObavijestLevel) => items.filter((o) => o.level === l).length;
  const grupe = [...new Set(obavijestTipovi.map((t) => t.grupa))];

  return (
    <div className="min-w-0 max-w-full break-words">
      <div className="mb-6 flex min-w-0 flex-col items-stretch justify-between gap-3 xl:flex-row xl:flex-wrap xl:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Obavijesti</h1>
          <p className="mt-1 text-sm text-slate-500">Svi rokovi na jednom mjestu · što se prikazuje i koliko unaprijed, postavlja se u Postavkama</p>
        </div>
        {permission === 'granted' ? (
          <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700"><BellRing className="h-4 w-4" /> Push obavijesti uključene</span>
        ) : permission === 'denied' ? (
          <span className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Push je blokiran u pregledniku – dopusti ga u postavkama stranice.</span>
        ) : permission === 'unsupported' ? (
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">Preglednik ne podržava push obavijesti.</span>
        ) : (
          <button type="button" onClick={() => void enablePush()} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-700">
            <BellRing className="h-4 w-4" /> Uključi push obavijesti
          </button>
        )}
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mb-4 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-4">
        {(['overdue', 'today', 'soon', 'upcoming'] as ObavijestLevel[]).map((l) => (
          <button key={l} type="button" onClick={() => setLevel(level === l ? '' : l)} className={`rounded-xl border-2 bg-white p-3 text-left ${level === l ? 'ring-2 ring-sky-400' : ''} ${levelStyle[l].row}`}>
            <p className="text-2xl font-bold text-slate-900">{countOf(l)}</p>
            <p className="text-xs font-medium text-slate-500">{levelStyle[l].label}</p>
          </button>
        ))}
      </div>

      <div className="mb-4 flex min-w-0 flex-col gap-3 xl:flex-row xl:flex-wrap">
        <div className="relative min-w-0 xl:min-w-[220px] xl:flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pretraži…" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" />
        </div>
        <select value={grupa} onChange={(event) => { setGrupa(event.target.value); setTip(''); }} className="min-w-0 max-w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Sve grupe</option>
          {grupe.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={tip} onChange={(event) => setTip(event.target.value)} className="min-w-0 max-w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Sve vrste</option>
          {obavijestTipovi.filter((t) => !grupa || t.grupa === grupa).map((t) => <option key={t.tip} value={t.tip}>{t.label}</option>)}
        </select>
        <select value={level} onChange={(event) => setLevel(event.target.value)} className="min-w-0 max-w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Sva hitnost</option>
          {(['overdue', 'today', 'soon', 'upcoming'] as ObavijestLevel[]).map((l) => <option key={l} value={l}>{levelStyle[l].label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="py-20 text-center text-slate-400">Učitavanje…</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white py-16 text-slate-500">
          {items.length === 0 ? <CheckCircle2 className="h-8 w-8 text-emerald-500" /> : <Bell className="h-8 w-8" />}
          <p>{items.length === 0 ? 'Nema aktivnih obavijesti.' : 'Nema obavijesti za odabrane filtere.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => (
            <button key={o.id} type="button" onClick={() => onNavigate(o.view)} className={`flex min-w-0 w-full flex-col items-start gap-3 rounded-xl border-l-4 border bg-white p-3 text-left shadow-sm hover:bg-slate-50 xl:flex-row xl:items-center xl:gap-4 ${levelStyle[o.level].row}`}>
              <span className={`w-24 shrink-0 rounded-full px-2 py-1 text-center text-xs font-semibold ${levelStyle[o.level].badge}`}>
                {o.days === null ? levelStyle[o.level].label : relativeLabel(o.days)}
              </span>
              <div className="min-w-0 w-full xl:flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{o.title}</p>
                <p className="truncate text-xs text-slate-500">{o.tipLabel} · {o.detail}</p>
              </div>
              {o.datum && <span className="text-xs text-slate-500">{new Date(`${o.datum}T00:00:00`).toLocaleDateString('hr-HR')}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
