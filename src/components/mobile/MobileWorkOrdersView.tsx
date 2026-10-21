import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, ImagePlus, Trash2, Check, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, CreditCard, FileText, Flag, Gauge, ListChecks, LogOut, Package, Play, Plus, RefreshCw, Truck, Wrench } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { usePushRegistration } from '@/components/mobile/usePushRegistration';
import {
  addNalogStavka,
  addNalogAlatFromInventory,
  addNalogStrojFromInventory,
  updateNalogStavka,
  addNalogZadatak,
  fetchGradilisteDokumenti,
  fetchMobileNalogTeam,
  fetchMobileRadniNalozi,
  fetchMobileWorkerDisplayName,
  fetchMojPortalVrijeme,
  fetchNalogDokumenti,
  fetchNalogFoto,
  fetchNalogGradilisteDokumentIds,
  fetchNalogStavke,
  fetchNalogZadaci,
  fetchOprema,
  saveMobileNalogIzvjestaj,
  saveMobileWorkerTime,
  setMobileNalogVozac,
  startMobileWorkerTime,
  submitMobileNalog,
  uploadNalogFoto,
  type GradilisteDokument,
  type MobileRadniNalog,
  type MobileWorkerTime,
  type NalogDokument,
  type NalogFoto,
  type NalogStavka,
} from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { GradilisteZadatak, Oprema } from '@/types';
import { WorkerDocumentsTab, WorkerScheduleTab, WorkerTimeTab, type WorkerPortalTab } from '@/components/mobile/WorkerPortalTabs';

const portalTabs: Array<{ id: WorkerPortalTab; label: string; title: string; icon: React.ReactNode }> = [
  { id: 'nalozi', label: 'Nalozi', title: 'Moji radni nalozi', icon: <ClipboardCheck className="h-5 w-5" /> },
  { id: 'raspored', label: 'Raspored', title: 'Raspored ekipa i vozila', icon: <Truck className="h-5 w-5" /> },
  { id: 'vrijeme', label: 'Vrijeme', title: 'Moje radno vrijeme', icon: <Clock3 className="h-5 w-5" /> },
  { id: 'dokumenti', label: 'Dokumenti', title: 'Moji dokumenti', icon: <FileText className="h-5 w-5" /> },
];

// Pregled koji poslovođa potvrđuje pri pokretanju vremena (zahtjev RPC-a mobile_start_worker_time).
const reviewSectionIds = ['upute', 'zadaci', 'materijal', 'alat', 'dokumenti'];

type PrepKey = 'napomena' | 'zadaci' | 'materijal_na' | 'alat_na' | 'dokumenti';
type SectionKey = 'poslovi' | 'foto' | 'materijal' | 'alat' | 'strojevi';

const sectionLabels: Record<SectionKey, string> = {
  poslovi: 'Poslovi',
  foto: 'Fotografije',
  materijal: 'Materijal',
  alat: 'Alat',
  strojevi: 'Strojevi',
};

type MobileReport = {
  kmPocetak: string;
  kmKraj: string;
  kmNa: boolean;
  encStanje: string;
};

type MobileDetails = {
  gradilisteId: string | null;
  vozacId: string | null;
  napomena: string | null;
  zadaci: GradilisteZadatak[];
  stavke: NalogStavka[];
  alati: Oprema[];
  strojevi: Oprema[];
  dokumenti: Array<NalogDokument | GradilisteDokument>;
  foto: NalogFoto[];
  ekipa: MobileWorkerTime[];
};

const emptyReport: MobileReport = {
  kmPocetak: '',
  kmKraj: '',
  kmNa: false,
  encStanje: '',
};

const DEFAULT_POCETAK_RADA = '06:00';
const DEFAULT_KRAJ_RADA = '16:00';
const MAX_FOTO_STRANICA = 1600;

interface PhotoUpload {
  id: string;
  nalogId: string;
  file: File;
  previewUrl: string;
  status: 'ceka' | 'salje' | 'greska';
  poruka?: string;
}

// Fotografije s mobitela (5–12 MB) smanjuju se prije slanja da upload bude brz i pouzdan.
async function compressPhoto(file: File): Promise<File> {
  if (file.type && !file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_FOTO_STRANICA / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob || (file.size > 0 && blob.size >= file.size)) return file;
    const baseName = (file.name || 'fotografija').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

const uploadId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function errorMessage(reason: unknown, fallback: string) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'object' && reason !== null && 'message' in reason && typeof reason.message === 'string') {
    return reason.message;
  }
  return fallback;
}

