import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Fuel, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Radnik, Vozilo, VoziloGorivo } from '@/types';
import {
  addVoziloGorivo,
  deleteVoziloGorivo,
  fetchVoziloGorivo,
  fetchVozilaGorivoAnomalyThreshold,
  fetchVozilaGorivoWorkers,
  updateVoziloGorivo,
  updateVozilaGorivoAnomalyThreshold,
  type VoziloGorivoInput,
} from '@/lib/api';
import { todayISO } from '@/lib/rokovi';
import { Select, TextInput } from '@/components/ui/Field';

const errorText = (reason: unknown) => {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'object' && reason !== null && 'message' in reason && typeof reason.message === 'string') {
    return reason.message;
  }
  return 'Greška pri spremanju točenja goriva.';
};

interface FuelConsumption {
  entry: VoziloGorivo;
  distance: number | null;
  consumption: number | null;
  anomaly: 'high' | 'low' | 'odometer' | null;
  baseline: number | null;
}

function median(values: number[]) {
  const sorted = values.slice().sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getFuelConsumptions(entries: VoziloGorivo[], thresholdPercent: number): FuelConsumption[] {
  const sorted = entries.slice().sort((first, second) =>
    first.datum.localeCompare(second.datum) || first.created_at.localeCompare(second.created_at));
  const measurements = sorted.map((entry, index) => {
    if (index === 0) return { entry, distance: null, consumption: null, anomaly: null, baseline: null };
    const distance = entry.kilometraza - sorted[index - 1].kilometraza;
    if (distance < 0) return { entry, distance: null, consumption: null, anomaly: 'odometer' as const, baseline: null };
    if (distance === 0) return { entry, distance: 0, consumption: null, anomaly: null, baseline: null };
    return {
      entry,
      distance,
      consumption: (Number(entry.litara) / distance) * 100,
      anomaly: null,
      baseline: null,
    };
  });
  return measurements.map((measurement) => {
    if (measurement.consumption === null || measurement.anomaly === 'odometer') return measurement;
    const comparisonValues = measurements
      .filter((other) => other.entry.id !== measurement.entry.id && other.consumption !== null)
      .map((other) => Number(other.consumption));
    if (comparisonValues.length < 3) return measurement;
    const baseline = median(comparisonValues);
    if (baseline <= 0) return { ...measurement, baseline };
    return {
      ...measurement,
      baseline,
      anomaly: measurement.consumption > baseline * (1 + thresholdPercent / 100)
        ? 'high' as const
        : measurement.consumption < baseline * (1 - thresholdPercent / 100)
          ? 'low' as const
          : null,
    };
  });
}

export function VoziloGorivo({ vozilo, canEdit = false, onChange }: {
  vozilo: Vozilo;
  canEdit?: boolean;
  onChange?: () => void;
}) {
  const [entries, setEntries] = useState<VoziloGorivo[]>([]);
  const [workers, setWorkers] = useState<Array<Pick<Radnik, 'id' | 'ime' | 'prezime' | 'uloga'>>>([]);
  const [editing, setEditing] = useState<VoziloGorivo | null>(null);
  const [datum, setDatum] = useState(todayISO());
  const [litara, setLitara] = useState('');
  const [kilometraza, setKilometraza] = useState(String(vozilo.kilometraza ?? ''));
  const [tocioId, setTocioId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [thresholdPercent, setThresholdPercent] = useState(50);
  const [thresholdDraft, setThresholdDraft] = useState('50');
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [records, staff, threshold] = await Promise.all([
        fetchVoziloGorivo(vozilo.id),
        fetchVozilaGorivoWorkers(),
        fetchVozilaGorivoAnomalyThreshold(),
      ]);
      setEntries(records);
      setWorkers(staff);
      setThresholdPercent(threshold);
      setThresholdDraft(String(threshold));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Load once per selected vehicle; changes are refreshed through this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vozilo.id]);

  useEffect(() => {
    if (!editing) setKilometraza(String(vozilo.kilometraza ?? ''));
  }, [vozilo.kilometraza, editing]);

  const consumptions = useMemo(() => getFuelConsumptions(entries, thresholdPercent), [entries, thresholdPercent]);
  const average = useMemo(() => {
    const valid = consumptions.filter((item) => item.distance && item.consumption !== null);
    const distance = valid.reduce((total, item) => total + (item.distance ?? 0), 0);
    return distance ? valid.reduce((total, item) => total + Number(item.entry.litara), 0) / distance * 100 : null;
  }, [consumptions]);
  const anomalyCount = consumptions.filter((item) => item.anomaly !== null).length;
  const eligibleWorkers = workers.filter((worker) =>
    vozilo.tip.trim().toLowerCase() === 'teretno' || worker.uloga.trim().toLowerCase() !== 'radnik');

  const reset = () => {
    setEditing(null);
    setDatum(todayISO());
    setLitara('');
    setKilometraza(String(vozilo.kilometraza ?? ''));
    setTocioId('');
  };

  const edit = (entry: VoziloGorivo) => {
    setEditing(entry);
    setDatum(entry.datum);
    setLitara(String(entry.litara));
    setKilometraza(String(entry.kilometraza));
    setTocioId(entry.tocio_radnik_id ?? '');
  };

  const save = async () => {
    const litersValue = Number(litara);
    const kmValue = Number(kilometraza);
    const worker = eligibleWorkers.find((item) => item.id === tocioId);
    if (!datum || !Number.isFinite(litersValue) || litersValue <= 0 || !kilometraza.trim()
      || !Number.isInteger(kmValue) || kmValue < 0 || !worker) {
      setError('Unesite datum, litre veće od nule, kilometražu i odaberite tko je točio.');
      return;
    }
    if ((!editing || kmValue !== editing.kilometraza) && kmValue < vozilo.kilometraza) {
      setError(`Kilometraža ne može biti manja od trenutnog stanja vozila (${vozilo.kilometraza.toLocaleString('hr-HR')} km).`);
      return;
    }
    const input: VoziloGorivoInput = {
      vozilo_id: vozilo.id,
      datum,
      litara: litersValue,
      kilometraza: kmValue,
      tocio_radnik_id: worker.id,
      tocio_ime: `${worker.ime} ${worker.prezime}`,
    };
    setSaving(true);
    setError(null);
    try {
      if (editing) await updateVoziloGorivo(editing.id, input);
      else await addVoziloGorivo(input);
      reset();
      await load();
      onChange?.();
      window.dispatchEvent(new Event('vozila-obavijest-updated'));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: VoziloGorivo) => {
    if (!window.confirm(`Obrisati unos od ${new Date(`${entry.datum}T00:00:00`).toLocaleDateString('hr-HR')}?`)) return;
    setError(null);
    try {
      await deleteVoziloGorivo(entry.id);
      if (editing?.id === entry.id) reset();
      await load();
      onChange?.();
      window.dispatchEvent(new Event('vozila-obavijest-updated'));
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  const saveThreshold = async () => {
    const threshold = Number(thresholdDraft);
    if (!Number.isInteger(threshold) || threshold < 5 || threshold > 90) {
      setError('Prag upozorenja mora biti cijeli broj od 5 do 90%.');
      return;
    }
    setSavingThreshold(true);
    setError(null);
    try {
      await updateVozilaGorivoAnomalyThreshold(threshold);
      setThresholdPercent(threshold);
      setThresholdDraft(String(threshold));
      window.dispatchEvent(new Event('vozila-obavijest-updated'));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSavingThreshold(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold text-slate-900">Prag upozorenja na potrošnju</h3>
        <p className="mt-1 text-xs text-slate-600">
          Postavka vrijedi za sva vozila i korisnike u tvrtki. Upozorenje se javlja kad je potrošnja više od odabranog postotka iznad ili ispod medijana; potrebno je najmanje tri druga izračunata točenja.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-medium text-slate-600">
            Odstupanje (%)
            <TextInput
              type="number"
              min="5"
              max="90"
              step="1"
              value={thresholdDraft}
              disabled={!canEdit || savingThreshold}
              onChange={(event) => setThresholdDraft(event.target.value)}
            />
          </label>
          {canEdit && (
            <button
              type="button"
              onClick={() => void saveThreshold()}
              disabled={savingThreshold || Number(thresholdDraft) === thresholdPercent}
              className="min-h-10 rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingThreshold ? 'Spremanje…' : 'Spremi prag'}
            </button>
          )}
        </div>
      </section>
      <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
          <Fuel className="h-4 w-4 text-amber-700" /> Prosječna potrošnja
        </h3>
        <p className="text-2xl font-bold text-slate-900">
          {average === null ? '—' : `${average.toLocaleString('hr-HR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} l/100 km`}
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Prosjek se računa iz unesenih litara i razlike kilometraže. Za najtočniji rezultat bilježite točenja do punog spremnika.
        </p>
      </section>
      {anomalyCount > 0 && (
        <section role="status" className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
          <h3 className="flex items-center gap-2 font-semibold text-rose-900">
            <AlertTriangle className="h-4 w-4" /> Upozorenje na anomalije
          </h3>
          <p className="mt-1 text-sm text-rose-800">
            Pronađeno je {anomalyCount} točenja za provjeru. Potrošnja se označava kad odstupa više od {thresholdPercent}% od medijana drugih izračunatih točenja ovog vozila (potrebna su najmanje tri druga zapisa); označava se i pad očitanja kilometraže.
          </p>
        </section>
      )}

      {canEdit && <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold text-slate-900">{editing ? 'Uredi točenje' : 'Unesi točenje goriva'}</h3>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-xs font-medium text-slate-600">Datum
            <TextInput type="date" value={datum} onChange={(event) => setDatum(event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">Litre goriva
            <TextInput type="number" min="0.01" step="0.01" value={litara} onChange={(event) => setLitara(event.target.value)} placeholder="npr. 42,5" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">Kilometraža auta
            <TextInput type="number" min={editing ? 0 : vozilo.kilometraza} step="1" value={kilometraza} onChange={(event) => setKilometraza(event.target.value)} />
            <span className="text-xs font-normal text-slate-500">Trenutno stanje: {vozilo.kilometraza.toLocaleString('hr-HR')} km</span>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">Tko je točio
            <Select value={tocioId} onChange={(event) => setTocioId(event.target.value)}>
              <option value="">Odaberi djelatnika</option>
              {tocioId && !eligibleWorkers.some((worker) => worker.id === tocioId) && (
                <option value={tocioId} disabled>Odabrani djelatnik više ne ispunjava uvjet</option>
              )}
              {eligibleWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.ime} {worker.prezime}</option>)}
            </Select>
          </label>
        </div>
        {vozilo.tip.trim().toLowerCase() !== 'teretno' && workers.some((worker) => worker.uloga.trim().toLowerCase() === 'radnik') && (
          <p className="mt-2 text-xs text-amber-800">Djelatnici kategorije „radnik” mogu evidentirati gorivo samo za teretna vozila.</p>
        )}
        {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50">
            {editing ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {saving ? 'Spremanje…' : editing ? 'Spremi promjene' : 'Dodaj točenje'}
          </button>
          {editing && <button type="button" onClick={reset} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">Odustani</button>}
        </div>
      </section>}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold text-slate-900">Povijest točenja</h3>
        {loading ? <p className="py-5 text-center text-sm text-slate-500">Učitavanje točenja…</p>
          : entries.length === 0 ? <p className="py-5 text-center text-sm text-slate-500">Još nema evidentiranih točenja.</p>
            : <div className="space-y-2">
              {consumptions.slice().reverse().map(({ entry, distance, consumption, anomaly, baseline }) => (
                <article key={entry.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{Number(entry.litara).toLocaleString('hr-HR')} l · {Number(entry.kilometraza).toLocaleString('hr-HR')} km</p>
                    <p className="text-xs text-slate-500">{new Date(`${entry.datum}T00:00:00`).toLocaleDateString('hr-HR')} · Točio/la: {entry.tocio_ime}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {anomaly === 'odometer'
                        ? <span className="font-semibold text-rose-700">Provjeriti kilometražu: niža je od prethodnog točenja.</span>
                        : consumption !== null && distance !== null
                          ? <>Potrošnja: <span className="font-semibold">{consumption.toLocaleString('hr-HR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} l/100 km</span> · {distance.toLocaleString('hr-HR')} km od prethodnog točenja</>
                          : 'Potrošnja će se prikazati nakon sljedećeg točenja s većom kilometražom.'}
                    </p>
                    {(anomaly === 'high' || anomaly === 'low') && (
                      <p role="status" className="mt-1 flex items-start gap-1 text-xs font-medium text-rose-700">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {anomaly === 'high' ? 'Neuobičajeno visoka' : 'Neuobičajeno niska'} potrošnja u odnosu na tipičnih {baseline?.toLocaleString('hr-HR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} l/100 km za ovo vozilo. Provjerite unos ili okolnosti vožnje.
                      </p>
                    )}
                  </div>
                  {canEdit && <div className="flex gap-1">
                    <button type="button" onClick={() => edit(entry)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-sky-700" aria-label="Uredi točenje"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={() => void remove(entry)} className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-700" aria-label="Obriši točenje"><Trash2 className="h-4 w-4" /></button>
                  </div>}
                </article>
              ))}
            </div>}
      </section>
    </div>
  );
}
