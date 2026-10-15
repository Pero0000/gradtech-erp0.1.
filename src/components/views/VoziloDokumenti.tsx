import { useEffect, useRef, useState } from 'react';
import { Wrench, Plus, Trash2, Paperclip } from 'lucide-react';
import type { VoziloDokument, VoziloDokumentVrsta } from '@/types';
import { addVoziloDokument, deleteVoziloDokument, fetchVoziloDokumenti } from '@/lib/api';
import { todayISO } from '@/lib/rokovi';
import { TextInput, Select } from '@/components/ui/Field';

const vrste: Record<VoziloDokumentVrsta, string> = {
  registracija: 'Registracija',
  tehnicki: 'Tehnički pregled',
  osiguranje: 'Osiguranje (AO)',
  kasko: 'Kasko',
  servis: 'Servis',
  enc: 'ENC',
  tahograf: 'Tahograf / baždarenje',
  ostalo: 'Ostalo',
};

const errText = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Greška');
const date = (v: string | null) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString('hr-HR') : '—');

function status(d: VoziloDokument) {
  if (!d.datum_do || d.vrsta === 'servis') return null;
  const days = Math.round((new Date(`${d.datum_do}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime()) / 86400000);
  if (days < 0) return { label: `Isteklo ${Math.abs(days)} d`, cls: 'bg-red-600 text-white' };
  if (days <= 30) return { label: `Ističe za ${days} d`, cls: 'bg-red-100 text-red-700' };
  return { label: 'Vrijedi', cls: 'bg-emerald-50 text-emerald-700' };
}

export function VoziloDokumenti({ voziloId, onChange }: { voziloId: string; onChange?: () => void }) {
  const [items, setItems] = useState<VoziloDokument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ vrsta: 'servis' as VoziloDokumentVrsta, naziv: '', datum_od: '', datum_do: '', iznos: '', km: '' });
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isServis = form.vrsta === 'servis';

  const load = async () => {
    try {
      setItems(await fetchVoziloDokumenti(voziloId));
    } catch (e) {
      setError(`${errText(e)} — pokreni migraciju 20261015320000_vozila_dokumenti_servis.sql.`);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voziloId]);

  const add = async () => {
    setSaving(true);
    setError(null);
    try {
      await addVoziloDokument(
        voziloId,
        {
          vrsta: form.vrsta,
          naziv: form.naziv.trim() || vrste[form.vrsta],
          datum_od: form.datum_od || null,
          datum_do: form.datum_do || null,
          iznos: form.iznos ? parseFloat(form.iznos) : null,
          km: form.km ? parseInt(form.km) : null,
          napomena: null,
        },
        file,
      );
      setForm({ ...form, naziv: '', datum_od: '', datum_do: '', iznos: '', km: '' });
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
      onChange?.();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (d: VoziloDokument) => {
    if (!window.confirm(`Obrisati "${d.naziv}"?`)) return;
    try {
      await deleteVoziloDokument(d);
      await load();
      onChange?.();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <Wrench className="h-4 w-4 text-slate-400" /> Dokumenti, servisi i rokovi ({items.length})
      </p>
      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="mb-3 space-y-1.5">
        {items.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Nema zapisa.</p>}
        {items.map((d) => {
          const st = status(d);
          return (
            <div key={d.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-1.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">
                  {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">{d.naziv}</a> : d.naziv}
                </p>
                <p className="text-xs text-slate-500">
                  {vrste[d.vrsta] ?? d.vrsta} · {d.vrsta === 'servis' ? date(d.datum_od) : `${date(d.datum_od)} – ${date(d.datum_do)}`}
                  {d.km != null && ` · ${d.km.toLocaleString('hr-HR')} km`}
                  {d.iznos != null && ` · ${d.iznos.toLocaleString('hr-HR', { minimumFractionDigits: 2 })} €`}
                  {d.vrsta === 'servis' && d.datum_do && ` · idući ${date(d.datum_do)}`}
                </p>
              </div>
              {st && <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>}
              <button type="button" onClick={() => void remove(d)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" aria-label="Obriši">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Select value={form.vrsta} onChange={(e) => setForm({ ...form, vrsta: e.target.value as VoziloDokumentVrsta })}>
            {Object.entries(vrste).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <TextInput value={form.naziv} onChange={(e) => setForm({ ...form, naziv: e.target.value })} placeholder={isServis ? 'Opis servisa (npr. veliki servis)' : 'Naziv (neobavezno)'} />
          <label className="text-xs text-slate-500">{isServis ? 'Datum servisa' : 'Početak'}
            <TextInput type="date" value={form.datum_od} onChange={(e) => setForm({ ...form, datum_od: e.target.value })} />
          </label>
          <label className="text-xs text-slate-500">{isServis ? 'Idući servis (datum)' : 'Kraj / istek'}
            <TextInput type="date" value={form.datum_do} onChange={(e) => setForm({ ...form, datum_do: e.target.value })} />
          </label>
          <TextInput type="number" min="0" value={form.km} onChange={(e) => setForm({ ...form, km: e.target.value })} placeholder={isServis ? 'Kilometraža na servisu' : 'Kilometraža (neobavezno)'} />
          <TextInput type="number" min="0" step="0.01" value={form.iznos} onChange={(e) => setForm({ ...form, iznos: e.target.value })} placeholder="Iznos (€)" />
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <Paperclip className="h-3.5 w-3.5" /> {file ? file.name : 'Priloži datoteku'}
          </button>
          <button type="button" onClick={() => void add()} disabled={saving} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" /> {saving ? 'Spremanje…' : 'Dodaj'}
          </button>
        </div>
      </div>
    </div>
  );
}
