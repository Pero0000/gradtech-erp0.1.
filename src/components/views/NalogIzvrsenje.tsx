import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, FileText, Gauge, Hammer, History, Package, Plus, Trash2, X, ListChecks, Wrench } from 'lucide-react';
import type { GradilisteZadatak, Oprema, RadniNalog, ZadatakVrsta } from '@/types';
import { zadatakVrsta } from '@/types';
import {
  addNalogStavka,
  addNalogAlatFromInventory,
  addNalogStrojFromInventory,
  addNalogZadatak,
  deleteGradilisteZadatak,
  deleteNalogDokument,
  deleteNalogFoto,
  deleteNalogStavka,
  fetchNalogDokumenti,
  fetchNalogFoto,
  fetchNalogIzvrsenje,
  fetchOprema,
  fetchNalogRadnikVrijeme,
  fetchNalogStavke,
  fetchNalogZadaci,
  fetchGradilisteDokumenti,
  fetchNalogGradilisteDokumentIds,
  fetchMobileWorkOrderAudit,
  setNalogGradilisteDokument,
  saveNalogIzvrsenje,
  saveNalogRadnikVrijeme,
  setNalogTeren,
  setNalogPoslovodja,
  setNalogVozac,
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
  type MobileWorkOrderAuditEntry,
} from '@/lib/api';

function errText(reason: unknown, fallback: string) {
  if (reason && typeof reason === 'object' && 'message' in reason) return String((reason as { message: unknown }).message);
  return fallback;
}

const hint = ' Pokreni migraciju 20261015230000_nalog_izvrsenje.sql u Supabase SQL editoru.';
const hint2 = ' Pokreni migraciju 20261015240000_nalog_stavke_dokumenti.sql u Supabase SQL editoru.';
const auditActions: Record<string, string> = {
  worker_assigned: 'Djelatnik je dodijeljen nalogu',
  worker_unassigned: 'Djelatnik je uklonjen s naloga',
  worker_time_updated: 'Radno vrijeme je uneseno ili izmijenjeno',
  worker_started: 'Početak rada je evidentiran',
  worker_finished: 'Završetak rada je evidentiran',
  order_reviewed: 'Potvrđen je pregled naloga',
  order_started: 'Rad na nalogu je započet',
  order_submitted: 'Djelatnik je potvrdio i predao nalog',
  order_approved: 'Nalog je odobren',
  order_status_changed: 'Status naloga je promijenjen',
  report_updated: 'Završni izvještaj je izmijenjen',
  report_confirmations_updated: 'Potvrde izvještaja su izmijenjene',
  item_added: 'Dodana je stavka materijala/alata',
  item_removed: 'Uklonjena je stavka materijala/alata',
  item_checked: 'Stavka materijala/alata je označena',
  item_updated: 'Stavka materijala/alata je izmijenjena',
  photo_added: 'Dodana je fotografija',
  photo_removed: 'Uklonjena je fotografija',
  document_added: 'Dodana je datoteka',
  document_removed: 'Uklonjena je datoteka',
  task_added: 'Dodan je radni zadatak',
  task_removed: 'Uklonjen je radni zadatak',
  task_checked: 'Status radnog zadatka je promijenjen',
};
const auditDetailLabels: Record<string, string> = {
  radnik: 'Djelatnik',
  old_start: 'Početak prije izmjene',
  new_start: 'Novi početak',
  old_finish: 'Završetak prije izmjene',
  new_finish: 'Novi završetak',
  km_pocetak: 'Početni kilometri',
  km_kraj: 'Završni kilometri',
  napomena: 'Napomena',
  mobile_km_na: 'Kilometri nisu primjenjivi',
  mobile_napomena_na: 'Napomena nije primjenjiva',
  mobile_tasks_confirmed: 'Zadaci potvrđeni',
  mobile_foto_na: 'Fotografija nije primjenjiva',
  mobile_materijal_na: 'Materijal nije potreban',
  mobile_alat_na: 'Alat nije potreban',
  old_status: 'Prethodni status',
  new_status: 'Novi status',
  old_potvrde: 'Prethodne potvrde',
  new_potvrde: 'Nove potvrde',
  tip: 'Vrsta',
  naziv: 'Naziv',
  gotovo: 'Završeno',
};

