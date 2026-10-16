import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, Clock, FileText, Gauge, Hammer, Package, Plus, Trash2, ListChecks } from 'lucide-react';
import type { GradilisteZadatak, RadniNalog } from '@/types';
import {
  addNalogStavka,
  addNalogZadatak,
  deleteGradilisteZadatak,
  deleteNalogDokument,
  deleteNalogFoto,
  deleteNalogStavka,
  fetchNalogDokumenti,
  fetchNalogFoto,
  fetchNalogIzvrsenje,
  fetchNalogRadnikVrijeme,
  fetchNalogStavke,
  fetchNalogZadaci,
  fetchGradilisteDokumenti,
  fetchNalogGradilisteDokumentIds,
  setNalogGradilisteDokument,
  saveNalogIzvrsenje,
  saveNalogRadnikVrijeme,
  setNalogTeren,
  setNalogPoslovodja,
  setNalogZavrsen,
  updateGradilisteZadatak,
  updateNalogStavka,
  uploadNalogDokument,
  uploadNalogFoto,
  type NalogDokument,
  type GradilisteDokument,
  type NalogFoto,
  type NalogRadnikVrijeme,
  type NalogStavka,
} from '@/lib/api';

function errText(reason: unknown, fallback: string) {
  if (reason && typeof reason === 'object' && 'message' in reason) return String((reason as { message: unknown }).message);
  return fallback;
}