function visibleMobileOrders(orders: MobileRadniNalog[]) {
  const today = new Date();
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return orders.filter((order) =>
    order.mobile_status !== 'odobren' && (order.rok === null || order.rok >= todayDate),
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-45 ${
        variant === 'primary'
          ? 'bg-sky-700 text-white active:bg-sky-800'
          : 'border border-slate-300 bg-white text-slate-700 active:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

export function MobileWorkOrdersView() {
  const { profile, company, signOut } = useAuth();
  const pushError = usePushRegistration(profile?.id ?? '');
  const [workerName, setWorkerName] = useState<string | null>(null);
  const [orders, setOrders] = useState<MobileRadniNalog[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<MobileDetails | null>(null);
  const [report, setReport] = useState<MobileReport>(emptyReport);
  const [potvrde, setPotvrde] = useState<string[]>([]);
  const [prep, setPrep] = useState<PrepKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newMaterial, setNewMaterial] = useState('');
  const [newTool, setNewTool] = useState('');
  const [newTask, setNewTask] = useState('');
  const [teamTimeDrafts, setTeamTimeDrafts] = useState<Record<string, { vrijemeOd: string; vrijemeDo: string }>>({});

  const [photoQueue, setPhotoQueue] = useState<PhotoUpload[]>([]);
  const [portalTab, setPortalTab] = useState<WorkerPortalTab>('nalozi');
  const [portalVrijeme, setPortalVrijeme] = useState(false);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const selected = orders.find((order) => order.id === selectedId) ?? null;
  const isLeader = selected?.poslovodja_id === profile?.radnik_id;

  useEffect(() => {
    if (!profile?.radnik_id) return;
    let active = true;
    void fetchMobileWorkerDisplayName()
      .then((name) => { if (active) setWorkerName(name); })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason, 'Ime djelatnika nije moguće učitati.'));
      });
    return () => { active = false; };
  }, [profile?.radnik_id]);

  useEffect(() => {
    if (!profile?.radnik_id) return;
    let active = true;
    const load = () => {
      void fetchMojPortalVrijeme()
        .then((visible) => {
          if (!active) return;
          setPortalVrijeme(visible);
          if (!visible) setPortalTab((tab) => (tab === 'vrijeme' ? 'nalozi' : tab));
        })
        .catch(() => undefined);
    };
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [profile?.radnik_id]);

  const visiblePortalTabs = portalTabs.filter((tab) => tab.id !== 'vrijeme' || portalVrijeme);

  const refreshOrders = useCallback(async () => {
    const list = await fetchMobileRadniNalozi();
    const visibleOrders = visibleMobileOrders(list);
    setOrders(visibleOrders);
    setSelectedId((current) => current && visibleOrders.some((order) => order.id === current) ? current : null);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchMobileRadniNalozi()
      .then((list) => {
        if (!active) return;
        setOrders(visibleMobileOrders(list));
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason, 'Radne naloge nije moguće učitati.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshOrders().catch((reason: unknown) => {
        if (active) setError(errorMessage(reason, 'Osvježavanje radnih naloga nije uspjelo.'));
      });
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshOrders]);

  useEffect(() => {
    const openFromPush = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === 'string') setSelectedId(event.detail);
    };
    window.addEventListener('tmcolor:open-mobile-work-order', openFromPush);
    return () => window.removeEventListener('tmcolor:open-mobile-work-order', openFromPush);
  }, []);

  const loadDetails = useCallback(async (order: MobileRadniNalog, showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setError(null);
      setNotice(null);
      setPrep([]);
    }
    try {
      const { data: nalog, error: nalogError } = await supabase
        .from('radni_nalozi')
        .select('gradiliste_id,vozac_id,km_pocetak,km_kraj,napomena,mobile_km_na,enc_stanje,mobile_potvrde')
        .eq('id', order.id)
        .single();
      if (nalogError) {
        if (/enc_stanje|mobile_potvrde/.test(nalogError.message)) {
          throw new Error('Pokreni migraciju 20261019120000_mobile_tijek_naloga.sql u Supabaseu.');
        }
        throw nalogError;
      }

      const [zadaci, stavke, dokumenti, foto, linkedIds, ekipa, alati, strojevi] = await Promise.all([
        fetchNalogZadaci(order.id),
        fetchNalogStavke(order.id),
        fetchNalogDokumenti(order.id),
        fetchNalogFoto(order.id),
        fetchNalogGradilisteDokumentIds(order.id),
        fetchMobileNalogTeam(order.id),
        fetchOprema('alat'),
        fetchOprema('stroj'),
      ]);
      const siteDocs = nalog.gradiliste_id ? await fetchGradilisteDokumenti(nalog.gradiliste_id) : [];
      const selectedSiteDocs = siteDocs.filter((document) => linkedIds.includes(document.id));

      setDetails({
        gradilisteId: nalog.gradiliste_id,
        vozacId: nalog.vozac_id,
        napomena: nalog.napomena,
        zadaci,
        stavke,
        alati: alati.filter((item) => item.status !== 'servis' && item.status !== 'neaktivno'),
        strojevi: strojevi.filter((item) => item.status !== 'servis' && item.status !== 'neaktivno'),
        dokumenti: [...dokumenti, ...selectedSiteDocs],
        foto,
        ekipa,
      });
      const savedPotvrde = (nalog.mobile_potvrde as string[] | null) ?? [];
      const timeConfirmed = savedPotvrde.includes('vrijeme');
      // Dok vrijeme nije potvrđeno pretpostavka je uvijek 06:00–16:00; ručne izmjene se čuvaju između osvježavanja.
      setTeamTimeDrafts((current) => Object.fromEntries(ekipa.map((worker) => [
        worker.radnik_id,
        timeConfirmed
          ? {
            vrijemeOd: worker.vrijeme_od?.slice(0, 5) ?? DEFAULT_POCETAK_RADA,
            vrijemeDo: worker.vrijeme_do?.slice(0, 5) ?? DEFAULT_KRAJ_RADA,
          }
          : (!showLoading && current[worker.radnik_id]) || { vrijemeOd: DEFAULT_POCETAK_RADA, vrijemeDo: DEFAULT_KRAJ_RADA },
      ])));
      setPotvrde(savedPotvrde);
      setReport({
        kmPocetak: nalog.km_pocetak?.toString() ?? '',
        kmKraj: nalog.km_kraj?.toString() ?? '',
        kmNa: nalog.mobile_km_na,
        encStanje: nalog.enc_stanje?.toString() ?? '',
      });
    } catch (reason) {
      setError(errorMessage(reason, 'Detalje radnog naloga nije moguće učitati.'));
      if (showLoading) setDetails(null);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetails(null);
      return;
    }
    let active = true;
    void fetchMobileRadniNalozi()
      .then((list) => {
        if (!active) return;
        const currentOrder = visibleMobileOrders(list).find((order) => order.id === selectedId);
        if (currentOrder) void loadDetails(currentOrder);
        else {
          setSelectedId(null);
          setDetails(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason, 'Radni nalog nije moguće osvježiti.'));
      });
    return () => { active = false; };
  }, [selectedId, loadDetails]);

  const runAction = async (action: () => Promise<void>, success?: string) => {
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
      await refreshOrders();
      const latest = (await fetchMobileRadniNalozi()).find((order) => order.id === selectedId);
      if (latest) await loadDetails(latest, false);
    } catch (reason) {
      setError(errorMessage(reason, 'Promjena nije spremljena.'));
    } finally {
      setWorking(false);
    }
  };

  const saveReport = async (overrides: { potvrde?: string[]; report?: MobileReport } = {}) => {
    if (!selected) return;
    const current = overrides.report ?? report;
    const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value.replace(',', '.'));
    const kmPocetak = numberOrNull(current.kmPocetak);
    const kmKraj = numberOrNull(current.kmKraj);
    const encStanje = numberOrNull(current.encStanje);
    if ((kmPocetak !== null && (!Number.isInteger(kmPocetak) || kmPocetak < 0)) ||
      (kmKraj !== null && (!Number.isInteger(kmKraj) || kmKraj < 0))) {
      throw new Error('Kilometri moraju biti cijeli pozitivni brojevi.');
    }
    if (encStanje !== null && (!Number.isFinite(encStanje) || encStanje < 0)) {
      throw new Error('Stanje ENC-a mora biti pozitivan broj.');
    }
    await saveMobileNalogIzvjestaj({
      nalogId: selected.id,
      kmPocetak,
      kmKraj,
      kmNa: current.kmNa,
      encStanje,
      potvrde: overrides.potvrde ?? potvrde,
    });
  };

  const setPotvrda = async (key: string, value: 'da' | 'na' | null) => {
    const next = potvrde.filter((item) => item !== key && item !== `${key}:na`);
    if (value === 'da') next.push(key);
    if (value === 'na') next.push(`${key}:na`);
    await runAction(() => saveReport({ potvrde: next }));
  };

  const togglePrep = (key: PrepKey, checked: boolean) => {
    setPrep((current) => checked ? [...current.filter((item) => item !== key), key] : current.filter((item) => item !== key));
  };

  const addItem = async (tip: 'materijal' | 'alat') => {
    if (!selected || !details) return;
    const value = tip === 'materijal' ? newMaterial.trim() : newTool.trim();
    if (!value) return;
    await runAction(async () => {
      await addNalogStavka(selected.id, tip, value);
      if (tip === 'materijal') {
        setNewMaterial('');
        togglePrep('materijal_na', false);
      } else {
        setNewTool('');
        togglePrep('alat_na', false);
      }
    });
  };

  const addInventoryTool = async (opremaId: string) => {
    if (!selected) return;
    await runAction(
      () => addNalogAlatFromInventory(selected.id, opremaId),
      'Alat je dodan na nalog i evidentiran na gradilištu.',
    );
  };

  const addInventoryMachine = async (opremaId: string) => {
    if (!selected) return;
    await runAction(
      () => addNalogStrojFromInventory(selected.id, opremaId),
      'Stroj je dodan na nalog i evidentiran na gradilištu.',
    );
  };

  const setMachineHours = async (item: NalogStavka, hours: number | null) => {
    await runAction(() => updateNalogStavka(item.id, { sati: hours }), 'Radni sati stroja su spremljeni.');
  };

  const queuePhotos = (files: FileList | null) => {
    if (!selected || !files?.length) return;
    const nalogId = selected.id;
    const items: PhotoUpload[] = Array.from(files).map((file) => ({
      id: uploadId(),
      nalogId,
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'ceka',
    }));
    setPhotoQueue((current) => [...current, ...items]);
  };

  const removeQueuedPhoto = (id: string) => {
    setPhotoQueue((current) => {
      const item = current.find((photo) => photo.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return current.filter((photo) => photo.id !== id);
    });
  };

  useEffect(() => {
    if (photoQueue.some((photo) => photo.status === 'salje')) return;
    const next = photoQueue.find((photo) => photo.status === 'ceka');
    if (!next) return;
    setPhotoQueue((current) => current.map((photo) => photo.id === next.id ? { ...photo, status: 'salje' } : photo));
    void (async () => {
      try {
        await uploadNalogFoto(next.nalogId, await compressPhoto(next.file), false);
        removeQueuedPhoto(next.id);
        const foto = await fetchNalogFoto(next.nalogId).catch(() => null);
        if (foto && selectedIdRef.current === next.nalogId) {
          setDetails((current) => current ? { ...current, foto } : current);
        }
      } catch (reason) {
        setPhotoQueue((current) => current.map((photo) => photo.id === next.id
          ? { ...photo, status: 'greska', poruka: errorMessage(reason, 'Fotografija nije poslana.') }
          : photo));
      }
    })();
  }, [photoQueue]);

  const toggleTask = async (task: GradilisteZadatak) => {
    await runAction(async () => {
      const { error: updateError } = await supabase
        .from('gradiliste_zadaci')
        .update({ gotovo: !task.gotovo, gotovo_at: !task.gotovo ? new Date().toISOString() : null })
        .eq('id', task.id);
      if (updateError) throw updateError;
    });
  };

  const addTask = async () => {
    if (!selected || !details || !newTask.trim()) return;
    const gradilisteId = details.gradilisteId;
    const name = newTask.trim();
    await runAction(async () => {
      await addNalogZadatak(selected.id, gradilisteId, name);
      setNewTask('');
    }, 'Radni zadatak je dodan.');
  };

  const toggleItem = async (item: NalogStavka, field: 'gotovo' | 'uzeto' = 'gotovo') => {
    await runAction(() => updateNalogStavka(item.id, { [field]: !item[field] }));
  };

  const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value.replace(',', '.'));

  const startSite = async () => {
    if (!selected || !details) return;
    await saveReport({ potvrde: [] });
    const notStarted = details.ekipa.filter((worker) => !worker.mobile_started_at);
    // Poslovođa prvi, kako bi njegov pregled bio evidentiran prije ostatka ekipe.
    notStarted.sort((a, b) => Number(b.radnik_id === selected.poslovodja_id) - Number(a.radnik_id === selected.poslovodja_id));
    for (const worker of notStarted) {
      await startMobileWorkerTime(selected.id, worker.radnik_id, reviewSectionIds);
    }
  };

  const confirmWorkTime = async (checked: boolean) => {
    if (!selected || !details) return;
    if (!checked) {
      await setPotvrda('vrijeme', null);
      return;
    }
    await runAction(async () => {
      for (const worker of details.ekipa) {
        const draft = teamTimeDrafts[worker.radnik_id];
        if (!draft?.vrijemeOd || !draft.vrijemeDo) {
          throw new Error(`Upiši početak i završetak rada za ${worker.ime} ${worker.prezime}.`);
        }
        if (draft.vrijemeDo <= draft.vrijemeOd) {
          throw new Error(`Završetak rada mora biti nakon početka (${worker.ime} ${worker.prezime}).`);
        }
      }
      for (const worker of details.ekipa) {
        const draft = teamTimeDrafts[worker.radnik_id];
        await saveMobileWorkerTime({
          nalogId: selected.id,
          radnikId: worker.radnik_id,
          vrijemeOd: draft.vrijemeOd,
          vrijemeDo: draft.vrijemeDo,
          reviewedSections: reviewSectionIds,
        });
      }
      await saveReport({ potvrde: [...potvrde.filter((item) => item !== 'vrijeme'), 'vrijeme'] });
    }, 'Radno vrijeme ekipe je potvrđeno.');
  };

  const confirmEnc = async (value: 'da' | 'na' | null) => {
    if (value === 'da') {
      const enc = numberOrNull(report.encStanje);
      if (enc === null || !Number.isFinite(enc) || enc < 0) {
        setError('Upiši stanje ENC-a prije potvrde.');
        return;
      }
    }
    const nextReport = value === 'na' ? { ...report, encStanje: '' } : report;
    if (value === 'na') setReport(nextReport);
    const next = potvrde.filter((item) => item !== 'enc' && item !== 'enc:na');
    if (value === 'da') next.push('enc');
    if (value === 'na') next.push('enc:na');
    await runAction(() => saveReport({ potvrde: next, report: nextReport }));
  };

  const confirmKmKraj = async (value: 'da' | 'na' | null) => {
    if (value === 'da') {
      const start = numberOrNull(report.kmPocetak);
      const end = numberOrNull(report.kmKraj);
      if (end === null || !Number.isInteger(end)) {
        setError('Upiši kilometre povratka.');
        return;
      }
      if (start !== null && end < start) {
        setError('Kilometri povratka ne smiju biti manji od početnih.');
        return;
      }
    }
    const nextReport = value === 'na' ? { ...report, kmKraj: '' } : report;
    if (value === 'na') setReport(nextReport);
    const next = potvrde.filter((item) => item !== 'km_kraj' && item !== 'km_kraj:na');
    if (value === 'da') next.push('km_kraj');
    if (value === 'na') next.push('km_kraj:na');
    await runAction(() => saveReport({ potvrde: next, report: nextReport }));
  };
  const selectedPhotoQueue = photoQueue.filter((photo) => photo.nalogId === selectedId);
  const materijalStavke = details?.stavke.filter((item) => item.tip === 'materijal') ?? [];
  const alatStavke = details?.stavke.filter((item) => item.tip === 'alat') ?? [];
  const strojStavke = details?.stavke.filter((item) => item.tip === 'stroj') ?? [];
  const hasNapomena = Boolean(details?.napomena?.trim());
  const kmPocetakValue = numberOrNull(report.kmPocetak);
  const prepChecks = [
    { label: 'Napomena pročitana', ok: !hasNapomena || prep.includes('napomena') },
    { label: 'Radni zadaci pregledani', ok: prep.includes('zadaci') },
    {
      label: 'Materijal preuzet',
      ok: materijalStavke.length ? materijalStavke.every((item) => item.uzeto) : prep.includes('materijal_na'),
    },
    {
      label: 'Alat preuzet',
      ok: alatStavke.length ? alatStavke.every((item) => item.uzeto) : prep.includes('alat_na'),
    },
    { label: 'Dokumenti pregledani', ok: prep.includes('dokumenti') },
    {
      label: 'Početni kilometri',
      ok: report.kmNa || (kmPocetakValue !== null && Number.isInteger(kmPocetakValue) && kmPocetakValue >= 0),
    },
  ];
  const prepReady = prepChecks.every((check) => check.ok);
  const potvrdaOf = (key: string): 'da' | 'na' | null =>
    potvrde.includes(key) ? 'da' : potvrde.includes(`${key}:na`) ? 'na' : null;
  const finishChecks = [
    ...(Object.keys(sectionLabels) as SectionKey[]).map((key) => ({
      label: sectionLabels[key],
      ok: potvrdaOf(key) !== null && (key !== 'foto' || selectedPhotoQueue.length === 0),
    })),
    { label: 'Radno vrijeme', ok: potvrde.includes('vrijeme') },
    { label: 'Stanje ENC-a', ok: potvrdaOf('enc') !== null },
    { label: 'Kilometri povratka', ok: report.kmNa || potvrdaOf('km_kraj') !== null },
  ];
  const finishReady = finishChecks.every((check) => check.ok);

  const signOutUser = async () => {
    try {
      await signOut();
    } catch (reason) {
      setError(errorMessage(reason, 'Odjava nije uspjela.'));
    }
  };

  return (
    <main className="min-h-[100dvh] bg-slate-100 pb-[env(safe-area-inset-bottom)]">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
            {company?.naziv}{workerName ? ` · ${workerName}` : ''}
          </p>
          <h1 className="text-lg font-bold text-slate-900">Portal djelatnika</h1>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refreshOrders().catch((reason: unknown) => setError(errorMessage(reason, 'Osvježavanje nije uspjelo.')))} className="rounded-lg p-2 text-slate-500" aria-label="Osvježi naloge">
            <RefreshCw className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => void signOutUser()} className="rounded-lg p-2 text-slate-500" aria-label="Odjavi se">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-4 p-4">
        {pushError && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{pushError}</p>}
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

        {selected ? (
          <section className="space-y-4">
            <button type="button" onClick={() => { setSelectedId(null); setNotice(null); setError(null); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-sky-800">
              <ChevronLeft className="h-5 w-5" /> Svi nalozi
            </button>
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-slate-500">{selected.broj}</p>
                  <h2 className="mt-1 text-xl font-bold text-slate-900">{selected.naslov}</h2>
                  {selected.gradiliste_naziv && <p className="mt-1 text-sm font-medium text-sky-800">{selected.gradiliste_naziv}</p>}
                </div>
                <span className="shrink-0 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-800">
                  {selected.mobile_status === 'dodijeljen' ? 'Dodijeljen' : selected.mobile_status === 'u_tijeku' ? 'U tijeku' : selected.mobile_status === 'predan' ? 'Čeka odobrenje' : selected.mobile_status === 'odobren' ? 'Odobren' : 'Nalog'}
                </span>
              </div>
              {selected.opis && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selected.opis}</p>}
              {selected.rok && <p className="mt-3 text-xs text-slate-500">Rok: {new Date(`${selected.rok}T00:00:00`).toLocaleDateString('hr-HR')}</p>}
            </article>

            {loading && <p className="rounded-xl bg-white p-4 text-sm text-slate-500">Učitavanje naloga…</p>}

            {!loading && details && (
              <>
                {hasNapomena && (
                  <section className="overflow-hidden rounded-2xl border-2 border-amber-400 bg-amber-50 shadow-md shadow-amber-100">
                    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-100 px-4 py-4">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
                        <AlertTriangle className="h-6 w-6" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-extrabold uppercase tracking-wider text-amber-800">Važno za ekipu</p>
                        <h3 className="text-lg font-extrabold text-slate-900">Napomena uz radni nalog</h3>
                      </div>
                    </div>
                    <div className="space-y-3 p-4">
                      <p className="whitespace-pre-wrap text-base font-semibold leading-6 text-slate-900">{details.napomena}</p>
                      {selected.mobile_status === 'dodijeljen' && (
                        <CheckField
                          checked={prep.includes('napomena')}
                          onChange={(checked) => togglePrep('napomena', checked)}
                          label="Pročitao/la sam i razumijem napomenu."
                        />
                      )}
                    </div>
                  </section>
                )}

                {selected.mobile_status === 'dodijeljen' && (
                  <>
                    <StepHeader step={1} title="Priprema prije polaska" text="Pregledaj nalog, preuzmi materijal i alat te upiši početne kilometre." />

                    <WorkOrderPanel title="Vozač" icon={<Gauge className="h-5 w-5" />} tone="sky">
                      <label className="block text-sm font-medium text-slate-700">
                        Odaberite vozača iz ekipe
                        <select
                          value={details.vozacId ?? ''}
                          disabled={working}
                          onChange={(event) => {
                            const radnikId = event.target.value || null;
                            void runAction(() => setMobileNalogVozac(selected.id, radnikId), 'Vozač je spremljen.');
                          }}
                          className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 disabled:bg-slate-100"
                        >
                          <option value="">Poslovođa (zadano)</option>
                          {details.ekipa.map((worker) => (
                            <option key={worker.radnik_id} value={worker.radnik_id}>{worker.ime} {worker.prezime}</option>
                          ))}
                        </select>
                      </label>
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Radni zadaci" icon={<ListChecks className="h-5 w-5" />} tone="emerald" summary={`${details.zadaci.length} zadataka`}>
                      {details.zadaci.length ? (
                        <ul className="space-y-2">
                          {details.zadaci.map((task) => (
                            <li key={task.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-base font-semibold text-slate-900">{task.naziv}</li>
                          ))}
                        </ul>
                      ) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Nema upisanih zadataka.</p>}
                      <div className="flex gap-2">
                        <input
                          value={newTask}
                          onChange={(event) => setNewTask(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void addTask();
                            }
                          }}
                          placeholder="Dodaj radni zadatak"
                          disabled={working}
                          className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400"
                        />
                        <button type="button" onClick={() => void addTask()} disabled={working || !newTask.trim()} className="inline-flex min-h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white disabled:opacity-40" aria-label="Dodaj radni zadatak">
                          <Plus className="h-5 w-5" />
                        </button>
                      </div>
                      <CheckField checked={prep.includes('zadaci')} onChange={(checked) => togglePrep('zadaci', checked)} label="Pregledao/la sam radne zadatke." />
                    </WorkOrderPanel>

                    <WorkOrderPanel
                      title="Materijal"
                      icon={<Package className="h-5 w-5" />}
                      tone="amber"
                      summary={`${materijalStavke.filter((item) => item.uzeto).length} / ${materijalStavke.length} uzeto`}
                    >
                      <p className="text-sm text-slate-500">Označi svaki materijal koji si uzeo/la.</p>
                      <ItemEditor
                        title="Materijal"
                        items={materijalStavke}
                        checkKey="uzeto"
                        value={newMaterial}
                        onValue={setNewMaterial}
                        onAdd={() => void addItem('materijal')}
                        onToggle={(item) => void toggleItem(item, 'uzeto')}
                        noneChecked={prep.includes('materijal_na')}
                        onNone={(checked) => togglePrep('materijal_na', checked)}
                        showNone={materijalStavke.length === 0}
                        noneLabel="Materijal nije potreban."
                        placeholder="Npr. boja bijela 15 l"
                        working={working}
                      />
                    </WorkOrderPanel>

                    <WorkOrderPanel
                      title="Alat"
                      icon={<Wrench className="h-5 w-5" />}
                      tone="sky"
                      summary={`${alatStavke.filter((item) => item.uzeto).length} / ${alatStavke.length} uzeto`}
                    >
                      <p className="text-sm text-slate-500">Označi svaki alat koji si uzeo/la.</p>
                      <ItemEditor
                        title="Alat"
                        items={alatStavke}
                        checkKey="uzeto"
                        equipment={details.alati}
                        value={newTool}
                        onValue={setNewTool}
                        onAdd={() => void addItem('alat')}
                        onAddEquipment={(opremaId) => void addInventoryTool(opremaId)}
                        onToggle={(item) => void toggleItem(item, 'uzeto')}
                        noneChecked={prep.includes('alat_na')}
                        onNone={(checked) => togglePrep('alat_na', checked)}
                        showNone={alatStavke.length === 0}
                        noneLabel="Alat nije potreban."
                        placeholder="Npr. skela, brusilica"
                        working={working}
                      />
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Dokumenti i slike" icon={<FileText className="h-5 w-5" />} tone="slate">
                      <ReviewBlock title="Prilozi">
                        {details.dokumenti.length ? details.dokumenti.map((document) => <a key={document.id} href={document.url} target="_blank" rel="noreferrer" className="block min-h-10 py-2 text-sm font-medium text-sky-700 underline">{document.naziv}</a>) : <p className="text-sm text-slate-500">Nema priloženih dokumenata.</p>}
                        {details.foto.length > 0 && (
                          <div className="mt-2 grid grid-cols-4 gap-2">
                            {details.foto.map((photo) => <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.naziv ?? 'Slika naloga'} className="aspect-square w-full rounded-lg object-cover" /></a>)}
                          </div>
                        )}
                      </ReviewBlock>
                      <CheckField checked={prep.includes('dokumenti')} onChange={(checked) => togglePrep('dokumenti', checked)} label="Pregledao/la sam dokumente i slike." />
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Početni kilometri" icon={<Gauge className="h-5 w-5" />} tone="amber">
                      <label className="block text-sm text-slate-600">Stanje brojila pri polasku (km)
                        <input
                          inputMode="numeric"
                          type="number"
                          min="0"
                          value={report.kmPocetak}
                          disabled={report.kmNa}
                          onChange={(event) => setReport((current) => ({ ...current, kmPocetak: event.target.value }))}
                          className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg text-slate-900 disabled:bg-slate-100"
                        />
                      </label>
                      {isLeader && (
                        <CheckField
                          checked={report.kmNa}
                          onChange={(checked) => setReport((current) => ({ ...current, kmNa: checked, kmPocetak: checked ? '' : current.kmPocetak, kmKraj: checked ? '' : current.kmKraj }))}
                          label="Kilometri nisu primjenjivi (bez vozila)."
                        />
                      )}
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Započni gradilište" icon={<Play className="h-5 w-5" />} tone="emerald">
                      <Checklist items={prepChecks} />
                      {isLeader ? (
                        <Button onClick={() => void runAction(startSite, 'Gradilište je započeto. Radno vrijeme ekipe teče od sada.')} disabled={working || !prepReady}>
                          <Play className="h-5 w-5" /> Započni gradilište
                        </Button>
                      ) : (
                        <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900">Gradilište započinje poslovođa nakon što je sve preuzeto.</p>
                      )}
                    </WorkOrderPanel>
                  </>
                )}

                {selected.mobile_status === 'u_tijeku' && (
                  <>
                    <StepHeader step={2} title="Rad na gradilištu" text="Za svaki dio odaberi „Potvrđujem” ili „Nije primjenjivo”." />
                    {!isLeader && (
                      <p className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-900">Možeš dopunjavati poslove, fotografije, materijal, alat i strojeve. Potvrde i zaključivanje naloga radi poslovođa.</p>
                    )}

                    <WorkOrderPanel
                      title="Poslovi"
                      icon={<ListChecks className="h-5 w-5" />}
                      tone="emerald"
                      summary={`${details.zadaci.filter((task) => task.gotovo).length} / ${details.zadaci.length} obavljeno`}
                    >
                      <p className="text-sm text-slate-500">Označi posao nakon što ga završiš.</p>
                      <div className="space-y-3">
                        {details.zadaci.length ? details.zadaci.map((task) => (
                          <label key={task.id} className={`flex min-h-[5.5rem] items-start gap-4 rounded-2xl border p-4 ${task.gotovo ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50/60'}`}>
                            <input type="checkbox" checked={task.gotovo} onChange={() => void toggleTask(task)} disabled={working} className="mt-0.5 h-7 w-7 shrink-0 rounded-md border-2 border-slate-300 accent-emerald-600" />
                            <span className="min-w-0 flex-1">
                              <span className={`block text-base font-semibold leading-6 ${task.gotovo ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{task.naziv}</span>
                              {task.gotovo_at && <span className="mt-1 block text-sm text-emerald-700">Završeno · {new Date(task.gotovo_at).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' })}</span>}
                            </span>
                          </label>
                        )) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Nema upisanih poslova.</p>}
                        <div className="flex gap-2">
                          <input
                            value={newTask}
                            onChange={(event) => setNewTask(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void addTask();
                              }
                            }}
                            placeholder="Dodaj posao"
                            disabled={working}
                            className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400"
                          />
                          <button type="button" onClick={() => void addTask()} disabled={working || !newTask.trim()} className="inline-flex min-h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white disabled:opacity-40" aria-label="Dodaj posao">
                            <Plus className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                      <SectionConfirm value={potvrdaOf('poslovi')} onChange={(value) => void setPotvrda('poslovi', value)} disabled={working || !isLeader} />
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Fotografije izvedenog rada" icon={<Camera className="h-5 w-5" />} tone="rose" summary={`${details.foto.length} fotografija`}>
                      {details.foto.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                          {details.foto.map((photo) => <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.naziv ?? 'Fotografija naloga'} className="aspect-square w-full rounded-lg object-cover" /></a>)}
                        </div>
                      )}
                      {selectedPhotoQueue.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-slate-700">
                            {selectedPhotoQueue.some((photo) => photo.status !== 'greska')
                              ? `Šaljem fotografije… (preostalo ${selectedPhotoQueue.filter((photo) => photo.status !== 'greska').length})`
                              : 'Neke fotografije nisu poslane.'}
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            {selectedPhotoQueue.map((photo) => (
                              <div key={photo.id} className="relative">
                                <img src={photo.previewUrl} alt="Fotografija u slanju" className={`aspect-square w-full rounded-lg object-cover ${photo.status === 'greska' ? 'opacity-40' : 'opacity-60'}`} />
                                {photo.status === 'salje' && <RefreshCw className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-spin text-white drop-shadow" />}
                                {photo.status === 'greska' && (
                                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-1">
                                    <button type="button" onClick={() => setPhotoQueue((current) => current.map((item) => item.id === photo.id ? { ...item, status: 'ceka', poruka: undefined } : item))} className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-800 shadow" title={photo.poruka}>
                                      Ponovi
                                    </button>
                                    <button type="button" onClick={() => removeQueuedPhoto(photo.id)} className="rounded-md bg-white p-1 text-red-600 shadow" aria-label="Ukloni fotografiju">
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          {selectedPhotoQueue.find((photo) => photo.poruka)?.poruka && (
                            <p className="text-xs text-red-600">{selectedPhotoQueue.find((photo) => photo.poruka)?.poruka}</p>
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-rose-600 px-3 text-sm font-semibold text-white active:bg-rose-700">
                          <Camera className="h-5 w-5" /> Fotografiraj
                          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => { queuePhotos(event.target.files); event.currentTarget.value = ''; }} />
                        </label>
                        <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700">
                          <ImagePlus className="h-5 w-5" /> Iz galerije
                          <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => { queuePhotos(event.target.files); event.currentTarget.value = ''; }} />
                        </label>
                      </div>
                      <p className="text-xs text-slate-500">Slikaj koliko god treba – svaka se fotografija šalje u pozadini dok slikaš dalje.</p>
                      <SectionConfirm
                        value={potvrdaOf('foto')}
                        onChange={(value) => {
                          if (value === 'da' && details.foto.length === 0) {
                            setError('Dodaj barem jednu fotografiju ili odaberi „Nije primjenjivo”.');
                            return;
                          }
                          if (value === 'da' && selectedPhotoQueue.length > 0) {
                            setError('Pričekaj da se sve fotografije pošalju.');
                            return;
                          }
                          void setPotvrda('foto', value);
                        }}
                        disabled={working || !isLeader}
                      />
                    </WorkOrderPanel>

                    <WorkOrderPanel
                      title="Materijal"
                      icon={<Package className="h-5 w-5" />}
                      tone="amber"
                      summary={`${materijalStavke.filter((item) => item.gotovo).length} / ${materijalStavke.length} za nastavak`}
                    >
                      <p className="text-sm text-slate-500">upiši što je potrebno za nastavak radova</p>
                      <ItemEditor
                        title="Materijal"
                        items={materijalStavke}
                        value={newMaterial}
                        onValue={setNewMaterial}
                        onAdd={() => void addItem('materijal')}
                        onToggle={(item) => void toggleItem(item)}
                        placeholder="Npr. boja bijela 15 l"
                        working={working}
                      />
                      <SectionConfirm value={potvrdaOf('materijal')} onChange={(value) => void setPotvrda('materijal', value)} disabled={working || !isLeader} />
                    </WorkOrderPanel>

                    <WorkOrderPanel
                      title="Alat"
                      icon={<Wrench className="h-5 w-5" />}
                      tone="sky"
                      summary={`${alatStavke.filter((item) => item.gotovo).length} / ${alatStavke.length} za nastavak`}
                    >
                      <p className="text-sm text-slate-500">upiši što je potrebno za nastavak radova</p>
                      <ItemEditor
                        title="Alat"
                        items={alatStavke}
                        equipment={details.alati}
                        value={newTool}
                        onValue={setNewTool}
                        onAdd={() => void addItem('alat')}
                        onAddEquipment={(opremaId) => void addInventoryTool(opremaId)}
                        onToggle={(item) => void toggleItem(item)}
                        placeholder="Npr. skela, brusilica"
                        working={working}
                      />
                      <SectionConfirm value={potvrdaOf('alat')} onChange={(value) => void setPotvrda('alat', value)} disabled={working || !isLeader} />
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Strojevi i radni sati" icon={<Wrench className="h-5 w-5" />} tone="amber">
                      <ItemEditor
                        title="Strojevi"
                        items={strojStavke}
                        equipment={details.strojevi}
                        equipmentLabel="stroj"
                        value=""
                        onValue={() => undefined}
                        onAdd={() => undefined}
                        onAddEquipment={(opremaId) => void addInventoryMachine(opremaId)}
                        onHours={(item, hours) => void setMachineHours(item, hours)}
                        onToggle={(item) => void toggleItem(item)}
                        placeholder=""
                        working={working}
                      />
                      <SectionConfirm value={potvrdaOf('strojevi')} onChange={(value) => void setPotvrda('strojevi', value)} disabled={working || !isLeader} />
                    </WorkOrderPanel>

                    <StepHeader step={3} title="Završetak dana" text="Potvrdi radno vrijeme, stanje ENC-a i kilometre povratka, zatim zaključi nalog." />

                    <WorkOrderPanel title="Radno vrijeme" icon={<Clock3 className="h-5 w-5" />} tone="sky">
                      <p className="text-sm text-slate-600">Radno vrijeme je unaprijed postavljeno na {DEFAULT_POCETAK_RADA}–{DEFAULT_KRAJ_RADA}. Ispravi ako je potrebno pa potvrdi.</p>
                      <div className="space-y-3">
                        {details.ekipa.map((worker) => {
                          const timeDraft = teamTimeDrafts[worker.radnik_id] ?? { vrijemeOd: DEFAULT_POCETAK_RADA, vrijemeDo: DEFAULT_KRAJ_RADA };
                          const locked = !isLeader || potvrde.includes('vrijeme') || working;
                          return (
                            <div key={worker.radnik_id} className="rounded-xl border border-slate-200 p-3">
                              <p className="font-semibold text-slate-900">{worker.ime} {worker.prezime}</p>
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <label className="block text-sm text-slate-700">Početak
                                  <input
                                    type="time"
                                    value={timeDraft.vrijemeOd}
                                    disabled={locked}
                                    onChange={(event) => setTeamTimeDrafts((current) => ({ ...current, [worker.radnik_id]: { ...timeDraft, vrijemeOd: event.target.value } }))}
                                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base disabled:bg-slate-100"
                                  />
                                </label>
                                <label className="block text-sm text-slate-700">Završetak
                                  <input
                                    type="time"
                                    value={timeDraft.vrijemeDo}
                                    disabled={locked}
                                    onChange={(event) => setTeamTimeDrafts((current) => ({ ...current, [worker.radnik_id]: { ...timeDraft, vrijemeDo: event.target.value } }))}
                                    className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base disabled:bg-slate-100"
                                  />
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {isLeader && (
                        <CheckField
                          checked={potvrde.includes('vrijeme')}
                          onChange={(checked) => void confirmWorkTime(checked)}
                          label="Potvrđujem radno vrijeme cijele ekipe."
                        />
                      )}
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Stanje ENC-a" icon={<CreditCard className="h-5 w-5" />} tone="slate">
                      <label className="block text-sm text-slate-600">Stanje ENC uređaja (€)
                        <input
                          inputMode="decimal"
                          type="number"
                          min="0"
                          step="0.01"
                          value={report.encStanje}
                          disabled={!isLeader || potvrdaOf('enc') !== null || working}
                          onChange={(event) => setReport((current) => ({ ...current, encStanje: event.target.value }))}
                          className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg text-slate-900 disabled:bg-slate-100"
                        />
                      </label>
                      <SectionConfirm value={potvrdaOf('enc')} onChange={(value) => void confirmEnc(value)} disabled={working || !isLeader} />
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Kilometri povratka" icon={<Gauge className="h-5 w-5" />} tone="amber">
                      {report.kmNa ? (
                        <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Kilometri su pri polasku označeni kao nisu primjenjivi.</p>
                      ) : (
                        <>
                          <p className="text-sm text-slate-600">Početno stanje: <span className="font-semibold text-slate-900">{report.kmPocetak || '—'} km</span></p>
                          <label className="block text-sm text-slate-600">Stanje brojila po povratku (km)
                            <input
                              inputMode="numeric"
                              type="number"
                              min="0"
                              value={report.kmKraj}
                              disabled={!isLeader || potvrdaOf('km_kraj') !== null || working}
                              onChange={(event) => setReport((current) => ({ ...current, kmKraj: event.target.value }))}
                              className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg text-slate-900 disabled:bg-slate-100"
                            />
                          </label>
                          {report.kmPocetak && report.kmKraj && Number(report.kmKraj) >= Number(report.kmPocetak) && (
                            <p className="text-sm text-slate-600">Prijeđeno: <span className="font-semibold text-slate-900">{Number(report.kmKraj) - Number(report.kmPocetak)} km</span></p>
                          )}
                          <SectionConfirm value={potvrdaOf('km_kraj')} onChange={(value) => void confirmKmKraj(value)} disabled={working || !isLeader} />
                        </>
                      )}
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Zaključi radni nalog" icon={<Flag className="h-5 w-5" />} tone="emerald">
                      <Checklist items={finishChecks} />
                      {isLeader ? (
                        <Button
                          onClick={() => void runAction(() => submitMobileNalog(selected.id, true), 'Radni nalog je zaključen i poslan u ured na odobrenje.')}
                          disabled={working || !finishReady}
                        >
                          <Flag className="h-5 w-5" /> Zaključi radni nalog
                        </Button>
                      ) : (
                        <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900">Nalog zaključuje poslovođa.</p>
                      )}
                    </WorkOrderPanel>
                  </>
                )}

                {selected.mobile_status === 'predan' && <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">Nalog je zaključen i čeka završno odobrenje u uredu.</p>}
                {selected.mobile_status === 'odobren' && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900">Nalog je pregledan i odobren.</p>}
              </>
            )}
          </section>
        ) : (
          <section className="space-y-3">
            <div className="rounded-3xl bg-slate-900 p-5 text-white shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-400">{new Date().toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                  <h2 className="mt-1 text-2xl font-bold">Dobro jutro, {workerName?.split(' ')[0] ?? 'djelatniče'}</h2>
                  <p className="mt-1 text-sm text-slate-400">{profile?.email}</p>
                </div>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-200 font-bold text-slate-900">
                  {workerName?.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() ?? 'TC'}
                </span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2">
                {[
                  { value: orders.length, label: 'dodijeljeno' },
                  { value: orders.filter((order) => order.mobile_status === 'u_tijeku').length, label: 'u tijeku' },
                  { value: orders.filter((order) => order.mobile_status === 'predan' || order.mobile_status === 'odobren').length, label: 'predano' },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl bg-slate-800 px-3 py-2">
                    <p className="text-xl font-bold">{stat.value}</p>
                    <p className="text-xs text-slate-400">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>
            {!profile?.radnik_id && (
              <p role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                Račun još nije povezan s djelatnikom. Zamoli administratora da ga poveže u „Korisnici i prava”.
              </p>
            )}
            <nav aria-label="Portal djelatnika" className={`grid ${visiblePortalTabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'} gap-1 rounded-2xl bg-white p-1 shadow-sm`}>
              {visiblePortalTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPortalTab(tab.id)}
                  aria-current={portalTab === tab.id ? 'page' : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-bold ${portalTab === tab.id ? 'bg-sky-700 text-white' : 'text-slate-600 active:bg-slate-100'}`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </nav>
            <h2 className="px-1 pt-2 text-lg font-bold text-slate-900">{portalTabs.find((tab) => tab.id === portalTab)?.title}</h2>
            {portalTab === 'raspored' && <WorkerScheduleTab radnikId={profile?.radnik_id ?? null} />}
            {portalTab === 'vrijeme' && portalVrijeme && <WorkerTimeTab />}
            {portalTab === 'dokumenti' && (profile?.radnik_id
              ? <WorkerDocumentsTab radnikId={profile.radnik_id} orders={orders} />
              : <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Nema dokumenata.</p>)}
            {portalTab === 'nalozi' && (loading ? <p className="rounded-xl bg-white p-4 text-sm text-slate-500">Učitavanje naloga…</p> : orders.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
                <ClipboardCheck className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-3 font-semibold text-slate-800">Nema dodijeljenih naloga</p>
                <p className="mt-1 text-sm text-slate-500">Zaključani nalozi koje ti dodijeli ured pojavit će se ovdje.</p>
              </div>
            ) : orders.map((order) => (
              <button key={order.id} type="button" onClick={() => setSelectedId(order.id)} className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm active:bg-indigo-50 ${order.mobile_status === 'u_tijeku' ? 'border-indigo-400' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-mono text-xs font-semibold text-indigo-600">{order.broj}</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${order.mobile_status === 'u_tijeku' ? 'bg-amber-100 text-amber-800' : order.mobile_status === 'odobren' ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-50 text-indigo-700'}`}>
                    {order.mobile_status === 'dodijeljen' ? 'Dodijeljen' : order.mobile_status === 'u_tijeku' ? 'U tijeku' : order.mobile_status === 'predan' ? 'Na odobrenju' : order.mobile_status === 'odobren' ? 'Odobren' : 'Nalog'}
                  </span>
                </div>
                <h3 className="mt-2 font-bold text-slate-900">{order.naslov}</h3>
                {order.gradiliste_naziv && <p className="mt-1 text-sm text-slate-500">{order.gradiliste_naziv}</p>}
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <span>{order.rok ? `Rok: ${new Date(`${order.rok}T00:00:00`).toLocaleDateString('hr-HR')}` : 'Otvori detalje naloga'}</span>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </div>
              </button>
            )))}
          </section>
        )}
      </div>
    </main>
  );
}

type WorkOrderPanelTone = 'sky' | 'amber' | 'emerald' | 'rose' | 'slate';

const workOrderPanelTone: Record<WorkOrderPanelTone, { header: string; icon: string }> = {
  sky: { header: 'bg-sky-50', icon: 'bg-sky-100 text-sky-800' },
  amber: { header: 'bg-amber-50', icon: 'bg-amber-100 text-amber-800' },
  emerald: { header: 'bg-emerald-50', icon: 'bg-emerald-100 text-emerald-800' },
  rose: { header: 'bg-rose-50', icon: 'bg-rose-100 text-rose-800' },
  slate: { header: 'bg-slate-100', icon: 'bg-white text-slate-700' },
};

function WorkOrderPanel({
  title,
  icon,
  tone = 'sky',
  summary,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone?: WorkOrderPanelTone;
  summary?: string;
  children: React.ReactNode;
}) {
  const colors = workOrderPanelTone[tone];
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className={`flex items-center gap-3 border-b border-slate-200/70 px-4 py-3 ${colors.header}`}>
        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${colors.icon}`}>
          {icon}
        </span>
        <h3 className="min-w-0 flex-1 text-base font-bold text-slate-900">{title}</h3>
        {summary && <span className="shrink-0 text-right text-xs font-bold text-emerald-700">{summary}</span>}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl bg-slate-50 p-3"><h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h4>{children}</div>;
}

function CheckField({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-xl px-1 py-2 text-sm text-slate-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 rounded border-slate-300 text-sky-700" />
      {label}
    </label>
  );
}

function ItemEditor({
  title,
  items,
  equipment,
  equipmentLabel = 'alat',
  value,
  onValue,
  onAdd,
  onAddEquipment,
  onHours,
  onToggle,
  checkKey = 'gotovo',
  noneChecked = false,
  onNone,
  noneLabel = '',
  showNone = false,
  placeholder,
  working,
}: {
  title: string;
  items: NalogStavka[];
  equipment?: Oprema[];
  equipmentLabel?: 'alat' | 'stroj';
  value: string;
  onValue: (value: string) => void;
  onAdd: () => void;
  onAddEquipment?: (opremaId: string) => void;
  onHours?: (item: NalogStavka, hours: number | null) => void;
  onToggle: (item: NalogStavka) => void;
  checkKey?: 'gotovo' | 'uzeto';
  noneChecked?: boolean;
  onNone?: (checked: boolean) => void;
  noneLabel?: string;
  showNone?: boolean;
  placeholder: string;
  working: boolean;
}) {
  const [selectedEquipmentId, setSelectedEquipmentId] = useState('');
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const linkedEquipment = equipment?.find((tool) => tool.id === item.oprema_id);
        const equipmentDetails = linkedEquipment
          ? `${linkedEquipment.gradilista?.naziv ?? 'Skladište'}${linkedEquipment.inventarski_broj ? ` · ${linkedEquipment.inventarski_broj}` : ''}`
          : null;
        const checked = Boolean(item[checkKey]);
        return (
          <div key={item.id} className={`flex min-h-[5.5rem] items-start gap-4 rounded-2xl border p-4 ${checked ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50/60'}`}>
            <label className="flex min-w-0 flex-1 items-start gap-4">
              <input type="checkbox" checked={checked} onChange={() => void onToggle(item)} disabled={working} className="mt-0.5 h-7 w-7 shrink-0 rounded-md border-2 border-slate-300 accent-emerald-600" />
              <span className="min-w-0 flex-1">
                <span className={`block text-base font-semibold leading-6 ${checked && checkKey === 'gotovo' ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{item.naziv}</span>
                {checked && checkKey === 'uzeto' && <span className="mt-1 block text-sm font-medium text-emerald-700">Uzeto</span>}
                {equipmentDetails && <span className="mt-1 block text-sm text-slate-500">{equipmentDetails}</span>}
              </span>
            </label>
            {onHours && (
              <label className="flex flex-shrink-0 items-center gap-1 text-xs text-slate-500">
                <input
                  key={`${item.id}-${item.sati ?? ''}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.5"
                  defaultValue={item.sati ?? ''}
                  onBlur={(event) => {
                    const next = event.target.value === '' ? null : Math.max(0, Number(event.target.value));
                    if (next !== (item.sati ?? null)) onHours(item, next);
                  }}
                  className="min-h-11 w-20 rounded-lg border border-slate-300 px-2 text-right text-sm"
                  aria-label={`Radni sati stroja ${item.naziv}`}
                />
                h
              </label>
            )}
          </div>
        );
      })}
      {items.length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Nema stavki.</p>}
      {!(equipmentLabel === 'stroj') && <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-4">
        <label htmlFor={`new-${equipmentLabel}-${title}`} className="block text-sm font-bold text-slate-900">Dodaj {title.toLocaleLowerCase('hr-HR')}</label>
        <input
          id={`new-${equipmentLabel}-${title}`}
          value={value}
          disabled={working}
          onChange={(event) => onValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onAdd();
            }
          }}
          placeholder={placeholder}
          className="min-h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"
        />
        <button type="button" onClick={onAdd} disabled={working || !value.trim()} className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-base font-bold text-white active:bg-indigo-700 disabled:opacity-40" aria-label={`Dodaj stavku: ${title}`}>
          <Plus className="h-5 w-5" /> Dodaj
        </button>
      </div>}
      {equipment && onAddEquipment && (
        <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-4">
          <label htmlFor={`inventory-${equipmentLabel}`} className="block text-sm font-bold text-slate-900">Dodaj {equipmentLabel === 'stroj' ? 'stroj iz popisa' : 'alat iz popisa opreme'}</label>
          <select
            id={`inventory-${equipmentLabel}`}
            value={selectedEquipmentId}
            onChange={(event) => setSelectedEquipmentId(event.target.value)}
            disabled={working}
            className="min-h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-base"
          >
            <option value="">{equipmentLabel === 'stroj' ? 'Odaberi stroj iz popisa strojeva…' : 'Odaberi alat iz popisa opreme…'}</option>
            {equipment.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {tool.naziv}{tool.inventarski_broj ? ` · ${tool.inventarski_broj}` : ''}
                {tool.gradilista?.naziv ? ` — ${tool.gradilista.naziv}` : ''}
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
            disabled={working || !selectedEquipmentId}
            className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-base font-bold text-white disabled:opacity-40"
          >
            <Plus className="h-5 w-5" /> Dodaj iz popisa
          </button>
        </div>
      )}
      {showNone && onNone && <CheckField checked={noneChecked} onChange={onNone} label={noneLabel} />}
    </div>
  );
}

