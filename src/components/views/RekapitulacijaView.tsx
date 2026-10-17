import { useState, useEffect } from 'react';
import {
  FileBarChart,
  Building2,
  Euro,
  Clock,
  ClipboardList,
  TrendingDown,
  Calendar,
  FileText,
  ClipboardCheck,
  Users,
} from 'lucide-react';
import type { Gradiliste, Trosak, RadnoVrijeme, TrosakKategorija, Rok, Faktura, UgovoreniRad } from '@/types';
import { fetchGradilista, fetchFullRekapitulacija, iznosFakture } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { RekapitulacijaSva } from './RekapitulacijaSva';

const kategorijaLabel: Record<TrosakKategorija, string> = {
  materijal: 'Materijal',
  gorivo: 'Gorivo',
  put: 'Put',
  smjestaj: 'Smještaj',
  kooperanti: 'Kooperanti',
  place: 'Plaće',
  oprema: 'Oprema',
  direktni: 'Direktni trošak',
  ostalo: 'Ostalo',
};

const nalogStatusBadge: Record<string, { variant: 'blue' | 'yellow' | 'green' | 'red'; label: string }> = {
  otvoren: { variant: 'blue', label: 'Otvoren' },
  u_tijeku: { variant: 'yellow', label: 'U tijeku' },
  zavrsen: { variant: 'green', label: 'Završen' },
  otkazan: { variant: 'red', label: 'Otkazan' },
};

const rokStatusBadge: Record<string, { variant: 'blue' | 'green' | 'red'; label: string }> = {
  otvoren: { variant: 'blue', label: 'Otvoren' },
  zavrsen: { variant: 'green', label: 'Završen' },
  prekoracen: { variant: 'red', label: 'Prekoračen' },
};

const fakturaStatusBadge: Record<string, { variant: 'blue' | 'green' | 'red'; label: string }> = {
  izdana: { variant: 'blue', label: 'Izdana' },
  placena: { variant: 'green', label: 'Plaćena' },
  'nep placena': { variant: 'red', label: 'Neplaćena' },
};

