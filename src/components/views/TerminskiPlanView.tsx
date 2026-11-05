import { formatHrDate } from '@/lib/localization';
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3, FileDown, Pencil, Plus, RefreshCw } from 'lucide-react';
import type { Gradiliste, GradilisteZadatak, Kooperant, KooperantAngazman, Rok } from '@/types';
import { createRok, fetchGradilista, fetchKooperantAngazmani, fetchKooperanti, fetchRokovi, fetchTerminskiPlanZadaci, updateKooperantTimelineColor, updateRok } from '@/lib/api';
import { exportTerminskiPlanPdf, type TerminskiPlanPdfRow } from '@/lib/terminskiPlanPdf';
import { hrPraznici } from '@/lib/obracunSati';
import { useAuth } from '@/auth/useAuth';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, Textarea, TextInput } from '@/components/ui/Field';
import { ResourceDeletionHistory } from '@/components/views/ResourceDeletionHistory';
import { DeadlineChangeHistoryPanel } from '@/components/views/FuelChangeHistory';

type RokFilter = 'svi' | 'otvoreni' | 'zavrseni' | 'prekoraceni';

const DAY_MS = 24 * 60 * 60 * 1000;
const VIEW_WEEK_OPTIONS = [1, 2, 3, 4, 6, 8, 12] as const;
type ViewWeeks = typeof VIEW_WEEK_OPTIONS[number];
const DEFAULT_CONTRACTOR_COLORS = ['#7c3aed', '#db2777', '#0891b2', '#ca8a04', '#ea580c', '#4f46e5', '#059669', '#be123c'];

