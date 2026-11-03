import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, RefreshCw } from 'lucide-react';
import {
  addMobileVoziloObavijest,
  fetchMobileVoziloObavijestVehicles,
  fetchMobileVoziloObavijesti,
} from '@/lib/api';
import type { VoziloObavijest, VoziloObavijestVrsta } from '@/types';

const vrstaLabels: Record<VoziloObavijestVrsta, string> = {
  kvar: 'Kvar',
  upozorenje: 'Upozorenje',
  ostalo: 'Ostalo',
};

const errorText = (reason: unknown) =>
  reason instanceof Error ? reason.message : 'Greška pri spremanju prijave vozila.';

export function MobileVehicleIssuesTab() {
  const [vehicles, setVehicles] = useState<Array<{ id: string; marka: string; model: string | null; registracija: string }>>([]);
  const [entries, setEntries] = useState<VoziloObavijest[]>([]);
  const [voziloId, setVoziloId] = useState('');
  const [vrsta, setVrsta] = useState<VoziloObavijestVrsta>('kvar');
  const [opis, setOpis] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextVehicles, nextEntries] = await Promise.all([
        fetchMobileVoziloObavijestVehicles(),
        fetchMobileVoziloObavijesti(),
      ]);
      setVehicles(nextVehicles);
      setEntries(nextEntries);
      setVoziloId((current) => current || nextVehicles[0]?.id || '');
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
    if (!voziloId || !opis.trim()) {
      setError('Odaberite vozilo i upišite opis problema.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await addMobileVoziloObavijest({ vozilo_id: voziloId, vrsta, opis: opis.trim() });
      setOpis('');
      setNotice('Prijava je poslana uredu.');
      setEntries(await fetchMobileVoziloObavijesti());
      window.dispatchEvent(new Event('vozila-obavijest-updated'));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };

  const vehicleName = (id: string) => {
    const vehicle = vehicles.find((item) => item.id === id);
    return vehicle ? `${vehicle.marka} ${vehicle.model ?? ''} · ${vehicle.registracija}`.trim() : 'Vozilo';
  };

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-red-200 bg-red-50 p-4">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><AlertTriangle className="h-5 w-5 text-red-700" /> Prijavi problem s vozilom</h3>
        <p className="mt-1 text-xs text-slate-600">Ured će prijavu vidjeti u obavijestima i javiti kad bude riješena.</p>
        {loading ? <p className="mt-4 text-sm text-slate-500">Učitavanje vozila…</p> : (
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-medium text-slate-700">Vozilo
              <select value={voziloId} onChange={(event) => setVoziloId(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
                <option value="">Odaberi vozilo</option>
                {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.marka} {vehicle.model ?? ''} · {vehicle.registracija}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">Vrsta prijave
              <select value={vrsta} onChange={(event) => setVrsta(event.target.value as VoziloObavijestVrsta)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
                {Object.entries(vrstaLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">Opis problema
              <textarea value={opis} onChange={(event) => setOpis(event.target.value)} maxLength={2000} rows={4} placeholder="Opiši kvar ili što treba provjeriti…" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base" />
            </label>
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-white p-3 text-sm text-red-800">{error}</p>}
            {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
            <button type="button" onClick={() => void save()} disabled={saving || !vehicles.length} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 text-sm font-bold text-white disabled:opacity-50">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saving ? 'Slanje…' : 'Pošalji prijavu'}
            </button>
            {!vehicles.length && <p className="text-sm text-slate-600">Nema dostupnih vozila.</p>}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="mb-2 flex items-center gap-2 font-semibold text-slate-900"><AlertTriangle className="h-4 w-4 text-slate-500" /> Moje prijave</h3>
        {loading ? <p className="py-4 text-center text-sm text-slate-500">Učitavanje prijava…</p> : entries.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">Još nema spremljenih prijava.</p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <article key={entry.id} className="rounded-xl border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900">{vrstaLabels[entry.vrsta]}</p>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${entry.rijeseno_at ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {entry.rijeseno_at ? <><CheckCircle2 className="mr-1 inline h-3 w-3" />Riješeno</> : 'Prijavljeno'}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{entry.opis}</p>
                <p className="mt-1 text-xs text-slate-500">{vehicleName(entry.vozilo_id)} · {new Date(`${entry.datum}T00:00:00`).toLocaleDateString('hr-HR')}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
