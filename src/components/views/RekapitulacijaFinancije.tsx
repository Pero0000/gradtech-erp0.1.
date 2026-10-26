import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw } from 'lucide-react';
import { fetchFinancijskaRekapitulacija, type FinancijskaRekapitulacija } from '@/lib/api';
import {
  financijskiFilterError, izracunajFinancijskeRedove, prazniFinancijskiFilteri,
  type FinancijskiFilteri, type FinancijskiRed, type FinancijskiSort,
} from '@/lib/financijskaRekapitulacija';
import type { Gradiliste, GradilisteRegija, GradilisteStatus, TrosakKategorija } from '@/types';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { ExportMenu } from '@/components/ui/ExportMenu';

const eur = (value: number) => value.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const num = (value: number) => value.toLocaleString('hr-HR', { maximumFractionDigits: 2 });
const statusLabels: Record<GradilisteStatus, string> = {
  ponuda: 'Ponuda', planirano: 'Planirano', aktivno: 'Aktivno', pauzirano: 'Pauzirano', zavrseno: 'Završeno',
};
const regijaLabels: Record<GradilisteRegija, string> = {
  dalmacija: 'Dalmacija', istra_kvarner: 'Istra i Kvarner', slavonija: 'Slavonija',
  zagreb_i_okolica: 'Zagreb i okolica', medimurje: 'Međimurje',
};
const kategorijaLabels: Record<TrosakKategorija, string> = {
  materijal: 'Materijal', gorivo: 'Gorivo', put: 'Put', smjestaj: 'Smještaj', kooperanti: 'Kooperanti',
  place: 'Plaće i rad', oprema: 'Oprema / strojevi', direktni: 'Direktni trošak', ostalo: 'Ostalo',
};
const columns: { key: FinancijskiSort; label: string }[] = [
  { key: 'naziv', label: 'Gradilište' }, { key: 'trosak', label: 'Stvarni trošak' },
  { key: 'prihod', label: 'Stvarni prihod (fakture)' }, { key: 'placeno', label: 'Plaćeno' },
  { key: 'neplaceno', label: 'Nenaplaćeno' }, { key: 'saldo', label: 'Razlika' },
  { key: 'marza', label: 'Marža (%)' }, { key: 'sati', label: 'Radni sati' },
];