function dateToUtc(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function displayDate(value: string) {
  return formatHrDate(new Date(`${value}T12:00:00`), { day: 'numeric', month: 'short', year: 'numeric' });
}

function startDateOf(rok: Rok) {
  return rok.datum_pocetka ?? rok.datum;
}

function endDateOf(rok: Rok) {
  return rok.datum_zavrsetka ?? rok.datum;
}

function dateRangeLabel(rok: Rok) {
  const start = startDateOf(rok);
  const end = endDateOf(rok);
  return start === end ? displayDate(end) : `${displayDate(start)} – ${displayDate(end)}`;
}

function dateRangeLabelForDates(start: string, end: string) {
  return start === end ? displayDate(end) : `${displayDate(start)} – ${displayDate(end)}`;
}

function hasEngagementPeriod(
  angazman: KooperantAngazman,
): angazman is KooperantAngazman & { datum_pocetka: string; datum_zavrsetka: string } {
  return Boolean(angazman.datum_pocetka && angazman.datum_zavrsetka);
}

const siteStatusOrder: Record<Gradiliste['status'], number> = {
  aktivno: 0,
  pauzirano: 1,
  planirano: 2,
  ponuda: 3,
  neplaceno: 4,
  zavrseno: 5,
};

function statusOf(rok: Rok, today: string): Exclude<RokFilter, 'svi'> {
  if (rok.status === 'zavrsen') return 'zavrseni';
  return rok.status === 'prekoracen' || endDateOf(rok) < today ? 'prekoraceni' : 'otvoreni';
}

function statusLabel(status: Exclude<RokFilter, 'svi'>) {
  if (status === 'zavrseni') return 'Završen';
  if (status === 'prekoraceni') return 'Prekoračen';
  return 'Otvoren';
}

export function TerminskiPlanView({ onOpenGradiliste }: { onOpenGradiliste: (id: string) => void }) {
  const { canAccess } = useAuth();
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [rokovi, setRokovi] = useState<Rok[]>([]);
  const [zadaci, setZadaci] = useState<GradilisteZadatak[]>([]);
  const [angazmani, setAngazmani] = useState<KooperantAngazman[]>([]);
  const [kooperanti, setKooperanti] = useState<Kooperant[]>([]);
  const [expandedSiteIds, setExpandedSiteIds] = useState<string[]>([]);
  const [selectedKooperantIds, setSelectedKooperantIds] = useState<string[] | null>(null);
  const [includeUnassigned, setIncludeUnassigned] = useState(true);
  const [savingColorId, setSavingColorId] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [selectedSite, setSelectedSite] = useState('');
  const [statusFilter, setStatusFilter] = useState<RokFilter>('svi');
  const [viewWeeks, setViewWeeks] = useState<ViewWeeks>(2);
  const [rangeStart, setRangeStart] = useState(() => dateKey(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deadlineModalOpen, setDeadlineModalOpen] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState<Rok | null>(null);
  const [savingDeadline, setSavingDeadline] = useState(false);
  const [deadlineRestoring, setDeadlineRestoring] = useState(false);
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  const [deadlineForm, setDeadlineForm] = useState({
    gradiliste_id: '',
    naziv: '',
    datum_pocetka: '',
    datum_zavrsetka: '',
    kooperant_id: '',
    opis: '',
    status: 'otvoren' as Rok['status'],
  });
  const canEditDeadlines = canAccess('gradilista', 'edit');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sites, deadlines, tasks, contractorAssignments, contractors] = await Promise.all([
        fetchGradilista(),
        fetchRokovi(),
        fetchTerminskiPlanZadaci(),
        fetchKooperantAngazmani(),
        fetchKooperanti(),
      ]);
      setGradilista(sites);
      setRokovi(deadlines);
      setZadaci(tasks);
      setAngazmani(contractorAssignments);
      setKooperanti(contractors);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Greška pri učitavanju terminskog plana.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const windowDays = viewWeeks * 7;
  const days = useMemo(() => Array.from({ length: windowDays }, (_, index) => shiftDate(rangeStart, index)), [rangeStart, windowDays]);
  const holidays = useMemo(() => {
    const years = new Set(days.map((day) => Number(day.slice(0, 4))));
    return new Map([...years].flatMap((year) => [...hrPraznici(year)]));
  }, [days]);
  const isRoseDay = (day: string) => new Date(`${day}T12:00:00`).getDay() === 0 || holidays.has(day);
  const timelineMinWidth = 180 + windowDays * 42;
  const rangeEnd = shiftDate(rangeStart, windowDays);
  const today = dateKey(new Date());
  const todayOffset = (dateToUtc(today) - dateToUtc(rangeStart)) / DAY_MS;
  const todayPosition = ((todayOffset + 0.5) / windowDays) * 100;
  const siteById = useMemo(() => new Map(gradilista.map((site) => [site.id, site])), [gradilista]);
  const taskById = useMemo(() => new Map(zadaci.map((task) => [task.id, task])), [zadaci]);
  const sortedKooperanti = useMemo(() => kooperanti.slice().sort((first, second) => first.naziv.localeCompare(second.naziv)), [kooperanti]);
  const kooperantColor = (kooperant: Kooperant) => {
    if (kooperant.timeline_color) return kooperant.timeline_color;
    const index = sortedKooperanti.findIndex((item) => item.id === kooperant.id);
    return DEFAULT_CONTRACTOR_COLORS[(index < 0 ? 0 : index) % DEFAULT_CONTRACTOR_COLORS.length];
  };
  const kooperantById = useMemo(() => new Map(kooperanti.map((kooperant) => [kooperant.id, kooperant])), [kooperanti]);
  const visibleDeadlines = useMemo(() => rokovi
    .filter((rok) => Boolean(rok.gradiliste_id) && siteById.has(rok.gradiliste_id))
    .filter((rok) => !selectedSite || rok.gradiliste_id === selectedSite)
    .filter((rok) => startDateOf(rok) < rangeEnd && endDateOf(rok) >= rangeStart)
    .filter((rok) => statusFilter === 'svi' || statusOf(rok, today) === statusFilter)
    .filter((rok) => {
      const kooperantId = rok.kooperant_id ?? (rok.zadatak_id ? taskById.get(rok.zadatak_id)?.kooperant_id : null);
      return kooperantId
        ? selectedKooperantIds === null || selectedKooperantIds.includes(kooperantId)
        : includeUnassigned;
    })
    .sort((first, second) => startDateOf(first).localeCompare(startDateOf(second)) || first.naziv.localeCompare(second.naziv)), [
    rokovi, siteById, selectedSite, rangeStart, rangeEnd, statusFilter, today, selectedKooperantIds, includeUnassigned, taskById,
  ]);
  const visibleAngazmani = useMemo(() => angazmani
    .filter((angazman) => angazman.status !== 'otkazano')
    .filter(hasEngagementPeriod)
    .filter((angazman) => Boolean(angazman.gradiliste_id) && siteById.has(angazman.gradiliste_id))
    .filter((angazman) => !selectedSite || angazman.gradiliste_id === selectedSite)
    .filter((angazman) => selectedKooperantIds === null || selectedKooperantIds.includes(angazman.kooperant_id))
    .filter((angazman) => angazman.datum_pocetka < rangeEnd && angazman.datum_zavrsetka >= rangeStart), [
    angazmani, siteById, selectedSite, rangeStart, rangeEnd, selectedKooperantIds,
  ]);
  const groupedTimeline = useMemo(() => {
    const groups = new Map<string, { site: Gradiliste; deadlines: Rok[]; angazmani: KooperantAngazman[] }>();
    for (const rok of visibleDeadlines) {
      const site = siteById.get(rok.gradiliste_id);
      if (!site) continue;
      const group = groups.get(site.id) ?? { site, deadlines: [], angazmani: [] };
      group.deadlines.push(rok);
      groups.set(site.id, group);
    }
    for (const angazman of visibleAngazmani) {
      const site = siteById.get(angazman.gradiliste_id);
      if (!site) continue;
      const group = groups.get(site.id) ?? { site, deadlines: [], angazmani: [] };
      group.angazmani.push(angazman);
      groups.set(site.id, group);
    }
    return [...groups.values()].sort((first, second) =>
      siteStatusOrder[first.site.status] - siteStatusOrder[second.site.status]
      || first.site.naziv.localeCompare(second.site.naziv),
    );
  }, [visibleDeadlines, visibleAngazmani, siteById]);

  const moveRange = (direction: -1 | 1) => setRangeStart((current) => shiftDate(current, direction * windowDays));
  const openToday = () => setRangeStart(today);
  const toggleSiteExpanded = (id: string) => {
    setExpandedSiteIds((current) => current.includes(id)
      ? current.filter((siteId) => siteId !== id)
      : [...current, id]);
  };
  const toggleKooperant = (id: string) => {
    const allIds = sortedKooperanti.map((kooperant) => kooperant.id);
    const selected = new Set(selectedKooperantIds ?? allIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    setSelectedKooperantIds(selected.size === allIds.length ? null : [...selected]);
  };
  const saveKooperantColor = async (kooperant: Kooperant, color: string) => {
    setSavingColorId(kooperant.id);
    setError(null);
    try {
      const updated = await updateKooperantTimelineColor(kooperant.id, color);
      setKooperanti((current) => current.map((item) => item.id === updated.id ? { ...item, timeline_color: updated.timeline_color } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Greška pri spremanju boje kooperanta.');
    } finally {
      setSavingColorId(null);
    }
  };
  const exportCurrentView = async () => {
    setExportingPdf(true);
    setError(null);
    try {
      const rows: TerminskiPlanPdfRow[] = groupedTimeline.flatMap(({ site, deadlines, angazmani: siteAngazmani }) => [
        ...deadlines.map((rok) => {
          const task = rok.zadatak_id ? taskById.get(rok.zadatak_id) : undefined;
          const kooperantId = rok.kooperant_id ?? task?.kooperant_id ?? null;
          const kooperant = rok.kooperanti?.naziv ?? task?.kooperanti?.naziv ?? '';
          const status = statusOf(rok, today);
          const contractor = kooperantId ? kooperantById.get(kooperantId) : undefined;
          const boja = contractor
            ? kooperantColor(contractor)
            : status === 'zavrseni' ? '#10b981' : status === 'prekoraceni' ? '#ef4444' : '#0ea5e9';
          return {
            gradiliste: site.naziv,
            aktivnost: rok.naziv,
            kooperant,
            pocetak: startDateOf(rok),
            kraj: endDateOf(rok),
            status: statusLabel(status),
            boja,
          };
        }),
        ...siteAngazmani.flatMap((angazman) => {
          if (!angazman.datum_pocetka || !angazman.datum_zavrsetka) return [];
          const kooperant = angazman.kooperanti?.naziv ?? '';
          const contractor = kooperantById.get(angazman.kooperant_id);
          return [{
            gradiliste: site.naziv,
            aktivnost: 'Angažman kooperanta',
            kooperant,
            pocetak: angazman.datum_pocetka,
            kraj: angazman.datum_zavrsetka,
            status: angazman.status === 'zavrseno' ? 'Završen' : 'Aktivan',
            boja: contractor ? kooperantColor(contractor) : '#f59e0b',
          }];
        }),
      ]);
      const selectedNames = selectedKooperantIds === null
        ? 'Svi kooperanti'
        : sortedKooperanti.filter((kooperant) => selectedKooperantIds.includes(kooperant.id)).map((kooperant) => kooperant.naziv).join(', ') || 'Nijedan kooperant';
      const subtitle = [
        `${displayDate(rangeStart)} – ${displayDate(shiftDate(rangeEnd, -1))}`,
        selectedSite ? siteById.get(selectedSite)?.naziv ?? 'Odabrano gradilište' : 'Sva gradilišta',
        statusFilter === 'svi' ? 'Svi statusi' : statusLabel(statusFilter),
        `${selectedNames}${includeUnassigned ? ', uključujući aktivnosti bez kooperanta' : ''}`,
      ].join(' · ');
      const visibleContractors = sortedKooperanti.filter((kooperant) =>
        selectedKooperantIds === null || selectedKooperantIds.includes(kooperant.id));
      const legenda = [
        { naziv: 'Otvoren rok', boja: '#0ea5e9' },
        { naziv: 'Prekoračen rok', boja: '#ef4444' },
        { naziv: 'Završen rok/angažman', boja: '#10b981' },
        ...visibleContractors.map((kooperant) => ({ naziv: kooperant.naziv, boja: kooperantColor(kooperant) })),
        ...(includeUnassigned ? [{ naziv: 'Angažman bez kooperanta', boja: '#f59e0b' }] : []),
      ];
      await exportTerminskiPlanPdf({
        naslov: 'Terminski plan',
        podnaslov: subtitle,
        pocetak: rangeStart,
        dani: days,
        redovi: rows,
        legenda,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Greška pri izvozu terminskog plana u PDF.');
    } finally {
      setExportingPdf(false);
    }
  };
  const openDeadlineEditor = (item?: Rok) => {
    const defaultDate = rangeStart;
    setEditingDeadline(item ?? null);
    setDeadlineError(null);
    setDeadlineForm({
      gradiliste_id: item?.gradiliste_id ?? (selectedSite || gradilista[0]?.id || ''),
      naziv: item?.naziv ?? '',
      datum_pocetka: item ? startDateOf(item) : defaultDate,
      datum_zavrsetka: item ? endDateOf(item) : defaultDate,
      kooperant_id: item?.kooperant_id ?? '',
      opis: item?.opis ?? '',
      status: item?.status ?? 'otvoren',
    });
    setDeadlineModalOpen(true);
  };
  const saveDeadline = async () => {
    if (savingDeadline || deadlineRestoring) return;
    if (!canEditDeadlines) {
      setDeadlineError('Nemate ovlasti za uređivanje termina.');
      return;
    }
    if (!deadlineForm.gradiliste_id || !deadlineForm.naziv.trim() || !deadlineForm.datum_pocetka || !deadlineForm.datum_zavrsetka) {
      setDeadlineError('Odaberi gradilište, upiši naziv i unesi početni i završni datum.');
      return;
    }
    if (deadlineForm.datum_zavrsetka < deadlineForm.datum_pocetka) {
      setDeadlineError('Datum završetka ne može biti prije datuma početka.');
      return;
    }
    setSavingDeadline(true);
    setDeadlineError(null);
    try {
      const payload = {
        gradiliste_id: deadlineForm.gradiliste_id,
        naziv: deadlineForm.naziv.trim(),
        datum: deadlineForm.datum_zavrsetka,
        datum_pocetka: deadlineForm.datum_pocetka,
        datum_zavrsetka: deadlineForm.datum_zavrsetka,
        kooperant_id: deadlineForm.kooperant_id || null,
        opis: deadlineForm.opis.trim() || null,
        status: deadlineForm.status,
      };
      if (editingDeadline) await updateRok(editingDeadline.id, payload);
      else await createRok({ ...payload, nalog_id: null });
      setRokovi(await fetchRokovi());
      setDeadlineModalOpen(false);
    } catch (reason) {
      setDeadlineError(reason instanceof Error ? reason.message : 'Termin nije spremljen.');
    } finally {
      setSavingDeadline(false);
    }
  };
  const renderTimelineRow = ({
    id,
    siteId,
    title,
    subtitle,
    start,
    end,
    color,
    colorHex,
    onEdit,
  }: {
    id: string;
    siteId: string;
    title: string;
    subtitle: string;
    start: string;
    end: string;
    color: 'blue' | 'red' | 'green' | 'violet' | 'amber';
    colorHex?: string;
    onEdit?: () => void;
  }) => {
    const startOffset = (dateToUtc(start) - dateToUtc(rangeStart)) / DAY_MS;
    const endOffset = (dateToUtc(end) - dateToUtc(rangeStart)) / DAY_MS;
    const visibleStart = Math.max(0, startOffset);
    const visibleEnd = Math.min(windowDays - 1, endOffset);
    const left = (visibleStart / windowDays) * 100;
    const width = (Math.max(1, visibleEnd - visibleStart + 1) / windowDays) * 100;
    const colorStyle = {
      blue: 'bg-sky-500',
      red: 'bg-red-500',
      green: 'bg-emerald-500',
      violet: 'bg-violet-500',
      amber: 'bg-amber-500',
    }[color];
    return (
      <div key={id} className="terminski-plan-task-row grid min-h-12 border-b border-slate-100 last:border-b-0" style={{ gridTemplateColumns: 'var(--terminski-site-column-width) minmax(0, 1fr)' }}>
        <div className="sticky left-0 z-10 flex min-w-0 items-center border-r border-slate-200 bg-white shadow-[4px_0_6px_-4px_rgba(15,23,42,0.3)]">
          <button type="button" onClick={() => onOpenGradiliste(siteId)} className="min-w-0 flex-1 px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 sm:px-3" title={`${title} · ${subtitle}`}>
            <span className="block break-words font-medium">{title}</span>
            <span className="block break-words text-[10px] text-slate-500">{subtitle}</span>
          </button>
          {onEdit && canEditDeadlines && (
            <button type="button" onClick={onEdit} aria-label={`Uredi termin ${title}`} title={`Uredi termin ${title}`} className="mr-1 shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-sky-50 hover:text-sky-700">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="relative grid" style={{ gridTemplateColumns: `repeat(${windowDays}, minmax(0, 1fr))` }}>
          {days.map((day) => {
            const roseDay = isRoseDay(day);
            const isSaturday = new Date(`${day}T12:00:00`).getDay() === 6;
            return <div key={day} className={`border-r ${roseDay ? 'border-r-2 border-rose-200 bg-rose-50' : isSaturday ? 'bg-slate-50 border-slate-100' : 'border-slate-100'}`} />;
          })}
          {todayOffset >= 0 && todayOffset < windowDays && (
            <div className="pointer-events-none absolute inset-y-0 z-[1] w-px bg-slate-500/70" style={{ left: `${todayPosition}%` }} />
          )}
          <button
            type="button"
            onClick={() => onOpenGradiliste(siteId)}
            title={`${title} · ${subtitle}. Otvori gradilište.`}
            aria-label={`${title}, ${subtitle}. Otvori gradilište.`}
            className={`absolute top-1/2 z-[2] h-2.5 min-w-3 -translate-y-1/2 rounded-full ${colorHex ? '' : colorStyle}`}
            style={{ left: `${left}%`, width: `${width}%`, ...(colorHex ? { backgroundColor: colorHex } : {}) }}
          />
        </div>
      </div>
    );
  };

  return (
    <section className="terminski-plan-view space-y-5" style={{ page: 'terminski-plan' }}>
      <div className="terminski-plan-hide-print">
        <ResourceDeletionHistory module="gradilista" table="rokovi" refreshVersion={0} onRestore={async () => {
          setDeadlineModalOpen(false);
          setEditingDeadline(null);
          setDeadlineError(null);
          setDeadlineForm({ gradiliste_id: '', naziv: '', datum_pocetka: '', datum_zavrsetka: '', kooperant_id: '', opis: '', status: 'otvoren' });
          setSelectedSite('');
          setStatusFilter('svi');
          await load();
        }} />
      </div>
      <header className="terminski-plan-hide-print flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <CalendarDays className="h-6 w-6 text-sky-700" /> Terminski plan
          </h1>
          <p className="mt-1 text-sm text-slate-500">Pregled počinje od danas; strelicom ulijevo možeš se vraćati u povijest.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditDeadlines && (
            <button type="button" onClick={() => openDeadlineEditor()} disabled={loading || gradilista.length === 0} className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
              <Plus className="h-4 w-4" /> Novi termin
            </button>
          )}
          <button type="button" onClick={() => void exportCurrentView()} disabled={loading || exportingPdf || groupedTimeline.length === 0} className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50">
            <FileDown className="h-4 w-4" /> {exportingPdf ? 'Izvoz…' : 'Izvezi PDF'}
          </button>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Osvježi
          </button>
        </div>
      </header>

      <div className="terminski-plan-hide-print flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Gradilište
          <select value={selectedSite} onChange={(event) => setSelectedSite(event.target.value)} className="min-w-52 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">Sva gradilišta</option>
            {gradilista.slice().sort((first, second) => first.naziv.localeCompare(second.naziv)).map((site) => <option key={site.id} value={site.id}>{site.naziv}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Status roka
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RokFilter)} className="min-w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="svi">Svi statusi</option>
            <option value="otvoreni">Otvoreni</option>
            <option value="prekoraceni">Prekoračeni</option>
            <option value="zavrseni">Završeni</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Prikaz razdoblja
          <select value={viewWeeks} onChange={(event) => setViewWeeks(Number(event.target.value) as ViewWeeks)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            {VIEW_WEEK_OPTIONS.map((weeks) => <option key={weeks} value={weeks}>{weeks} {weeks === 1 ? 'tjedan' : weeks === 2 ? 'tjedna' : 'tjedana'}</option>)}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => moveRange(-1)} aria-label="Prethodno razdoblje" className="rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={openToday} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Danas</button>
          <button type="button" onClick={() => moveRange(1)} aria-label="Sljedeće razdoblje" className="rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      <section className="terminski-plan-hide-print rounded-xl border border-slate-200 bg-white p-3 shadow-sm" aria-label="Filtriranje kooperanata">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Kooperanti</h2>
          <button
            type="button"
            onClick={() => { setSelectedKooperantIds(null); setIncludeUnassigned(true); }}
            className="rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50"
          >
            Prikaži sve
          </button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={includeUnassigned} onChange={(event) => setIncludeUnassigned(event.target.checked)} className="rounded border-slate-300 text-sky-600" />
            Bez kooperanta
          </label>
          {sortedKooperanti.map((kooperant) => (
            <label key={kooperant.id} className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={selectedKooperantIds === null || selectedKooperantIds.includes(kooperant.id)}
                onChange={() => toggleKooperant(kooperant.id)}
                className="rounded border-slate-300 text-sky-600"
              />
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: kooperantColor(kooperant) }} />
              {kooperant.naziv}
            </label>
          ))}
          {sortedKooperanti.length === 0 && <p className="text-sm text-slate-500">Nema evidentiranih kooperanata.</p>}
        </div>
      </section>

      <div className="terminski-plan-hide-print flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-800"><span className="h-2 w-2 rounded-full bg-sky-500" /> Otvoren</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-800"><span className="h-2 w-2 rounded-full bg-red-500" /> Prekoračen</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Završen</span>
        {sortedKooperanti.map((kooperant) => (
          <label key={kooperant.id} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: kooperantColor(kooperant) }} />
            <span>{kooperant.naziv}</span>
            <input
              type="color"
              value={kooperantColor(kooperant)}
              disabled={savingColorId === kooperant.id}
              onChange={(event) => void saveKooperantColor(kooperant, event.target.value)}
              aria-label={`Boja za kooperanta ${kooperant.naziv}`}
              title={`Odaberi boju za ${kooperant.naziv}`}
              className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-wait"
            />
          </label>
        ))}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600"><span className="h-2 w-2 rounded-full bg-slate-400" /> Bez kooperanta</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600"><span className="h-2 w-2 rounded-full bg-slate-500" /> Danas</span>
      </div>

      {error && <div role="alert" className="terminski-plan-hide-print flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Učitavanje rokova i kooperanata…</div>
      ) : visibleDeadlines.length === 0 && visibleAngazmani.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Clock3 className="mx-auto h-8 w-8 text-slate-400" />
          <p className="mt-2 font-medium text-slate-700">Nema rokova ni angažmana kooperanata za odabrane filtre i razdoblje.</p>
          <p className="mt-1 text-sm text-slate-500">Pomakni razdoblje ili promijeni filtre za prikaz drugih aktivnosti.</p>
        </div>
      ) : (
        <div className="terminski-plan-grid overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="terminski-plan-grid-inner" style={{ minWidth: `${timelineMinWidth}px` }}>
            <div className="terminski-plan-grid-header grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: 'var(--terminski-site-column-width) minmax(0, 1fr)' }}>
              <div className="sticky left-0 z-20 flex items-center border-r border-slate-200 bg-slate-50 px-2 py-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500 shadow-[4px_0_6px_-4px_rgba(15,23,42,0.3)] sm:px-3">Gradilište / aktivnost</div>
              <div className="grid grid-rows-[20px_1fr]">
                <div className="terminski-plan-month-band grid border-b border-slate-200" style={{ gridTemplateColumns: `repeat(${windowDays}, minmax(0, 1fr))` }}>
                  {days.map((day, index) => {
                    const monthKey = day.slice(0, 7);
                    const previousKey = index > 0 ? days[index - 1].slice(0, 7) : null;
                    if (monthKey === previousKey) return null;
                    const monthDays = days.slice(index).filter((value) => value.slice(0, 7) === monthKey).length;
                    const month = new Date(`${day}T12:00:00`).toLocaleDateString('hr-HR', { month: 'long', year: 'numeric' });
                    return <span key={monthKey} className="truncate border-r border-slate-200 px-1 text-center text-[10px] font-semibold capitalize text-slate-600" style={{ gridColumn: `span ${monthDays}` }}>{month}</span>;
                  })}
                </div>
                <div className="grid" style={{ gridTemplateColumns: `repeat(${windowDays}, minmax(0, 1fr))` }}>
                  {days.map((day) => {
                    const date = new Date(`${day}T12:00:00`);
                    const roseDay = isRoseDay(day);
                    const isSaturday = date.getDay() === 6;
                    const holiday = holidays.get(day);
                    return (
                      <div key={day} title={`${formatHrDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${holiday ? ` · ${holiday}` : ''}`} className={`terminski-plan-day-header flex min-h-[48px] flex-col items-center justify-center border-r ${roseDay ? 'border-r-2 border-r-rose-300' : 'border-slate-200'} px-0.5 text-center ${roseDay ? 'bg-rose-100 text-rose-800' : day === today ? 'bg-sky-100 text-sky-900' : isSaturday ? 'bg-slate-100 text-slate-500' : 'text-slate-600'}`}>
                        <span className="terminski-plan-day-name text-[10px] capitalize">{date.toLocaleDateString('hr-HR', { weekday: 'short' }).replace('.', '')}</span>
                        <span className="text-xs font-semibold">{date.getDate()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            {groupedTimeline.map(({ site, deadlines, angazmani: siteAngazmani }) => (
              <div key={site.id} className="border-b-2 border-slate-300 last:border-b-0">
                <div className="terminski-plan-site-row grid bg-sky-100/70" style={{ gridTemplateColumns: 'var(--terminski-site-column-width) minmax(0, 1fr)' }}>
                  <button
                    type="button"
                    onClick={() => toggleSiteExpanded(site.id)}
                    aria-expanded={expandedSiteIds.includes(site.id)}
                    aria-controls={`site-details-${site.id}`}
                    className="sticky left-0 z-10 flex min-w-0 items-center gap-1.5 border-r border-slate-200 bg-sky-100 px-2 py-2 text-left text-xs font-semibold text-sky-800 shadow-[4px_0_6px_-4px_rgba(15,23,42,0.3)] hover:bg-sky-100 sm:gap-2 sm:px-3 sm:py-2.5"
                    title={expandedSiteIds.includes(site.id) ? 'Sakrij radove' : 'Prikaži radove'}
                  >
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expandedSiteIds.includes(site.id) ? '' : '-rotate-90'}`} />
                    <span className="truncate">{site.naziv}</span>
                  </button>
                  <div
                    className="terminski-plan-site-timeline relative grid"
                    style={{ gridTemplateColumns: `repeat(${windowDays}, minmax(0, 1fr))`, minHeight: Math.max(40, deadlines.length * 9 + 12) }}
                  >
                    {days.map((day) => {
                      const roseDay = isRoseDay(day);
                      const isSaturday = new Date(`${day}T12:00:00`).getDay() === 6;
                      return <div key={day} className={`border-r ${roseDay ? 'border-r-2 border-rose-200 bg-rose-50' : isSaturday ? 'border-slate-100 bg-slate-50' : 'border-slate-100'}`} />;
                    })}
                    {todayOffset >= 0 && todayOffset < windowDays && (
                      <div className="pointer-events-none absolute inset-y-0 z-[1] w-px bg-slate-500/70" style={{ left: `${todayPosition}%` }} />
                    )}
                    {!expandedSiteIds.includes(site.id) && deadlines.map((rok, index) => {
                      const start = startDateOf(rok);
                      const end = endDateOf(rok);
                      const startOffset = (dateToUtc(start) - dateToUtc(rangeStart)) / DAY_MS;
                      const endOffset = (dateToUtc(end) - dateToUtc(rangeStart)) / DAY_MS;
                      const visibleStart = Math.max(0, startOffset);
                      const visibleEnd = Math.min(windowDays - 1, endOffset);
                      if (visibleEnd < visibleStart) return null;
                      const task = rok.zadatak_id ? taskById.get(rok.zadatak_id) : undefined;
                      const contractorId = rok.kooperant_id ?? task?.kooperant_id ?? null;
                      const contractor = contractorId ? kooperantById.get(contractorId) : undefined;
                      const status = statusOf(rok, today);
                      const color = contractor
                        ? kooperantColor(contractor)
                        : status === 'zavrseni' ? '#10b981' : status === 'prekoraceni' ? '#ef4444' : '#0ea5e9';
                      return (
                        <div
                          key={rok.id}
                          className="absolute z-[2] h-1.5 rounded-full"
                          title={`${rok.naziv} · ${dateRangeLabel(rok)}`}
                          aria-label={`${rok.naziv}, ${dateRangeLabel(rok)}`}
                          style={{
                            left: `${(visibleStart / windowDays) * 100}%`,
                            top: `${6 + index * 9}px`,
                            width: `${(Math.max(1, visibleEnd - visibleStart + 1) / windowDays) * 100}%`,
                            backgroundColor: color,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
                {expandedSiteIds.includes(site.id) && <div id={`site-details-${site.id}`}>
                {deadlines.map((rok) => {
                  const status = statusOf(rok, today);
                  const task = rok.zadatak_id ? taskById.get(rok.zadatak_id) : undefined;
                  const contractorId = rok.kooperant_id ?? task?.kooperant_id ?? null;
                  const contractor = rok.kooperanti?.naziv ?? task?.kooperanti?.naziv;
                  const contractorColor = contractorId ? kooperantById.get(contractorId) : undefined;
                  const subtitle = `${dateRangeLabel(rok)} · ${contractor ? `Kooperant: ${contractor} · ` : ''}${statusLabel(status)}`;
                  return renderTimelineRow({
                    id: `rok-${rok.id}`,
                    siteId: site.id,
                    title: rok.naziv,
                    subtitle,
                    start: startDateOf(rok),
                    end: endDateOf(rok),
                    color: contractor ? 'violet' : status === 'zavrseni' ? 'green' : status === 'prekoraceni' ? 'red' : 'blue',
                    colorHex: contractorColor ? kooperantColor(contractorColor) : undefined,
                    onEdit: () => openDeadlineEditor(rok),
                  });
                })}
                {siteAngazmani.map((angazman) => {
                  if (!angazman.datum_pocetka || !angazman.datum_zavrsetka) return null;
                  const name = angazman.kooperanti?.naziv ?? 'Kooperant';
                  const contractorColor = kooperantById.get(angazman.kooperant_id);
                  return renderTimelineRow({
                    id: `angazman-${angazman.id}`,
                    siteId: site.id,
                    title: name,
                    subtitle: `Angažman · ${angazman.status === 'zavrseno' ? 'Završen' : 'Aktivan'} · ${dateRangeLabelForDates(angazman.datum_pocetka, angazman.datum_zavrsetka)}`,
                    start: angazman.datum_pocetka,
                    end: angazman.datum_zavrsetka,
                    color: angazman.status === 'zavrseno' ? 'green' : 'amber',
                    colorHex: contractorColor ? kooperantColor(contractorColor) : undefined,
                  });
                })}
                </div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {!loading && <p className="terminski-plan-hide-print text-xs text-slate-500">Prikazano {visibleDeadlines.length} rokova i {visibleAngazmani.length} angažmana kooperanata s unesenim datumima · nedjelje i blagdani označeni su rozo, subote blago sivo · razdoblje {displayDate(rangeStart)} – {displayDate(shiftDate(rangeEnd, -1))}. Klikni naziv ili traku za otvaranje gradilišta.</p>}
      <Modal
        open={deadlineModalOpen}
        onClose={() => { if (!savingDeadline && !deadlineRestoring) setDeadlineModalOpen(false); }}
        title={editingDeadline ? 'Uredi termin' : 'Novi termin'}
        footer={(
          <>
            <button type="button" disabled={savingDeadline || deadlineRestoring} onClick={() => setDeadlineModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Odustani</button>
            <button type="button" onClick={() => void saveDeadline()} disabled={savingDeadline || deadlineRestoring} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
              {savingDeadline ? 'Spremanje…' : 'Spremi termin'}
            </button>
          </>
        )}
      >
        <fieldset disabled={savingDeadline || deadlineRestoring} className="space-y-4">
          {deadlineError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{deadlineError}</p>}
          <Field label="Gradilište *">
            <Select value={deadlineForm.gradiliste_id} onChange={(event) => setDeadlineForm((previous) => ({ ...previous, gradiliste_id: event.target.value }))}>
              <option value="">Odaberi gradilište</option>
              {gradilista.slice().sort((first, second) => first.naziv.localeCompare(second.naziv)).map((site) => <option key={site.id} value={site.id}>{site.naziv}</option>)}
            </Select>
          </Field>
          <Field label="Naziv termina *">
            <TextInput value={deadlineForm.naziv} onChange={(event) => setDeadlineForm((previous) => ({ ...previous, naziv: event.target.value }))} placeholder="npr. Početak fasaderskih radova" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Početak *">
              <TextInput type="date" value={deadlineForm.datum_pocetka} onChange={(event) => setDeadlineForm((previous) => ({ ...previous, datum_pocetka: event.target.value }))} />
            </Field>
            <Field label="Završetak *">
              <TextInput type="date" min={deadlineForm.datum_pocetka || undefined} value={deadlineForm.datum_zavrsetka} onChange={(event) => setDeadlineForm((previous) => ({ ...previous, datum_zavrsetka: event.target.value }))} />
            </Field>
          </div>
          <Field label="Kooperant">
            <Select value={deadlineForm.kooperant_id} onChange={(event) => setDeadlineForm((previous) => ({ ...previous, kooperant_id: event.target.value }))}>
              <option value="">Bez kooperanta</option>
              {sortedKooperanti.map((kooperant) => <option key={kooperant.id} value={kooperant.id}>{kooperant.naziv}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={deadlineForm.status} onChange={(event) => setDeadlineForm((previous) => ({ ...previous, status: event.target.value as Rok['status'] }))}>
              <option value="otvoren">Otvoren</option>
              <option value="prekoracen">Prekoračen</option>
              <option value="zavrsen">Završen</option>
            </Select>
          </Field>
          <Field label="Napomena">
            <Textarea rows={3} value={deadlineForm.opis} onChange={(event) => setDeadlineForm((previous) => ({ ...previous, opis: event.target.value }))} />
          </Field>
        </fieldset>
        {editingDeadline && <DeadlineChangeHistoryPanel
          recordId={editingDeadline.id}
          disabled={savingDeadline}
          onRestoringChange={setDeadlineRestoring}
          onRestore={async () => {
            setDeadlineModalOpen(false);
            setEditingDeadline(null);
            setDeadlineError(null);
            setDeadlineForm({ gradiliste_id: '', naziv: '', datum_pocetka: '', datum_zavrsetka: '', kooperant_id: '', opis: '', status: 'otvoren' });
            await load();
          }}
        />}
      </Modal>
    </section>
  );
}
