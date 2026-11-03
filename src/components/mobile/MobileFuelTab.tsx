import { useEffect, useState } from 'react';
import { Fuel, Gauge, Plus, RefreshCw } from 'lucide-react';
import {
  addMobileVoziloGorivo,
  fetchMobileVoziloGorivoOptions,
  fetchMobileVoziloGorivo,
  type MobileVoziloGorivoOptions,
} from '@/lib/api';
import type { VoziloGorivo } from '@/types';
import { todayISO } from '@/lib/rokovi';

const errorText = (reason: unknown) =>
  reason instanceof Error ? reason.message : 'Greška pri spremanju točenja goriva.';

export function MobileFuelTab() {
  const [options, setOptions] = useState<MobileVoziloGorivoOptions>({ vozila: [], radnici: [] });
  const [entries, setEntries] = useState<VoziloGorivo[]>([]);
  const [voziloId, setVoziloId] = useState('');
  const [tocioId, setTocioId] = useState('');
  const [datum, setDatum] = useState(todayISO());
  const [litara, setLitara] = useState('');
  const [kilometraza, setKilometraza] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextOptions, nextEntries] = await Promise.all([
        fetchMobileVoziloGorivoOptions(),
        fetchMobileVoziloGorivo(),
      ]);
      setOptions(nextOptions);
      setEntries(nextEntries);
      const firstWorker = nextOptions.radnici[0];
      const firstVehicle = nextOptions.vozila.find((vehicle) =>
        firstWorker?.uloga.trim().toLowerCase() !== 'radnik' || vehicle.tip.trim().toLowerCase() === 'teretno');
      setVoziloId((current) => current || firstVehicle?.id || '');
      setTocioId((current) => current || firstWorker?.id || '');
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    const litersValue = Number(litara);
    const kmValue = Number(kilometraza);
    if (!voziloId || !datum || !Number.isFinite(litersValue) || litersValue <= 0 || !kilometraza.trim()
      || !Number.isInteger(kmValue) || kmValue < 0 || !tocioId) {
      setError('Odaberite vozilo i osobu koja je točila te unesite litre i kilometražu.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await addMobileVoziloGorivo({
        vozilo_id: voziloId,
        datum,
        litara: litersValue,
        kilometraza: kmValue,
        tocio_radnik_id: tocioId,
      });
      setLitara('');
      setNotice('Točenje goriva je spremljeno.');
      setEntries(await fetchMobileVoziloGorivo());
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };

  const vehicleName = (id: string) => {
    const vehicle = options.vozila.find((item) => item.id === id);
    return vehicle ? `${vehicle.marka} ${vehicle.model ?? ''} · ${vehicle.registracija}`.trim() : 'Vozilo';
  };
  const selectedWorker = options.radnici.find((worker) => worker.id === tocioId);
  const availableVehicles = options.vozila.filter((vehicle) =>
    selectedWorker?.uloga.trim().toLowerCase() !== 'radnik' || vehicle.tip.trim().toLowerCase() === 'teretno');

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><Fuel className="h-5 w-5 text-amber-700" /> Unos goriva</h3>
        <p className="mt-1 text-xs text-slate-600">Upiši količinu goriva, kilometražu auta i tko je točio.</p>
        {loading ? <p className="mt-4 text-sm text-slate-500">Učitavanje vozila i djelatnika…</p> : (
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-medium text-slate-700">Tko je točio
              <select value={tocioId} onChange={(event) => {
                const nextWorkerId = event.target.value;
                const nextWorker = options.radnici.find((worker) => worker.id === nextWorkerId);
                const nextVehicles = options.vozila.filter((vehicle) =>
                  nextWorker?.uloga.trim().toLowerCase() !== 'radnik' || vehicle.tip.trim().toLowerCase() === 'teretno');
                setTocioId(nextWorkerId);
                setVoziloId((current) => nextVehicles.some((vehicle) => vehicle.id === current) ? current : nextVehicles[0]?.id ?? '');
              }} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
                <option value="">Odaberi djelatnika</option>
                {options.radnici.map((worker) => <option key={worker.id} value={worker.id}>{worker.ime} {worker.prezime}</option>)}
              </select>
            </label>
            {selectedWorker?.uloga.trim().toLowerCase() === 'radnik' && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">Kategorija „radnik” može evidentirati gorivo samo za teretna vozila.</p>
            )}
            <label className="block text-sm font-medium text-slate-700">Vozilo
              <select value={voziloId} onChange={(event) => setVoziloId(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
                <option value="">Odaberi vozilo</option>
                {availableVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.marka} {vehicle.model ?? ''} · {vehicle.registracija}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm font-medium text-slate-700">Datum
                <input type="date" value={datum} onChange={(event) => setDatum(event.target.value)} className="mt-1 min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-2 text-sm" />
              </label>
              <label className="block text-sm font-medium text-slate-700">Litre goriva
                <input type="number" inputMode="decimal" min="0.01" step="0.01" value={litara} onChange={(event) => setLitara(event.target.value)} placeholder="npr. 42,5" className="mt-1 min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base" />
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-700">Kilometraža auta
              <input type="number" inputMode="numeric" min="0" step="1" value={kilometraza} onChange={(event) => setKilometraza(event.target.value)} placeholder="Stanje kilometara" className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base" />
            </label>
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
            <button type="button" onClick={() => void save()} disabled={saving || !availableVehicles.length || !options.radnici.length} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 text-sm font-bold text-white disabled:opacity-50">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saving ? 'Spremanje…' : 'Spremi točenje'}
            </button>
            {!loading && !availableVehicles.length && <p className="text-sm text-slate-600">Za odabranu kategoriju nema dostupnih vozila.</p>}
            {!loading && !options.radnici.length && <p className="text-sm text-slate-600">Nema aktivnih djelatnika za odabir.</p>}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="mb-2 flex items-center gap-2 font-semibold text-slate-900"><Gauge className="h-4 w-4 text-slate-500" /> Moji unosi goriva</h3>
        {entries.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">Još nema spremljenih unosa.</p> : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <article key={entry.id} className="rounded-xl border border-slate-100 p-3">
                <p className="font-semibold text-slate-900">{Number(entry.litara).toLocaleString('hr-HR')} l · {Number(entry.kilometraza).toLocaleString('hr-HR')} km</p>
                <p className="mt-0.5 text-xs text-slate-500">{vehicleName(entry.vozilo_id)} · {new Date(`${entry.datum}T00:00:00`).toLocaleDateString('hr-HR')}</p>
                <p className="text-xs text-slate-500">Točio/la: {entry.tocio_ime}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