export function RekapitulacijaFinancije({ gradilista, satnica, nettoPoRadnicima, onOpen }: {
  gradilista: Gradiliste[];
  satnica: number;
  nettoPoRadnicima: boolean;
  onOpen: (id: string) => void;
}) {
  const [data, setData] = useState<FinancijskaRekapitulacija | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [filters, setFilters] = useState<FinancijskiFilteri>(prazniFinancijskiFilteri);
  const [sort, setSort] = useState<FinancijskiSort>('naziv');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const filterError = financijskiFilterError(filters);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    void fetchFinancijskaRekapitulacija().then((result) => {
      if (!cancelled) setData(result);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(
        reason && typeof reason === 'object' && 'message' in reason
          ? String(reason.message) : 'Greška pri učitavanju financijske rekapitulacije.',
      );
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [refresh]);

  const update = <K extends keyof FinancijskiFilteri>(key: K, value: FinancijskiFilteri[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const options = useMemo(() => {
    const objekti = new Map<string, string>();
    const investitori = new Map<string, string>();
    const voditelji = new Set<string>();
    for (const g of gradilista) {
      if (g.objekt_id) objekti.set(g.objekt_id, g.objekti?.naziv ?? g.objekt_id);
      if (g.objekti?.investitor_id) investitori.set(g.objekti.investitor_id, g.objekti.investitori?.naziv ?? g.objekti.investitor_id);
      if (g.voditelj_gradilista) voditelji.add(g.voditelj_gradilista);
    }
    const byName = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1], 'hr');
    return { objekti: [...objekti].sort(byName), investitori: [...investitori].sort(byName), voditelji: [...voditelji].sort((a, b) => a.localeCompare(b, 'hr')) };
  }, [gradilista]);

  const rows = useMemo(() => {
    if (!data || filterError) return [];
    const result = izracunajFinancijskeRedove(gradilista, data, filters, satnica, nettoPoRadnicima);
    const dir = direction === 'asc' ? 1 : -1;
    return result.sort((a, b) => {
      if (sort === 'naziv') return a.gradiliste.naziv.localeCompare(b.gradiliste.naziv, 'hr') * dir;
      const first = a[sort];
      const second = b[sort];
      if (first === null) return second === null ? 0 : 1;
      if (second === null) return -1;
      return (first - second) * dir || a.gradiliste.naziv.localeCompare(b.gradiliste.naziv, 'hr');
    });
  }, [data, filterError, gradilista, filters, satnica, nettoPoRadnicima, sort, direction]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({
    trosak: sum.trosak + row.trosak, prihod: sum.prihod + row.prihod, placeno: sum.placeno + row.placeno,
    neplaceno: sum.neplaceno + row.neplaceno, saldo: sum.saldo + row.saldo, sati: sum.sati + row.sati,
    brojFaktura: sum.brojFaktura + row.brojFaktura,
  }), { trosak: 0, prihod: 0, placeno: 0, neplaceno: 0, saldo: 0, sati: 0, brojFaktura: 0 }), [rows]);
  const marza = totals.prihod !== 0 ? totals.saldo / totals.prihod * 100 : null;
  const ready = !loading && !error && !filterError && data !== null;
  const filterSummary = [
    `Razdoblje: ${filters.od || 'od početka'} – ${filters.do || 'bez završnog ograničenja'}`,
    `Obračun rada: ${nettoPoRadnicima ? 'netto po radnicima' : `${num(satnica)} €/h`}`,
    filters.search && `Pretraga: ${filters.search}`,
    filters.gradilista.length > 0 && `Gradilišta: ${gradilista.filter((g) => filters.gradilista.includes(g.id)).map((g) => g.naziv).join(', ')}`,
    filters.status && `Status: ${statusLabels[filters.status]}`,
    filters.regija && `Regija: ${Object.entries(regijaLabels).find(([key]) => key === filters.regija)?.[1] ?? 'Bez regije'}`,
    filters.investitor && `Investitor: ${options.investitori.find(([id]) => id === filters.investitor)?.[1] ?? 'Bez investitora'}`,
    filters.objekt && `Objekt: ${options.objekti.find(([id]) => id === filters.objekt)?.[1] ?? 'Bez objekta'}`,
    filters.voditelj && `Voditelj: ${filters.voditelj === 'bez' ? 'Bez voditelja' : filters.voditelj}`,
    filters.kategorija && `Kategorija troška: ${kategorijaLabels[filters.kategorija]}`,
    filters.fakturaStatus && `Fakture: ${filters.fakturaStatus === 'placena' ? 'Plaćene' : filters.fakturaStatus === 'izdana' ? 'Izdane (još nisu označene plaćenima)' : 'Neplaćene'}`,
    filters.rezultat && `Rezultat: ${filters.rezultat === 'plus' ? 'Pozitivan' : filters.rezultat === 'minus' ? 'Negativan' : 'Nula'}`,
    filters.aktivnost && `Aktivnost: ${filters.aktivnost === 's_podacima' ? 'S evidencijom' : 'Bez evidencije'}`,
    ...([
      ['Trošak', filters.trosakMin, filters.trosakMax],
      ['Prihod', filters.prihodMin, filters.prihodMax],
      ['Razlika', filters.saldoMin, filters.saldoMax],
    ]).filter(([, min, max]) => min !== '' || max !== '').map(([label, min, max]) => `${label}: ${min || 'bez minimuma'} – ${max || 'bez maksimuma'} €`),
  ].filter(Boolean).join(' · ');

  const toggleSort = (key: FinancijskiSort) => {
    if (sort === key) setDirection((value) => value === 'asc' ? 'desc' : 'asc');
    else { setSort(key); setDirection(key === 'naziv' ? 'asc' : 'desc'); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <p><strong>Stvarni prihod</strong> je zbroj izdanih faktura (svih statusa, uključujući plaćene), prema postojećem obračunu iznosa i rabata. Nije isto što i naplata.</p>
        <p className="mt-1"><strong>Stvarni trošak</strong> uključuje evidentirane troškove i rad prema satnici odabranoj iznad. Razlika = prihod − trošak; marža = razlika / prihod. Nisu uključeni planirani troškovi ni nefakturirani ugovoreni radovi.</p>
      </div>

      <div className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-4">
          <Field label="Pretraga"><TextInput placeholder="Naziv, adresa, objekt, investitor…" value={filters.search} onChange={(e) => update('search', e.target.value)} /></Field>
          <Field label="Status gradilišta"><Select value={filters.status} onChange={(e) => {
            const value = e.target.value;
            if (value === '' || value in statusLabels) update('status', value as GradilisteStatus | '');
          }}><option value="">Svi statusi</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
          <Field label="Evidencija od"><TextInput type="date" value={filters.od} onChange={(e) => update('od', e.target.value)} /></Field>
          <Field label="Evidencija do"><TextInput type="date" value={filters.do} onChange={(e) => update('do', e.target.value)} /></Field>
        </div>
        <p className="text-xs text-slate-500">Razdoblje filtrira datum troška, datum rada i datum izdavanja fakture (uključujući oba granična datuma), a ne datum početka gradilišta. Prazni datumi znače sva razdoblja.</p>
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-sky-700">Dodatni filtri: gradilišta, lokacija, investitor, troškovi, fakture i iznosi</summary>
          <div className="mt-3 grid gap-3 xl:grid-cols-2 2xl:grid-cols-4">
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Gradilišta (moguć višestruki odabir)</span>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-300 p-2">
                {gradilista.map((g) => <label key={g.id} className="flex min-w-0 items-center gap-2 break-words text-sm">
                  <input type="checkbox" checked={filters.gradilista.includes(g.id)} onChange={(e) => update('gradilista', e.target.checked ? [...filters.gradilista, g.id] : filters.gradilista.filter((id) => id !== g.id))} />
                  {g.naziv}
                </label>)}
              </div>
              <span className="text-xs text-slate-500">Bez odabira = sva gradilišta.</span>
            </div>
            <Field label="Regija"><Select value={filters.regija} onChange={(e) => update('regija', e.target.value)}><option value="">Sve regije</option>{Object.entries(regijaLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="bez">Bez regije</option></Select></Field>
            <Field label="Investitor (prema objektu)"><Select value={filters.investitor} onChange={(e) => update('investitor', e.target.value)}><option value="">Svi investitori</option>{options.investitori.map(([id, naziv]) => <option key={id} value={id}>{naziv}</option>)}<option value="bez">Bez investitora</option></Select></Field>
            <Field label="Objekt"><Select value={filters.objekt} onChange={(e) => update('objekt', e.target.value)}><option value="">Svi objekti</option>{options.objekti.map(([id, naziv]) => <option key={id} value={id}>{naziv}</option>)}<option value="bez">Bez objekta</option></Select></Field>
            <Field label="Voditelj gradilišta"><Select value={filters.voditelj} onChange={(e) => update('voditelj', e.target.value)}><option value="">Svi voditelji</option>{options.voditelji.map((naziv) => <option key={naziv} value={naziv}>{naziv}</option>)}<option value="bez">Bez voditelja</option></Select></Field>
            <Field label="Kategorija troška"><Select value={filters.kategorija} onChange={(e) => {
              const value = e.target.value;
              if (value === '' || value in kategorijaLabels) update('kategorija', value as TrosakKategorija | '');
            }}><option value="">Svi troškovi i rad</option>{Object.entries(kategorijaLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
            <Field label="Status fakture"><Select value={filters.fakturaStatus} onChange={(e) => {
              const value = e.target.value;
              if (value === '' || value === 'izdana' || value === 'placena' || value === 'nep placena') update('fakturaStatus', value);
            }}><option value="">Sve izdane fakture</option><option value="izdana">Izdana (status)</option><option value="placena">Plaćena</option><option value="nep placena">Neplaćena</option></Select></Field>
            <Field label="Financijski rezultat"><Select value={filters.rezultat} onChange={(e) => {
              const value = e.target.value;
              if (value === '' || value === 'plus' || value === 'minus' || value === 'nula') update('rezultat', value);
            }}><option value="">Svi rezultati</option><option value="plus">Pozitivna razlika</option><option value="minus">Negativna razlika</option><option value="nula">Razlika nula</option></Select></Field>
            <Field label="Aktivnost u odabranom razdoblju"><Select value={filters.aktivnost} onChange={(e) => {
              const value = e.target.value;
              if (value === '' || value === 's_podacima' || value === 'bez_podataka') update('aktivnost', value);
            }}><option value="">Sva gradilišta</option><option value="s_podacima">S evidencijom</option><option value="bez_podataka">Bez evidencije</option></Select></Field>
            {([
              ['trosakMin', 'Trošak od (€)'], ['trosakMax', 'Trošak do (€)'],
              ['prihodMin', 'Prihod od (€)'], ['prihodMax', 'Prihod do (€)'],
              ['saldoMin', 'Razlika od (€)'], ['saldoMax', 'Razlika do (€)'],
            ] as const).map(([key, label]) => <Field key={key} label={label}><TextInput type="number" step="0.01" value={filters[key]} onChange={(e) => update(key, e.target.value)} /></Field>)}
          </div>
          <p className="mt-3 text-xs text-amber-800">Kategorija troška filtrira samo troškove, a status fakture samo prihode. Razlika i marža tada se odnose na odabrani dio evidencije, ne na cijelo gradilište.</p>
        </details>
        <div className="flex flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center">
          <button type="button" onClick={() => setFilters(prazniFinancijskiFilteri)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Poništi sve filtre</button>
          <button type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"><RefreshCw className="h-4 w-4" /> Osvježi iznose</button>
          <div className="xl:ml-auto">
            <ExportMenu disabled={!ready || rows.length === 0} build={() => ({
              file: 'Stvarni_troskovi_i_prihodi', title: 'Stvarni troškovi i prihodi gradilišta',
              subtitle: filterSummary, rows,
              columns: [
                { header: 'Gradilište', get: (r: FinancijskiRed) => r.gradiliste.naziv },
                { header: 'Status', get: (r: FinancijskiRed) => statusLabels[r.gradiliste.status] },
                { header: 'Evidentirani troškovi', kind: 'eur', get: (r: FinancijskiRed) => r.direktni },
                { header: 'Rad', kind: 'eur', get: (r: FinancijskiRed) => r.rad },
                { header: 'Stvarni trošak', kind: 'eur', get: (r: FinancijskiRed) => r.trosak },
                { header: 'Stvarni prihod', kind: 'eur', get: (r: FinancijskiRed) => r.prihod },
                { header: 'Plaćeno', kind: 'eur', get: (r: FinancijskiRed) => r.placeno },
                { header: 'Nenaplaćeno', kind: 'eur', get: (r: FinancijskiRed) => r.neplaceno },
                { header: 'Razlika', kind: 'eur', get: (r: FinancijskiRed) => r.saldo },
                { header: 'Marža (%)', kind: 'num', get: (r: FinancijskiRed) => r.marza },
                { header: 'Radni sati', kind: 'num', get: (r: FinancijskiRed) => r.sati },
                { header: 'Broj faktura', kind: 'num', get: (r: FinancijskiRed) => r.brojFaktura },
              ],
              totals: {
                'Stvarni trošak': totals.trosak, 'Stvarni prihod': totals.prihod, Plaćeno: totals.placeno,
                Nenaplaćeno: totals.neplaceno, Razlika: totals.saldo, 'Radni sati': totals.sati, 'Broj faktura': totals.brojFaktura,
              },
            })} />
          </div>
        </div>
      </div>
      {filterError && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{filterError}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="py-10 text-center text-slate-500">Učitavanje troškova, radnih sati i faktura…</p>}
      {ready && <>
        <p className="text-xs text-slate-500">{filterSummary}</p>
        <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-4">
          {[
            ['Stvarni trošak', totals.trosak], ['Stvarni prihod (izdane fakture)', totals.prihod],
            ['Razlika prihoda i troška', totals.saldo], ['Nenaplaćene fakture', totals.neplaceno],
          ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">{label}</p><p className="mt-1 break-words text-xl font-bold text-slate-900">{eur(Number(value))}</p>
          </div>)}
        </div>
        <p className="text-sm text-slate-600">Prikazano {rows.length} od {gradilista.length} gradilišta · {totals.brojFaktura} faktura · {num(totals.sati)} h. Svi zbrojevi odnose se samo na filtrirani prikaz.</p>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr>{columns.map(({ key, label }) => <th key={key} scope="col" aria-sort={sort === key ? direction === 'asc' ? 'ascending' : 'descending' : 'none'} className={`whitespace-nowrap px-4 py-3 ${key === 'naziv' ? 'text-left' : 'text-right'}`}>
              <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">{label}{sort === key ? direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3" />}</button>
            </th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && <tr><td colSpan={columns.length} className="p-8 text-center text-slate-500">Nema gradilišta koja odgovaraju odabranim filtrima.</td></tr>}
              {rows.map((row) => <tr key={row.gradiliste.id} className="hover:bg-slate-50">
                <td className="min-w-[12rem] px-4 py-3"><button type="button" onClick={() => onOpen(row.gradiliste.id)} className="text-left font-semibold text-sky-700 hover:underline">{row.gradiliste.naziv}</button><p className="text-xs text-slate-500">{statusLabels[row.gradiliste.status]}{row.gradiliste.objekti?.naziv ? ` · ${row.gradiliste.objekti.naziv}` : ''}</p></td>
                <td className="whitespace-nowrap px-4 py-3 text-right"><p>{eur(row.trosak)}</p><p className="text-xs text-slate-500">Evidencija {eur(row.direktni)} · rad {eur(row.rad)}</p></td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{eur(row.prihod)}<p className="text-xs text-slate-500">{row.brojFaktura} faktura</p></td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{eur(row.placeno)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{eur(row.neplaceno)}</td>
                <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold ${row.saldo < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{eur(row.saldo)}</td>
                <td className="px-4 py-3 text-right">{row.marza === null ? '—' : `${num(row.marza)} %`}</td>
                <td className="px-4 py-3 text-right">{num(row.sati)}</td>
              </tr>)}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 bg-slate-100 font-bold"><tr>
              <th scope="row" className="px-4 py-3 text-left">Ukupno ({rows.length})</th>
              {[totals.trosak, totals.prihod, totals.placeno, totals.neplaceno, totals.saldo].map((value, index) => <td key={index} className="whitespace-nowrap px-4 py-3 text-right">{eur(value)}</td>)}
              <td className="px-4 py-3 text-right">{marza === null ? '—' : `${num(marza)} %`}</td>
              <td className="px-4 py-3 text-right">{num(totals.sati)}</td>
            </tr></tfoot>
          </table>
        </div>
      </>}
    </div>
  );
}
