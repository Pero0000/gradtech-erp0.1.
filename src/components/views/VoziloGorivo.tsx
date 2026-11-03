import { useEffect, useMemo, useState } from 'react';
import { Fuel, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Radnik, Vozilo, VoziloGorivo } from '@/types';
import {
  addVoziloGorivo,
  deleteVoziloGorivo,
  fetchVoziloGorivo,
  fetchVozilaGorivoWorkers,
  updateVoziloGorivo,
  type VoziloGorivoInput,
} from '@/lib/api';
import { todayISO } from '@/lib/rokovi';
import { Select, TextInput } from '@/components/ui/Field';

const errorText = (reason: unknown) =>
  reason instanceof Error ? reason.message : 'Greška pri spremanju točenja goriva.';

function averageConsumption(entries: VoziloGorivo[]) {
  const sorted = entries.slice().sort((first, second) =>
    first.kilometraza - second.kilometraza || first.datum.localeCompare(second.datum));
  let totalLiters = 0;
  let totalDistance = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const distance = sorted[index].kilometraza - sorted[index - 1].kilometraza;
    if (distance <= 0) continue;
    totalDistance += distance;
    totalLiters += Number(sorted[index].litara);
  }
  return totalDistance > 0 ? (totalLiters / totalDistance) * 100 : null;
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
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [records, staff] = await Promise.all([fetchVoziloGorivo(vozilo.id), fetchVozilaGorivoWorkers()]);
      setEntries(records);
      setWorkers(staff);
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

  const average = useMemo(() => averageConsumption(entries), [entries]);
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
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <div className="space-y-4">
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
            <TextInput type="number" min="0" step="1" value={kilometraza} onChange={(event) => setKilometraza(event.target.value)} />
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
              {entries.slice().sort((first, second) => second.kilometraza - first.kilometraza).map((entry) => (
                <article key={entry.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{Number(entry.litara).toLocaleString('hr-HR')} l · {Number(entry.kilometraza).toLocaleString('hr-HR')} km</p>
                    <p className="text-xs text-slate-500">{new Date(`${entry.datum}T00:00:00`).toLocaleDateString('hr-HR')} · Točio/la: {entry.tocio_ime}</p>
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
