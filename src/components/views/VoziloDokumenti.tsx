import { useEffect, useRef, useState } from 'react';
import { Wrench, Plus, Trash2, Paperclip, Pencil, X } from 'lucide-react';
import type { VoziloDokument, VoziloDokumentVrsta } from '@/types';
import { addVoziloDokument, deleteVoziloDokument, fetchVoziloDokumenti, updateVoziloDokument } from '@/lib/api';
import { todayISO } from '@/lib/rokovi';
import { TextInput, Select, Textarea } from '@/components/ui/Field';

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
  const [editing, setEditing] = useState<VoziloDokument | null>(null);
  const [form, setForm] = useState({ vrsta: 'servis' as VoziloDokumentVrsta, naziv: '', datum_od: '', datum_do: '', iznos: '', km: '', serviser: '', dijelovi: '', napomena: '' });
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isServis = form.vrsta === 'servis';

  const resetForm = () => {
    setEditing(null);
    setForm({ vrsta: 'servis', naziv: '', datum_od: '', datum_do: '', iznos: '', km: '', serviser: '', dijelovi: '', napomena: '' });
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const edit = (document: VoziloDokument) => {
    setEditing(document);
    setForm({
      vrsta: document.vrsta,
      naziv: document.naziv,
      datum_od: document.datum_od ?? '',
      datum_do: document.datum_do ?? '',
      iznos: document.iznos?.toString() ?? '',
      km: document.km?.toString() ?? '',
      serviser: document.serviser ?? '',
      dijelovi: document.dijelovi ?? '',
      napomena: document.napomena ?? '',
    });
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

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
      const input = {
        vrsta: form.vrsta,
        naziv: form.naziv.trim() || vrste[form.vrsta],
        datum_od: form.datum_od || null,
        datum_do: form.datum_do || null,
        iznos: form.iznos ? parseFloat(form.iznos) : null,
        km: form.km ? parseInt(form.km) : null,
        serviser: form.vrsta === 'servis' ? form.serviser.trim() || null : null,
        dijelovi: form.vrsta === 'servis' ? form.dijelovi.trim() || null : null,
        napomena: form.napomena.trim() || null,
      };
      if (editing) await updateVoziloDokument(editing, input, file);
      else await addVoziloDokument(voziloId, input, file);
      resetForm();
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
      if (editing?.id === d.id) resetForm();
      await load();
      onChange?.();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-base font-semibold text-slate-800">
        <Wrench className="h-4 w-4 text-slate-500" /> Servisi i održavanje
      </p>
      <p className="mb-3 text-xs text-slate-500">Servisna povijest prikazana je od najnovijeg zapisa. U servis možeš dodati trošak, kilometražu, servisera, dijelove i račun/dokument.</p>
      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="mb-3 space-y-1.5">
        {items.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">Još nema servisa ni dokumenata za ovo vozilo.</p>}
        {[...items].sort((a, b) => (b.datum_od ?? '').localeCompare(a.datum_od ?? '')).map((d) => {
          const st = status(d);
          return (
            <div key={d.id} className="relative flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                <Wrench className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words font-semibold text-slate-800">
                  {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">{d.naziv}</a> : d.naziv}
                </p>
                <p className="text-xs text-slate-500">
                  {vrste[d.vrsta] ?? d.vrsta} · {d.vrsta === 'servis' ? date(d.datum_od) : `${date(d.datum_od)} – ${date(d.datum_do)}`}
                  {d.km != null && ` · ${d.km.toLocaleString('hr-HR')} km`}
                  {d.iznos != null && ` · ${d.iznos.toLocaleString('hr-HR', { minimumFractionDigits: 2 })} €`}
                  {d.vrsta === 'servis' && d.datum_do && ` · idući ${date(d.datum_do)}`}
                </p>
                {d.vrsta === 'servis' && d.serviser && <p className="mt-2 text-xs text-slate-600"><strong>Serviser:</strong> {d.serviser}</p>}
                {d.vrsta === 'servis' && d.dijelovi && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600"><strong>Zamijenjeni dijelovi:</strong> {d.dijelovi}</p>}
                {d.napomena && <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{d.napomena}</p>}
                {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline"><Paperclip className="h-3 w-3" />Račun / dokument</a>}
              </div>
              {st && <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>}
              <button type="button" onClick={() => edit(d)} className="flex-shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-700" aria-label={`Uredi ${d.naziv}`}>
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => void remove(d)} className="flex-shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" aria-label="Obriši">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-800">{editing ? `Uredi: ${editing.naziv}` : 'Dodaj servis ili dokument'}</h4>
          {editing && <button type="button" onClick={resetForm} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"><X className="h-3.5 w-3.5" /> Odustani</button>}
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block min-w-0 text-xs text-slate-500">Vrsta zapisa
          <Select value={form.vrsta} onChange={(e) => setForm({ ...form, vrsta: e.target.value as VoziloDokumentVrsta })}>
            {Object.entries(vrste).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          </label>
          <label className="block min-w-0 text-xs text-slate-500">Naziv / opis
            <TextInput value={form.naziv} onChange={(e) => setForm({ ...form, naziv: e.target.value })} placeholder={isServis ? 'npr. veliki servis' : 'Naziv (neobavezno)'} />
          </label>
          <label className="block min-w-0 text-xs text-slate-500">{isServis ? 'Datum servisa' : 'Početak'}
            <TextInput type="date" value={form.datum_od} onChange={(e) => setForm({ ...form, datum_od: e.target.value })} />
          </label>
          <label className="block min-w-0 text-xs text-slate-500">{isServis ? 'Idući servis (datum)' : 'Kraj / istek'}
            <TextInput type="date" value={form.datum_do} onChange={(e) => setForm({ ...form, datum_do: e.target.value })} />
          </label>
          <label className="block min-w-0 text-xs text-slate-500">Kilometraža (km)
            <TextInput type="number" min="0" value={form.km} onChange={(e) => setForm({ ...form, km: e.target.value })} placeholder="npr. 125000" />
          </label>
          <label className="block min-w-0 text-xs text-slate-500">Cijena servisa / iznos (€)
            <TextInput type="number" min="0" step="0.01" value={form.iznos} onChange={(e) => setForm({ ...form, iznos: e.target.value })} placeholder="npr. 350,00" />
          </label>
        </div>
        {isServis && (
          <>
            <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block min-w-0 text-xs text-slate-500">Serviser / servisna radionica
                <TextInput value={form.serviser} onChange={(e) => setForm((previous) => ({ ...previous, serviser: e.target.value }))} placeholder="npr. Auto Centar Horvat" />
              </label>
              <label className="block min-w-0 text-xs text-slate-500">Zamijenjeni dijelovi
                <TextInput value={form.dijelovi} onChange={(e) => setForm((previous) => ({ ...previous, dijelovi: e.target.value }))} placeholder="npr. uljni i zračni filter" />
              </label>
            </div>
            <label className="block text-xs text-slate-500">Opis obavljenih radova
            <Textarea
              rows={3}
              value={form.napomena}
              onChange={(e) => setForm((previous) => ({ ...previous, napomena: e.target.value }))}
              placeholder={'npr. zamjena ulja i filtera\npregled kočnica\npregled ovjesa'}
            />
            </label>
          </>
        )}
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex min-w-0 max-w-full items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <Paperclip className="h-3.5 w-3.5 flex-shrink-0" /> <span className="min-w-0 truncate">{file ? file.name : editing?.putanja ? 'Zamijeni postojeći prilog' : 'Priloži datoteku'}</span>
          </button>
          <button type="button" onClick={() => void add()} disabled={saving} className="inline-flex items-center justify-center gap-1 rounded-lg bg-sky-600 xl:ml-auto px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">
            {editing ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {saving ? 'Spremanje…' : editing ? 'Spremi promjene' : 'Dodaj'}
          </button>
        </div>
        {editing?.putanja && !file && <p className="text-xs text-slate-500">Postojeći prilog ostaje spremljen ako ne odaberete novu datoteku.</p>}
      </div>
    </div>
  );
}