const hint = ' Pokreni migraciju 20261015230000_nalog_izvrsenje.sql u Supabase SQL editoru.';
const hint2 = ' Pokreni migraciju 20261015240000_nalog_stavke_dokumenti.sql u Supabase SQL editoru.';

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function Checklist({
  items,
  placeholder,
  onAdd,
  onToggle,
  onRemove,
}: {
  items: NalogStavka[];
  placeholder: string;
  onAdd: (naziv: string) => void;
  onToggle: (s: NalogStavka) => void;
  onRemove: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText('');
  };
  return (
    <div>
      <div className="space-y-1.5">
        {items.map((s) => (
          <div key={s.id} className={`flex items-center gap-3 rounded-lg border px-3 py-1.5 text-sm ${s.gotovo ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100'}`}>
            <input type="checkbox" checked={s.gotovo} onChange={() => onToggle(s)} className="h-4 w-4 rounded border-slate-300" />
            <span className={`flex-1 ${s.gotovo ? 'text-emerald-800 line-through' : 'text-slate-800'}`}>{s.naziv}</span>
            <button onClick={() => onRemove(s.id)} className="text-slate-300 hover:text-red-600" aria-label="Obriši stavku">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-slate-400">Nema stavki.</p>}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button onClick={submit} disabled={!text.trim()} className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
          <Plus className="h-4 w-4" />
          Dodaj
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
      <span className="text-sky-600">{icon}</span>
      {children}
    </h4>
  );
}

export function NalogIzvrsenje({
  nalog,
  radnikIds,
  hideZadaci,
  onChange,
  slotId,
}: {
  nalog: Pick<RadniNalog, 'id' | 'gradiliste_id'> & Partial<Pick<RadniNalog, 'mobile_status'>>;
  radnikIds?: string[];
  hideZadaci?: boolean;
  slotId?: string;
  onChange?: (zavrsen: boolean) => void;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(slotId ? document.getElementById(slotId) : null);
  }, [slotId]);
  const [zavrsen, setZavrsen] = useState(false);
  const [teren, setTeren] = useState(false);
  const [poslovodja, setPoslovodja] = useState<string | null>(null);

  const changePoslovodja = (radnikId: string | null) => {
    setPoslovodja(radnikId);
    void guard(async () => {
      await setNalogPoslovodja(nalog.id, radnikId);
      onChange?.(zavrsen);
    }, 'Greška pri spremanju poslovođe.');
  };
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [km, setKm] = useState({ pocetak: '', kraj: '' });
  const [stavke, setStavke] = useState<NalogStavka[]>([]);
  const [napomena, setNapomena] = useState('');
  const [dokumenti, setDokumenti] = useState<NalogDokument[]>([]);
  const [gradDokumenti, setGradDokumenti] = useState<GradilisteDokument[]>([]);
  const [gradLinked, setGradLinked] = useState<string[]>([]);
  const docRef = useRef<HTMLInputElement>(null);
  const [vremena, setVremena] = useState<NalogRadnikVrijeme[]>([]);
  const [zadaci, setZadaci] = useState<GradilisteZadatak[]>([]);
  const [newZadatak, setNewZadatak] = useState('');
  const [foto, setFoto] = useState<NalogFoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    const [izv, vr, zad, fo, st, dok] = await Promise.allSettled([
      fetchNalogIzvrsenje(nalog.id),
      fetchNalogRadnikVrijeme(nalog.id),
      fetchNalogZadaci(nalog.id),
      fetchNalogFoto(nalog.id),
      fetchNalogStavke(nalog.id),
      fetchNalogDokumenti(nalog.id),
    ]);
    if (izv.status === 'fulfilled') {
      setKm({ pocetak: izv.value.km_pocetak?.toString() ?? '', kraj: izv.value.km_kraj?.toString() ?? '' });
      setNapomena(izv.value.napomena ?? '');
      setZavrsen(izv.value.status === 'zavrsen');
      setTeren(Boolean(izv.value.teren));
      setPoslovodja(izv.value.poslovodja_id ?? null);
    } else setError(errText(izv.reason, 'Greška pri učitavanju.') + hint + ' Za napomene pokreni i 20261015250000_nalog_napomena.sql.');
    if (st.status === 'fulfilled') setStavke(st.value);
    else setError((e) => e ?? errText(st.reason, 'Greška pri učitavanju materijala i alata.') + hint2);
    if (dok.status === 'fulfilled') setDokumenti(dok.value);
    else setError((e) => e ?? errText(dok.reason, 'Greška pri učitavanju dokumenata.') + hint2);
    if (vr.status === 'fulfilled') {
      const withDefault = vr.value.map((v) => (v.vrijeme_od ? v : { ...v, vrijeme_od: '06:00:00' }));
      setVremena(withDefault);
      vr.value
        .filter((v) => !v.vrijeme_od)
        .forEach((v) => void saveNalogRadnikVrijeme(nalog.id, v.radnik_id, '06:00', v.vrijeme_do).catch(() => undefined));
    }
    else setError((e) => e ?? errText(vr.reason, 'Greška pri učitavanju radnika.') + hint);
    if (zad.status === 'fulfilled') setZadaci(zad.value);
    else setError((e) => e ?? errText(zad.reason, 'Greška pri učitavanju zadataka.') + ' Pokreni migraciju 20261015220000_zadaci_nalog_veza.sql.');
    if (fo.status === 'fulfilled') setFoto(fo.value);
    else setError((e) => e ?? errText(fo.reason, 'Greška pri učitavanju fotografija.') + hint);
    if (nalog.gradiliste_id) setGradDokumenti(await fetchGradilisteDokumenti(nalog.gradiliste_id).catch(() => []));
    setGradLinked(await fetchNalogGradilisteDokumentIds(nalog.id).catch(() => []));
  }, [nalog.id, nalog.gradiliste_id]);

  const ownPaths = new Set([...dokumenti.map((d) => d.putanja), ...foto.map((f) => f.putanja)]);
  const pickerDocs = gradDokumenti.filter((d) => !ownPaths.has(d.putanja));
  const toggleGradDok = async (id: string, on: boolean) => {
    setGradLinked((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));
    try {
      await setNalogGradilisteDokument(nalog.id, id, on);
    } catch (e) {
      setGradLinked((prev) => (on ? prev.filter((x) => x !== id) : [...prev, id]));
      setError(errText(e, 'Greška pri spremanju odabira dokumenta.') + ' Pokreni migraciju 20261015300000_nalog_gradiliste_dokumenti.sql.');
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const guard = async (action: () => Promise<void>, fallback: string) => {
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(errText(reason, fallback) + hint);
    }
  };

  const changeTeren = (value: boolean) => {
    setTeren(value);
    void guard(async () => {
      await setNalogTeren(nalog.id, value);
      onChange?.(zavrsen);
    }, 'Greška pri spremanju oznake teren.');
  };

  const toggleZavrsen = (value: boolean) => {
    if (value) {
      if (nalog.mobile_status === 'dodijeljen' || nalog.mobile_status === 'u_tijeku') {
        setError('Djelatnici još rade na nalogu. Zaključivanje je moguće tek nakon što poslovođa preda završni izvještaj.');
        return;
      }
      const radnici = radnikIds ? vremena.filter((v) => radnikIds.includes(v.radnik_id)) : vremena;
      if (radnici.some((v) => !v.vrijeme_od || !v.vrijeme_do)) {
        setError('Nalog se ne može zaključiti dok nije upisan završetak rada (Do) za sve radnike.');
        return;
      }
      const missing: string[] = [];
      if (km.pocetak === '' || km.kraj === '') missing.push('kilometre');
      const poruka = missing.length > 0
        ? `Nije upisano: ${missing.join(', ')}.\n\nKilometri se neće obračunati. Zaključiti nalog svejedno?`
        : 'Zaključiti radni nalog? Sati i kilometri upisat će se u trošak gradilišta, a neriješeni zadaci, materijal i alat prenose se na idući nalog.';
      if (!window.confirm(poruka)) return;
    }
    void guard(async () => {
      if (value) {
        const pocetak = km.pocetak === '' ? null : Number(km.pocetak);
        const kraj = km.kraj === '' ? null : Number(km.kraj);
        await saveNalogIzvrsenje(nalog.id, { km_pocetak: pocetak, km_kraj: kraj, napomena: napomena.trim() || null });
      }
      await setNalogZavrsen(nalog.id, value);
      setZavrsen(value);
      onChange?.(value);
    }, 'Greška pri zaključivanju naloga.');
  };

  const saveDetails = () =>
    guard(async () => {
      const toNum = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v))));
      const pocetak = toNum(km.pocetak);
      const kraj = toNum(km.kraj);
      if ((pocetak !== null && Number.isNaN(pocetak)) || (kraj !== null && Number.isNaN(kraj))) throw new Error('Kilometri moraju biti broj.');
      if (pocetak !== null && kraj !== null && kraj < pocetak) throw new Error('Završno stanje ne može biti manje od početnog.');
      await saveNalogIzvrsenje(nalog.id, { km_pocetak: pocetak, km_kraj: kraj, napomena: napomena.trim() || null });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    }, 'Greška pri spremanju.');

  const changeVrijeme = (radnikId: string, field: 'vrijeme_od' | 'vrijeme_do', value: string) => {
    const next = vremena.map((v) => (v.radnik_id === radnikId ? { ...v, [field]: value || null } : v));
    setVremena(next);
    const row = next.find((v) => v.radnik_id === radnikId);
    if (row) void guard(() => saveNalogRadnikVrijeme(nalog.id, radnikId, row.vrijeme_od, row.vrijeme_do), 'Greška pri spremanju vremena.');
  };

  const addZadatak = () => {
    const naziv = newZadatak.trim();
    if (!naziv || !nalog.gradiliste_id) return;
    const gradilisteId = nalog.gradiliste_id;
    void guard(async () => {
      await addNalogZadatak(nalog.id, gradilisteId, naziv);
      setNewZadatak('');
      setZadaci(await fetchNalogZadaci(nalog.id));
    }, 'Greška pri dodavanju zadatka.');
  };

  const toggleZadatak = (z: GradilisteZadatak) => {
    setZadaci((prev) => prev.map((x) => (x.id === z.id ? { ...x, gotovo: !z.gotovo } : x)));
    void guard(() => updateGradilisteZadatak(z.id, { gotovo: !z.gotovo }), 'Greška pri spremanju zadatka.');
  };

  const removeZadatak = (id: string) =>
    void guard(async () => {
      await deleteGradilisteZadatak(id);
      setZadaci((prev) => prev.filter((x) => x.id !== id));
    }, 'Greška pri brisanju zadatka.');

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    await guard(async () => {
      for (const file of Array.from(files)) await uploadNalogFoto(nalog.id, file);
      setFoto(await fetchNalogFoto(nalog.id));
    }, 'Greška pri učitavanju fotografije.');
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeFoto = (f: NalogFoto) =>
    void guard(async () => {
      await deleteNalogFoto(f);
      setFoto((prev) => prev.filter((x) => x.id !== f.id));
    }, 'Greška pri brisanju fotografije.');

  const reloadStavke = async () => setStavke(await fetchNalogStavke(nalog.id));
  const addStavka = (tip: 'materijal' | 'alat', naziv: string) =>
    void guard(async () => {
      await addNalogStavka(nalog.id, tip, naziv);
      await reloadStavke();
    }, 'Greška pri dodavanju stavke.');
  const toggleStavka = (s: NalogStavka) => {
    setStavke((prev) => prev.map((x) => (x.id === s.id ? { ...x, gotovo: !s.gotovo } : x)));
    void guard(() => updateNalogStavka(s.id, { gotovo: !s.gotovo }), 'Greška pri spremanju stavke.');
  };
  const removeStavka = (id: string) =>
    void guard(async () => {
      await deleteNalogStavka(id);
      setStavke((prev) => prev.filter((x) => x.id !== id));
    }, 'Greška pri brisanju stavke.');

  const onDocs = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    await guard(async () => {
      for (const file of Array.from(files)) await uploadNalogDokument(nalog.id, file);
      setDokumenti(await fetchNalogDokumenti(nalog.id));
    }, 'Greška pri učitavanju dokumenta.');
    setUploading(false);
    if (docRef.current) docRef.current.value = '';
  };

  const removeDokument = (d: NalogDokument) =>
    void guard(async () => {
      await deleteNalogDokument(d);
      setDokumenti((prev) => prev.filter((x) => x.id !== d.id));
    }, 'Greška pri brisanju dokumenta.');

  const kmRazlika = km.pocetak !== '' && km.kraj !== '' && Number(km.kraj) >= Number(km.pocetak) ? Number(km.kraj) - Number(km.pocetak) : null;
  const inputCls = 'rounded-lg border border-slate-300 px-3 py-1.5 text-sm';
  const visibleVremena = radnikIds ? vremena.filter((v) => radnikIds.includes(v.radnik_id)) : vremena;

  return (
    <div className={`md:columns-2 md:gap-x-6 [&>*]:mb-5 [&>*]:break-inside-avoid ${hideZadaci ? '' : 'mt-5 border-t border-slate-100 pt-4'}`}>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {slot && createPortal(
        zavrsen ? (
          <div className="flex items-center gap-2 text-sm text-emerald-800">
            <Check className="h-4 w-4" />
            Zaključen
            <button onClick={() => toggleZavrsen(false)} className="rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">Ponovno otvori</button>
          </div>
        ) : (
          <button onClick={() => toggleZavrsen(true)} disabled={nalog.mobile_status === 'dodijeljen' || nalog.mobile_status === 'u_tijeku'} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
            <Check className="h-4 w-4" />
            {nalog.mobile_status === 'predan' ? 'Odobri i zaključi nalog' : nalog.mobile_status === 'dodijeljen' || nalog.mobile_status === 'u_tijeku' ? 'Čeka izvještaj djelatnika' : 'Zaključi radni nalog'}
          </button>
        ),
        slot,
      )}
      <div className={hideZadaci ? 'hidden' : undefined}>
        <SectionTitle icon={<ListChecks className="h-4 w-4" />}>
          Radni zadaci ({zadaci.filter((z) => z.gotovo).length}/{zadaci.length})
        </SectionTitle>
        <div className="space-y-1.5">
          {zadaci.map((z) => (
            <div key={z.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${z.gotovo ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100'}`}>
              <input type="checkbox" checked={z.gotovo} onChange={() => toggleZadatak(z)} className="h-4 w-4 rounded border-slate-300" />
              <span className={`flex-1 ${z.gotovo ? 'text-emerald-800 line-through' : 'text-slate-800'}`}>{z.naziv}</span>
              <button onClick={() => removeZadatak(z.id)} className="text-slate-300 hover:text-red-600" aria-label="Obriši zadatak">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {zadaci.length === 0 && <p className="text-xs text-slate-400">Nema zadataka na ovom nalogu.</p>}
        </div>
        {nalog.gradiliste_id && (
          <div className="mt-2 flex gap-2">
            <input
              value={newZadatak}
              onChange={(e) => setNewZadatak(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addZadatak(); }}
              placeholder="Novi radni zadatak"
              className={`${inputCls} flex-1`}
            />
            <button onClick={addZadatak} disabled={!newZadatak.trim()} className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              <Plus className="h-4 w-4" />
              Dodaj
            </button>
          </div>
        )}
      </div>

      <div>
        <SectionTitle icon={<Clock className="h-4 w-4" />}>Radno vrijeme radnika</SectionTitle>
        <label className={`mb-2 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${teren ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-slate-200 text-slate-700'}`}>
          <input type="checkbox" checked={teren} onChange={(e) => changeTeren(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Teren (dodatno se obračunava)
        </label>
        {visibleVremena.length === 0 ? (
          <p className="text-xs text-slate-400">Na nalogu nema radnika.</p>
        ) : (
          <div className="space-y-1.5">
            {visibleVremena.map((v) => {
              const od = v.vrijeme_od ? toMinutes(v.vrijeme_od) : null;
              const doo = v.vrijeme_do ? toMinutes(v.vrijeme_do) : null;
              const mins = od !== null && doo !== null ? (doo >= od ? doo - od : doo + 1440 - od) : null;
              let nocne = 0;
              if (od !== null && mins) {
                for (let m = od; m < od + mins; m++) {
                  const t = m % 1440;
                  if (t >= 1320 || t < 360) nocne++;
                }
              }
              return (
                <div key={v.radnik_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <span className="min-w-[140px] flex-1 text-slate-800">{v.radnik ? `${v.radnik.ime} ${v.radnik.prezime}` : 'Radnik'}</span>
                  <label className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-0.5 text-xs ${poslovodja === v.radnik_id ? 'bg-amber-100 font-semibold text-amber-800' : 'text-slate-500'}`}>
                    <input
                      type="radio"
                      name={`poslovodja-${nalog.id}`}
                      checked={poslovodja === v.radnik_id}
                      onChange={() => changePoslovodja(v.radnik_id)}
                    />
                    Poslovođa
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    Od
                    <input type="time" value={v.vrijeme_od?.slice(0, 5) ?? ''} onChange={(e) => changeVrijeme(v.radnik_id, 'vrijeme_od', e.target.value)} className={inputCls} />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    Do
                    <input type="time" value={v.vrijeme_do?.slice(0, 5) ?? ''} onChange={(e) => changeVrijeme(v.radnik_id, 'vrijeme_do', e.target.value)} className={inputCls} />
                  </label>
                  <span className="min-w-[70px] text-right text-xs font-medium text-slate-600">
                    {mins !== null && mins > 0 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : '—'}
                    {nocne > 0 && (
                      <span className="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700">
                        noćni {Math.floor(nocne / 60)}h {String(nocne % 60).padStart(2, '0')}m
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <SectionTitle icon={<Gauge className="h-4 w-4" />}>Kilometri</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Početno stanje
            <input type="number" min={0} value={km.pocetak} onChange={(e) => setKm({ ...km, pocetak: e.target.value })} onBlur={() => void saveDetails()} className={`${inputCls} w-32`} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Završno stanje
            <input type="number" min={0} value={km.kraj} onChange={(e) => setKm({ ...km, kraj: e.target.value })} onBlur={() => void saveDetails()} className={`${inputCls} w-32`} />
          </label>
          {kmRazlika !== null && <span className="text-xs font-medium text-slate-600">Prijeđeno: {kmRazlika.toLocaleString('hr-HR')} km</span>}
        </div>
      </div>

      <div className="grid gap-4">
        <div>
          <SectionTitle icon={<Package className="h-4 w-4" />}>
            Materijal potreban za dalje ({stavke.filter((s) => s.tip === 'materijal' && s.gotovo).length}/{stavke.filter((s) => s.tip === 'materijal').length})
          </SectionTitle>
          <Checklist
            items={stavke.filter((s) => s.tip === 'materijal')}
            placeholder="npr. boja bijela 15 l"
            onAdd={(n) => addStavka('materijal', n)}
            onToggle={toggleStavka}
            onRemove={removeStavka}
          />
        </div>
        <div>
          <SectionTitle icon={<Hammer className="h-4 w-4" />}>
            Alat potreban za dalje ({stavke.filter((s) => s.tip === 'alat' && s.gotovo).length}/{stavke.filter((s) => s.tip === 'alat').length})
          </SectionTitle>
          <Checklist
            items={stavke.filter((s) => s.tip === 'alat')}
            placeholder="npr. skela, brusilica"
            onAdd={(n) => addStavka('alat', n)}
            onToggle={toggleStavka}
            onRemove={removeStavka}
          />
        </div>
      </div>
      <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 shadow-[0_0_14px_rgba(251,191,36,0.55)] ring-2 ring-amber-200/70">
        <SectionTitle icon={<FileText className="h-4 w-4 text-amber-600" />}>Napomene</SectionTitle>
        <textarea rows={3} value={napomena} onChange={(e) => setNapomena(e.target.value)} onBlur={() => void saveDetails()} placeholder="Dodatne napomene uz nalog…"         className={`${inputCls} w-full border-amber-300 bg-white font-medium text-slate-900`} />
              </div>
      <div className="flex items-center gap-3">
        <button onClick={() => void saveDetails()} className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
          Spremi kilometre i napomene
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <Check className="h-3.5 w-3.5" /> Spremljeno
          </span>
        )}
      </div>

      {pickerDocs.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3">
          <SectionTitle icon={<FileText className="h-4 w-4" />}>Dokumenti i slike gradilišta — označi one koji se prikazuju na ovom nalogu ({gradLinked.length}/{pickerDocs.length})</SectionTitle>
          <div className="grid gap-1.5 md:grid-cols-2">
            {pickerDocs.map((d) => (
              <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-sky-100 bg-white px-3 py-1.5 text-sm">
                <input type="checkbox" checked={gradLinked.includes(d.id)} onChange={(e) => void toggleGradDok(d.id, e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-sky-600" />
                {d.vrsta === 'slika' ? <img src={d.url} alt="" className="h-6 w-6 rounded object-cover" /> : <FileText className="h-4 w-4 flex-shrink-0 text-slate-400" />}
                <a href={d.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sky-700 hover:underline">{d.naziv}</a>
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionTitle icon={<FileText className="h-4 w-4" />}>Dokumenti ({dokumenti.length})</SectionTitle>
        <input ref={docRef} type="file" multiple className="hidden" onChange={(e) => void onDocs(e.target.files)} />
        <div className="mb-2 space-y-1.5">
          {dokumenti.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-1.5 text-sm">
              <FileText className="h-4 w-4 flex-shrink-0 text-slate-400" />
              <a href={d.url} target="_blank" rel="noreferrer" download={d.naziv} className="min-w-0 flex-1 truncate text-sky-700 hover:underline">
                {d.naziv}
              </a>
              <span className="text-xs text-slate-400">{formatSize(d.velicina)}</span>
              <button onClick={() => removeDokument(d)} className="text-slate-300 hover:text-red-600" aria-label="Obriši dokument">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => docRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {uploading ? 'Učitavanje…' : 'Dodaj dokumente (PDF, Excel, Word…)'}
        </button>
      </div>

      <div>
        <SectionTitle icon={<Camera className="h-4 w-4" />}>Fotografije ({foto.length})</SectionTitle>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="mb-3 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {uploading ? 'Učitavanje…' : 'Dodaj fotografije'}
        </button>
        {foto.length > 0 && (
          <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
            {foto.map((f) => (
              <div key={f.id} className="group relative overflow-hidden rounded-lg border border-slate-200">
                <a href={f.url} target="_blank" rel="noreferrer">
                  <img src={f.url} alt={f.naziv ?? 'Fotografija'} className="h-28 w-full object-cover" />
                </a>
                <button
                  onClick={() => removeFoto(f)}
                  className="absolute right-1 top-1 hidden rounded bg-white/90 p-1 text-red-600 group-hover:block"
                  aria-label="Obriši fotografiju"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function toMinutes(t: string) {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}