function auditValue(value: unknown) {
  if (typeof value === 'boolean') return value ? 'Da' : 'Ne';
  if (value === null) return '—';
  if (Array.isArray(value)) return value.join(', ') || '—';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function AuditLog({ entries }: { entries: MobileWorkOrderAuditEntry[] }) {
  return (
    <div className="pt-3">
      {entries.length === 0 ? (
        <p className="text-xs text-slate-500">Još nema zabilježenih promjena.</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-sm font-medium text-slate-800">
                {auditActions[entry.action] ?? entry.action.replace(/_/g, ' ')}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {entry.actor_name} · {new Date(entry.created_at).toLocaleString('hr-HR')}
              </p>
              {Object.entries(entry.details)
                .filter(([, value]) => value !== undefined)
                .map(([key, value]) => (
                  <p key={key} className="mt-1 break-words text-xs text-slate-600">
                    {auditDetailLabels[key] ?? key}: {auditValue(value)}
                  </p>
                ))}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ResolvedStavkeHistory({ items, onToggle }: { items: NalogStavka[]; onToggle: (item: NalogStavka) => void }) {
  const [showHistory, setShowHistory] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={showHistory}
        onClick={() => setShowHistory((open) => !open)}
        className="mb-2 border-b-2 border-transparent px-2.5 py-2 text-xs font-semibold text-slate-600 hover:border-sky-600 hover:text-sky-800"
      >
        {showHistory ? 'Sakrij povijest' : `Povijest (${items.length})`}
      </button>
      {showHistory && <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2">
        {items.length === 0 && <p className="text-xs text-slate-400">Povijest je prazna.</p>}
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm">
            <input type="checkbox" checked onChange={() => onToggle(item)} className="h-4 w-4 rounded border-slate-300 accent-emerald-600" />
            <span className="flex-1 text-emerald-800 line-through">{item.naziv}</span>
            <span className="text-xs text-emerald-700">Riješeno</span>
          </label>
        ))}
      </div>}
    </div>
  );
}

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function Checklist({
  items,
  placeholder,
  onAdd,
  equipment,
  equipmentLabel = 'alat',
  onAddEquipment,
  onHoursChange,
  onHoursSave,
  onToggle,
  onRemove,
}: {
  items: NalogStavka[];
  placeholder: string;
  onAdd?: (naziv: string) => void;
  equipment?: Oprema[];
  equipmentLabel?: 'alat' | 'stroj';
  onAddEquipment?: (opremaId: string) => void;
  onHoursChange?: (s: NalogStavka, value: string) => void;
  onHoursSave?: (s: NalogStavka) => void;
  onToggle: (s: NalogStavka) => void;
  onRemove: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const [selectedEquipmentId, setSelectedEquipmentId] = useState('');
  const submit = () => {
    if (!text.trim() || !onAdd) return;
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
            {onHoursChange && (
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={s.sati ?? ''}
                  onChange={(e) => onHoursChange(s, e.target.value)}
                  onBlur={() => onHoursSave?.(s)}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
                  aria-label={`Radni sati stroja ${s.naziv}`}
                />
                h
              </label>
            )}
            <button onClick={() => onRemove(s.id)} className="text-slate-300 hover:text-red-600" aria-label="Obriši stavku">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-slate-400">Nema stavki.</p>}
      </div>
      {onAdd && (
        <div className="mt-2 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button onClick={submit} disabled={!text.trim()} className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
            <Plus className="h-4 w-4" />
            Dodaj
          </button>
        </div>
      )}
      {equipment && onAddEquipment && (
        <div className="mt-2 flex gap-2">
          <select
            value={selectedEquipmentId}
            onChange={(event) => setSelectedEquipmentId(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">{equipmentLabel === 'stroj' ? 'Odaberi stroj iz popisa strojeva…' : 'Odaberi alat iz popisa opreme…'}</option>
            {equipment.map((item) => (
              <option key={item.id} value={item.id}>
                {item.naziv}{item.inventarski_broj ? ` · ${item.inventarski_broj}` : ''}
                {item.gradilista?.naziv ? ` — ${item.gradilista.naziv}` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              if (!selectedEquipmentId) return;
              onAddEquipment(selectedEquipmentId);
              setSelectedEquipmentId('');
            }}
            disabled={!selectedEquipmentId}
            className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {equipmentLabel === 'stroj' ? 'Dodaj stroj' : 'Dodaj alat'}
          </button>
        </div>
      )}
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
  hideStavke,
  visualSections = false,
  onChange,
  slotId,
}: {
  nalog: Pick<RadniNalog, 'id' | 'gradiliste_id'> & Partial<Pick<RadniNalog, 'status' | 'mobile_status'>>;
  radnikIds?: string[];
  hideZadaci?: boolean;
  hideStavke?: boolean;
  visualSections?: boolean;
  slotId?: string;
  onChange?: (zavrsen: boolean) => void;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(slotId ? document.getElementById(slotId) : null);
  }, [slotId]);
  const [zavrsen, setZavrsen] = useState(false);
  const [bezIzvrsenja, setBezIzvrsenja] = useState(false);
  const [teren, setTeren] = useState(false);
  const [poslovodja, setPoslovodja] = useState<string | null>(null);
  const [vozac, setVozac] = useState<string | null>(null);

  const changePoslovodja = (radnikId: string | null) => {
    setPoslovodja(radnikId);
    void guard(async () => {
      await setNalogPoslovodja(nalog.id, radnikId);
      onChange?.(zavrsen);
    }, 'Greška pri spremanju poslovođe.');
  };
  const changeVozac = (radnikId: string | null) => {
    setVozac(radnikId);
    void guard(async () => {
      await setNalogVozac(nalog.id, radnikId);
      onChange?.(zavrsen);
    }, 'Greška pri spremanju vozača.');
  };
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [km, setKm] = useState({ pocetak: '', kraj: '' });
  const [stavke, setStavke] = useState<NalogStavka[]>([]);
  const [alati, setAlati] = useState<Oprema[]>([]);
  const [strojevi, setStrojevi] = useState<Oprema[]>([]);
  const [napomena, setNapomena] = useState('');
  const [dokumenti, setDokumenti] = useState<NalogDokument[]>([]);
  const [gradDokumenti, setGradDokumenti] = useState<GradilisteDokument[]>([]);
  const [gradLinked, setGradLinked] = useState<string[]>([]);
  const docRef = useRef<HTMLInputElement>(null);
  const [vremena, setVremena] = useState<NalogRadnikVrijeme[]>([]);
  const [zadaci, setZadaci] = useState<GradilisteZadatak[]>([]);
  const [newZadatak, setNewZadatak] = useState<Record<ZadatakVrsta, string>>({ zadatak: '', dodatni: '' });
  const [foto, setFoto] = useState<NalogFoto[]>([]);
  const [selectedFotoId, setSelectedFotoId] = useState<string | null>(null);
  const [audit, setAudit] = useState<MobileWorkOrderAuditEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedFotoIndex = foto.findIndex((f) => f.id === selectedFotoId);
  const selectedFoto = selectedFotoIndex >= 0 ? foto[selectedFotoIndex] : null;

  const navigateFoto = useCallback((direction: -1 | 1) => {
    if (selectedFotoIndex < 0 || foto.length < 2) return;
    const nextIndex = (selectedFotoIndex + direction + foto.length) % foto.length;
    setSelectedFotoId(foto[nextIndex].id);
  }, [foto, selectedFotoIndex]);

  useEffect(() => {
    if (!selectedFoto) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedFotoId(null);
      if (event.key === 'ArrowLeft') navigateFoto(-1);
      if (event.key === 'ArrowRight') navigateFoto(1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateFoto, selectedFoto]);

  const load = useCallback(async () => {
    setError(null);
    const [izv, vr, zad, fo, st, dok, history, inventory, machines] = await Promise.allSettled([
      fetchNalogIzvrsenje(nalog.id),
      fetchNalogRadnikVrijeme(nalog.id),
      fetchNalogZadaci(nalog.id),
      fetchNalogFoto(nalog.id),
      fetchNalogStavke(nalog.id),
      fetchNalogDokumenti(nalog.id),
      fetchMobileWorkOrderAudit(nalog.id),
      fetchOprema('alat'),
      fetchOprema('stroj'),
    ]);
    if (izv.status === 'fulfilled') {
      setKm({ pocetak: izv.value.km_pocetak?.toString() ?? '', kraj: izv.value.km_kraj?.toString() ?? '' });
      setNapomena(izv.value.napomena ?? '');
      setZavrsen(izv.value.status === 'zavrsen');
      setBezIzvrsenja(Boolean(izv.value.bez_izvrsenja));
      setTeren(Boolean(izv.value.teren));
      setPoslovodja(izv.value.poslovodja_id ?? null);
      setVozac(izv.value.vozac_id ?? null);
      // Jedini djelatnik na nalogu automatski postaje poslovođa.
      if (!izv.value.poslovodja_id && vr.status === 'fulfilled' && vr.value.length === 1) {
        const only = vr.value[0].radnik_id;
        setPoslovodja(only);
        void setNalogPoslovodja(nalog.id, only).catch(() => undefined);
      }
    } else setError(errText(izv.reason, 'Greška pri učitavanju.') + hint + ' Za napomene pokreni i 20261015250000_nalog_napomena.sql.');
    if (st.status === 'fulfilled') setStavke(st.value);
    else setError((e) => e ?? errText(st.reason, 'Greška pri učitavanju materijala i alata.') + hint2);
    if (inventory.status === 'fulfilled') setAlati(inventory.value.filter((item) => item.status !== 'servis' && item.status !== 'neaktivno'));
    else setError((e) => e ?? errText(inventory.reason, 'Greška pri učitavanju popisa alata.'));
    if (machines.status === 'fulfilled') setStrojevi(machines.value.filter((item) => item.status !== 'servis' && item.status !== 'neaktivno'));
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
    if (history.status === 'fulfilled') setAudit(history.value);
    else setError((e) => e ?? errText(history.reason, 'Greška pri učitavanju povijesti promjena.') + ' Pokreni migraciju 20261016200000_mobile_work_order_audit.sql.');
    if (nalog.gradiliste_id) setGradDokumenti(await fetchGradilisteDokumenti(nalog.gradiliste_id).catch(() => []));
    setGradLinked(await fetchNalogGradilisteDokumentIds(nalog.id).catch(() => []));
  }, [nalog.id, nalog.gradiliste_id]);

  useEffect(() => {
    const refreshAudit = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchMobileWorkOrderAudit(nalog.id)
        .then(setAudit)
        .catch((reason: unknown) => setError(errText(reason, 'Greška pri osvježavanju povijesti promjena.')));
    };
    const timer = window.setInterval(refreshAudit, 30_000);
    document.addEventListener('visibilitychange', refreshAudit);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshAudit);
    };
  }, [nalog.id]);

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

  const toggleZavrsen = (value: boolean, bezPotvrdeDjelatnika = false, zavrsiBezIzvrsenja = false) => {
    if (zavrsiBezIzvrsenja) {
      const nijeZapoceo = !nalog.mobile_status
        ? nalog.status === 'otvoren'
        : nalog.mobile_status === 'dodijeljen'
          && nalog.status !== 'zavrsen'
          && nalog.status !== 'otkazan';
      if (!nijeZapoceo) {
        setError('Bez izvršenja može se završiti samo otvoren nalog ili poslan nalog na kojem djelatnik još nije započeo rad.');
        return;
      }
      if (!window.confirm('Ovaj radni nalog bit će uklonjen iz otvorenih naloga djelatnika i označen kao završen bez izvršenja. Neće se obračunati sati ni troškovi, a nezavršeni zadaci vratit će se na gradilište. Nastaviti?')) return;
    }
    if (value) {
      if (!zavrsiBezIzvrsenja && !bezPotvrdeDjelatnika && (nalog.mobile_status === 'dodijeljen' || nalog.mobile_status === 'u_tijeku')) {
        setError('Djelatnici još rade na nalogu. Zaključivanje je moguće tek nakon što poslovođa preda završni izvještaj.');
        return;
      }
      const radnici = radnikIds ? vremena.filter((v) => radnikIds.includes(v.radnik_id)) : vremena;
      if (!zavrsiBezIzvrsenja && !bezPotvrdeDjelatnika && radnici.some((v) => !v.vrijeme_od || !v.vrijeme_do)) {
        setError('Nalog se ne može zaključiti dok nije upisan završetak rada (Do) za sve radnike.');
        return;
      }
      const missing: string[] = [];
      if (km.pocetak === '' || km.kraj === '') missing.push('kilometre');
      const upozorenje = bezPotvrdeDjelatnika
        ? 'Djelatnici nisu potvrdili rad ni završni izvještaj. Ova će napomena biti trajno zabilježena na nalogu.'
        : '';
      const detalji = missing.length > 0
        ? `Nije upisano: ${missing.join(', ')}. Kilometri se neće obračunati.`
        : 'Sati i kilometri upisat će se u trošak gradilišta, a neriješeni zadaci, materijal i alat prenose se na idući nalog.';
      if (!zavrsiBezIzvrsenja) {
        const poruka = [upozorenje, detalji, 'Zaključiti nalog?'].filter(Boolean).join('\n\n');
        if (!window.confirm(poruka)) return;
      }
    }
    void guard(async () => {
      if (value && !zavrsiBezIzvrsenja) {
        const pocetak = km.pocetak === '' ? null : Number(km.pocetak);
        const kraj = km.kraj === '' ? null : Number(km.kraj);
        await saveNalogIzvrsenje(nalog.id, { km_pocetak: pocetak, km_kraj: kraj, napomena: napomena.trim() || null });
      }
      await setNalogZavrsen(nalog.id, value, bezPotvrdeDjelatnika, zavrsiBezIzvrsenja);
      setZavrsen(value);
      setBezIzvrsenja(value && zavrsiBezIzvrsenja);
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

  const addZadatak = (vrsta: ZadatakVrsta) => {
    const naziv = newZadatak[vrsta].trim();
    if (!naziv) return;
    const gradilisteId = nalog.gradiliste_id ?? null;
    void guard(async () => {
      await addNalogZadatak(nalog.id, gradilisteId, naziv, vrsta);
      setNewZadatak((prev) => ({ ...prev, [vrsta]: '' }));
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
      setSelectedFotoId((prev) => prev === f.id ? null : prev);
    }, 'Greška pri brisanju fotografije.');

  const reloadStavke = async () => setStavke(await fetchNalogStavke(nalog.id));
  const addStavka = (tip: 'materijal' | 'alat', naziv: string) =>
    void guard(async () => {
      await addNalogStavka(nalog.id, tip, naziv);
      await reloadStavke();
    }, 'Greška pri dodavanju stavke.');
  const addAlatIzPopisa = (opremaId: string) =>
    void guard(async () => {
      await addNalogAlatFromInventory(nalog.id, opremaId);
      await Promise.all([
        reloadStavke(),
        fetchOprema('alat').then((items) => setAlati(items.filter((item) => item.status !== 'servis' && item.status !== 'neaktivno'))),
      ]);
    }, 'Greška pri dodavanju alata s popisa opreme.');
  const addStrojIzPopisa = (opremaId: string) =>
    void guard(async () => {
      await addNalogStrojFromInventory(nalog.id, opremaId);
      await Promise.all([
        reloadStavke(),
        fetchOprema('stroj').then((items) => setStrojevi(items.filter((item) => item.status !== 'servis' && item.status !== 'neaktivno'))),
      ]);
    }, 'Greška pri dodavanju stroja s popisa.');
  const changeSati = (s: NalogStavka, value: string) =>
    setStavke((prev) => prev.map((x) => (x.id === s.id ? { ...x, sati: value === '' ? null : Math.max(0, Number(value)) } : x)));
  const saveSati = (s: NalogStavka) => {
    const current = stavke.find((x) => x.id === s.id);
    void guard(() => updateNalogStavka(s.id, { sati: current?.sati ?? null }), 'Greška pri spremanju radnih sati stroja.');
  };
  const toggleStavka = (s: NalogStavka) => {
    const rijeseno = Boolean(s.gotovo || s.uzeto);
    setStavke((prev) => prev.map((x) => (x.id === s.id ? { ...x, gotovo: !rijeseno, uzeto: !rijeseno } : x)));
    void guard(() => updateNalogStavka(s.id, { gotovo: !rijeseno }), 'Greška pri spremanju stavke.');
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
  const inputCls = 'min-w-0 max-w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm';
  const modulePanelCls = visualSections ? 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm' : '';
  const visibleVremena = radnikIds ? vremena.filter((v) => radnikIds.includes(v.radnik_id)) : vremena;

  return (
    <div className={`min-w-0 break-words xl:columns-2 xl:gap-x-6 [&>*]:mb-5 [&>*]:min-w-0 [&>*]:break-inside-avoid ${hideZadaci ? '' : 'mt-5 border-t border-slate-100 pt-4'}`}>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {slot && createPortal(
        zavrsen ? (
          <div className="flex items-center gap-2 text-sm text-emerald-800">
            <Check className="h-4 w-4" />
            {bezIzvrsenja ? 'Završen bez izvršenja' : 'Zaključen'}
            {nalog.mobile_status === 'zakljucen_bez_potvrde' && (
              <span className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Djelatnici nisu potvrdili</span>
            )}
            <button onClick={() => toggleZavrsen(false)} className="rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">Ponovno otvori</button>
          </div>
        ) : (
          <>
            <button
              onClick={() => toggleZavrsen(true)}
              disabled={nalog.mobile_status === 'dodijeljen' || nalog.mobile_status === 'u_tijeku'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {nalog.mobile_status === 'predan' ? 'Odobri i zaključi nalog' : nalog.mobile_status === 'dodijeljen' || nalog.mobile_status === 'u_tijeku' ? 'Čeka izvještaj djelatnika' : 'Zaključi radni nalog'}
            </button>
            {((!nalog.mobile_status && nalog.status === 'otvoren')
              || (nalog.mobile_status === 'dodijeljen' && nalog.status !== 'zavrsen' && nalog.status !== 'otkazan')) && (
              <button
                onClick={() => toggleZavrsen(true, false, true)}
                className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Check className="h-4 w-4" />
                Završi bez izvršenja
              </button>
            )}
            {(nalog.mobile_status === 'dodijeljen' || nalog.mobile_status === 'u_tijeku') && (
              <button
                onClick={() => toggleZavrsen(true, true)}
                className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                <Check className="h-4 w-4" />
                Zaključi bez potvrda djelatnika
              </button>
            )}
          </>
        ),
        slot,
      )}
      <div className={visualSections
        ? 'rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm'
        : 'rounded-xl border-2 border-amber-400 bg-amber-50 p-4 shadow-md ring-2 ring-amber-200/70'}>
        <SectionTitle icon={<FileText className="h-5 w-5 text-amber-700" />}>Napomena uz radni nalog</SectionTitle>
        <textarea
          rows={4}
          value={napomena}
          onChange={(event) => setNapomena(event.target.value)}
          onBlur={() => void saveDetails()}
          placeholder="Dodatne napomene i važne upute uz nalog…"
          className={`${inputCls} w-full ${visualSections ? 'border-amber-200' : 'border-amber-400'} bg-white text-base font-semibold text-slate-900 placeholder:font-normal`}
        />
        {!napomena.trim() && <p className="text-sm font-medium text-amber-900">Napomena nije upisana.</p>}
      </div>
      {([['zadatak', 'Radni zadaci', 'Nema zadataka na ovom nalogu.', 'Novi radni zadatak'], ['dodatni', 'Dodatni radovi', 'Nema dodatnih radova na ovom nalogu.', 'Novi dodatni rad']] as const).map(([vrsta, naslov, prazno, placeholder]) => {
        const lista = zadaci.filter((z) => !z.gotovo && zadatakVrsta(z) === vrsta);
        return (
      <div key={vrsta} className={`${hideZadaci ? 'hidden' : ''} ${modulePanelCls}`}>
        <SectionTitle icon={<ListChecks className="h-4 w-4" />}>
          {naslov} ({lista.length})
        </SectionTitle>
        <div className="space-y-1.5">
          {lista.map((z) => (
            <div key={z.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${z.gotovo ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100'}`}>
              <input type="checkbox" checked={z.gotovo} onChange={() => toggleZadatak(z)} className="h-4 w-4 rounded border-slate-300" />
              <span className={`flex-1 ${z.gotovo ? 'text-emerald-800 line-through' : 'text-slate-800'}`}>{z.naziv}</span>
              <button onClick={() => removeZadatak(z.id)} className="text-slate-300 hover:text-red-600" aria-label="Obriši">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {lista.length === 0 && <p className="text-xs text-slate-400">{prazno}</p>}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={newZadatak[vrsta]}
            onChange={(e) => setNewZadatak((prev) => ({ ...prev, [vrsta]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') addZadatak(vrsta); }}
            placeholder={placeholder}
            className={`${inputCls} flex-1`}
          />
          <button onClick={() => addZadatak(vrsta)} disabled={!newZadatak[vrsta].trim()} className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
            <Plus className="h-4 w-4" />
            Dodaj
          </button>
        </div>
      </div>
        );
      })}

      <div className={modulePanelCls}>
        <SectionTitle icon={<Clock className="h-4 w-4" />}>Radno vrijeme radnika</SectionTitle>
        <label className={`mb-2 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${teren ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-slate-200 text-slate-700'}`}>
          <input type="checkbox" checked={teren} onChange={(e) => changeTeren(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Teren (dodatno se obračunava)
        </label>
        <label className="mb-2 block text-xs font-medium text-slate-600">
          Vozač
          <select
            value={vozac ?? ''}
            onChange={(event) => changeVozac(event.target.value || null)}
            className={`${inputCls} ml-2 max-w-xs`}
          >
            <option value="">Poslovođa (zadano)</option>
            {visibleVremena.map((v) => (
              <option key={v.radnik_id} value={v.radnik_id}>
                {v.radnik ? `${v.radnik.ime} ${v.radnik.prezime}` : 'Radnik'}
              </option>
            ))}
          </select>
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
                    <input
                      type="time"
                      value={v.vrijeme_do?.slice(0, 5) ?? ''}
                      onFocus={() => {
                        if (!v.vrijeme_do) changeVrijeme(v.radnik_id, 'vrijeme_do', '16:00');
                      }}
                      onChange={(e) => changeVrijeme(v.radnik_id, 'vrijeme_do', e.target.value)}
                      className={inputCls}
                    />
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

      <div className={modulePanelCls}>
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

      {!hideStavke && <div className={`grid gap-4 ${modulePanelCls}`}>
        <div className={visualSections ? 'rounded-lg bg-slate-50 p-3' : undefined}>
          <SectionTitle icon={<Package className="h-4 w-4" />}>
            Materijal potreban za dalje ({stavke.filter((s) => s.tip === 'materijal' && !s.gotovo && !s.uzeto).length})
          </SectionTitle>
          <Checklist
            items={stavke.filter((s) => s.tip === 'materijal' && !s.gotovo && !s.uzeto)}
            placeholder="npr. boja bijela 15 l"
            onAdd={(n) => addStavka('materijal', n)}
            onToggle={toggleStavka}
            onRemove={removeStavka}
          />
          <ResolvedStavkeHistory
            items={stavke.filter((s) => s.tip === 'materijal' && (s.gotovo || s.uzeto))}
            onToggle={toggleStavka}
          />
        </div>
        <div className={visualSections ? 'rounded-lg bg-slate-50 p-3' : undefined}>
          <SectionTitle icon={<Hammer className="h-4 w-4" />}>
            Alat potreban za dalje ({stavke.filter((s) => s.tip === 'alat' && !s.gotovo && !s.uzeto).length})
          </SectionTitle>
          <Checklist
            items={stavke.filter((s) => s.tip === 'alat' && !s.gotovo && !s.uzeto)}
            placeholder="npr. skela, brusilica"
            onAdd={(n) => addStavka('alat', n)}
            equipment={alati}
            onAddEquipment={addAlatIzPopisa}
            onToggle={toggleStavka}
            onRemove={removeStavka}
          />
          <ResolvedStavkeHistory
            items={stavke.filter((s) => s.tip === 'alat' && (s.gotovo || s.uzeto))}
            onToggle={toggleStavka}
          />
        </div>
        <div className={visualSections ? 'rounded-lg bg-slate-50 p-3' : undefined}>
          <SectionTitle icon={<Wrench className="h-4 w-4" />}>
            Strojevi ({stavke.filter((s) => s.tip === 'stroj' && s.gotovo).length}/{stavke.filter((s) => s.tip === 'stroj').length}) — unesi radne sate za trošak gradilišta
          </SectionTitle>
          <Checklist
            items={stavke.filter((s) => s.tip === 'stroj')}
            placeholder=""
            equipment={strojevi}
            equipmentLabel="stroj"
            onAddEquipment={addStrojIzPopisa}
            onHoursChange={changeSati}
            onHoursSave={saveSati}
            onToggle={toggleStavka}
            onRemove={removeStavka}
          />
        </div>
      </div>}
      <div className={`${modulePanelCls} flex items-center gap-3`}>
        <button onClick={() => void saveDetails()} className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
          Spremi kilometre i napomenu
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <Check className="h-3.5 w-3.5" /> Spremljeno
          </span>
        )}
      </div>

      <div>
      {pickerDocs.length > 0 && (
        <div className={visualSections ? modulePanelCls : 'rounded-xl border border-sky-200 bg-sky-50/60 p-3'}>
          <SectionTitle icon={<FileText className="h-4 w-4" />}>Dokumenti i slike gradilišta — označi one koji se prikazuju na ovom nalogu ({gradLinked.length}/{pickerDocs.length})</SectionTitle>
          <div className="grid gap-1.5 xl:grid-cols-2">
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

      <div className={modulePanelCls}>
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

      <div className={modulePanelCls}>
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
          <div className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-4">
            {foto.map((f) => (
              <div key={f.id} className="group relative overflow-hidden rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setSelectedFotoId(f.id)}
                  aria-label={`Pregledaj fotografiju ${f.naziv ?? ''}`}
                  className="block w-full cursor-zoom-in"
                >
                  <img src={f.url} alt={f.naziv ?? 'Fotografija'} className="h-28 w-full object-cover" />
                </button>
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
      {selectedFoto && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/95 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Pregled fotografije radnog naloga"
          onClick={() => setSelectedFotoId(null)}
        >
          <button
            type="button"
            onClick={() => setSelectedFotoId(null)}
            aria-label="Zatvori pregled fotografije"
            className="absolute right-3 top-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 sm:right-5 sm:top-5"
          >
            <X className="h-6 w-6" />
          </button>
          {foto.length > 1 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                navigateFoto(-1);
              }}
              aria-label="Prethodna fotografija"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white hover:bg-white/30 sm:left-5 sm:p-3"
            >
              <ChevronLeft className="h-7 w-7" />
            </button>
          )}
          <div className="flex max-h-full max-w-full flex-col items-center gap-3" onClick={(event) => event.stopPropagation()}>
            <img
              src={selectedFoto.url}
              alt={selectedFoto.naziv ?? 'Fotografija radnog naloga'}
              className="max-h-[82dvh] max-w-[85vw] object-contain"
            />
            <p className="text-sm text-white/80">
              {selectedFoto.naziv ?? 'Fotografija'} · {selectedFotoIndex + 1} / {foto.length}
            </p>
          </div>
          {foto.length > 1 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                navigateFoto(1);
              }}
              aria-label="Sljedeća fotografija"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white hover:bg-white/30 sm:right-5 sm:p-3"
            >
              <ChevronRight className="h-7 w-7" />
            </button>
          )}
        </div>,
        document.body,
      )}
      <div className="xl:col-span-2">
        <details className={`group rounded-xl border border-slate-200 ${visualSections ? 'bg-white shadow-sm' : 'bg-slate-50'}`}>
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 [&::-webkit-details-marker]:hidden">
            <History className="h-4 w-4 flex-shrink-0 text-slate-400" />
            <span className="font-medium text-slate-700">Povijest aktivnosti</span>
            <span className="text-xs text-slate-400">{audit.length}</span>
            <ChevronDown className="ml-auto h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-slate-200 px-3 pb-3">
            <AuditLog entries={audit} />
          </div>
        </details>
      </div>
    </div>
  );
}

function toMinutes(t: string) {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}
