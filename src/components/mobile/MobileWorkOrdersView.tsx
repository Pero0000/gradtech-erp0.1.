import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera, Check, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, FileText, Gauge, ListChecks, LogOut, Package, Plus, RefreshCw, Upload, Wrench } from 'lucide-react';
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
  fetchNalogDokumenti,
  fetchNalogFoto,
  fetchNalogGradilisteDokumentIds,
  fetchNalogStavke,
  fetchNalogZadaci,
  fetchOprema,
  finishMobileWorkerTime,
  saveMobileNalogReport,
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

const reviewSections = [
  { id: 'upute', label: 'Upute i opis naloga' },
  { id: 'zadaci', label: 'Radni zadaci' },
  { id: 'materijal', label: 'Materijal za nastavak' },
  { id: 'alat', label: 'Alat za nastavak' },
  { id: 'dokumenti', label: 'Dokumenti i slike' },
] as const;

type MobileReport = {
  kmPocetak: string;
  kmKraj: string;
  kmNa: boolean;
  napomena: string;
  napomenaNa: boolean;
  tasksConfirmed: boolean;
  fotoNa: boolean;
  materijalNa: boolean;
  alatNa: boolean;
};

type MobileDetails = {
  gradilisteId: string | null;
  vozacId: string | null;
  kmPocetak: number | null;
  kmKraj: number | null;
  napomena: string | null;
  mobileKmNa: boolean;
  mobileNapomenaNa: boolean;
  mobileTasksConfirmed: boolean;
  mobileFotoNa: boolean;
  mobileMaterijalNa: boolean;
  mobileAlatNa: boolean;
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
  napomena: '',
  napomenaNa: false,
  tasksConfirmed: false,
  fotoNa: false,
  materijalNa: false,
  alatNa: false,
};

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
  const { profile, signOut } = useAuth();
  const pushError = usePushRegistration(profile?.id ?? '');
  const [workerName, setWorkerName] = useState<string | null>(null);
  const [orders, setOrders] = useState<MobileRadniNalog[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<MobileDetails | null>(null);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [report, setReport] = useState<MobileReport>(emptyReport);
  const [noteConfirmed, setNoteConfirmed] = useState(false);
  const [leaderConfirmed, setLeaderConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newMaterial, setNewMaterial] = useState('');
  const [newTool, setNewTool] = useState('');
  const [newTask, setNewTask] = useState('');
  const [teamTimeDrafts, setTeamTimeDrafts] = useState<Record<string, { vrijemeOd: string; vrijemeDo: string }>>({});

  const selected = orders.find((order) => order.id === selectedId) ?? null;
  const isLeader = selected?.poslovodja_id === profile?.radnik_id;
  const canEditOrder = selected?.mobile_status === 'dodijeljen' || selected?.mobile_status === 'u_tijeku';
  const isReviewed = reviewSections.every((section) => reviewed.includes(section.id));

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
      setNoteConfirmed(false);
      setLeaderConfirmed(false);
    }
    try {
      const { data: nalog, error: nalogError } = await supabase
        .from('radni_nalozi')
        .select('gradiliste_id,vozac_id,km_pocetak,km_kraj,napomena,mobile_km_na,mobile_napomena_na,mobile_tasks_confirmed,mobile_foto_na,mobile_materijal_na,mobile_alat_na')
        .eq('id', order.id)
        .single();
      if (nalogError) throw nalogError;

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
        kmPocetak: nalog.km_pocetak,
        kmKraj: nalog.km_kraj,
        napomena: nalog.napomena,
        mobileKmNa: nalog.mobile_km_na,
        mobileNapomenaNa: nalog.mobile_napomena_na,
        mobileTasksConfirmed: nalog.mobile_tasks_confirmed,
        mobileFotoNa: nalog.mobile_foto_na,
        mobileMaterijalNa: nalog.mobile_materijal_na,
        mobileAlatNa: nalog.mobile_alat_na,
        zadaci,
        stavke,
        alati: alati.filter((item) => item.status !== 'servis' && item.status !== 'neaktivno'),
        strojevi: strojevi.filter((item) => item.status !== 'servis' && item.status !== 'neaktivno'),
        dokumenti: [...dokumenti, ...selectedSiteDocs],
        foto,
        ekipa,
      });
      setTeamTimeDrafts(Object.fromEntries(ekipa.map((worker) => [
        worker.radnik_id,
        { vrijemeOd: worker.vrijeme_od?.slice(0, 5) ?? '', vrijemeDo: worker.vrijeme_do?.slice(0, 5) ?? '' },
      ])));
      setReviewed(order.mobile_reviewed_sections ?? []);
      setReport({
        kmPocetak: nalog.km_pocetak?.toString() ?? '',
        kmKraj: nalog.km_kraj?.toString() ?? '',
        kmNa: nalog.mobile_km_na,
        napomena: nalog.napomena ?? '',
        napomenaNa: nalog.mobile_napomena_na,
        tasksConfirmed: nalog.mobile_tasks_confirmed,
        fotoNa: nalog.mobile_foto_na,
        materijalNa: nalog.mobile_materijal_na,
        alatNa: nalog.mobile_alat_na,
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

  const saveReport = async () => {
    if (!selected) return;
    const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value);
    const kmPocetak = numberOrNull(report.kmPocetak);
    const kmKraj = numberOrNull(report.kmKraj);
    if ((kmPocetak !== null && (!Number.isInteger(kmPocetak) || kmPocetak < 0)) ||
      (kmKraj !== null && (!Number.isInteger(kmKraj) || kmKraj < 0))) {
      throw new Error('Kilometri moraju biti cijeli pozitivni brojevi.');
    }
    await saveMobileNalogReport({
      nalogId: selected.id,
      kmPocetak,
      kmKraj,
      kmNa: report.kmNa,
      napomena: report.napomena,
      napomenaNa: report.napomenaNa,
      tasksConfirmed: report.tasksConfirmed,
      fotoNa: report.fotoNa,
      materijalNa: report.materijalNa,
      alatNa: report.alatNa,
    });
  };

  const addItem = async (tip: 'materijal' | 'alat') => {
    if (!selected || !details) return;
    const value = tip === 'materijal' ? newMaterial.trim() : newTool.trim();
    if (!value) return;
    await runAction(async () => {
      await addNalogStavka(selected.id, tip, value);
      if (tip === 'materijal') {
        setNewMaterial('');
        setReport((current) => ({ ...current, materijalNa: false }));
      } else {
        setNewTool('');
        setReport((current) => ({ ...current, alatNa: false }));
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

  const uploadPhotos = async (files: FileList | null) => {
    if (!selected || !files?.length) return;
    const chosen = Array.from(files);
    await runAction(async () => {
      for (const file of chosen) await uploadNalogFoto(selected.id, file, false);
      setReport((current) => ({ ...current, fotoNa: false }));
    });
  };

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
    if (!selected || !details?.gradilisteId || !newTask.trim()) return;
    const gradilisteId = details.gradilisteId;
    const name = newTask.trim();
    await runAction(async () => {
      await addNalogZadatak(selected.id, gradilisteId, name);
      setNewTask('');
    }, 'Radni zadatak je dodan.');
  };

  const toggleItem = async (item: NalogStavka) => {
    await runAction(async () => {
      const { error: updateError } = await supabase
        .from('radni_nalozi_stavke')
        .update({ gotovo: !item.gotovo })
        .eq('id', item.id);
      if (updateError) throw updateError;
    });
  };

  const saveWorkerTime = async (worker: MobileWorkerTime) => {
    if (!selected) return;
    const draft = teamTimeDrafts[worker.radnik_id];
    if (!draft?.vrijemeOd) {
      throw new Error('Unesi vrijeme početka rada.');
    }
    await saveMobileWorkerTime({
      nalogId: selected.id,
      radnikId: worker.radnik_id,
      vrijemeOd: draft.vrijemeOd,
      vrijemeDo: draft.vrijemeDo || null,
      reviewedSections: isLeader ? reviewed : [],
    });
  };

  const reviewedSet = useMemo(() => new Set(reviewed), [reviewed]);
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
            Tm-color{workerName ? ` · ${workerName}` : ''}
          </p>
          <h1 className="text-lg font-bold text-slate-900">Moji radni nalozi</h1>
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

            {!loading && details && (
              <WorkOrderPanel title="Vozač" icon={<Gauge className="h-5 w-5" />} tone="sky">
                <label className="block text-sm font-medium text-slate-700">
                  Odaberite vozača iz ekipe
                  <select
                    value={details.vozacId ?? ''}
                    disabled={!canEditOrder || working}
                    onChange={(event) => {
                      const radnikId = event.target.value || null;
                      void runAction(
                        () => setMobileNalogVozac(selected.id, radnikId),
                        'Vozač je spremljen.',
                      );
                    }}
                    className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 disabled:bg-slate-100"
                  >
                    <option value="">Poslovođa (zadano)</option>
                    {details.ekipa.map((worker) => (
                      <option key={worker.radnik_id} value={worker.radnik_id}>
                        {worker.ime} {worker.prezime}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-2 text-sm text-slate-600">
                  Trenutni vozač: {(() => {
                    const driverId = details.vozacId ?? selected.poslovodja_id;
                    const driver = details.ekipa.find((worker) => worker.radnik_id === driverId);
                    return driver ? `${driver.ime} ${driver.prezime}` : 'poslovođa (još nije odabran)';
                  })()}
                </p>
              </WorkOrderPanel>
            )}

            {!loading && details && (
              <section className="overflow-hidden rounded-2xl border-2 border-amber-400 bg-amber-50 shadow-md shadow-amber-100">
                <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-100 px-4 py-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
                    <AlertTriangle className="h-6 w-6" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-extrabold uppercase tracking-wider text-amber-800">Važno za ekipu</p>
                    <h3 className="text-lg font-extrabold text-slate-900">Napomena uz radni nalog</h3>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${report.napomena.trim() ? 'bg-amber-200 text-amber-900' : report.napomenaNa ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-amber-900'}`}>
                    {report.napomena.trim() ? 'Pročitati' : report.napomenaNa ? 'Potvrđeno' : 'Potrebna potvrda'}
                  </span>
                </div>
                <div className="space-y-3 p-4">
                  <p className="text-sm leading-5 text-amber-950">Ovdje upišite važne upute za radnike. Napomena će biti prikazana uz radni nalog.</p>
                  <textarea
                    rows={4}
                    value={report.napomena}
                    disabled={!canEditOrder || (isLeader && report.napomenaNa)}
                    onChange={(event) => {
                      setReport((current) => ({ ...current, napomena: event.target.value, napomenaNa: false }));
                      setNoteConfirmed(false);
                    }}
                    placeholder="Upišite napomenu ili važne upute…"
                    className="w-full rounded-xl border-2 border-amber-400 bg-white p-4 text-base font-semibold leading-6 text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:bg-amber-100"
                  />
                  {!report.napomena.trim() && (
                    <p className="rounded-xl border border-amber-300 bg-white p-3 text-sm font-semibold text-amber-900">
                      {isLeader ? 'Upišite napomenu ili potvrdite da nije potrebna.' : 'Poslovođa još nije upisao napomenu.'}
                    </p>
                  )}
                  {report.napomena.trim() && (
                    <CheckField
                      checked={noteConfirmed}
                      onChange={setNoteConfirmed}
                      label="Potvrđujem da sam pročitao/la i razumio/la napomenu."
                    />
                  )}
                {isLeader && canEditOrder && (
                  <CheckField
                    checked={report.napomenaNa}
                    onChange={(checked) => {
                      setReport((current) => ({ ...current, napomenaNa: checked, napomena: checked ? '' : current.napomena }));
                      setNoteConfirmed(false);
                    }}
                    label="Potvrđujem da nema dodatne napomene."
                  />
                )}
                {canEditOrder && (
                  <Button
                    onClick={() => void runAction(saveReport, 'Napomena i izmjene izvještaja spremljene.')}
                    disabled={working || (report.napomena.trim() ? !noteConfirmed : !isLeader || !report.napomenaNa)}
                  >
                    <Upload className="h-5 w-5" /> Spremi potvrđenu napomenu
                  </Button>
                )}
                </div>
              </section>
            )}

            {loading && <p className="rounded-xl bg-white p-4 text-sm text-slate-500">Učitavanje naloga…</p>}
            {!loading && details && !selected.mobile_started_at && selected.mobile_status !== 'predan' && selected.mobile_status !== 'odobren' && (
              <WorkOrderPanel title="Pregled prije početka" icon={<ClipboardCheck className="h-5 w-5" />} tone="sky">
                <p className="text-sm text-slate-600">Svi djelatnici mogu pregledavati i dopunjavati podatke naloga. Poslovođa potvrđuje da su pregledani svi dijelovi.</p>
                <div className="space-y-2">
                  <ReviewBlock title="Radni zadaci">
                    {details.zadaci.length ? details.zadaci.map((task) => <p key={task.id} className="text-sm text-slate-700">• {task.naziv}</p>) : <p className="text-sm text-slate-500">Nema upisanih zadataka.</p>}
                  </ReviewBlock>
                  <ReviewBlock title="Materijal i alat">
                    {details.stavke.length ? details.stavke.map((item) => <p key={item.id} className="text-sm text-slate-700">• {item.tip === 'materijal' ? 'Materijal' : item.tip === 'stroj' ? `Stroj${item.sati ? ` (${item.sati} h)` : ''}` : 'Alat'}: {item.naziv}</p>) : <p className="text-sm text-slate-500">Nema upisanih stavki.</p>}
                  </ReviewBlock>
                  <ReviewBlock title="Dokumenti i slike">
                    {details.dokumenti.length ? details.dokumenti.map((document) => <a key={document.id} href={document.url} target="_blank" rel="noreferrer" className="block min-h-10 py-2 text-sm font-medium text-sky-700 underline">{document.naziv}</a>) : <p className="text-sm text-slate-500">Nema priloženih dokumenata.</p>}
                    {details.foto.length > 0 && (
                      <div className="mt-2 grid grid-cols-4 gap-2">
                        {details.foto.map((photo) => <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.naziv ?? 'Slika naloga'} className="aspect-square w-full rounded-lg object-cover" /></a>)}
                      </div>
                    )}
                  </ReviewBlock>
                </div>
                {isLeader && <div className="space-y-2 border-t border-slate-100 pt-3">
                  {reviewSections.map((section) => (
                    <label key={section.id} className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
                      <input type="checkbox" checked={reviewedSet.has(section.id)} onChange={(event) => setReviewed((current) => event.target.checked ? [...current, section.id] : current.filter((id) => id !== section.id))} className="h-5 w-5 rounded border-slate-300 text-sky-700" />
                      <span className="text-sm font-medium text-slate-800">Poslovođa pregledao: {section.label.toLowerCase()}</span>
                    </label>
                  ))}
                </div>}
              </WorkOrderPanel>
            )}

            {!loading && details && selected.mobile_status !== 'nije_poslan' && (
              <>
                {(selected.mobile_status === 'dodijeljen' || selected.mobile_status === 'u_tijeku') && (
                    <WorkOrderPanel title="Radno vrijeme ekipe" icon={<Clock3 className="h-5 w-5" />} tone="sky">
                      <p className="text-sm text-slate-600">Svi unosi ostaju na ovom radnom nalogu. Svaki dodijeljeni radnik može evidentirati vrijeme bilo kojeg člana ekipe.</p>
                      <div className="mt-3 space-y-3">
                        {details.ekipa.map((worker) => {
                          const timeDraft = teamTimeDrafts[worker.radnik_id] ?? {
                            vrijemeOd: worker.vrijeme_od?.slice(0, 5) ?? '',
                            vrijemeDo: worker.vrijeme_do?.slice(0, 5) ?? '',
                          };
                          return (
                          <div key={worker.radnik_id} className="rounded-xl border border-slate-200 p-3">
                            <p className="font-semibold text-slate-900">{worker.ime} {worker.prezime}</p>
                            <label className="mt-2 block text-sm text-slate-700">Početak
                              <input
                                type="time"
                                value={timeDraft.vrijemeOd}
                                onChange={(event) => setTeamTimeDrafts((current) => ({
                                  ...current,
                                  [worker.radnik_id]: { ...timeDraft, vrijemeOd: event.target.value },
                                }))}
                                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base"
                              />
                            </label>
                            <label className="mt-2 block text-sm text-slate-700">Završetak
                              <input
                                type="time"
                                value={timeDraft.vrijemeDo}
                                onFocus={() => {
                                  if (!timeDraft.vrijemeDo) {
                                    setTeamTimeDrafts((current) => ({
                                      ...current,
                                      [worker.radnik_id]: { ...timeDraft, vrijemeDo: '16:00' },
                                    }));
                                  }
                                }}
                                onChange={(event) => setTeamTimeDrafts((current) => ({
                                  ...current,
                                  [worker.radnik_id]: { ...timeDraft, vrijemeDo: event.target.value },
                                }))}
                                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base"
                              />
                            </label>
                            <div className="mt-3">
                              <Button
                                variant="secondary"
                                onClick={() => void runAction(() => saveWorkerTime(worker), `Radno vrijeme za ${worker.ime} ${worker.prezime} spremljeno.`)}
                                disabled={working || (isLeader && !isReviewed)}
                              >
                                <Check className="h-5 w-5" /> Spremi radno vrijeme
                              </Button>
                            </div>
                            {!worker.mobile_started_at ? (
                              <div className="mt-3">
                                <Button
                                  variant="secondary"
                                  onClick={() => void runAction(() => startMobileWorkerTime(
                                    selected.id,
                                    worker.radnik_id,
                                    isLeader ? reviewed : [],
                                  ), `Početak vremena za ${worker.ime} ${worker.prezime} spremljen.`)}
                                  disabled={working || (isLeader && !isReviewed)}
                                >
                                  <Clock3 className="h-5 w-5" /> Započni vrijeme
                                </Button>
                              </div>
                            ) : !worker.mobile_finished_at ? (
                              <div className="mt-3">
                                <Button
                                  variant="secondary"
                                  onClick={() => void runAction(() => finishMobileWorkerTime(selected.id, worker.radnik_id), `Završetak vremena za ${worker.ime} ${worker.prezime} spremljen.`)}
                                  disabled={working}
                                >
                                  <Check className="h-5 w-5" /> Završi vrijeme
                                </Button>
                              </div>
                            ) : (
                              <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Vrijeme je završeno.</p>
                            )}
                          </div>
                          );
                        })}
                      </div>
                  </WorkOrderPanel>
                )}

                {canEditOrder && (
                  <div className="space-y-4">
                    <WorkOrderPanel title="Podaci i izvještaj ekipe" icon={<FileText className="h-5 w-5" />} tone="slate">
                      <p className="text-sm leading-5 text-slate-600">Svi djelatnici mogu uređivati podatke naloga. Potvrdne elemente i predaju završnog izvještaja vodi poslovođa.</p>
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Kilometri" icon={<Gauge className="h-5 w-5" />} tone="amber">
                      <div className="space-y-2">
                      <label className="block text-sm text-slate-600">Početno stanje
                        <input inputMode="numeric" type="number" min="0" value={report.kmPocetak} disabled={isLeader && report.kmNa} onChange={(event) => setReport((current) => ({ ...current, kmPocetak: event.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg text-slate-900 disabled:bg-slate-100" />
                      </label>
                      <label className="block text-sm text-slate-600">Završno stanje
                        <input inputMode="numeric" type="number" min="0" value={report.kmKraj} disabled={isLeader && report.kmNa} onChange={(event) => setReport((current) => ({ ...current, kmKraj: event.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg text-slate-900 disabled:bg-slate-100" />
                      </label>
                      {isLeader && <CheckField checked={report.kmNa} onChange={(checked) => setReport((current) => ({ ...current, kmNa: checked, kmPocetak: checked ? '' : current.kmPocetak, kmKraj: checked ? '' : current.kmKraj }))} label="Kilometri nisu primjenjivi" />}
                      </div>
                    </WorkOrderPanel>

                    <WorkOrderPanel
                      title="Poslovi"
                      icon={<ListChecks className="h-5 w-5" />}
                      tone="emerald"
                      summary={`${details.zadaci.filter((task) => task.gotovo).length} / ${details.zadaci.length} obavljeno`}
                    >
                      <p className="text-sm text-slate-500">Označite posao nakon što ga završite.</p>
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
                      {details.gradilisteId && (
                        <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-4">
                          <label htmlFor="mobile-new-task" className="block text-sm font-bold text-slate-900">Dodaj posao</label>
                          <input
                            id="mobile-new-task"
                            value={newTask}
                            onChange={(event) => setNewTask(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void addTask();
                              }
                            }}
                            placeholder="Naziv posla"
                            disabled={working}
                            className="min-h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400"
                          />
                          <button type="button" onClick={() => void addTask()} disabled={working || !newTask.trim()} className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-base font-bold text-white active:bg-indigo-700 disabled:opacity-40">
                            <Plus className="h-5 w-5" /> Dodaj posao
                          </button>
                        </div>
                      )}
                      {isLeader && <CheckField checked={report.tasksConfirmed} onChange={(checked) => setReport((current) => ({ ...current, tasksConfirmed: checked }))} label="Potvrđujem da su pregledani svi zadaci i označeno što je završeno" />}
                      </div>
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Fotografije izvedenog rada" icon={<Camera className="h-5 w-5" />} tone="rose">
                      <div className="space-y-2">
                      {details.foto.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                          {details.foto.map((photo) => <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.naziv ?? 'Fotografija naloga'} className="aspect-square w-full rounded-lg object-cover" /></a>)}
                        </div>
                      )}
                      <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700">
                        <Camera className="h-5 w-5" /> Fotografiraj ili odaberi slike
                        <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(event) => { void uploadPhotos(event.target.files); event.currentTarget.value = ''; }} />
                      </label>
                      {isLeader && <CheckField checked={report.fotoNa} onChange={(checked) => setReport((current) => ({ ...current, fotoNa: checked }))} label="Fotografija nije primjenjiva" />}
                      </div>
                    </WorkOrderPanel>

                    <WorkOrderPanel
                      title="Materijali"
                      icon={<Package className="h-5 w-5" />}
                      tone="amber"
                      summary={`${details.stavke.filter((item) => item.tip === 'materijal' && item.gotovo).length} / ${details.stavke.filter((item) => item.tip === 'materijal').length} za nastavak`}
                    >
                      <p className="text-sm text-slate-500">Označite materijal koji je potreban za nastavak radova.</p>
                      <ItemEditor
                        title="Materijal"
                        items={details.stavke.filter((item) => item.tip === 'materijal')}
                        value={newMaterial}
                        onValue={(value) => setNewMaterial(value)}
                        onAdd={() => void addItem('materijal')}
                        onToggle={toggleItem}
                        noneChecked={report.materijalNa}
                        onNone={(checked) => setReport((current) => ({ ...current, materijalNa: checked }))}
                        showNone={isLeader}
                        noneLabel="Potvrđujem da dodatni materijal nije potreban"
                        placeholder="Npr. boja bijela 15 l"
                        working={working}
                      />
                    </WorkOrderPanel>

                    <WorkOrderPanel
                      title="Alati za ponijeti"
                      icon={<Wrench className="h-5 w-5" />}
                      tone="sky"
                      summary={`${details.stavke.filter((item) => item.tip === 'alat' && item.gotovo).length} / ${details.stavke.filter((item) => item.tip === 'alat').length} spremno`}
                    >
                      <p className="text-sm text-slate-500">Označite alat koji treba ponijeti na gradilište.</p>
                      <ItemEditor
                        title="Alat"
                        items={details.stavke.filter((item) => item.tip === 'alat')}
                        equipment={details.alati}
                        value={newTool}
                        onValue={(value) => setNewTool(value)}
                        onAdd={() => void addItem('alat')}
                        onAddEquipment={(opremaId) => void addInventoryTool(opremaId)}
                        onToggle={toggleItem}
                        noneChecked={report.alatNa}
                        onNone={(checked) => setReport((current) => ({ ...current, alatNa: checked }))}
                        showNone={isLeader}
                        noneLabel="Potvrđujem da dodatni alat nije potreban"
                        placeholder="Npr. skela, brusilica"
                        working={working}
                      />
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Strojevi i radni sati" icon={<Wrench className="h-5 w-5" />} tone="amber">
                      <ItemEditor
                        title="Strojevi"
                        items={details.stavke.filter((item) => item.tip === 'stroj')}
                        equipment={details.strojevi}
                        equipmentLabel="stroj"
                        value=""
                        onValue={() => undefined}
                        onAdd={() => undefined}
                        onAddEquipment={(opremaId) => void addInventoryMachine(opremaId)}
                        onHours={(item, hours) => void setMachineHours(item, hours)}
                        onToggle={toggleItem}
                        noneChecked={false}
                        onNone={() => undefined}
                        showNone={false}
                        noneLabel=""
                        placeholder=""
                        working={working}
                      />
                    </WorkOrderPanel>

                    <Button variant="secondary" onClick={() => void runAction(saveReport, 'Izmjene izvještaja su spremljene.')} disabled={working}>
                      <Upload className="h-5 w-5" /> Spremi izmjene izvještaja
                    </Button>
                    {isLeader && selected.mobile_status === 'u_tijeku' && <WorkOrderPanel title="Potvrda i predaja" icon={<Check className="h-5 w-5" />} tone="emerald">
                      <CheckField
                        checked={leaderConfirmed}
                        onChange={setLeaderConfirmed}
                        label="Kao poslovođa potvrđujem da sam pregledao napomenu, radna vremena ekipe i završni izvještaj."
                      />
                      <div className="space-y-2">
                        <Button onClick={() => void runAction(async () => { await saveReport(); await submitMobileNalog(selected.id, leaderConfirmed); }, 'Nalog je predan na odobrenje.')} disabled={working || !leaderConfirmed}>
                          <Check className="h-5 w-5" /> Predaj nalog na odobrenje
                        </Button>
                      </div>
                      <p className="text-xs leading-5 text-slate-500">Prije predaje svi dodijeljeni djelatnici moraju imati završeno vrijeme. Samo poslovođa može potvrditi i predati nalog.</p>
                    </WorkOrderPanel>}
                  </div>
                )}

                {!isLeader && selected.mobile_status === 'u_tijeku' && (
                  <p className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-900">Možeš uređivati podatke, zadatke, materijal, alat i fotografije. Poslovođa je odgovoran za potvrde i predaju naloga.</p>
                )}

                {selected.mobile_status === 'predan' && <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">Nalog je predan poslovođi i čeka završno odobrenje u uredu.</p>}
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
            <h2 className="px-1 pt-2 text-lg font-bold text-slate-900">Moji radni nalozi</h2>
            {loading ? <p className="rounded-xl bg-white p-4 text-sm text-slate-500">Učitavanje naloga…</p> : orders.length === 0 ? (
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
            ))}
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
  noneChecked,
  onNone,
  noneLabel,
  showNone,
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
  noneChecked: boolean;
  onNone: (checked: boolean) => void;
  noneLabel: string;
  showNone: boolean;
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
        return (
          <div key={item.id} className={`flex min-h-[5.5rem] items-start gap-4 rounded-2xl border p-4 ${item.gotovo ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50/60'}`}>
            <label className="flex min-w-0 flex-1 items-start gap-4">
              <input type="checkbox" checked={item.gotovo} onChange={() => void onToggle(item)} disabled={working} className="mt-0.5 h-7 w-7 shrink-0 rounded-md border-2 border-slate-300 accent-emerald-600" />
              <span className="min-w-0 flex-1">
                <span className={`block text-base font-semibold leading-6 ${item.gotovo ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{item.naziv}</span>
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
      {showNone && <CheckField checked={noneChecked} onChange={onNone} label={noneLabel} />}
    </div>
  );
}