function daysUntil(d: string): number {
  const target = new Date(d + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function RekapitulacijaView() {
  const [satnica, setSatnica] = useState(() => {
    const saved = Number(localStorage.getItem('tm_univerzalna_satnica'));
    return saved > 0 ? saved : 18;
  });
  const [nettoPoRadnicima, setNettoPoRadnicima] = useState(() => localStorage.getItem('tm_netto_po_radnicima') === '1');
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [troskovi, setTroskovi] = useState<Trosak[]>([]);
  const [radnoVrijeme, setRadnoVrijeme] = useState<RadnoVrijeme[]>([]);
  const [nalozi, setNalozi] = useState<any[]>([]);
  const [rokovi, setRokovi] = useState<Rok[]>([]);
  const [fakture, setFakture] = useState<Faktura[]>([]);
  const [ugovoreniRadovi, setUgovoreniRadovi] = useState<UgovoreniRad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const g = await fetchGradilista();
        setGradilista(g);
        if (g.length > 0 && !selectedId) {
          setSelectedId('all');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Greška pri učitavanju');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId || selectedId === 'all') return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchFullRekapitulacija(selectedId);
        setTroskovi(data.troskovi as Trosak[]);
        setRadnoVrijeme(data.radnoVrijeme as RadnoVrijeme[]);
        setNalozi(data.nalozi);
        setRokovi(data.rokovi as Rok[]);
        setFakture(data.fakture as Faktura[]);
        setUgovoreniRadovi(data.ugovoreniRadovi as UgovoreniRad[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Greška pri učitavanju');
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedId]);

  const selectedGradiliste = gradilista.find((g) => g.id === selectedId);

  // Financial calculations
  const direktniTroskovi = troskovi.reduce((sum, t) => sum + t.iznos, 0);
  const trosakRada = radnoVrijeme.reduce((sum, rv) => {
    const cijena = nettoPoRadnicima ? rv.radnici?.cijena_sata ?? satnica : satnica;
    return sum + rv.sati * cijena;
  }, 0);
  const ukupniTroskovi = direktniTroskovi + trosakRada;
  const ukupnoSati = radnoVrijeme.reduce((sum, rv) => sum + rv.sati, 0);

  const troskoviPoKategoriji = troskovi.reduce<Record<string, number>>((acc, t) => {
    acc[t.kategorija] = (acc[t.kategorija] ?? 0) + t.iznos;
    return acc;
  }, {});

  const satiPoRadniku = radnoVrijeme.reduce<Record<string, { ime: string; sati: number; trosak: number; satnica: number }>>((acc, rv) => {
    const key = rv.radnik_id;
    const ime = rv.radnici ? `${rv.radnici.ime} ${rv.radnici.prezime}` : 'Nepoznato';
    const cijena = nettoPoRadnicima ? rv.radnici?.cijena_sata ?? satnica : satnica;
    if (!acc[key]) acc[key] = { ime, sati: 0, trosak: 0, satnica: cijena };
    acc[key].sati += rv.sati;
    acc[key].trosak += rv.sati * cijena;
    return acc;
  }, {});
  const setUniversalRate = (value: number) => {
    const next = Math.max(0, value);
    setSatnica(next);
    localStorage.setItem('tm_univerzalna_satnica', String(next));
  };
  const setNettoMode = (value: boolean) => {
    setNettoPoRadnicima(value);
    localStorage.setItem('tm_netto_po_radnicima', value ? '1' : '0');
  };

  const ukupnoFakture = fakture.reduce((sum, f) => sum + iznosFakture(f), 0);
  const placenoFakture = fakture.filter((f) => f.status === 'placena').reduce((sum, f) => sum + iznosFakture(f), 0);
  const ugovorenoUkupno = ugovoreniRadovi.reduce((sum, u) => sum + u.ugovoreni_iznos, 0);
  const ostvarenoUkupno = ugovoreniRadovi.reduce((sum, u) => sum + (u.ostvareni_iznos ?? 0), 0);

  if (loading && gradilista.length === 0) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Rekapitulacija gradilišta</h1>
        <p className="text-sm text-slate-500 mt-1">Potpuni pregled financija, rokova i radova po gradilištu</p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {gradilista.length === 0 ? (
        <EmptyState
          icon={<FileBarChart className="h-7 w-7" />}
          title="Nema gradilišta"
          description="Dodajte gradilišta da biste vidjeli rekapitulaciju."
        />
      ) : (
        <>
          <div className="mb-6 w-80">
            <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="all">Sva gradilišta (pregled)</option>
              {gradilista.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.naziv}
                </option>
              ))}
            </Select>
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            <label className="inline-flex items-center gap-2">
              Univerzalna satnica
              <input
                type="number"
                min={0}
                step="0.5"
                value={satnica}
                onChange={(event) => setUniversalRate(Number(event.target.value))}
                className="w-20 rounded border border-slate-300 px-2 py-1"
              />
              €/h
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={nettoPoRadnicima}
                onChange={(event) => setNettoMode(event.target.checked)}
                className="h-4 w-4 accent-sky-600"
              />
              Netto po radnicima
            </label>
          </div>

          {selectedId === 'all' && (
            <RekapitulacijaSva
              gradilista={gradilista}
              onOpen={setSelectedId}
              satnica={satnica}
              nettoPoRadnicima={nettoPoRadnicima}
            />
          )}

          {selectedId !== 'all' && selectedGradiliste && (
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900">{selectedGradiliste.naziv}</h2>
                  {selectedGradiliste.adresa && (
                    <p className="text-sm text-slate-500">{selectedGradiliste.adresa}</p>
                  )}
                </div>
              </div>
              {selectedGradiliste.opis && (
                <p className="text-sm text-slate-600">{selectedGradiliste.opis}</p>
              )}
            </div>
          )}

          {selectedId !== 'all' && (<>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2 mb-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
                  <TrendingDown className="h-5 w-5" />
                </div>
                <span className="text-sm text-slate-500">Ukupni troškovi</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {ukupniTroskovi.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Direktni: {direktniTroskovi.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })} ·
                Rad: {trosakRada.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <Clock className="h-5 w-5" />
                </div>
                <span className="text-sm text-slate-500">Ukupno sati</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{ukupnoSati.toFixed(1)}h</p>
              <p className="text-xs text-slate-400 mt-1">
                ≈ {trosakRada.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })} trošak rada
              </p>
            </div>
          </div>

          {/* Fakture + ugovoreni radovi summary */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <FileText className="h-5 w-5" />
                </div>
                <span className="text-sm text-slate-500">Fakture ukupno</span>
              </div>
              <p className="text-xl font-bold text-slate-900">
                {ukupnoFakture.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
              </p>
              <p className="text-xs text-emerald-600 mt-1">
                Plaćeno: {placenoFakture.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                  <ClipboardCheck className="h-5 w-5" />
                </div>
                <span className="text-sm text-slate-500">Ugovoreno</span>
              </div>
              <p className="text-xl font-bold text-slate-900">
                {ugovorenoUkupno.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Ostvareno: {ostvarenoUkupno.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <Calendar className="h-5 w-5" />
                </div>
                <span className="text-sm text-slate-500">Rokovi</span>
              </div>
              <p className="text-xl font-bold text-slate-900">{rokovi.length}</p>
              <p className="text-xs text-slate-400 mt-1">
                {rokovi.filter((r) => r.status === 'otvoren').length} otvorenih ·{' '}
                {rokovi.filter((r) => r.status === 'prekoracen').length} prekoračenih
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <span className="text-sm text-slate-500">Nalozi</span>
              </div>
              <p className="text-xl font-bold text-slate-900">{nalozi.length}</p>
              <p className="text-xs text-slate-400 mt-1">
                {nalozi.filter((n: any) => n.status === 'otvoren' || n.status === 'u_tijeku').length} aktivnih
              </p>
            </div>
          </div>

          {/* Rokovi */}
          {rokovi.length > 0 && (
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 font-semibold text-slate-900 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-amber-500" />
                Rokovi projekta
              </h3>
              <div className="space-y-2">
                {rokovi.map((r) => {
                  const rb = rokStatusBadge[r.status] ?? rokStatusBadge.otvoren;
                  const d = daysUntil(r.datum);
                  return (
                    <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">{r.naziv}</p>
                        {r.opis && <p className="text-xs text-slate-400 truncate">{r.opis}</p>}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-sm text-slate-500">
                          {new Date(r.datum + 'T00:00:00').toLocaleDateString('hr-HR')}
                        </span>
                        {r.status === 'otvoren' && (
                          <span
                            className={`text-xs font-semibold ${
                              d < 0 ? 'text-red-600' : d <= 7 ? 'text-amber-600' : 'text-slate-500'
                            }`}
                          >
                            {d < 0 ? `${Math.abs(d)}d prekor.` : `${d}d`}
                          </span>
                        )}
                        <Badge variant={rb.variant}>{rb.label}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Troškovi po kategoriji */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 font-semibold text-slate-900 flex items-center gap-2">
                <Euro className="h-5 w-5 text-sky-600" />
                Troškovi po kategoriji
              </h3>
              {Object.keys(troskoviPoKategoriji).length === 0 ? (
                <p className="text-sm text-slate-400 py-4">Nema direktnih troškova</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(troskoviPoKategoriji)
                    .sort((a, b) => b[1] - a[1])
                    .map(([kat, iznos]) => {
                      const pct = direktniTroskovi > 0 ? (iznos / direktniTroskovi) * 100 : 0;
                      return (
                        <div key={kat}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-slate-700">{kategorijaLabel[kat as TrosakKategorija] ?? kat}</span>
                            <span className="font-medium text-slate-900">
                              {iznos.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  {/* Trošak rada (auto-izračunat) */}
                  {trosakRada > 0 && (
                    <div>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-slate-700 flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5" />
                          Trošak rada (auto)
                        </span>
                        <span className="font-medium text-emerald-600">
                          {trosakRada.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${ukupniTroskovi > 0 ? (trosakRada / ukupniTroskovi) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Sati i trošak po radniku */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 font-semibold text-slate-900 flex items-center gap-2">
                <Clock className="h-5 w-5 text-sky-600" />
                Sati i trošak po radniku
              </h3>
              {Object.keys(satiPoRadniku).length === 0 ? (
                <p className="text-sm text-slate-400 py-4">Nema zabilježenih sati</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(satiPoRadniku)
                    .sort((a, b) => b[1].trosak - a[1].trosak)
                    .map(([id, data]) => (
                      <div key={id} className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-700">{data.ime}</p>
                          <p className="text-xs text-slate-400">{data.sati.toFixed(1)}h × {data.satnica.toLocaleString('hr-HR')} €/h</p>
                        </div>
                        <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">
                          {data.trosak.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Fakture */}
            {fakture.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-4 font-semibold text-slate-900 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-indigo-600" />
                  Fakture ({fakture.length})
                </h3>
                <div className="space-y-2">
                  {fakture.map((f) => {
                    const fb = fakturaStatusBadge[f.status] ?? fakturaStatusBadge.izdana;
                    return (
                      <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3">
                        <div className="min-w-0">
                          <p className="text-sm font-mono font-medium text-slate-700">{f.broj}</p>
                          <p className="text-xs text-slate-400">
                            {f.kupac ?? '—'} · {new Date(f.datum_izdavanja + 'T00:00:00').toLocaleDateString('hr-HR')}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-sm font-semibold text-slate-900">
                            {iznosFakture(f).toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
                          </span>
                          <Badge variant={fb.variant}>{fb.label}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Ugovoreni radovi */}
            {ugovoreniRadovi.length > 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-4 font-semibold text-slate-900 flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-teal-600" />
                  Ugovoreni radovi ({ugovoreniRadovi.length})
                </h3>
                <div className="space-y-3">
                  {ugovoreniRadovi.map((u) => {
                    const pct = u.ugovoreni_iznos > 0 ? (u.ostvareni_iznos / u.ugovoreni_iznos) * 100 : 0;
                    return (
                      <div key={u.id} className="rounded-lg border border-slate-100 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium text-slate-900">{u.naziv}</p>
                          <Badge variant={u.status === 'zavrseno' ? 'green' : u.status === 'u_tijeku' ? 'yellow' : 'blue'}>
                            {u.status === 'zavrseno' ? 'Završeno' : u.status === 'u_tijeku' ? 'U tijeku' : 'Planirano'}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                          <span>Ugovoreno: {u.ugovoreni_iznos.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}</span>
                          <span>Ostvareno: {(u.ostvareni_iznos ?? 0).toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Radni nalozi */}
          {nalozi.length > 0 && (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 font-semibold text-slate-900 flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-sky-600" />
                Radni nalozi ({nalozi.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Broj</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Naslov</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Kreirano</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Rok</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {nalozi.map((n: any) => {
                      const si = nalogStatusBadge[n.status] ?? nalogStatusBadge.otvoren;
                      return (
                        <tr key={n.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-3 py-2.5 text-xs font-mono text-slate-500">{n.broj}</td>
                          <td className="px-3 py-2.5 text-sm font-medium text-slate-900">{n.naslov}</td>
                          <td className="px-3 py-2.5"><Badge variant={si.variant}>{si.label}</Badge></td>
                          <td className="px-3 py-2.5 text-sm text-slate-500">
                            {new Date(n.datum_kreiranja + 'T00:00:00').toLocaleDateString('hr-HR')}
                          </td>
                          <td className="px-3 py-2.5 text-sm text-slate-500">
                            {n.rok ? new Date(n.rok + 'T00:00:00').toLocaleDateString('hr-HR') : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tablični prikaz troškova */}
          {troskovi.length > 0 && (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 font-semibold text-slate-900 flex items-center gap-2">
                <Euro className="h-5 w-5 text-sky-600" />
                Svi troškovi ({troskovi.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Datum</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Kategorija</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Opis</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Iznos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {troskovi.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2.5 text-sm text-slate-500">
                          {new Date(t.datum + 'T00:00:00').toLocaleDateString('hr-HR')}
                        </td>
                        <td className="px-3 py-2.5 text-sm text-slate-600">
                          {kategorijaLabel[t.kategorija] ?? t.kategorija}
                        </td>
                        <td className="px-3 py-2.5 text-sm text-slate-700">{t.opis}</td>
                        <td className="px-3 py-2.5 text-right text-sm font-medium text-slate-900">
                          {t.iznos.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </>)}
        </>
      )}
    </div>
  );
}