function SectionConfirm({
  value,
  onChange,
  disabled,
  confirmLabel = 'Potvrđujem',
  naLabel = 'Nije primjenjivo',
}: {
  value: 'da' | 'na' | null;
  onChange: (value: 'da' | 'na' | null) => void;
  disabled?: boolean;
  confirmLabel?: string;
  naLabel?: string;
}) {
  const base = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60';
  return (
    <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value === 'da' ? null : 'da')}
        className={`${base} ${value === 'da' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
      >
        <Check className="h-4 w-4" /> {confirmLabel}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(value === 'na' ? null : 'na')}
        className={`${base} ${value === 'na' ? 'border-slate-600 bg-slate-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
      >
        {naLabel}
      </button>
    </div>
  );
}

function Checklist({ items }: { items: Array<{ label: string; ok: boolean }> }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-3 text-sm">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${item.ok ? 'bg-emerald-600 text-white' : 'border-2 border-slate-300 bg-white'}`}>
            {item.ok && <Check className="h-4 w-4" />}
          </span>
          <span className={item.ok ? 'text-slate-500' : 'font-semibold text-slate-800'}>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function StepHeader({ step, title, text }: { step: number; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3 px-1 pt-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">{step}</span>
      <div>
        <h3 className="text-lg font-extrabold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-600">{text}</p>
      </div>
    </div>
  );
}
