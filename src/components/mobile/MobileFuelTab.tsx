import { useEffect, useState } from 'react';
import { Fuel, Gauge, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import {
  addMobileVoziloGorivo,
  fetchMobileVoziloGorivoOptions,
  fetchMobileVoziloGorivo,
  type MobileVoziloGorivoOptions,
} from '@/lib/api';
import type { VoziloGorivo } from '@/types';
import { todayISO } from '@/lib/rokovi';
import { parseDecimalInput, formatHrDate } from '@/lib/localization';

const errorText = (reason: unknown, fallback: string) => {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'object' && reason !== null && 'message' in reason) {
    const error = reason as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [
      typeof error.message === 'string' ? error.message : null,
      typeof error.details === 'string' ? `Detalji: ${error.details}` : null,
      typeof error.hint === 'string' ? `Savjet: ${error.hint}` : null,
      typeof error.code === 'string' ? `Kod: ${error.code}` : null,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }
  return fallback;
};

export function MobileFuelTab() {
  const { profile } = useAuth();
  const tocioId = profile?.radnik_id ?? '';
  const [options, setOptions] = useState<MobileVoziloGorivoOptions>({ vozila: [], radnici: [] });
  const [entries, setEntries] = useState<VoziloGorivo[]>([]);
  const [voziloId, setVoziloId] = useState('');
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
      if (!tocioId) throw new Error('Vaš korisnički račun nije povezan s djelatnikom. Obratite se administratoru.');
      const [nextOptions, nextEntries] = await Promise.all([
        fetchMobileVoziloGorivoOptions(tocioId),
        fetchMobileVoziloGorivo(),
      ]);
      if (!nextOptions.radnici.some((worker) => worker.id === tocioId)) {
        throw new Error('Prijavljeni djelatnik nije aktivan ili nije dostupan za unos goriva. Obratite se administratoru.');
      }
      setOptions(nextOptions);
      setEntries(nextEntries);
      const selectedVehicle = nextOptions.vozila.find((vehicle) => vehicle.id === voziloId) ?? nextOptions.vozila[0];
      setVoziloId(selectedVehicle?.id ?? '');
      setKilometraza((current) => selectedVehicle?.id === voziloId && current
        ? current
        : String(selectedVehicle?.kilometraza ?? ''));
    } catch (reason) {
      setError(errorText(reason, 'Popis vozila i djelatnika nije moguće učitati.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Reload permissions when the linked worker changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tocioId]);

  const save = async () => {
    if (saving) return;
    if (!tocioId || !options.radnici.some((worker) => worker.id === tocioId)) {
      setError('Prijavljeni djelatnik nije dostupan za unos goriva. Obratite se administratoru.');
      return;
    }
    const litersValue = parseDecimalInput(litara);
    const kmValue = Number(kilometraza);
    if (!voziloId || !datum || !Number.isFinite(litersValue) || litersValue <= 0 || !kilometraza.trim()
      || !Number.isInteger(kmValue) || kmValue < 0) {
      setError('Odaberite vozilo te unesite datum, litre i kilometražu.');
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
      window.dispatchEvent(new Event('vozila-obavijest-updated'));
      try {
        const [nextEntries, nextOptions] = await Promise.all([
          fetchMobileVoziloGorivo(),
          fetchMobileVoziloGorivoOptions(tocioId),
        ]);
        setEntries(nextEntries);
        setOptions(nextOptions);
        const updatedVehicle = nextOptions.vozila.find((vehicle) => vehicle.id === voziloId);
        if (updatedVehicle) setKilometraza(String(updatedVehicle.kilometraza));
      } catch (reason) {
        setError(`Točenje je spremljeno, ali prikaz nije osvježen: ${errorText(reason, 'Podatke nije moguće osvježiti.')}`);
      }
    } catch (reason) {
      setError(errorText(reason, 'Točenje goriva nije moguće spremiti.'));
    } finally {
      setSaving(false);
    }
  };

  const vehicleName = (id: string) => {
    const vehicle = options.vozila.find((item) => item.id === id);
    return vehicle ? `${vehicle.marka} ${vehicle.model ?? ''} · ${vehicle.registracija}`.trim() : 'Vozilo';
  };
  const selectedWorker = options.radnici.find((worker) => worker.id === tocioId);
  const selectedVehicle = options.vozila.find((vehicle) => vehicle.id === voziloId);
  const availableVehicles = options.vozila.filter((vehicle) =>
    !selectedWorker
    || selectedWorker.dozvoljeni_tipovi_vozila === null
    || selectedWorker.dozvoljeni_tipovi_vozila.some((tip) => tip.trim().toLowerCase() === vehicle.tip.trim().toLowerCase()));

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><Fuel className="h-5 w-5 text-amber-700" /> Unos goriva</h3>
        <p className="mt-1 text-xs text-slate-600">Upiši količinu goriva i kilometražu auta. Unos se automatski bilježi na tvoje ime.</p>
        {loading ? <p className="mt-4 text-sm text-slate-500">Učitavanje vozila…</p> : (
          <div className="mt-4 space-y-3">
            {selectedWorker?.dozvoljeni_tipovi_vozila && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                Za kategoriju „{selectedWorker.uloga}” dopušteno je: {selectedWorker.dozvoljeni_tipovi_vozila.join(', ')}.
              </p>
            )}
            <label className="block text-sm font-medium text-slate-700">Vozilo
              <select value={voziloId} disabled={loading} onChange={(event) => {
                const nextVehicleId = event.target.value;
                const nextVehicle = options.vozila.find((vehicle) => vehicle.id === nextVehicleId);
                setVoziloId(nextVehicleId);
                setKilometraza(String(nextVehicle?.kilometraza ?? ''));
              }} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
                <option value="">Odaberi vozilo</option>
                {availableVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.marka} {vehicle.model ?? ''} · {vehicle.registracija}{vehicle.gorivo_pin ? ` · ${vehicle.gorivo_pin}` : ''}</option>)}
              </select>
            </label>
            {selectedWorker && availableVehicles.length === 0 && (
              <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                Nema vozila dopuštenog za kategoriju „{selectedWorker.uloga}”.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm font-medium text-slate-700">Datum
                <input lang="hr-HR" type="date" value={datum} onChange={(event) => setDatum(event.target.value)} className="mt-1 min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-2 text-sm" />
              </label>
              <label className="block text-sm font-medium text-slate-700">Litre goriva
                <input type="text" inputMode="decimal" value={litara} onChange={(event) => setLitara(event.target.value)} placeholder="npr. 42,5" className="mt-1 min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base" />
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-700">Kilometraža auta
              <input type="number" inputMode="numeric" min={0} step="1" value={kilometraza} onChange={(event) => setKilometraza(event.target.value)} placeholder="Stanje kilometara" className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base" />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Trenutno stanje: {Number(selectedVehicle?.kilometraza ?? 0).toLocaleString('hr-HR')} km
              </span>
              {selectedVehicle && kilometraza.trim() && Number(kilometraza) < selectedVehicle.kilometraza && (
                <span role="status" className="mt-1 block text-xs font-normal text-amber-800">
                  Provjerite kilometražu i datum točenja. Manji unos može se spremiti; trenutno stanje vozila neće se smanjiti.
                </span>
              )}
            </label>
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            {error && (
              <button type="button" onClick={() => void load()} disabled={loading || saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-800 disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Ponovno učitaj popise
              </button>
            )}
            {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
            <button type="button" onClick={() => void save()} disabled={saving || !availableVehicles.length || !selectedWorker} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 text-sm font-bold text-white disabled:opacity-50">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saving ? 'Spremanje…' : 'Spremi točenje'}
            </button>
            {!loading && !availableVehicles.length && <p className="text-sm text-slate-600">Za odabranu kategoriju nema dostupnih vozila.</p>}
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
                <p className="mt-0.5 text-xs text-slate-500">{vehicleName(entry.vozilo_id)} · {formatHrDate(new Date(`${entry.datum}T00:00:00`))}</p>
                <p className="text-xs text-slate-500">Točio/la: {entry.tocio_ime}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
