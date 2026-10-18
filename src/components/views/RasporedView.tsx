import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList, GripVertical, Hammer, Package, Plus, Trash2, Truck, X } from 'lucide-react';
import type { DnevniRasporedGradiliste, DnevniRasporedOstalo, DnevniRasporedRadnik, Gradiliste, GradilisteRegija, GradilisteZadatak, NalogPrioritet, NalogStatus, Radnik, Rok, Vozilo } from '@/types';
import { nextDeadline } from '@/lib/rokovi';
import { Modal } from '@/components/ui/Modal';
import { NalogIzvrsenje } from './NalogIzvrsenje';
import { Field, TextInput, Select, Textarea } from '@/components/ui/Field';
import type { GradilisteStavka } from '@/lib/api';
import {
  setNalogZadaci,
  setNalogStavke as saveNalogStavke,
  addNalogStavke,
  setRasporedGradilistePotvrdeno,
  fetchGradilisteZadaci,
  fetchGradilisteStavke,
  generateNalogBroj,
  discardRasporedNalog,
  fetchZakljuceniNalozi,
  fetchRadniNalozi,
  updateRadniNalog,
  notifyLockedNalogWorkers,
  addRasporedOstalo,
  copyLatestDnevniRaspored,
  createNalogFromRaspored,
  fetchRasporedOstalo,
  removeRasporedOstalo,
  updateRasporedOstaloTekst,
  assignRasporedGradiliste,
  assignRasporedRadnik,
  fetchDnevniRaspored,
  fetchGradilista,
  fetchRokovi,
  fetchRadnici,
  fetchVozila,
  moveRasporedGradiliste,
  moveRasporedRadnik,
  removeRasporedGradiliste,
  removeRasporedRadnik,
  updateRasporedVrijemeVozila,
  addRasporedTekst,
  updateRasporedTekst,
} from '@/lib/api';

type DragPayload =
  | { type: 'gradiliste'; id: string; assignmentId?: string }
  | { type: 'radnik'; id: string; assignmentId?: string }
  | { type: 'ostalo'; id: string; assignmentId?: string };

type SortMode = 'manual' | 'datum_pocetka' | 'datum_zavrsetka';

interface NalogForm {
  fresh?: boolean;
  nalogId?: string;
  zakljucen_at: string | null;
  assignmentId: string;
  broj: string;
  gradiliste_id: string;
  naslov: string;
  opis: string;
  status: NalogStatus;
  prioritet: NalogPrioritet;
  rok: string;
  radnik_ids: string[];
  radnik_options: string[];
  zadatak_ids: string[];
  stavka_ids: string[];
  nove_stavke: { tip: 'materijal' | 'alat'; naziv: string }[];
}
type Category = 'arhiva' | 'aktivna' | 'planirana' | 'ponude';

const columnLabels = ['dm gradilišta', 'dm intervencije', 'ostala gradilišta'];
const columnsStorageKey = 'gradilista-board-columns-v1';
const sortModesStorageKey = 'gradilista-board-sort-modes-v1';
const categories: { key: Category; label: string; statuses: Gradiliste['status'][] }[] = [
  { key: 'arhiva', label: 'Arhiva', statuses: ['zavrseno'] },
  { key: 'aktivna', label: 'Aktivna', statuses: ['aktivno', 'pauzirano'] },
  { key: 'planirana', label: 'Planirana', statuses: ['planirano'] },
  { key: 'ponude', label: 'Ponude', statuses: ['ponuda'] },
];
const regionInfo: Record<GradilisteRegija, { label: string; badge: string }> = {
  dalmacija: { label: 'Dalmacija', badge: 'border-sky-200 bg-sky-100 text-sky-800' },
  istra_kvarner: { label: 'Istra i Kvarner', badge: 'border-emerald-200 bg-emerald-100 text-emerald-800' },
  slavonija: { label: 'Slavonija', badge: 'border-amber-200 bg-amber-100 text-amber-900' },
  zagreb_i_okolica: { label: 'Zagreb i okolica', badge: 'border-rose-200 bg-rose-100 text-rose-800' },
  medimurje: { label: 'Međimurje', badge: 'border-violet-200 bg-violet-100 text-violet-800' },
};
const minSiteSlots = 5;
const defaultWorkerSlots = 5;

function readSortModes(): SortMode[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(sortModesStorageKey) ?? 'null');
    if (Array.isArray(parsed) && parsed.length === 3) {
      return parsed.map((mode): SortMode => mode === 'datum_pocetka' || mode === 'datum_zavrsetka' ? mode : 'manual');
    }
  } catch {
    // Use the default order.
  }
  return ['manual', 'manual', 'manual'];
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString('hr-HR');
}

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().split('T')[0];
}

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('hr-HR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function readColumns(items: Gradiliste[]): string[][] {
  let saved: string[][] = [[], [], []];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(columnsStorageKey) ?? 'null');
    if (Array.isArray(parsed) && parsed.length === 3) {
      saved = parsed.map((column) => Array.isArray(column) ? column.filter((id): id is string => typeof id === 'string') : []);
    }
  } catch {
    // Fall back to an automatic layout.
  }

  const valid = new Set(items.map((item) => item.id));
  const assigned = new Set<string>();
  const columns: string[][] = [[], [], []];
  saved.forEach((column, index) => {
    for (const id of column) {
      if (valid.has(id) && !assigned.has(id)) {
        columns[index].push(id);
        assigned.add(id);
      }
    }
  });
  for (const item of items) {
    if (assigned.has(item.id)) continue;
    const shortest = columns.reduce((best, column, index) => column.length < columns[best].length ? index : best, 0);
    columns[shortest].push(item.id);
  }
  return columns;
}

function WorkerCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      title={count > 1 ? `Radnik je raspoređen na ${count} gradilišta/auta` : 'Raspoređen na 1 gradilište/auto'}
      className={`inline-flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${count > 1 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}
    >
      {count}
    </span>
  );
}

function errMsg(reason: unknown, fallback: string) {
  if (reason && typeof reason === 'object' && 'message' in reason) return String((reason as { message: unknown }).message);
  return fallback;
}

function readPayload(event: React.DragEvent): DragPayload | null {
  try {
    const parsed = JSON.parse(event.dataTransfer.getData('application/json')) as DragPayload;
    return parsed?.type && parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

function startDrag(event: React.DragEvent, payload: DragPayload) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/json', JSON.stringify(payload));
}

export function RasporedView() {
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [radnici, setRadnici] = useState<Radnik[]>([]);
  const [vozila, setVozila] = useState<Vozilo[]>([]);
  const [siteAssignments, setSiteAssignments] = useState<DnevniRasporedGradiliste[]>([]);
  const [workerAssignments, setWorkerAssignments] = useState<DnevniRasporedRadnik[]>([]);
  const [selectedDate, setSelectedDate] = useState(localDateString());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copyingSchedule, setCopyingSchedule] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [, setColumnsVersion] = useState(0);
  const [ostalo, setOstalo] = useState<DnevniRasporedOstalo[]>([]);
  const [nalogForm, setNalogForm] = useState<NalogForm | null>(null);
  const [nalogSaving, setNalogSaving] = useState(false);
  const [nalogStavke, setNalogStavke] = useState<GradilisteStavka[]>([]);
  const [nalogStavkeLoading, setNalogStavkeLoading] = useState(false);
  const [noviMaterijal, setNoviMaterijal] = useState('');
  const [noviAlat, setNoviAlat] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [lockedNalozi, setLockedNalozi] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<Category>('aktivna');
  const [sortModes, setSortModes] = useState<SortMode[]>(() => readSortModes());
  const [rokovi, setRokovi] = useState<Rok[]>([]);
  const [nalogZadaci, setNalogZadaciList] = useState<GradilisteZadatak[]>([]);
  const formGradilisteId = nalogForm?.gradiliste_id ?? '';
  const formNalogId = nalogForm?.nalogId;
  const visibleZadaci = nalogZadaci.filter(
    (z) => (!z.gotovo || z.nalog_id === formNalogId) && (!z.nalog_id || z.nalog_id === formNalogId),
  );
  const visibleStavke = nalogStavke.filter((item) => !item.gotovo || item.nalog_id === formNalogId);

  useEffect(() => {
    if (!formGradilisteId) {
      setNalogZadaciList([]);
      return;
    }
    let cancelled = false;
    fetchGradilisteZadaci(formGradilisteId)
      .then((list) => {
        if (!cancelled) setNalogZadaciList(list);
      })
      .catch(() => {
        if (!cancelled) setNalogZadaciList([]);
      });
    return () => {
      cancelled = true;
    };
  }, [formGradilisteId]);

  useEffect(() => {
    if (!formGradilisteId) {
      setNalogStavke([]);
      setNalogStavkeLoading(false);
      return;
    }
    let cancelled = false;
    setNalogStavkeLoading(true);
    fetchGradilisteStavke(formGradilisteId)
      .then((list) => {
        if (cancelled) return;
        setNalogStavke(list);
        setNalogForm((current) => current && current.gradiliste_id === formGradilisteId
          ? { ...current, stavka_ids: list.filter((item) => item.nalog_id === current.nalogId).map((item) => item.id) }
          : current);
      })
      .catch(() => {
        if (!cancelled) setNalogStavke([]);
      })
      .finally(() => {
        if (!cancelled) setNalogStavkeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [formGradilisteId, formNalogId]);
  const changeSortMode = (columnIndex: number, mode: SortMode) => {
    const next = [...sortModes];
    next[columnIndex] = mode;
    setSortModes(next);
    try {
      window.localStorage.setItem(sortModesStorageKey, JSON.stringify(next));
    } catch {
      // Sorting still works for this session.
    }
  };

  const loadDay = useCallback(async (date: string) => {
    const day = await fetchDnevniRaspored(date);
    setSiteAssignments(day.gradilista);
    setWorkerAssignments(day.radnici);
    const nalogIds = day.gradilista.map((a) => a.nalog_id).filter((id): id is string => Boolean(id));
    try {
      setLockedNalozi(await fetchZakljuceniNalozi(nalogIds));
    } catch (e) {
      setLockedNalozi(nalogIds);
      setError(e instanceof Error ? `Nije moguće provjeriti zaključane naloge; premještanje gradilišta je blokirano. ${e.message}` : 'Nije moguće provjeriti zaključane naloge; premještanje gradilišta je blokirano.');
    }
  }, []);

  const loadOstalo = useCallback(async () => {
    try {
      setOstalo(await fetchRasporedOstalo());
      return true;
    } catch (e) {
      setOstalo([]);
      setError(e instanceof Error ? e.message : 'Greška pri učitavanju popisa Ostalo');
      return false;
    }
  }, []);

  useEffect(() => {
    void loadOstalo();
  }, [loadOstalo]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchGradilista(), fetchRadnici(), fetchVozila(), fetchRokovi().catch(() => [] as Rok[])])
      .then(([nextGradilista, nextRadnici, nextVozila, nextRokovi]) => {
        if (cancelled) return;
        setGradilista(nextGradilista);
        setRadnici(nextRadnici);
        setVozila(nextVozila.filter((v) => v.u_rasporedu !== false));
        setRokovi(nextRokovi);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Greška pri učitavanju');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadDay(selectedDate).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Greška pri učitavanju rasporeda');
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, loadDay]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      await Promise.all([loadDay(selectedDate), loadOstalo()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri spremanju rasporeda');
    }
  };

  const isVehicleLocked = (voziloId: string) => siteAssignments.some((assignment) =>
    assignment.vozilo_id === voziloId
    && (assignment.gradiliste_potvrdeno
      || assignment.nalog_id && lockedNalozi.includes(assignment.nalog_id)));

  const isVehicleOrderLocked = (voziloId: string) => siteAssignments.some((assignment) =>
    assignment.vozilo_id === voziloId
    && assignment.nalog_id
    && lockedNalozi.includes(assignment.nalog_id));

  const toggleSiteConfirmation = (assignment: DnevniRasporedGradiliste, confirmed: boolean) => {
    if (confirmed && isVehicleLocked(assignment.vozilo_id)) {
      setError('Vozilo je već zaključano zbog druge potvrde ili zaključenog radnog naloga.');
      return;
    }
    void run(() => setRasporedGradilistePotvrdeno(assignment.id, confirmed));
  };

  const isLockedAssignment = (assignmentId: string) => {
    const assignment = siteAssignments.find((item) => item.id === assignmentId);
    return Boolean(assignment && isVehicleLocked(assignment.vozilo_id));
  };

  const isLockedWorkerAssignment = (assignmentId: string) => {
    const assignment = workerAssignments.find((item) => item.id === assignmentId);
    return Boolean(assignment && isVehicleLocked(assignment.vozilo_id));
  };

  const isWorkerAssignedToLockedVehicle = (radnikId: string) => workerAssignments.some((assignment) =>
    assignment.radnik_id === radnikId && isVehicleLocked(assignment.vozilo_id));

  const copyLatestSchedule = async () => {
    setCopyingSchedule(true);
    setError(null);
    setNotice(null);
    try {
      const sourceDate = await copyLatestDnevniRaspored(selectedDate);
      if (!sourceDate) {
        setNotice('Nema ranije napravljenog rasporeda za kopiranje.');
        return;
      }
      const [, ostaloLoaded] = await Promise.all([loadDay(selectedDate), loadOstalo()]);
      if (!ostaloLoaded) return;
      setNotice(`Raspored od ${formatShortDate(sourceDate)} dodan je na odabrani datum bez duplikata.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri kopiranju zadnjeg rasporeda');
    } finally {
      setCopyingSchedule(false);
    }
  };

  const openNalog = async (assignmentId: string, g: Gradiliste, opis: string, radnikIds: string[]) => {
    setError(null);
    try {
      let broj: string;
      try {
        broj = await generateNalogBroj();
      } catch {
        broj = `RN-${new Date().getFullYear()}-${Date.now().toString().slice(-3)}`;
      }
      const created = await createNalogFromRaspored(assignmentId, {
        broj,
        gradiliste_id: g.id,
        naslov: `${g.naziv} – ${new Date(selectedDate + 'T00:00:00').toLocaleDateString('hr-HR')}`,
        opis: opis || null,
        status: 'otvoren',
        prioritet: 'srednji',
        rok: selectedDate,
        radnik_ids: radnikIds,
      });
      await loadDay(selectedDate);
      await openExistingNalog(assignmentId, created.id);
      setNalogForm((form) => (form ? { ...form, fresh: true } : form));
    } catch (e) {
      setError(errMsg(e, 'Greška pri kreiranju naloga'));
    }
  };

  const openExistingNalog = async (assignmentId: string, nalogId: string) => {
    setError(null);
    try {
      const nalog = (await fetchRadniNalozi()).find((n) => n.id === nalogId);
      if (!nalog) {
        setError('Radni nalog više ne postoji.');
        return;
      }
      const savedIds = (nalog.radnici ?? []).map((r) => r.id);
      const carIds = workerAssignments
        .filter((w) => w.vozilo_id === siteAssignments.find((s) => s.id === assignmentId)?.vozilo_id)
        .map((w) => w.radnik_id);
      const isDraft = !nalog.zakljucen_at;
      const linkedZadaci = nalog.gradiliste_id
        ? (await fetchGradilisteZadaci(nalog.gradiliste_id).catch(() => [] as GradilisteZadatak[])).filter((z) => z.nalog_id === nalogId)
        : [];
      setNalogForm({
        nalogId,
        zakljucen_at: nalog.zakljucen_at ?? null,
        assignmentId,
        broj: nalog.broj,
        gradiliste_id: nalog.gradiliste_id ?? '',
        naslov: nalog.naslov,
        opis: nalog.opis ?? '',
        status: nalog.status,
        prioritet: nalog.prioritet,
        rok: nalog.rok ?? '',
        radnik_ids: isDraft ? [...new Set([...savedIds, ...carIds])] : savedIds,
        radnik_options: [...new Set([...savedIds, ...carIds])],
        zadatak_ids: linkedZadaci.map((z) => z.id),
        stavka_ids: [],
        nove_stavke: [],
      });
      setNoviMaterijal('');
      setNoviAlat('');
    } catch (e) {
      setError(errMsg(e, 'Greška pri učitavanju naloga'));
    }
  };

  const closeNalog = () => {
    setNalogForm(null);
    setConfirmDiscard(false);
    setNoviMaterijal('');
    setNoviAlat('');
  };

  const addDraftStavka = (tip: 'materijal' | 'alat') => {
    const naziv = (tip === 'materijal' ? noviMaterijal : noviAlat).trim();
    if (!naziv) return;
    setNalogForm((current) => current ? { ...current, nove_stavke: [...current.nove_stavke, { tip, naziv }] } : current);
    if (tip === 'materijal') setNoviMaterijal('');
    else setNoviAlat('');
  };

  const discardNalog = async () => {
    if (!nalogForm?.nalogId) return;
    setNalogSaving(true);
    setError(null);
    try {
      await discardRasporedNalog(nalogForm.nalogId);
      closeNalog();
      await loadDay(selectedDate);
    } catch (e) {
      setError(errMsg(e, 'Greška pri brisanju naloga'));
      closeNalog();
    } finally {
      setNalogSaving(false);
    }
  };

  const saveNalog = async (lock?: 'lock' | 'unlock') => {
    if (!nalogForm || !nalogForm.naslov.trim() || !nalogForm.nalogId) return;
    setNalogSaving(true);
    setError(null);
    try {
      const nalogId = nalogForm.nalogId;
      const payload = {
        gradiliste_id: nalogForm.gradiliste_id || null,
        naslov: nalogForm.naslov.trim(),
        opis: nalogForm.opis.trim() || null,
        status: nalogForm.status,
        prioritet: nalogForm.prioritet,
        rok: nalogForm.rok || null,
        radnik_ids: nalogForm.radnik_ids,
        zakljucen: lock === 'unlock' ? false : undefined,
      };
      if (nalogForm.nalogId) await updateRadniNalog(nalogForm.nalogId, payload);
      const validIds = nalogZadaci.filter((z) => nalogForm.zadatak_ids.includes(z.id)).map((z) => z.id);
      try {
        await setNalogZadaci(nalogId, nalogForm.gradiliste_id || null, validIds);
      } catch (reason) {
        const message = errMsg(reason, 'Zadaci nisu spremljeni.');
        setError(`${message} Pokreni migraciju 20261015220000_zadaci_nalog_veza.sql.`);
        if (lock === 'lock') throw new Error(message);
      }
      await saveNalogStavke(
        nalogId,
        nalogForm.gradiliste_id || null,
        nalogForm.stavka_ids,
      );
      await addNalogStavke(nalogId, nalogForm.nove_stavke);
      setNalogForm((current) => current ? { ...current, nove_stavke: [] } : current);
      if (lock === 'lock') {
        await updateRadniNalog(nalogId, { ...payload, zakljucen: true });
        await notifyLockedNalogWorkers(nalogId);
      }
      closeNalog();
      await loadDay(selectedDate);
    } catch (e) {
      setError(errMsg(e, 'Greška pri spremanju naloga'));
      closeNalog();
    } finally {
      setNalogSaving(false);
    }
  };

  const dismissNalog = async () => {
    const fresh = nalogForm?.fresh ? nalogForm.nalogId : undefined;
    closeNalog();
    if (!fresh) return;
    try {
      await discardRasporedNalog(fresh);
    } catch (e) {
      setError(errMsg(e, 'Greška pri brisanju nacrta'));
    }
    await loadDay(selectedDate);
  };

  const changeDay = (delta: number) => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    setSelectedDate(localDateString(d));
  };

  const dropOnVehicle = (event: React.DragEvent, voziloId: string) => {
    event.preventDefault();
    setDropTarget(null);
    if (isVehicleLocked(voziloId)) {
      setError('Vozilo je zaključano zbog zaključenog radnog naloga.');
      return;
    }
    const payload = readPayload(event);
    if (!payload) return;
    if (payload.type === 'ostalo') {
      const entry = ostalo.find((item) => item.id === payload.id);
      if (entry?.radnik_id && isWorkerAssignedToLockedVehicle(entry.radnik_id)) {
        setError('Radnik je na vozilu sa zaključenim radnim nalogom i ne može se premjestiti.');
        return;
      }
    }
    if (payload.type === 'radnik' && isWorkerAssignedToLockedVehicle(payload.id)) {
      setError('Radnik je na vozilu sa zaključenim radnim nalogom i ne može se premjestiti.');
      return;
    }
    if (payload.assignmentId
      && (payload.type === 'gradiliste' && isLockedAssignment(payload.assignmentId)
        || payload.type === 'radnik' && isLockedWorkerAssignment(payload.assignmentId))) {
      setError('Stavke s vozila na kojem je zaključen radni nalog ne mogu se premjestiti.');
      return;
    }
    void run(async () => {
      if (payload.type === 'ostalo') {
        const entry = ostalo.find((o) => o.id === payload.id);
        if (!entry) return;
        if (entry.radnik_id) await assignRasporedRadnik(selectedDate, voziloId, entry.radnik_id);
        else if (entry.tekst) await addRasporedTekst(selectedDate, voziloId, entry.tekst, true);
        await removeRasporedOstalo(entry.id);
      } else if (payload.type === 'gradiliste') {
        if (payload.assignmentId) await moveRasporedGradiliste(payload.assignmentId, voziloId);
        else await assignRasporedGradiliste(selectedDate, voziloId, payload.id);
      } else if (payload.assignmentId) {
        await moveRasporedRadnik(payload.assignmentId, voziloId);
      } else {
        await assignRasporedRadnik(selectedDate, voziloId, payload.id);
      }
    });
  };

  const placeSite = (gradilisteId: string, columnIndex: number, beforeId?: string) => {
    if (gradilisteId === beforeId) return;
    const next = readColumns(gradilista).map((column) => column.filter((id) => id !== gradilisteId));
    const at = beforeId ? next[columnIndex].indexOf(beforeId) : -1;
    next[columnIndex].splice(at < 0 ? next[columnIndex].length : at, 0, gradilisteId);
    try {
      window.localStorage.setItem(columnsStorageKey, JSON.stringify(next));
    } catch {
      // Redoslijed vrijedi samo do osvježavanja stranice.
    }
    if (beforeId && sortModes[columnIndex] !== 'manual') changeSortMode(columnIndex, 'manual');
    setColumnsVersion((v) => v + 1);
  };

  const dropOnColumn = (event: React.DragEvent, columnIndex: number, beforeId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const payload = readPayload(event);
    if (!payload || payload.type !== 'gradiliste') return;
    if (payload.assignmentId) {
      if (isLockedAssignment(payload.assignmentId)) {
        setError('Gradilište sa zaključenim radnim nalogom ne može se premjestiti s vozila.');
        return;
      }
      const assignment = siteAssignments.find((a) => a.id === payload.assignmentId);
      if (assignment?.gradiliste_id) placeSite(assignment.gradiliste_id, columnIndex, beforeId);
      const assignmentId = payload.assignmentId;
      void run(() => removeRasporedGradiliste(assignmentId));
    } else {
      placeSite(payload.id, columnIndex, beforeId);
    }
  };

  const dropOnOstalo = (event: React.DragEvent) => {
    event.preventDefault();
    setDropTarget(null);
    const payload = readPayload(event);
    if (!payload || payload.type === 'ostalo' || (payload.type === 'radnik' && ostalo.some((o) => o.radnik_id === payload.id))) return;
    const assignmentId = payload.type === 'radnik' || payload.type === 'gradiliste' ? payload.assignmentId : undefined;
    if (payload.type === 'radnik' && isWorkerAssignedToLockedVehicle(payload.id)) {
      setError('Radnik je na vozilu sa zaključenim radnim nalogom i ne može se premjestiti.');
      return;
    }
    if (assignmentId && (payload.type === 'radnik'
      ? isLockedWorkerAssignment(assignmentId)
      : isLockedAssignment(assignmentId))) {
      setError('Stavke s vozila na kojem je zaključen radni nalog ne mogu se premjestiti.');
      return;
    }
    void run(async () => {
      if (payload.type === 'radnik') {
        await addRasporedOstalo(selectedDate, { radnikId: payload.id });
        if (assignmentId) await removeRasporedRadnik(assignmentId);
      } else if (assignmentId) {
        const assignment = siteAssignments.find((a) => a.id === assignmentId);
        if (assignment && !assignment.gradiliste_id && assignment.tekst) {
          await addRasporedOstalo(selectedDate, { tekst: assignment.tekst });
          await removeRasporedGradiliste(assignmentId);
        }
      }
    });
  };

  const dropOnPanel = (event: React.DragEvent, type: DragPayload['type']) => {
    event.preventDefault();
    setDropTarget(null);
    const payload = readPayload(event);
    if (payload?.type === 'ostalo' && type === 'radnik') {
      const entry = ostalo.find((o) => o.id === payload.id);
      if (entry?.radnik_id) void run(() => removeRasporedOstalo(entry.id));
      return;
    }
    if (!payload || payload.type !== type || !payload.assignmentId) return;
    if ((type === 'gradiliste' && isLockedAssignment(payload.assignmentId))
      || (type === 'radnik' && isLockedWorkerAssignment(payload.assignmentId))) {
      setError('Stavke s vozila na kojem je zaključen radni nalog ne mogu se ukloniti.');
      return;
    }
    const assignmentId = payload.assignmentId;
    void run(() => type === 'gradiliste' ? removeRasporedGradiliste(assignmentId) : removeRasporedRadnik(assignmentId));
  };

  const allowDrop = (event: React.DragEvent, target: string) => {
    event.preventDefault();
    if (dropTarget !== target) setDropTarget(target);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  const categoryStatuses = categories.find((c) => c.key === activeCategory)?.statuses ?? [];
  const sites = gradilista.filter((g) => categoryStatuses.includes(g.status)
    && !siteAssignments.some((a) => a.gradiliste_id === g.id));
  const columns = readColumns(gradilista).map((column) =>
    column.filter((id) => sites.some((site) => site.id === id)));
  const workers = radnici.filter((r) => (r.status === 'aktivan' || workerAssignments.some((a) => a.radnik_id === r.id))
    && !ostalo.some((o) => o.radnik_id === r.id));
  const vehicleOf = (voziloId: string) => vozila.find((v) => v.id === voziloId);
  const workerCount = (radnikId: string) => workerAssignments.filter((a) => a.radnik_id === radnikId).length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dnevni raspored</h1>
          <p className="mt-1 text-sm text-slate-500">Povuci gradilišta i radnike u vozila. Povuci natrag na popis za uklanjanje.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => changeDay(-1)}
            aria-label="Prethodni dan"
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-[250px] text-center">
            <div className="flex items-center justify-center gap-2">
              <CalendarDays className="h-5 w-5 text-sky-600" />
              <span className="text-base font-semibold capitalize text-slate-900">{formatDate(selectedDate)}</span>
            </div>
            <div className="mt-1 flex items-center justify-center gap-2">
              <label className="text-xs text-slate-500" htmlFor="raspored-date">Odaberi datum:</label>
              <input
                id="raspored-date"
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) setSelectedDate(e.target.value);
                }}
                aria-label="Odaberi datum dnevnog rasporeda"
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700"
              />
              <button type="button" onClick={() => setSelectedDate(localDateString())} className="text-xs text-sky-600 hover:text-sky-700">
                Danas
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => changeDay(1)}
            aria-label="Sljedeći dan"
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => void copyLatestSchedule()}
            disabled={copyingSchedule}
            className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:cursor-wait disabled:opacity-60"
          >
            <ClipboardList className="h-4 w-4" />
            {copyingSchedule ? 'Kopiranje…' : 'Kopiraj zadnji raspored'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(620px,1.35fr)_minmax(0,1.9fr)_minmax(190px,0.4fr)]">
        {/* Gradilišta */}
        <div>
          <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Kategorije gradilišta">
            {categories.map((category) => {
              const count = gradilista.filter((g) => category.statuses.includes(g.status)).length;
              const active = activeCategory === category.key;
              return (
                <button
                  key={category.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveCategory(category.key)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${active ? 'bg-sky-100 text-sky-800' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {category.label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-white/70' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-3 items-start gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-2">
            {columns.map((column, index) => {
              const mode = sortModes[index] ?? 'manual';
              const items = column
                .map((id) => sites.find((item) => item.id === id))
                .filter((item): item is Gradiliste => Boolean(item));
              if (mode !== 'manual') {
                items.sort((first, second) => {
                  const a = mode === 'datum_pocetka' ? nextDeadline(first, rokovi)?.datum ?? first.datum_pocetka : first[mode];
                  const b = mode === 'datum_pocetka' ? nextDeadline(second, rokovi)?.datum ?? second.datum_pocetka : second[mode];
                  if (!a || !b) return a === b ? 0 : a ? -1 : 1;
                  return a.localeCompare(b);
                });
              }
              return (
                <section
                  key={columnLabels[index]}
                  aria-label={columnLabels[index]}
                  onDragOver={(e) => allowDrop(e, `panel-gradiliste-${index}`)}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => dropOnColumn(e, index)}
                  className={`min-h-32 min-w-0 space-y-2 rounded-lg p-0.5 ${dropTarget === `panel-gradiliste-${index}` ? 'bg-sky-100/70 ring-1 ring-sky-400' : ''}`}
                >
                  <div className="space-y-1 px-0.5">
                    <div className="flex items-center justify-between">
                      <h2 className="truncate text-[10px] font-semibold uppercase text-slate-500" title={columnLabels[index]}>
                        {columnLabels[index]}
                      </h2>
                      <span className="text-[10px] tabular-nums text-slate-400">{items.length}</span>
                    </div>
                    <select
                      aria-label={`Sortiranje: ${columnLabels[index]}`}
                      value={mode}
                      onChange={(e) => changeSortMode(index, e.target.value as SortMode)}
                      className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-700"
                    >
                      <option value="manual">Vlastiti redoslijed</option>
                      <option value="datum_pocetka">Početni / idući rok</option>
                      <option value="datum_zavrsetka">Krajnji rok</option>
                    </select>
                  </div>
                  {items.map((g) => {
                    const region = g.regija ? regionInfo[g.regija] : null;
                    return (
                      <div
                        key={g.id}
                        draggable
                        onDragStart={(e) => startDrag(e, { type: 'gradiliste', id: g.id })}
                        onDragOver={(e) => {
                          e.stopPropagation();
                          allowDrop(e, `site-${g.id}`);
                        }}
                        onDrop={(e) => dropOnColumn(e, index, g.id)}
                        title={g.naziv}
                        className={`cursor-grab rounded-lg border bg-white p-2 shadow-sm hover:border-sky-300 active:cursor-grabbing ${dropTarget === `site-${g.id}` ? 'border-sky-400 ring-2 ring-sky-400' : 'border-slate-200'}`}
                      >
                        <p className="break-words text-[13px] font-semibold leading-tight text-slate-900">{g.naziv}</p>
                        {region && (
                          <span className={`mt-1 inline-flex rounded-full border px-1.5 text-[9px] font-medium leading-3 ${region.badge}`}>
                            {region.label}
                          </span>
                        )}
                        {(g.datum_pocetka || g.datum_zavrsetka) && (
                          <div className="mt-1.5 space-y-0.5 border-t border-slate-100 pt-1 text-[10px] leading-tight text-slate-600">
                            {g.datum_pocetka && <p><span className="text-slate-400">Početak:</span> <span className="font-semibold text-slate-900">{formatShortDate(g.datum_pocetka)}</span></p>}
                            {g.datum_zavrsetka && <p><span className="text-slate-400">Kraj:</span> <span className="font-semibold text-slate-900">{formatShortDate(g.datum_zavrsetka)}</span></p>}
                          </div>
                        )}
                        {(() => {
                          const next = nextDeadline(g, rokovi);
                          return next ? (
                            <p className="mt-1 truncate rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900" title={next.label}>
                              <span className="font-semibold">Idući:</span> {next.label} · {formatShortDate(next.datum)}
                            </p>
                          ) : null;
                        })()}
                        {g.opis && (
                          <div className="mt-1.5 rounded border-l-2 border-red-500 bg-red-50 px-1.5 py-1">
                            <p className="text-[8px] font-bold uppercase text-red-700">Napomena</p>
                            <p className="line-clamp-3 text-[10px] leading-3 text-red-900">{g.opis}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {items.length === 0 && <p className="py-6 text-center text-[10px] text-slate-400">Prazan stupac</p>}
                </section>
              );
            })}
          </div>
        </div>

        {/* Vozila */}
        {vozila.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            <Truck className="mx-auto mb-2 h-6 w-6 text-slate-400" />
            Nema vozila. Dodajte vozila na tabu Vozila i ona će se pojaviti ovdje kao auti.
          </div>
        ) : (
          <div className="grid grid-cols-3 items-start gap-4">
            {[...vozila].sort((a, b) => b.broj_mjesta - a.broj_mjesta || a.registracija.localeCompare(b.registracija)).map((vozilo) => {
              const carSites = siteAssignments.filter((a) => a.vozilo_id === vozilo.id);
              const carWorkers = workerAssignments.filter((a) => a.vozilo_id === vozilo.id);
              const workerSlots = Math.max(vozilo.broj_mjesta || defaultWorkerSlots, carWorkers.length);
              const carTime = carSites.find((a) => a.vrijeme)?.vrijeme ?? '';
              const siteSlots = Math.max(minSiteSlots, carSites.length + 2) - 1;
              const over = vozilo.broj_mjesta > 0 && carWorkers.length > vozilo.broj_mjesta;
              const vehicleLocked = isVehicleLocked(vozilo.id);
              const target = `car-${vozilo.id}`;
              return (
                <section
                  key={vozilo.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!vehicleLocked) allowDrop(e, target);
                    else setDropTarget(null);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
                  }}
                  onDrop={(e) => dropOnVehicle(e, vozilo.id)}
                  title={vehicleLocked ? 'Zaključano zbog potvrđene stavke Ostalo ili zaključenog radnog naloga' : undefined}
                  className={`min-w-0 rounded-lg border-2 p-3 transition-colors ${vehicleLocked ? 'border-emerald-500 bg-emerald-50/60' : dropTarget === target ? 'border-sky-400 bg-sky-50' : 'border-slate-400 bg-slate-200'}`}
                >
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className="w-20 flex-shrink-0 rounded border border-slate-800 bg-white px-1.5 py-0.5 text-xs text-slate-900">AUTO:</span>
                    <span className="min-w-0 flex-1 truncate rounded border border-slate-800 bg-amber-200 px-2 py-0.5 text-center text-sm font-bold uppercase text-slate-900" title={[vozilo.marka, vozilo.model, vozilo.registracija].filter(Boolean).join(' ')}>
                      {[vozilo.marka, vozilo.model, vozilo.registracija].filter(Boolean).join(' ')}
                    </span>
                    {vehicleLocked && <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold text-white">ZAKLJUČANO</span>}
                  </div>

                  <div className="mb-2 flex gap-2">
                    <span className="h-fit w-20 flex-shrink-0 rounded border border-slate-800 bg-white px-1.5 py-0.5 text-[10px] text-slate-900">GRADILIŠTE:</span>
                    <div className="min-w-0 flex-1 bg-white px-2 py-0.5">
                      {carSites.map((a) => {
                        const g = a.gradiliste_id ? gradilista.find((item) => item.id === a.gradiliste_id) : undefined;
                        const isText = !a.gradiliste_id;
                        const hasNalog = Boolean(a.nalog_id);
                        const nalogLocked = vehicleLocked;
                        return (
                          <div
                            key={a.id}
                            draggable={!nalogLocked}
                            onDragStart={(e) => {
                              if (nalogLocked) {
                                e.preventDefault();
                                return;
                              }
                              startDrag(e, { type: 'gradiliste', id: a.gradiliste_id ?? a.id, assignmentId: a.id });
                            }}
                            className={`min-h-[2.25rem] border-b border-slate-100 pb-0.5 ${nalogLocked ? 'cursor-not-allowed bg-emerald-100' : 'cursor-grab'}`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              {isText ? (
                                <div className={`flex min-w-0 flex-1 items-center gap-1 rounded px-1 ${a.iz_ostalo ? 'bg-pink-50' : ''}`}>
                                  <input
                                    key={`${a.id}-${a.tekst ?? ''}`}
                                    defaultValue={a.tekst ?? ''}
                                    aria-label="Ručni unos"
                                    disabled={vehicleLocked}
                                    onBlur={(e) => {
                                      const next = e.target.value.trim();
                                      if (!next) void run(() => removeRasporedGradiliste(a.id));
                                      else if (next !== a.tekst) void run(() => updateRasporedTekst(a.id, next));
                                    }}
                                    className={`min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none focus:ring-1 focus:ring-sky-500 ${a.iz_ostalo ? 'text-pink-500' : 'text-slate-900'}`}
                                  />
                                  {a.iz_ostalo && (
                                    <label
                                      title={a.gradiliste_potvrdeno
                                        ? isVehicleOrderLocked(vozilo.id) || siteAssignments.some((other) => other.id !== a.id && other.vozilo_id === vozilo.id && other.gradiliste_potvrdeno)
                                          ? 'Makni ovu potvrdu; vozilo ostaje zaključano dok postoji druga potvrda ili zaključen nalog'
                                          : 'Odznači za otključavanje vozila'
                                        : vehicleLocked
                                          ? 'Vozilo je zaključano zbog druge potvrde ili zaključenog naloga'
                                          : 'Potvrdi ovu stavku i zaključaj vozilo'}
                                      className={`flex flex-shrink-0 items-center gap-0.5 rounded px-1 text-[10px] ${vehicleLocked && !a.gradiliste_potvrdeno ? 'cursor-not-allowed text-slate-300' : 'cursor-pointer text-slate-600'}`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={Boolean(a.gradiliste_potvrdeno)}
                                        disabled={vehicleLocked && !a.gradiliste_potvrdeno}
                                        onChange={(event) => toggleSiteConfirmation(a, event.target.checked)}
                                        aria-label={`Potvrdi stavku Ostalo ${a.tekst ?? ''}`}
                                        className="h-3.5 w-3.5 accent-emerald-600"
                                      />
                                      Potvrdi
                                    </label>
                                  )}
                                </div>
                              ) : (
                                <span className="min-w-0 flex-1 break-words text-[13px] font-medium leading-tight text-blue-800">{g?.naziv ?? 'Nepoznato gradilište'}</span>
                              )}
                              <button
                                type="button"
                                onClick={() => void run(() => removeRasporedGradiliste(a.id))}
                                disabled={nalogLocked}
                                aria-label="Ukloni gradilište"
                                title={nalogLocked ? 'Nije moguće ukloniti gradilište sa zaključenim radnim nalogom' : 'Ukloni gradilište'}
                                className="flex-shrink-0 text-slate-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                              {!isText && g && (
                                <>
                                  {a.gradiliste_potvrdeno && !a.iz_ostalo && (
                                    <label
                                      title="Ukloni ranije spremljenu potvrdu gradilišta"
                                      className="flex flex-shrink-0 cursor-pointer items-center gap-0.5 rounded px-1 text-[10px] text-amber-700"
                                    >
                                      <input
                                        type="checkbox"
                                        checked
                                        onChange={() => toggleSiteConfirmation(a, false)}
                                        aria-label={`Ukloni staru potvrdu za gradilište ${g.naziv}`}
                                        className="h-3.5 w-3.5 accent-amber-600"
                                      />
                                      Ukloni staru potvrdu
                                    </label>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => void (a.nalog_id ? openExistingNalog(a.id, a.nalog_id) : openNalog(a.id, g, [vozilo.registracija, carTime].filter(Boolean).join(', '), carWorkers.map((w) => w.radnik_id)))}
                                    title={nalogLocked ? 'Zaključen radni nalog – otvori' : hasNalog ? 'Nacrt radnog naloga – otvori' : 'Kreiraj radni nalog'}
                                    aria-label={hasNalog ? 'Otvori radni nalog' : 'Kreiraj radni nalog'}
                                    className={`flex flex-shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-semibold ${nalogLocked ? 'bg-emerald-500 text-white' : hasNalog ? 'bg-amber-200 text-amber-900' : 'bg-slate-100 text-slate-600 hover:bg-sky-100 hover:text-sky-800'}`}
                                  >
                                    {nalogLocked ? <Check className="h-3 w-3" /> : <ClipboardList className="h-3 w-3" />}
                                    RN
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {Array.from({ length: siteSlots - carSites.length }).map((_, i) => (
                        <div key={i} className="h-[2.25rem] border-b border-slate-100">
                          {(
                            <input
                             
                              aria-label="Ručni unos"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                              }}
                              onBlur={(e) => {
                                const text = e.target.value.trim();
                                e.target.value = '';
                                if (text && !vehicleLocked) void run(() => addRasporedTekst(selectedDate, vozilo.id, text));
                              }}
                              disabled={vehicleLocked}
                              className="h-full w-full bg-transparent px-1 text-[13px] text-slate-900 outline-none placeholder:text-slate-300 focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:bg-slate-100"
                            />
                          )}
                        </div>
                      ))}
                      <div className="h-[2.25rem]">
                        <input
                          key={`${vozilo.id}-${carTime}`}
                          defaultValue={carTime}
                          disabled={carSites.length === 0 || vehicleLocked}
                          aria-label="Radno vrijeme"
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            if (next !== carTime) void run(() => updateRasporedVrijemeVozila(selectedDate, vozilo.id, next));
                          }}
                          className="h-full w-full bg-yellow-300 px-1 text-[13px] text-red-600 outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-yellow-100"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <span className="h-fit w-20 flex-shrink-0 rounded border border-slate-800 bg-white px-1.5 py-0.5 text-[10px] text-slate-900">RADNICI:</span>
                    <div className="min-w-0 flex-1 bg-white px-2 py-0.5">
                      {carWorkers.map((a) => {
                        const r = radnici.find((item) => item.id === a.radnik_id);
                        return (
                          <div
                            key={a.id}
                            draggable={!vehicleLocked}
                            onDragStart={(e) => {
                              if (vehicleLocked) {
                                e.preventDefault();
                                return;
                              }
                              startDrag(e, { type: 'radnik', id: a.radnik_id, assignmentId: a.id });
                            }}
                            className={`flex h-6 items-center justify-between gap-1 border-b border-slate-100 ${vehicleLocked ? 'cursor-not-allowed' : 'cursor-grab'}`}
                          >
                            <span className={`truncate text-[13px] font-medium ${workerCount(a.radnik_id) > 1 ? 'text-red-600' : 'text-emerald-700'}`}>{r ? `${r.prezime} ${r.ime}` : 'Nepoznat radnik'}</span>
                            <span className="flex flex-shrink-0 items-center gap-1">
                              <WorkerCount count={workerCount(a.radnik_id)} />
                              <button
                                type="button"
                                onClick={() => void run(() => removeRasporedRadnik(a.id))}
                                disabled={vehicleLocked}
                                aria-label="Ukloni radnika"
                                title={vehicleLocked ? 'Vozilo je zaključano' : 'Ukloni radnika'}
                                className="text-slate-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          </div>
                        );
                      })}
                      {Array.from({ length: workerSlots - carWorkers.length }).map((_, i) => (
                        <div key={i} className="h-6 border-b border-slate-100" />
                      ))}
                    </div>
                  </div>
                  {vozilo.broj_mjesta > 0 && (
                    <p className={`mt-1 text-right text-[10px] ${over ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
                      {carWorkers.length}/{vozilo.broj_mjesta} mjesta{over ? ' – premašen kapacitet' : ''}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <div className="space-y-3 xl:sticky xl:top-0">
        {/* Radnici */}
        <aside
          onDragOver={(e) => allowDrop(e, 'panel-radnici')}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => dropOnPanel(e, 'radnik')}
          className={`rounded-xl border border-dashed p-3 ${dropTarget === 'panel-radnici' ? 'border-sky-400 bg-sky-50/70' : 'border-slate-200 bg-slate-50/50'}`}
        >
          <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">Zaposlenici ({workers.length})</h2>
          {workers.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Nema aktivnih radnika</p>}
          <div className="space-y-1.5">
            {workers.map((r) => {
              const assignments = workerAssignments.filter((a) => a.radnik_id === r.id);
              const cars = assignments
                .map((a) => vehicleOf(a.vozilo_id)?.registracija)
                .filter(Boolean)
                .join(', ');
              const workerLocked = isWorkerAssignedToLockedVehicle(r.id);
              return (
              <div
                key={r.id}
                draggable={!workerLocked}
                onDragStart={(e) => {
                  if (workerLocked) {
                    e.preventDefault();
                    return;
                  }
                  startDrag(e, { type: 'radnik', id: r.id });
                }}
                title={workerLocked ? 'Radnik je na vozilu sa zaključenim radnim nalogom' : undefined}
                className={`flex items-center gap-1.5 rounded-lg border bg-white px-2 py-1.5 shadow-sm ${workerLocked ? 'cursor-not-allowed opacity-70' : 'cursor-grab active:cursor-grabbing'} ${assignments.length > 1 ? 'border-red-200' : assignments.length === 1 ? 'border-emerald-200' : 'border-slate-200 hover:border-sky-300'}`}
                >
                  <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-slate-300" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-800">{r.prezime} {r.ime}</p>
                    {cars && <p className={`truncate text-[10px] ${assignments.length > 1 ? 'text-red-600' : 'text-emerald-700'}`}>{cars}</p>}
                  </div>
                  <WorkerCount count={assignments.length} />
                </div>
              );
            })}
          </div>
        </aside>

        <aside
          onDragOver={(e) => allowDrop(e, 'panel-ostalo')}
          onDragLeave={() => setDropTarget(null)}
          onDrop={dropOnOstalo}
          className={`rounded-xl border border-dashed p-3 ${dropTarget === 'panel-ostalo' ? 'border-sky-400 bg-sky-50/70' : 'border-slate-200 bg-slate-50/50'}`}
        >
          <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">Ostalo</h2>
          <div className="space-y-1.5">
            {ostalo.map((entry) => {
              const worker = entry.radnik_id ? radnici.find((r) => r.id === entry.radnik_id) : null;
              return (
                <div
                  key={entry.id}
                  draggable
                  onDragStart={(e) => startDrag(e, { type: 'ostalo', id: entry.id })}
                  className="flex cursor-grab items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-sm active:cursor-grabbing"
                >
                  <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-slate-300" />
                  {entry.radnik_id ? (
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">{worker ? `${worker.prezime} ${worker.ime}` : 'Nepoznat radnik'}</span>
                  ) : (
                    <input
                      key={`${entry.id}-${entry.tekst ?? ''}`}
                      defaultValue={entry.tekst ?? ''}
                      aria-label="Ostalo"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (!next) void run(() => removeRasporedOstalo(entry.id));
                        else if (next !== entry.tekst) void run(() => updateRasporedOstaloTekst(entry.id, next));
                      }}
                      className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-pink-400 outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => void run(() => removeRasporedOstalo(entry.id))}
                    aria-label="Ukloni"
                    className="flex-shrink-0 text-slate-300 hover:text-red-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            <input
              aria-label="Novo polje u ostalo"
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const text = e.target.value.trim();
                e.target.value = '';
                if (text) void run(() => addRasporedOstalo(selectedDate, { tekst: text }));
              }}
              className="h-8 w-full rounded-lg border border-dashed border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none focus:border-sky-400"
            />
          </div>
        </aside>
        </div>
      </div>

      <Modal
        wide
        open={nalogForm !== null}
        onClose={() => void dismissNalog()}
        title={nalogForm?.nalogId ? 'Uredi radni nalog' : 'Novi radni nalog'}
        footer={
          <>
            {nalogForm?.nalogId && (
              <div className="mr-auto flex items-center gap-2">
                {confirmDiscard ? (
                  <>
                    <span className="text-xs text-slate-600">Obrisati nalog {nalogForm.broj}?</span>
                    <button
                      onClick={() => void discardNalog()}
                      disabled={nalogSaving}
                      className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Da, odustani
                    </button>
                    <button onClick={() => setConfirmDiscard(false)} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
                      Ne
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDiscard(true)}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Odustani od naloga
                  </button>
                )}
              </div>
            )}
            <button
              onClick={() => void dismissNalog()}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Odustani
            </button>
            <button
              onClick={() => void saveNalog()}
              disabled={nalogSaving || nalogStavkeLoading || !nalogForm?.naslov.trim()}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              {nalogSaving ? 'Spremanje…' : nalogForm?.zakljucen_at ? 'Spremi izmjene' : 'Spremi nacrt'}
            </button>
            {!nalogForm?.zakljucen_at && (
              <button
                onClick={() => void saveNalog('lock')}
                disabled={nalogSaving || nalogStavkeLoading || !nalogForm?.naslov.trim()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                Zaključi nalog
              </button>
            )}
          </>
        }
      >
        {nalogForm && (
          <div className="space-y-4">
            <div className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs ${nalogForm.zakljucen_at ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
              <span>
                {nalogForm.zakljucen_at
                  ? `Zaključen ${new Date(nalogForm.zakljucen_at).toLocaleString('hr-HR')}. Izmjene i dalje možeš spremati.`
                  : 'Nacrt – radnici još nisu obaviješteni. Nalog možeš dorađivati dok ga ne zaključiš.'}
              </span>
              {nalogForm.zakljucen_at && (
                <button
                  type="button"
                  onClick={() => void saveNalog('unlock')}
                  disabled={nalogSaving}
                  className="flex-shrink-0 font-semibold underline disabled:opacity-50"
                >
                  Vrati u nacrt
                </button>
              )}
            </div>
            <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-4">
            <Field label="Broj naloga">
              <TextInput value={nalogForm.broj} readOnly className="font-mono bg-slate-50" />
            </Field>
            <Field label="Naslov *">
              <TextInput value={nalogForm.naslov} onChange={(e) => setNalogForm({ ...nalogForm, naslov: e.target.value })} />
            </Field>
            <Field label="Gradilište">
              <Select value={nalogForm.gradiliste_id} onChange={(e) => setNalogForm({ ...nalogForm, gradiliste_id: e.target.value })}>
                {gradilista.map((g) => (
                  <option key={g.id} value={g.id}>{g.naziv}</option>
                ))}
              </Select>
            </Field>
            <Field label="Opis">
              <Textarea rows={3} value={nalogForm.opis} onChange={(e) => setNalogForm({ ...nalogForm, opis: e.target.value })} placeholder="Detaljan opis zadatka…" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Status">
                <Select value={nalogForm.status} onChange={(e) => setNalogForm({ ...nalogForm, status: e.target.value as NalogStatus })}>
                  <option value="otvoren">Otvoren</option>
                  <option value="u_tijeku">U tijeku</option>
                  <option value="zavrsen">Završen</option>
                  <option value="otkazan">Otkazan</option>
                </Select>
              </Field>
              <Field label="Prioritet">
                <Select value={nalogForm.prioritet} onChange={(e) => setNalogForm({ ...nalogForm, prioritet: e.target.value as NalogPrioritet })}>
                  <option value="niski">Niski</option>
                  <option value="srednji">Srednji</option>
                  <option value="visoki">Visoki</option>
                  <option value="hitno">Hitno</option>
                </Select>
              </Field>
            </div>
            <Field label="Rok izvršenja">
              <TextInput type="date" value={nalogForm.rok} onChange={(e) => setNalogForm({ ...nalogForm, rok: e.target.value })} />
            </Field>
            </div>
            <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Radni zadaci za ovaj nalog</p>
              {visibleZadaci.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Nema otvorenih radnih zadataka za ovo gradilište.</p>
              ) : (
                <div className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {visibleZadaci.map((z) => (
                    <label key={z.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={nalogForm.zadatak_ids.includes(z.id)}
                        onChange={() =>
                          setNalogForm({
                            ...nalogForm,
                            zadatak_ids: nalogForm.zadatak_ids.includes(z.id)
                              ? nalogForm.zadatak_ids.filter((id) => id !== z.id)
                              : [...nalogForm.zadatak_ids, z.id],
                          })
                        }
                        className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      <span className="flex-1 text-sm text-slate-700">{z.naziv}</span>
                      {z.rok && <span className="text-xs text-slate-400">{new Date(z.rok + 'T00:00:00').toLocaleDateString('hr-HR')}</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Materijal i alat za ovaj nalog</p>
              {nalogStavkeLoading ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Učitavanje materijala i alata…</p>
              ) : visibleStavke.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Nema otvorenog materijala ni alata za ovo gradilište.</p>
              ) : (
                <div className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {visibleStavke.map((item) => (
                    <label key={item.id} className={`flex items-center gap-3 px-3 py-2 ${item.gotovo ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-slate-50'}`}>
                      <input
                        type="checkbox"
                        checked={nalogForm.stavka_ids.includes(item.id)}
                        disabled={item.gotovo}
                        onChange={() =>
                          setNalogForm({
                            ...nalogForm,
                            stavka_ids: nalogForm.stavka_ids.includes(item.id)
                              ? nalogForm.stavka_ids.filter((id) => id !== item.id)
                              : [...nalogForm.stavka_ids, item.id],
                          })
                        }
                        className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      <span className="flex-1 text-sm text-slate-700">{item.naziv}</span>
                      <span className="text-xs text-slate-400">{item.tip === 'materijal' ? 'Materijal' : item.tip === 'stroj' ? 'Stroj' : 'Alat'}</span>
                      {item.nalog_id && item.nalog_id !== formNalogId && <span className="text-xs text-sky-700">Prethodni nalog</span>}
                      {!item.nalog_id && <span className="text-xs text-slate-400">Gradilište</span>}
                    </label>
                  ))}
                </div>
              )}
              <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                {(['materijal', 'alat'] as const).map((tip) => {
                  const isMaterial = tip === 'materijal';
                  const Icon = isMaterial ? Package : Hammer;
                  const draftValue = isMaterial ? noviMaterijal : noviAlat;
                  const setDraftValue = isMaterial ? setNoviMaterijal : setNoviAlat;
                  return (
                    <div key={tip} className="min-w-0 space-y-2">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <Icon className="h-3.5 w-3.5 text-slate-500" /> Novi {tip} za nalog
                      </p>
                      <div className="space-y-1.5">
                        {nalogForm.nove_stavke.map((stavka, index) => stavka.tip === tip && (
                          <div key={`${tip}-${index}`} className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs">
                            <span className="min-w-0 flex-1 break-words text-slate-700">{stavka.naziv}</span>
                            <button
                              type="button"
                              onClick={() => setNalogForm((current) => current ? { ...current, nove_stavke: current.nove_stavke.filter((_, itemIndex) => itemIndex !== index) } : current)}
                              className="flex-shrink-0 text-slate-400 hover:text-red-600"
                              aria-label={`Ukloni ${stavka.naziv}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex min-w-0 gap-2">
                        <input
                          value={draftValue}
                          onChange={(event) => setDraftValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              addDraftStavka(tip);
                            }
                          }}
                          placeholder={isMaterial ? 'Npr. boja bijela 15 l' : 'Npr. skela, brusilica'}
                          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => addDraftStavka(tip)}
                          disabled={!draftValue.trim()}
                          className="inline-flex flex-shrink-0 items-center justify-center rounded-lg bg-sky-600 px-2.5 text-white hover:bg-sky-700 disabled:opacity-40"
                          aria-label={`Dodaj ${isMaterial ? 'materijal' : 'alat'}`}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Dodijeljeni radnici</p>
              <div className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {radnici.filter((r) => nalogForm.radnik_options.includes(r.id)).map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={nalogForm.radnik_ids.includes(r.id)}
                      onChange={() =>
                        setNalogForm({
                          ...nalogForm,
                          radnik_ids: nalogForm.radnik_ids.includes(r.id)
                            ? nalogForm.radnik_ids.filter((id) => id !== r.id)
                            : [...nalogForm.radnik_ids, r.id],
                        })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span className="text-sm text-slate-700">
                      {r.ime} {r.prezime} <span className="text-slate-400">— {r.uloga}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            </div>
            {nalogForm.nalogId && (
              <div className="md:col-span-2 xl:col-span-2">
                <NalogIzvrsenje
                  key={nalogForm.nalogId}
                  nalog={{ id: nalogForm.nalogId, gradiliste_id: nalogForm.gradiliste_id || null }}
                  radnikIds={nalogForm.radnik_ids}
                  hideZadaci
                  hideStavke
                  onChange={(zavrsen) => setNalogForm((f) => (f ? { ...f, status: zavrsen ? 'zavrsen' : f.status === 'zavrsen' ? 'u_tijeku' : f.status } : f))}
                />
              </div>
            )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
