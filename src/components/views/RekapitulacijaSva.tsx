import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, TrendingDown, Building2 } from 'lucide-react';
import type { Gradiliste, Trosak, RadnoVrijeme, Faktura, UgovoreniRad, TrosakKategorija } from '@/types';
import { fetchFullRekapitulacija, iznosFakture } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { ExportMenu } from '@/components/ui/ExportMenu';

const eur = (v: number) => v.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

const kategorijaLabel: Record<TrosakKategorija, string> = {
  materijal: 'Materijal', gorivo: 'Gorivo', put: 'Put', smjestaj: 'Smještaj', kooperanti: 'Kooperanti',
  place: 'Plaće', oprema: 'Oprema', direktni: 'Direktni trošak', ostalo: 'Ostalo',
};

const kategorijaColor: Record<TrosakKategorija, string> = {
  materijal: '#0ea5e9', gorivo: '#f59e0b', put: '#818cf8', smjestaj: '#fb923c', kooperanti: '#f43f5e',
  place: '#10b981', oprema: '#94a3b8', direktni: '#eab308', ostalo: '#f87171',
};

const statusBadge: Record<string, { variant: 'blue' | 'green' | 'red' | 'yellow'; label: string }> = {
  ponuda: { variant: 'yellow', label: 'Ponuda' },
  planirano: { variant: 'blue', label: 'Planirano' },
  aktivno: { variant: 'green', label: 'Aktivno' },
  pauzirano: { variant: 'yellow', label: 'Pauzirano' },
  zavrseno: { variant: 'blue', label: 'Završeno' },
};

interface Red {
  g: Gradiliste;
  direktni: number;
  rad: number;
  troskovi: number;
  fakture: number;
  placeno: number;
  ugovoreno: number;
  sati: number;
  radnoVrijeme: RadnoVrijeme[];
  kategorije: Partial<Record<TrosakKategorija, number>>;
}

type SortKey = 'naziv' | 'troskovi' | 'fakture' | 'ugovoreno';

