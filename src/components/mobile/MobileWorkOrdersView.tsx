import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Check, ChevronLeft, ClipboardCheck, Clock3, FileText, Gauge, ListChecks, LogOut, Package, Plus, RefreshCw, Upload, Wrench } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { usePushRegistration } from '@/components/mobile/usePushRegistration';
import {
  addNalogStavka,
  fetchGradilisteDokumenti,
  fetchMobileNalogTeam,
  fetchMobileRadniNalozi,
  fetchMobileWorkerDisplayName,
  fetchNalogDokumenti,
  fetchNalogFoto,
  fetchNalogGradilisteDokumentIds,
  fetchNalogStavke,
  fetchNalogZadaci,
  finishMobileWorkerTime,
  saveMobileNalogReport,
  saveMobileWorkerTime,
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
import type { GradilisteZadatak } from '@/types';

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
  const [leaderConfirmed, setLeaderConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newMaterial, setNewMaterial] = useState('');
  const [newTool, setNewTool] = useState('');
  const [teamTimeDrafts, setTeamTimeDrafts] = useState<Record<string, { vrijemeOd: string; vrijemeDo: string }>>({});

  const selected = orders.find((order) => order.id === selectedId) ?? null;
  const isLeader = selected?.poslovodja_id === profile?.radnik_id;
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
    setOrders(list);
    setSelectedId((current) => current && list.some((order) => order.id === current) ? current : null);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchMobileRadniNalozi()
      .then((list) => {
        if (!active) return;
        setOrders(list);
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
      setLeaderConfirmed(false);
    }
    try {
      const { data: nalog, error: nalogError } = await supabase
        .from('radni_nalozi')
        .select('gradiliste_id,km_pocetak,km_kraj,napomena,mobile_km_na,mobile_napomena_na,mobile_tasks_confirmed,mobile_foto_na,mobile_materijal_na,mobile_alat_na')
        .eq('id', order.id)
        .single();
      if (nalogError) throw nalogError;

      const [zadaci, stavke, dokumenti, foto, linkedIds, ekipa] = await Promise.all([
        fetchNalogZadaci(order.id),
        fetchNalogStavke(order.id),
        fetchNalogDokumenti(order.id),
        fetchNalogFoto(order.id),
        fetchNalogGradilisteDokumentIds(order.id),
        fetchMobileNalogTeam(order.id),
      ]);
      const siteDocs = nalog.gradiliste_id ? await fetchGradilisteDokumenti(nalog.gradiliste_id) : [];
      const selectedSiteDocs = siteDocs.filter((document) => linkedIds.includes(document.id));

      setDetails({
        gradilisteId: nalog.gradiliste_id,
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
        const currentOrder = list.find((order) => order.id === selectedId);
        if (currentOrder) void loadDetails(currentOrder);
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
      reviewedSections: reviewed,
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

            {loading && <p className="rounded-xl bg-white p-4 text-sm text-slate-500">Učitavanje naloga…</p>}
            {!loading && details && !selected.mobile_started_at && selected.mobile_status !== 'predan' && selected.mobile_status !== 'odobren' && (
              <WorkOrderPanel title="Pregled prije početka" icon={<ClipboardCheck className="h-5 w-5" />} tone="sky">
                <p className="text-sm text-slate-600">Otvori i pregledaj sve stavke. Nakon potvrde možeš evidentirati vrijeme za bilo kojeg člana ekipe na ovom nalogu.</p>
                <div className="space-y-2">
                  <ReviewBlock title="Radni zadaci">
                    {details.zadaci.length ? details.zadaci.map((task) => <p key={task.id} className="text-sm text-slate-700">• {task.naziv}</p>) : <p className="text-sm text-slate-500">Nema upisanih zadataka.</p>}
                  </ReviewBlock>
                  <ReviewBlock title="Materijal i alat">
                    {details.stavke.length ? details.stavke.map((item) => <p key={item.id} className="text-sm text-slate-700">• {item.tip === 'materijal' ? 'Materijal' : 'Alat'}: {item.naziv}</p>) : <p className="text-sm text-slate-500">Nema upisanih stavki.</p>}
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
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  {reviewSections.map((section) => (
                    <label key={section.id} className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
                      <input type="checkbox" checked={reviewedSet.has(section.id)} onChange={(event) => setReviewed((current) => event.target.checked ? [...current, section.id] : current.filter((id) => id !== section.id))} className="h-5 w-5 rounded border-slate-300 text-sky-700" />
                      <span className="text-sm font-medium text-slate-800">Pregledao sam: {section.label.toLowerCase()}</span>
                    </label>
                  ))}
                </div>
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
                                disabled={working || !isReviewed}
                              >
                                <Check className="h-5 w-5" /> Spremi radno vrijeme
                              </Button>
                            </div>
                            {!worker.mobile_started_at ? (
                              <div className="mt-3">
                                <Button
                                  variant="secondary"
                                  onClick={() => void runAction(() => startMobileWorkerTime(selected.id, worker.radnik_id, reviewed), `Početak vremena za ${worker.ime} ${worker.prezime} spremljen.`)}
                                  disabled={working || !isReviewed}
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

                {isLeader && selected.mobile_status === 'u_tijeku' && (
                  <div className="space-y-4">
                    <WorkOrderPanel title="Završni izvještaj poslovođe" icon={<FileText className="h-5 w-5" />} tone="slate">
                      <p className="text-sm leading-5 text-slate-600">Spremi podatke tijekom rada. Predaja je moguća nakon završetka vremena cijele ekipe.</p>
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Kilometri" icon={<Gauge className="h-5 w-5" />} tone="amber">
                      <div className="space-y-2">
                      <label className="block text-sm text-slate-600">Početno stanje
                        <input inputMode="numeric" type="number" min="0" value={report.kmPocetak} disabled={report.kmNa} onChange={(event) => setReport((current) => ({ ...current, kmPocetak: event.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg text-slate-900 disabled:bg-slate-100" />
                      </label>
                      <label className="block text-sm text-slate-600">Završno stanje
                        <input inputMode="numeric" type="number" min="0" value={report.kmKraj} disabled={report.kmNa} onChange={(event) => setReport((current) => ({ ...current, kmKraj: event.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg text-slate-900 disabled:bg-slate-100" />
                      </label>
                      <CheckField checked={report.kmNa} onChange={(checked) => setReport((current) => ({ ...current, kmNa: checked, kmPocetak: checked ? '' : current.kmPocetak, kmKraj: checked ? '' : current.kmKraj }))} label="Kilometri nisu primjenjivi" />
                      </div>
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Radni zadaci" icon={<ListChecks className="h-5 w-5" />} tone="emerald">
                      <div className="space-y-2">
                      {details.zadaci.length ? details.zadaci.map((task) => (
                        <label key={task.id} className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
                          <input type="checkbox" checked={task.gotovo} onChange={() => void toggleTask(task)} disabled={working} className="h-5 w-5 rounded border-slate-300 text-emerald-700" />
                          <span className={`text-sm ${task.gotovo ? 'text-emerald-800 line-through' : 'text-slate-800'}`}>{task.naziv}</span>
                        </label>
                      )) : <p className="text-sm text-slate-500">Nema radnih zadataka.</p>}
                      <CheckField checked={report.tasksConfirmed} onChange={(checked) => setReport((current) => ({ ...current, tasksConfirmed: checked }))} label="Pregledao sam sve zadatke i označio što je završeno" />
                      </div>
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Napomena" icon={<FileText className="h-5 w-5" />} tone="sky">
                      <div className="space-y-2">
                      <textarea rows={4} value={report.napomena} disabled={report.napomenaNa} onChange={(event) => setReport((current) => ({ ...current, napomena: event.target.value }))} placeholder="Opiši izvedene radove ili važne okolnosti…" className="w-full rounded-xl border border-slate-300 p-3 text-base text-slate-900 disabled:bg-slate-100" />
                      <CheckField checked={report.napomenaNa} onChange={(checked) => setReport((current) => ({ ...current, napomenaNa: checked, napomena: checked ? '' : current.napomena }))} label="Nemam dodatnu napomenu" />
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
                      <CheckField checked={report.fotoNa} onChange={(checked) => setReport((current) => ({ ...current, fotoNa: checked }))} label="Fotografija nije primjenjiva" />
                      </div>
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Materijal za nastavak" icon={<Package className="h-5 w-5" />} tone="amber">
                      <ItemEditor
                        title="Materijal"
                        items={details.stavke.filter((item) => item.tip === 'materijal')}
                        value={newMaterial}
                        onValue={(value) => setNewMaterial(value)}
                        onAdd={() => void addItem('materijal')}
                        onToggle={toggleItem}
                        noneChecked={report.materijalNa}
                        onNone={(checked) => setReport((current) => ({ ...current, materijalNa: checked }))}
                        noneLabel="Nije potreban dodatni materijal"
                        placeholder="Npr. boja bijela 15 l"
                      />
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Alat za nastavak" icon={<Wrench className="h-5 w-5" />} tone="sky">
                      <ItemEditor
                        title="Alat"
                        items={details.stavke.filter((item) => item.tip === 'alat')}
                        value={newTool}
                        onValue={(value) => setNewTool(value)}
                        onAdd={() => void addItem('alat')}
                        onToggle={toggleItem}
                        noneChecked={report.alatNa}
                        onNone={(checked) => setReport((current) => ({ ...current, alatNa: checked }))}
                        noneLabel="Nije potreban dodatni alat"
                        placeholder="Npr. skela, brusilica"
                      />
                    </WorkOrderPanel>

                    <WorkOrderPanel title="Potvrda i predaja" icon={<Check className="h-5 w-5" />} tone="emerald">
                      <CheckField
                        checked={leaderConfirmed}
                        onChange={setLeaderConfirmed}
                        label="Kao poslovođa potvrđujem radna vremena ekipe i pregledao sam završni izvještaj."
                      />
                      <div className="space-y-2">
                        <Button variant="secondary" onClick={() => void runAction(saveReport, 'Izvještaj je spremljen.')} disabled={working}>
                          <Upload className="h-5 w-5" /> Spremi izvještaj
                        </Button>
                        <Button onClick={() => void runAction(async () => { await saveReport(); await submitMobileNalog(selected.id, leaderConfirmed); }, 'Nalog je predan na odobrenje.')} disabled={working || !leaderConfirmed}>
                          <Check className="h-5 w-5" /> Predaj nalog na odobrenje
                        </Button>
                      </div>
                      <p className="text-xs leading-5 text-slate-500">Prije predaje svi dodijeljeni djelatnici moraju imati završeno vrijeme. Samo poslovođa može potvrditi i predati nalog.</p>
                    </WorkOrderPanel>
                  </div>
                )}

                {!isLeader && selected.mobile_status === 'u_tijeku' && (
                  <p className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-900">Svi radnici evidentiraju vrijeme na ovom istom nalogu. Poslovođa pregledava i potvrđuje završni izvještaj.</p>
                )}

                {selected.mobile_status === 'predan' && <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">Nalog je predan poslovođi i čeka završno odobrenje u uredu.</p>}
                {selected.mobile_status === 'odobren' && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900">Nalog je pregledan i odobren.</p>}
              </>
            )}
          </section>
        ) : (
          <section className="space-y-3">
            <div className="rounded-2xl bg-sky-900 p-4 text-white">
              <p className="text-sm font-medium text-sky-100">Prijavljen djelatnik</p>
              <p className="mt-1 break-all font-semibold">{profile?.email}</p>
            </div>
            {loading ? <p className="rounded-xl bg-white p-4 text-sm text-slate-500">Učitavanje naloga…</p> : orders.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
                <ClipboardCheck className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-3 font-semibold text-slate-800">Nema dodijeljenih naloga</p>
                <p className="mt-1 text-sm text-slate-500">Zaključani nalozi koje ti dodijeli ured pojavit će se ovdje.</p>
              </div>
            ) : orders.map((order) => (
              <button key={order.id} type="button" onClick={() => setSelectedId(order.id)} className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm active:bg-sky-50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-slate-500">{order.broj}</p>
                    <h2 className="mt-1 font-bold text-slate-900">{order.naslov}</h2>
                    {order.gradiliste_naziv && <p className="mt-1 text-sm text-slate-600">{order.gradiliste_naziv}</p>}
                    {order.rok && <p className="mt-2 text-xs text-slate-500">Rok: {new Date(`${order.rok}T00:00:00`).toLocaleDateString('hr-HR')}</p>}
                  </div>
                  <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800">
                    {order.mobile_status === 'dodijeljen' ? 'Novi' : order.mobile_status === 'u_tijeku' ? 'U tijeku' : order.mobile_status === 'predan' ? 'Na odobrenju' : order.mobile_status === 'odobren' ? 'Odobren' : 'Nalog'}
                  </span>
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
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone?: WorkOrderPanelTone;
  children: React.ReactNode;
}) {
  const colors = workOrderPanelTone[tone];
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className={`flex items-center gap-3 border-b border-slate-200/70 px-4 py-3 ${colors.header}`}>
        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${colors.icon}`}>
          {icon}
        </span>
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
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
  value,
  onValue,
  onAdd,
  onToggle,
  noneChecked,
  onNone,
  noneLabel,
  placeholder,
}: {
  title: string;
  items: NalogStavka[];
  value: string;
  onValue: (value: string) => void;
  onAdd: () => void;
  onToggle: (item: NalogStavka) => void;
  noneChecked: boolean;
  onNone: (checked: boolean) => void;
  noneLabel: string;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <label key={item.id} className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
          <input type="checkbox" checked={item.gotovo} onChange={() => void onToggle(item)} className="h-5 w-5 rounded border-slate-300 text-emerald-700" />
          <span className="text-sm text-slate-800">{item.naziv}</span>
        </label>
      ))}
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(event) => onValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onAdd();
            }
          }}
          placeholder={placeholder}
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm"
        />
        <button type="button" onClick={onAdd} disabled={!value.trim()} className="min-h-12 rounded-xl bg-slate-800 px-4 text-white disabled:opacity-40" aria-label={`Dodaj stavku: ${title}`}><Plus className="h-5 w-5" /></button>
      </div>
      <CheckField checked={noneChecked} onChange={onNone} label={noneLabel} />
    </div>
  );
}
