import { useEffect, useRef, useState } from 'react';
import { FileText, Plus, Trash2, Paperclip } from 'lucide-react';
import type { RadnikDokument, RadnikDokumentVrsta } from '@/types';
import { addRadnikDokument, deleteRadnikDokument, fetchRadnikDokumenti } from '@/lib/api';
import { todayISO } from '@/lib/rokovi';
import { TextInput, Select } from '@/components/ui/Field';

export const dokumentVrste: Record<RadnikDokumentVrsta, string> = {
  lijecnicki: 'Liječnički pregled',
  atest: 'Atest',
  zastita_na_radu: 'Zaštita na radu',
  osposobljavanje: 'Osposobljavanje',
  ostalo: 'Ostalo',
};

const errText = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Greška');

function status(d: RadnikDokument) {
  if (!d.datum_do) return null;
  const today = todayISO();
  const days = Math.round((new Date(`${d.datum_do}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
  if (days < 0) return { label: `Istekao ${Math.abs(days)} d`, cls: 'bg-red-600 text-white' };
  if (days <= 30) return { label: `Ističe za ${days} d`, cls: 'bg-red-100 text-red-700' };
  return { label: 'Vrijedi', cls: 'bg-emerald-50 text-emerald-700' };
}

const date = (v: string | null) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString('hr-HR') : '—');

export function RadnikDokumenti({ radnikId }: { radnikId: string }) {
  const [items, setItems] = useState<RadnikDokument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ vrsta: 'lijecnicki' as RadnikDokumentVrsta, naziv: '', datum_od: '', datum_do: '' });
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setItems(await fetchRadnikDokumenti(radnikId));
    } catch (e) {
      setError(`${errText(e)} — pokreni migraciju 20261015310000_radnici_cijene_dokumenti.sql.`);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radnikId]);

  const add = async () => {
    const naziv = form.naziv.trim() || dokumentVrste[form.vrsta];
    setSaving(true);
    setError(null);
    try {
      await addRadnikDokument(
        radnikId,
        { vrsta: form.vrsta, naziv, datum_od: form.datum_od || null, datum_do: form.datum_do || null, napomena: null },
        file,
      );
      setForm({ vrsta: form.vrsta, naziv: '', datum_od: '', datum_do: '' });
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (d: RadnikDokument) => {
    if (!window.confirm(`Obrisati "${d.naziv}"?`)) return;
    try {
      await deleteRadnikDokument(d);
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <FileText className="h-4 w-4 text-slate-400" /> Dokumenti i rokovi ({items.length})
      </p>
      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="mb-3 space-y-1.5">
        {items.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Nema dokumenata.</p>}
        {items.map((d) => {
          const st = status(d);
          return (
            <div key={d.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-1.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">
                  {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">{d.naziv}</a> : d.naziv}
                </p>
                <p className="text-xs text-slate-500">{dokumentVrste[d.vrsta] ?? d.vrsta} · {date(d.datum_od)} – {date(d.datum_do)}</p>
              </div>
              {st && <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>}
              <button type="button" onClick={() => void remove(d)} className="flex-shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" aria-label="Obriši">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          <Select value={form.vrsta} onChange={(e) => setForm({ ...form, vrsta: e.target.value as RadnikDokumentVrsta })}>
            {Object.entries(dokumentVrste).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <TextInput value={form.naziv} onChange={(e) => setForm({ ...form, naziv: e.target.value })} placeholder="Naziv (neobavezno)" />
          <label className="block min-w-0 text-xs text-slate-500">Početak
            <TextInput type="date" value={form.datum_od} onChange={(e) => setForm({ ...form, datum_od: e.target.value })} />
          </label>
          <label className="block min-w-0 text-xs text-slate-500">Kraj / istek
            <TextInput type="date" value={form.datum_do} onChange={(e) => setForm({ ...form, datum_do: e.target.value })} />
          </label>
        </div>
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex min-w-0 max-w-full items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <Paperclip className="h-3.5 w-3.5 flex-shrink-0" /> <span className="min-w-0 truncate">{file ? file.name : 'Priloži datoteku'}</span>
          </button>
          <button type="button" onClick={() => void add()} disabled={saving} className="inline-flex items-center justify-center gap-1 rounded-lg bg-sky-600 xl:ml-auto px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" /> {saving ? 'Spremanje…' : 'Dodaj'}
          </button>
        </div>
      </div>
    </div>
  );
}