export function RekapitulacijaSva({
  gradilista,
  onOpen,
  satnica,
  nettoPoRadnicima,
}: {
  gradilista: Gradiliste[];
  onOpen: (id: string) => void;
  satnica: number;
  nettoPoRadnicima: boolean;
}) {
  const [rows, setRows] = useState<Red[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('troskovi');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const all = await Promise.all(gradilista.map(async (g): Promise<Red> => {
          const d = await fetchFullRekapitulacija(g.id);
          const troskovi = d.troskovi as Trosak[];
          const rv = d.radnoVrijeme as RadnoVrijeme[];
          const fakture = d.fakture as Faktura[];
          const ugovoreni = d.ugovoreniRadovi as UgovoreniRad[];
          const direktni = troskovi.reduce((s, t) => s + t.iznos, 0);
          const kategorije: Partial<Record<TrosakKategorija, number>> = {};
          troskovi.forEach((t) => { kategorije[t.kategorija] = (kategorije[t.kategorija] ?? 0) + t.iznos; });
          return {
            g, direktni, rad: 0, troskovi: direktni,
            fakture: fakture.reduce((s, f) => s + iznosFakture(f), 0),
            placeno: fakture.filter((f) => f.status === 'placena').reduce((s, f) => s + iznosFakture(f), 0),
            ugovoreno: ugovoreni.reduce((s, u) => s + u.ugovoreni_iznos, 0),
            sati: rv.reduce((s, r) => s + r.sati, 0),
            radnoVrijeme: rv,
            kategorije,
          };
        }));
        if (!cancelled) setRows(all);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Greška pri učitavanju');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [gradilista]);

  const visible = useMemo(() => {
    const list = rows.filter((r) => !status || r.g.status === status);
    const dir = sortDir === 'asc' ? 1 : -1;
    return list.map((row) => {
      const rad = row.radnoVrijeme.reduce((sum, item) => {
        const rate = nettoPoRadnicima ? item.radnici?.cijena_sata ?? satnica : satnica;
        return sum + item.sati * rate;
      }, 0);
      return { ...row, rad, troskovi: row.direktni + rad };
    }).sort((a, b) => {
      if (sortKey === 'naziv') return a.g.naziv.localeCompare(b.g.naziv, 'hr') * dir;
      return (a[sortKey] - b[sortKey]) * dir;
    });
  }, [rows, status, sortKey, sortDir, satnica, nettoPoRadnicima]);

  const tot = useMemo(() => visible.reduce((a, r) => ({
    troskovi: a.troskovi + r.troskovi, rad: a.rad + r.rad, direktni: a.direktni + r.direktni,
    fakture: a.fakture + r.fakture, placeno: a.placeno + r.placeno, ugovoreno: a.ugovoreno + r.ugovoreno, sati: a.sati + r.sati,
  }), { troskovi: 0, rad: 0, direktni: 0, fakture: 0, placeno: 0, ugovoreno: 0, sati: 0 }), [visible]);

  const katTot = useMemo(() => {
    const m: Partial<Record<TrosakKategorija, number>> = {};
    visible.forEach((r) => (Object.keys(r.kategorije) as TrosakKategorija[]).forEach((k) => { m[k] = (m[k] ?? 0) + (r.kategorije[k] ?? 0); }));
    if (tot.rad > 0) m.place = (m.place ?? 0) + tot.rad;
    return (Object.entries(m) as [TrosakKategorija, number][]).sort((a, b) => b[1] - a[1]);
  }, [visible, tot.rad]);

  const katSum = katTot.reduce((s, [, v]) => s + v, 0);
  const donut = (() => {
    let acc = 0;
    const parts = katTot.map(([k, v]) => {
      const from = (acc / (katSum || 1)) * 100;
      acc += v;
      return `${kategorijaColor[k]} ${from}% ${(acc / (katSum || 1)) * 100}%`;
    });
    return parts.length ? `conic-gradient(${parts.join(',')})` : '#e2e8f0';
  })();

  const maxBar = Math.max(1, ...visible.map((r) => r.troskovi));

  const toggle = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'naziv' ? 'asc' : 'desc'); }
  };

  const Th = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 ${right ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => toggle(k)} className={`inline-flex items-center gap-1 hover:text-slate-800 ${sortKey === k ? 'text-sky-700' : ''}`}>
        {label}
        {sortKey === k ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );

  if (loading) return <div className="py-16 text-center text-slate-400">Učitavanje svih gradilišta…</div>;

  return (
    <div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="mr-auto" />
        <ExportMenu
          disabled={visible.length === 0}
          build={() => ({
            file: 'Rekapitulacija_gradilista',
            title: 'Rekapitulacija gradilišta',
            subtitle: status ? `Status: ${statusBadge[status].label}` : undefined,
            rows: visible,
            columns: [
              { header: 'Gradilište', get: (r: Red) => r.g.naziv },
              { header: 'Status', get: (r: Red) => statusBadge[r.g.status]?.label ?? r.g.status },
              { header: 'Direktni troškovi', kind: 'eur', get: (r: Red) => r.direktni },
              { header: 'Rad', kind: 'eur', get: (r: Red) => r.rad },
              { header: 'Troškovi', kind: 'eur', get: (r: Red) => r.troskovi },
              { header: 'Ugovoreno', kind: 'eur', get: (r: Red) => r.ugovoreno },
              { header: 'Fakturirano', kind: 'eur', get: (r: Red) => r.fakture },
              { header: 'Plaćeno', kind: 'eur', get: (r: Red) => r.placeno },
            ],
            totals: {
              'Direktni troškovi': tot.direktni, Rad: tot.rad, Troškovi: tot.troskovi,
              Ugovoreno: tot.ugovoreno, Fakturirano: tot.fakture, Plaćeno: tot.placeno,
            },
          })}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {['', 'aktivno', 'planirano', 'ponuda', 'pauzirano', 'zavrseno'].map((s) => (
          <button
            key={s || 'sve'}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${status === s ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
          >
            {s ? statusBadge[s].label : 'Sva'} ({s ? rows.filter((r) => r.g.status === s).length : rows.length})
          </button>
        ))}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2 text-sm text-slate-500"><TrendingDown className="h-4 w-4 text-red-500" /> Ukupni troškovi</div>
          <p className="text-2xl font-bold text-slate-900">{eur(tot.troskovi)}</p>
          <p className="mt-1 text-xs text-slate-400">Direktni {eur(tot.direktni)} · rad {eur(tot.rad)} ({tot.sati.toFixed(0)}h)</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2 text-sm text-slate-500"><Building2 className="h-4 w-4 text-sky-600" /> Ugovoreno</div>
          <p className="text-2xl font-bold text-slate-900">{eur(tot.ugovoreno)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center gap-2 text-sm text-slate-500"><FileText className="h-4 w-4 text-indigo-600" /> Fakture</div>
          <p className="text-2xl font-bold text-slate-900">{eur(tot.fakture)}</p>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="bg-emerald-500" style={{ width: `${tot.fakture ? (tot.placeno / tot.fakture) * 100 : 0}%` }} />
          </div>
          <p className="mt-1 text-xs text-emerald-600">Plaćeno {eur(tot.placeno)} · neplaćeno {eur(tot.fakture - tot.placeno)}</p>
        </div>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Troškovi po gradilištu</h3>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> Troškovi</span>
            </div>
          </div>
          {visible.length === 0 ? <p className="text-sm text-slate-400">Nema gradilišta.</p> : (
            <div className="space-y-3">
              {visible.map((r) => (
                <button key={r.g.id} type="button" onClick={() => onOpen(r.g.id)} className="block w-full text-left">
                  <div className="mb-1 flex justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-slate-700">{r.g.naziv}</span>
                    <span className="shrink-0 text-slate-500">{eur(r.troskovi)}</span>
                  </div>
                  <div className="relative h-4 rounded bg-slate-100">
                    <div className="absolute inset-y-1 left-0 rounded bg-sky-500" style={{ width: `${(r.troskovi / maxBar) * 100}%` }} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-semibold text-slate-900">Troškovi po kategoriji</h3>
          {katSum === 0 ? <p className="text-sm text-slate-400">Nema troškova.</p> : (
            <>
              <div className="relative mx-auto mb-4 h-40 w-40 rounded-full" style={{ background: donut }}>
                <div className="absolute inset-6 flex flex-col items-center justify-center rounded-full bg-white">
                  <span className="text-xs text-slate-400">Ukupno</span>
                  <span className="text-sm font-bold text-slate-900">{eur(katSum)}</span>
                </div>
              </div>
              <ul className="space-y-1.5 text-xs">
                {katTot.map(([k, v]) => (
                  <li key={k} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: kategorijaColor[k] }} />
                    <span className="flex-1 text-slate-600">{kategorijaLabel[k]}</span>
                    <span className="font-semibold text-slate-800">{eur(v)}</span>
                    <span className="w-9 text-right text-slate-400">{Math.round((v / katSum) * 100)}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <Th k="naziv" label="Gradilište" />
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
              <Th k="troskovi" label="Troškovi" right />
              <Th k="ugovoreno" label="Ugovoreno" right />
              <Th k="fakture" label="Fakture" right />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((r) => {
              const sb = statusBadge[r.g.status] ?? statusBadge.planirano;
              return (
                <tr key={r.g.id} onClick={() => onOpen(r.g.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    <span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4 text-slate-400" />{r.g.naziv}</span>
                  </td>
                  <td className="px-4 py-3"><Badge variant={sb.variant}>{sb.label}</Badge></td>
                  <td className="px-4 py-3 text-right text-sm text-slate-700">{eur(r.troskovi)}</td>
                  <td className="px-4 py-3 text-right text-sm text-slate-700">{eur(r.ugovoreno)}</td>
                  <td className="px-4 py-3 text-right text-sm text-slate-700">{eur(r.fakture)}</td>
                </tr>
              );
            })}
            <tr className="bg-slate-50 font-bold">
              <td className="px-4 py-3 text-sm" colSpan={2}>Ukupno</td>
              <td className="px-4 py-3 text-right text-sm">{eur(tot.troskovi)}</td>
              <td className="px-4 py-3 text-right text-sm">{eur(tot.ugovoreno)}</td>
              <td className="px-4 py-3 text-right text-sm">{eur(tot.fakture)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
