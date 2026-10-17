import { useState, useEffect, useRef, type DragEvent } from 'react';
import { Building2, Plus, Pencil, Trash2, Calendar, GripVertical, AlertTriangle } from 'lucide-react';
import type { Gradiliste, GradilisteRegija, GradilisteStatus, Investitor, Objekt, Rok } from '@/types';
import {
  fetchRokovi,
  fetchGradilista,
  createGradiliste,
  updateGradiliste,
  deleteGradiliste,
  fetchInvestitori,
  createInvestitor,
  fetchObjekti,
  createObjekt,
  createGradilisteZadatak,
  fetchGradilisteBoardLayout,
  saveGradilisteBoardLayout,
  type GradilisteBoardSortMode,
} from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { ExportMenu } from '@/components/ui/ExportMenu';
import { Field, TextInput, Select, Textarea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { GradilisteDetailsPanel } from '@/components/views/GradilisteDetailsPanel';
import { nextDeadline, deadlineAlert } from '@/lib/rokovi';
import { useAuth } from '@/auth/useAuth';

const statusBadge: Record<GradilisteStatus, { variant: 'green' | 'yellow' | 'red' | 'blue' | 'gray'; label: string }> = {
  ponuda: { variant: 'yellow', label: 'Ponuda' },
  planirano: { variant: 'blue', label: 'Planirano' },
  aktivno: { variant: 'green', label: 'Aktivno' },
  pauzirano: { variant: 'yellow', label: 'Pauzirano' },
  zavrseno: { variant: 'gray', label: 'Završeno' },
};

const compactStatusBadgeStyle: Record<'green' | 'yellow' | 'red' | 'blue' | 'gray', string> = {
  green: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  yellow: 'border-amber-200 bg-amber-100 text-amber-800',
  red: 'border-red-200 bg-red-100 text-red-800',
  blue: 'border-sky-200 bg-sky-100 text-sky-800',
  gray: 'border-slate-200 bg-slate-100 text-slate-700',
};

const regionInfo: Record<GradilisteRegija, { label: string; badge: string }> = {
  dalmacija: { label: 'Dalmacija', badge: 'border-sky-200 bg-sky-100 text-sky-800' },
  istra_kvarner: { label: 'Istra i Kvarner', badge: 'border-emerald-200 bg-emerald-100 text-emerald-800' },
  slavonija: { label: 'Slavonija', badge: 'border-amber-200 bg-amber-100 text-amber-900' },
  zagreb_i_okolica: { label: 'Zagreb i okolica', badge: 'border-rose-200 bg-rose-100 text-rose-800' },
  medimurje: { label: 'Međimurje', badge: 'border-violet-200 bg-violet-100 text-violet-800' },
};

const emptyForm = {
  naziv: '',
  adresa: '',
  regija: '' as GradilisteRegija | '',
  investitorId: '',
  investitorNaziv: '',
  objektId: '',
  objektNaziv: '',
  status: 'planirano' as GradilisteStatus,
  datum_pocetka: '',
  datum_zavrsetka: '',
  opis: '',
};

type GradilisteSortMode = GradilisteBoardSortMode;
type GradilisteCategory = 'arhiva' | 'aktivna' | 'planirana' | 'ponude';
const gradilisteColumnLabels = ['dm gradilišta', 'dm intervencije', 'ostala gradilišta'];
const gradilisteCategories: { key: GradilisteCategory; label: string; statuses: GradilisteStatus[] }[] = [
  { key: 'arhiva', label: 'Arhiva', statuses: ['zavrseno'] },
  { key: 'aktivna', label: 'Aktivna', statuses: ['aktivno', 'pauzirano'] },
  { key: 'planirana', label: 'Planirana', statuses: ['planirano'] },
  { key: 'ponude', label: 'Ponude', statuses: ['ponuda'] },
];
const categoryDefaultStatus: Record<GradilisteCategory, GradilisteStatus> = {
  arhiva: 'zavrseno',
  aktivna: 'aktivno',
  planirana: 'planirano',
  ponude: 'ponuda',
};

function emptyGradilisteColumns(): string[][] {
  return [[], [], []];
}

function emptyGradilisteSortModes(): GradilisteSortMode[] {
  return ['manual', 'manual', 'manual'];
}

function reconcileGradilisteColumns(items: Gradiliste[], savedColumns: string[][]): string[][] {
  const validIds = new Set(items.map((item) => item.id));
  const assignedIds = new Set<string>();
  const columns = emptyGradilisteColumns();

  savedColumns.forEach((savedColumn, columnIndex) => {
    for (const id of savedColumn) {
      if (validIds.has(id) && !assignedIds.has(id)) {
        columns[columnIndex].push(id);
        assignedIds.add(id);
      }
    }
  });

  for (const item of items) {
    if (assignedIds.has(item.id)) continue;
    const shortestColumn = columns.reduce((shortest, column, index) =>
      column.length < columns[shortest].length ? index : shortest, 0);
    columns[shortestColumn].push(item.id);
    assignedIds.add(item.id);
  }

  return columns;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

export function GradilistaView({ onOpenNalog }: { onOpenNalog?: (nalogId: string) => void } = {}) {
  const { canAccess } = useAuth();
  const canEditBoard = canAccess('gradilista', 'edit');
  const layoutSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const [items, setItems] = useState<Gradiliste[]>([]);
  const [rokovi, setRokovi] = useState<Rok[]>([]);
  const [columnIds, setColumnIds] = useState<string[][]>(emptyGradilisteColumns);
  const [columnSortModes, setColumnSortModes] = useState<GradilisteSortMode[]>(emptyGradilisteSortModes);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetColumn, setDropTargetColumn] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<GradilisteCategory>('aktivna');
  const [selectedGradilisteId, setSelectedGradilisteId] = useState<string | null>(null);
  const [targetColumn, setTargetColumn] = useState('');
  const [investitori, setInvestitori] = useState<Investitor[]>([]);
  const [objekti, setObjekti] = useState<Objekt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Gradiliste | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [newInvestorName, setNewInvestorName] = useState('');
  const [investorMode, setInvestorMode] = useState<'manual' | 'select'>('manual');
  const [newObjectName, setNewObjectName] = useState('');
  const [objectMode, setObjectMode] = useState<'manual' | 'select'>('manual');
  const [newZadaci, setNewZadaci] = useState<{ naziv: string; rok: string }[]>([]);
  const [zadatakNaziv, setZadatakNaziv] = useState('');
  const [zadatakRok, setZadatakRok] = useState('');

  const persistBoardLayout = (columns: string[][], sortModes: GradilisteSortMode[]) => {
    const save = layoutSaveQueue.current
      .catch(() => undefined)
      .then(() => saveGradilisteBoardLayout({ columns, sortModes }));
    layoutSaveQueue.current = save;
    return save;
  };

  const loadRokovi = async () => {
    try {
      setRokovi(await fetchRokovi());
    } catch {
      setRokovi([]);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    void loadRokovi();
    try {
      const [nextItems, nextInvestitori, savedLayout] = await Promise.all([
        fetchGradilista(),
        fetchInvestitori(),
        fetchGradilisteBoardLayout(),
      ]);
      setItems(nextItems);
      setInvestitori(nextInvestitori);
      const nextColumns = reconcileGradilisteColumns(nextItems, savedLayout?.columns ?? emptyGradilisteColumns());
      const nextSortModes = savedLayout?.sortModes ?? emptyGradilisteSortModes();
      setColumnIds(nextColumns);
      setColumnSortModes(nextSortModes);
      if (canEditBoard && (!savedLayout || JSON.stringify(savedLayout.columns) !== JSON.stringify(nextColumns))) {
        await persistBoardLayout(nextColumns, nextSortModes);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri učitavanju');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const refreshBoardLayout = async () => {
      try {
        const layout = await fetchGradilisteBoardLayout();
        if (!layout) return;
        const nextColumns = reconcileGradilisteColumns(items, layout.columns);
        setColumnIds((current) => JSON.stringify(current) === JSON.stringify(nextColumns) ? current : nextColumns);
        setColumnSortModes((current) => JSON.stringify(current) === JSON.stringify(layout.sortModes) ? current : layout.sortModes);
      } catch {
        // Keep the current board visible if a background refresh fails.
      }
    };
    const timer = window.setInterval(() => void refreshBoardLayout(), 30_000);
    return () => window.clearInterval(timer);
  }, [items]);

  useEffect(() => {
    let cancelled = false;
    if (!form.investitorId) {
      setObjekti([]);
      return;
    }

    fetchObjekti(form.investitorId)
      .then((nextObjekti) => {
        if (!cancelled) setObjekti(nextObjekti);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Greška pri učitavanju objekata');
      });

    return () => {
      cancelled = true;
    };
  }, [form.investitorId]);

  const handleDragStart = (event: DragEvent<HTMLDivElement>, gradilisteId: string) => {
    if (!canEditBoard) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', gradilisteId);
    setDraggedId(gradilisteId);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, targetColumn: number, targetId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canEditBoard) return;
    const gradilisteId = event.dataTransfer.getData('text/plain') || draggedId;
    const sourceColumn = columnIds.findIndex((column) => column.includes(gradilisteId ?? ''));
    if (!gradilisteId || sourceColumn < 0 || gradilisteId === targetId) return;

    const nextColumns = columnIds.map((column) => [...column]);
    const sourceIndex = nextColumns[sourceColumn].indexOf(gradilisteId);
    nextColumns[sourceColumn].splice(sourceIndex, 1);
    const destination = nextColumns[targetColumn];
    let targetIndex = targetId ? destination.indexOf(targetId) : destination.length;
    if (targetIndex < 0) targetIndex = destination.length;
    destination.splice(targetIndex, 0, gradilisteId);

    let nextSortModes = columnSortModes;
    if (sourceColumn === targetColumn && columnSortModes[targetColumn] !== 'manual') {
      nextSortModes = [...columnSortModes];
      nextSortModes[targetColumn] = 'manual';
      setColumnSortModes(nextSortModes);
    }
    setColumnIds(nextColumns);
    void persistBoardLayout(nextColumns, nextSortModes).catch((e) => setError(getErrorMessage(e, 'Greška pri spremanju rasporeda')));
    setDraggedId(null);
    setDropTargetColumn(null);
    setDropTargetId(null);
  };

  const handleColumnSortChange = (columnIndex: number, mode: GradilisteSortMode) => {
    if (!canEditBoard) return;
    const nextSortModes = [...columnSortModes];
    nextSortModes[columnIndex] = mode;
    setColumnSortModes(nextSortModes);
    void persistBoardLayout(columnIds, nextSortModes).catch((e) => setError(getErrorMessage(e, 'Greška pri spremanju sortiranja')));
  };

  const visibleItems = items.filter((item) =>
    gradilisteCategories.find((category) => category.key === activeCategory)?.statuses.includes(item.status),
  );
  const selectedGradiliste = items.find((item) => item.id === selectedGradilisteId) ?? null;

  const openCreate = (columnIndex?: number) => {
    setEditing(null);
    setForm({ ...emptyForm, status: categoryDefaultStatus[activeCategory] });
    setTargetColumn(columnIndex === undefined ? '' : String(columnIndex));
    setNewInvestorName('');
    setInvestorMode('manual');
    setNewObjectName('');
    setObjectMode('manual');
    setNewZadaci([]);
    setZadatakNaziv('');
    setZadatakRok('');
    setModalOpen(true);
  };

  const addNewZadatak = () => {
    const naziv = zadatakNaziv.trim();
    if (!naziv) return;
    setNewZadaci((prev) => [...prev, { naziv, rok: zadatakRok }]);
    setZadatakNaziv('');
    setZadatakRok('');
  };

  const openEdit = (g: Gradiliste) => {
    setEditing(g);
    const currentColumn = columnIds.findIndex((column) => column.includes(g.id));
    setTargetColumn(String(Math.max(currentColumn, 0)));
    const investor = g.objekti?.investitori;
    setForm({
      naziv: g.naziv,
      adresa: g.adresa ?? '',
      regija: g.regija ?? '',
      investitorId: investor?.id ?? '',
      investitorNaziv: investor?.naziv ?? '',
      objektId: g.objekt_id ?? '',
      objektNaziv: g.objekti?.naziv ?? '',
      status: g.status,
      datum_pocetka: g.datum_pocetka ?? '',
      datum_zavrsetka: g.datum_zavrsetka ?? '',
      opis: g.opis ?? '',
    });
    setNewInvestorName('');
    setInvestorMode('manual');
    setNewObjectName('');
    setObjectMode('manual');
    setModalOpen(true);
  };

  const resolveInvestitor = async () => {
    const naziv = form.investitorNaziv.trim();
    if (!naziv) return null;

    const existing = investitori.find((item) => item.id === form.investitorId)
      ?? investitori.find((item) => item.naziv.toLocaleLowerCase() === naziv.toLocaleLowerCase());
    if (existing) return existing;

    const created = await createInvestitor({ naziv });
    setInvestitori((prev) => [...prev, created].sort((a, b) => a.naziv.localeCompare(b.naziv)));
    return created;
  };

  const save = async () => {
    if (!form.naziv.trim() || !targetColumn) return;
    setSaving(true);
    setError(null);
    try {
      const investorName = form.investitorNaziv.trim();
      const objectName = (objectMode === 'manual' ? form.objektNaziv : objekti.find((item) => item.id === form.objektId)?.naziv ?? '').trim();
      if (Boolean(investorName) !== Boolean(objectName)) {
        throw new Error('Investitor i objekt moraju biti uneseni zajedno.');
      }

      const investor = investorName ? await resolveInvestitor() : null;
      const selectedObject = objectMode === 'select' && form.objektId
        ? objekti.find((item) => item.id === form.objektId) ?? null
        : null;
      const objekt = objectName && investor
        ? selectedObject ?? await createObjekt({ naziv: objectName, investitor_id: investor.id })
        : null;

      const payload = {
        naziv: form.naziv.trim(),
        adresa: form.adresa.trim() || null,
        regija: form.regija || null,
        objekt_id: objekt?.id ?? null,
        voditelj_gradilista: editing?.voditelj_gradilista ?? null,
        ugovorena_vrijednost: editing?.ugovorena_vrijednost ?? 0,
        predvidena_marza: editing?.predvidena_marza ?? 0,
        status: form.status,
        datum_pocetka: form.datum_pocetka || null,
        datum_zavrsetka: form.datum_zavrsetka || null,
        opis: form.opis.trim() || null,
      };
      const savedGradiliste = editing
        ? await updateGradiliste(editing.id, payload)
        : await createGradiliste(payload);
      if (!editing) {
        const pending = zadatakNaziv.trim() ? [...newZadaci, { naziv: zadatakNaziv.trim(), rok: zadatakRok }] : newZadaci;
        for (const z of pending) await createGradilisteZadatak(savedGradiliste.id, z.naziv, z.rok || null);
      }
      const nextColumns = columnIds.map((column) => column.filter((id) => id !== savedGradiliste.id));
      nextColumns[Number(targetColumn)].push(savedGradiliste.id);
      setColumnIds(nextColumns);
      await persistBoardLayout(nextColumns, columnSortModes);
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(getErrorMessage(e, 'Greška pri spremanju gradilišta'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateInvestor = async () => {
    const naziv = newInvestorName.trim();
    if (!naziv) return;

    try {
      const created = await createInvestitor({ naziv });
      setInvestitori((prev) => [...prev.filter((item) => item.id !== created.id), created].sort((a, b) => a.naziv.localeCompare(b.naziv)));
      setForm((prev) => ({ ...prev, investitorId: created.id, investitorNaziv: created.naziv, objektId: '', objektNaziv: '' }));
      setNewInvestorName('');
      setInvestorMode('manual');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri spremanju investitora');
    }
  };

  const handleCreateObject = async (objectName = newObjectName) => {
    const naziv = objectName.trim();
    const investorName = form.investitorNaziv.trim();
    if (!naziv || !investorName) return;

    try {
      const investor = await resolveInvestitor();
      if (!investor) return;
      const created = await createObjekt({ naziv, investitor_id: investor.id });
      setObjekti((prev) => [...prev.filter((item) => item.id !== created.id), created].sort((a, b) => a.naziv.localeCompare(b.naziv)));
      setForm((prev) => ({ ...prev, investitorId: investor.id, investitorNaziv: investor.naziv, objektId: created.id, objektNaziv: created.naziv }));
      setNewObjectName('');
      setObjectMode('select');
    } catch (e) {
      setError(getErrorMessage(e, 'Greška pri spremanju objekta'));
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteGradiliste(deleteId);
      if (selectedGradilisteId === deleteId) setSelectedGradilisteId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri brisanju');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gradilišta</h1>
          <p className="text-sm text-slate-500 mt-1">Upravljajte svim gradilištima firme</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            disabled={items.length === 0}
            build={() => ({
              file: 'Gradilista',
              title: 'Gradilišta',
              rows: items,
              columns: [
                { header: 'Naziv', get: (g: Gradiliste) => g.naziv },
                { header: 'Status', get: (g: Gradiliste) => statusBadge[g.status].label },
                { header: 'Regija', get: (g: Gradiliste) => (g.regija ? regionInfo[g.regija].label : '') },
                { header: 'Adresa', get: (g: Gradiliste) => g.adresa ?? '' },
                { header: 'Voditelj', get: (g: Gradiliste) => g.voditelj_gradilista ?? '' },
                { header: 'Početak', kind: 'date', get: (g: Gradiliste) => g.datum_pocetka },
                { header: 'Završetak', kind: 'date', get: (g: Gradiliste) => g.datum_zavrsetka },
                { header: 'Ugovoreno', kind: 'eur', get: (g: Gradiliste) => g.ugovorena_vrijednost ?? 0 },
              ],
            })}
          />
          <button
            onClick={() => openCreate()}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Novo gradilište
          </button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2 border-b border-slate-200 pb-3" role="tablist" aria-label="Kategorije gradilišta">
        {gradilisteCategories.map((category) => {
          const count = items.filter((item) => category.statuses.includes(item.status)).length;
          const active = activeCategory === category.key;
          return (
            <button
              key={category.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveCategory(category.key)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-sky-100 text-sky-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              {category.label}
              <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-white/70 text-sky-800' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {error && !modalOpen && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-7 w-7" />}
          title="Nema gradilišta"
          description="Dodajte prvo gradilište da biste počeli pratiti radove, raspored i resurse."
          action={
            <button
              onClick={() => openCreate()}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Novo gradilište
            </button>
          }
        />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <div className="min-w-0">
          {visibleItems.length === 0 && (
            <p className="mb-3 text-sm text-slate-500">Nema gradilišta u kategoriji {gradilisteCategories.find((category) => category.key === activeCategory)?.label.toLocaleLowerCase()}.</p>
          )}
          <div className="grid items-start gap-4 md:grid-cols-3">
          {[0, 1, 2].map((columnIndex) => {
            const column = columnIds[columnIndex] ?? [];
            const columnItems = column
              .map((id) => visibleItems.find((item) => item.id === id))
              .filter((item): item is Gradiliste => Boolean(item));
            const sortMode = columnSortModes[columnIndex] ?? 'manual';
            if (sortMode !== 'manual') {
              const dateOf = (item: Gradiliste) =>
                sortMode === 'datum_pocetka'
                  ? nextDeadline(item, rokovi)?.datum ?? item.datum_pocetka
                  : item.datum_zavrsetka;
              columnItems.sort((first, second) => {
                const firstDate = dateOf(first);
                const secondDate = dateOf(second);
                if (!firstDate || !secondDate) {
                  if (firstDate === secondDate) return 0;
                  return firstDate ? -1 : 1;
                }
                return firstDate.localeCompare(secondDate);
              });
            }
            return (
              <section
                key={columnIndex}
                aria-label={gradilisteColumnLabels[columnIndex]}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropTargetColumn(columnIndex);
                  setDropTargetId(null);
                }}
                onDrop={(event) => handleDrop(event, columnIndex)}
                className={`min-h-72 space-y-3 rounded-xl border border-dashed p-3 transition-colors ${dropTargetColumn === columnIndex && !dropTargetId ? 'border-sky-400 bg-sky-50/70' : 'border-slate-200 bg-slate-50/50'}`}
              >
                <div className="space-y-2 px-1 pb-1">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase text-slate-500">{gradilisteColumnLabels[columnIndex]}</h2>
                    <span className="text-xs tabular-nums text-slate-400">{columnItems.length}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCreate(columnIndex)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Novo gradilište
                  </button>
                  <Select
                    aria-label={`Sortiranje: ${gradilisteColumnLabels[columnIndex]}`}
                    value={sortMode}
                    onChange={(event) => handleColumnSortChange(columnIndex, event.target.value as GradilisteSortMode)}
                    disabled={!canEditBoard}
                    className="px-2.5 py-2 text-xs"
                  >
                    <option value="manual">Vlastiti redoslijed</option>
                    <option value="datum_pocetka">Početni / idući rok</option>
                    <option value="datum_zavrsetka">Krajnji rok</option>
                  </Select>
                </div>
                {columnItems.length === 0 && (
                  <div className="flex min-h-32 items-center justify-center text-sm text-slate-400">Prazan stupac</div>
                )}
                {columnItems.map((g) => {
                  const sb = statusBadge[g.status];
                  const region = g.regija ? regionInfo[g.regija] : null;
                  return (
                    <div
                      key={g.id}
                      draggable={canEditBoard}
                      onDragStart={(event) => handleDragStart(event, g.id)}
                      onDragEnd={() => {
                        setDraggedId(null);
                        setDropTargetColumn(null);
                        setDropTargetId(null);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDropTargetColumn(columnIndex);
                        setDropTargetId(g.id);
                      }}
                      onDrop={(event) => handleDrop(event, columnIndex, g.id)}
                      onClick={() => setSelectedGradilisteId(g.id)}
                      className={`group relative cursor-grab rounded-xl border bg-white p-3 shadow-sm transition-all active:cursor-grabbing hover:shadow-md ${selectedGradilisteId === g.id ? 'border-sky-500 ring-1 ring-sky-200' : 'border-slate-200'} ${draggedId === g.id ? 'opacity-50' : ''} ${dropTargetId === g.id ? 'ring-2 ring-sky-400' : ''}`}
                    >
                      <div className="mb-2 flex min-w-0 items-center gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                          <h3 title={g.naziv} className="min-w-0 flex-1 truncate whitespace-nowrap text-xs font-semibold leading-tight text-slate-900">{g.naziv}</h3>
                          <span className={`inline-flex flex-shrink-0 items-center rounded-full border px-1 py-0 text-[9px] font-medium leading-3 ${compactStatusBadgeStyle[sb.variant]}`}>
                            {sb.label}
                          </span>
                          {region && (
                            <span className={`inline-flex flex-shrink-0 items-center rounded-full border px-1.5 py-0 text-[9px] font-medium leading-3 ${region.badge}`}>
                              {region.label}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="absolute right-2 top-2 flex items-center gap-0.5">
                        <GripVertical className="h-3.5 w-3.5 text-slate-300" aria-label="Povuci gradilište" />
                        <div className="flex rounded bg-white/90 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => openEdit(g)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600 transition-colors"
                        aria-label={`Uredi ${g.naziv}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteId(g.id)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 transition-colors"
                        aria-label={`Izbriši ${g.naziv}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                {(() => {
                  const alert = deadlineAlert(g, rokovi);
                  if (!alert) return null;
                  const style = alert.level === 'overdue'
                    ? 'border-red-700 bg-red-600 text-white'
                    : alert.level === 'today'
                      ? 'border-red-400 bg-red-200 text-red-900'
                      : 'border-red-200 bg-red-50 text-red-700';
                  const text = alert.level === 'overdue'
                    ? `Van roka ${Math.abs(alert.days)} d`
                    : alert.level === 'today'
                      ? 'Danas'
                      : `Za ${alert.days} ${alert.days === 1 ? 'dan' : 'dana'}`;
                  return (
                    <div className={`mt-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold ${style}`}>
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="flex-shrink-0">{text}</span>
                      <span className="min-w-0 flex-1 truncate font-normal">· {alert.label}</span>
                    </div>
                  );
                })()}

                {(g.datum_pocetka || g.datum_zavrsetka) && (
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2">
                    {g.datum_pocetka && (
                      <div className="flex min-w-0 items-start gap-1.5">
                        <Calendar className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-sky-600" />
                        <div className="min-w-0">
                          <p className="text-[9px] font-semibold uppercase text-slate-500">Početni rok</p>
                          <p className="text-xs font-semibold text-slate-900">{new Date(g.datum_pocetka).toLocaleDateString('hr-HR')}</p>
                        </div>
                      </div>
                    )}
                    {g.datum_zavrsetka && (
                      <div className="flex min-w-0 items-start gap-1.5">
                        <Calendar className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                        <div className="min-w-0">
                          <p className="text-[9px] font-semibold uppercase text-slate-500">Krajnji rok</p>
                          <p className="text-xs font-semibold text-slate-900">{new Date(g.datum_zavrsetka).toLocaleDateString('hr-HR')}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {(() => {
                  const next = nextDeadline(g, rokovi);
                  return next ? (
                    <div className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                      <Calendar className="h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                      <span className="font-semibold uppercase text-[9px]">Idući rok</span>
                      <span className="min-w-0 flex-1 truncate">{next.label}</span>
                      <span className="flex-shrink-0 font-semibold">{new Date(`${next.datum}T00:00:00`).toLocaleDateString('hr-HR')}</span>
                    </div>
                  ) : null;
                })()}

                {g.opis && (
                  <div className="mt-2 rounded-md border-l-2 border-red-500 bg-red-50 px-2.5 py-1.5">
                    <p className="mb-0.5 text-[9px] font-bold uppercase text-red-700">Napomena</p>
                    <p className="text-xs leading-4 text-red-900 line-clamp-2">{g.opis}</p>
                  </div>
                )}
                    </div>
                  );
                })}
              </section>
            );
          })}
          </div>
          </div>
          {selectedGradiliste && (
            <GradilisteDetailsPanel
              gradiliste={selectedGradiliste}
              onClose={() => setSelectedGradilisteId(null)}
              onEdit={() => openEdit(selectedGradiliste)}
              onGradilisteUpdate={(updates) => {
                setItems((previous) => previous.map((item) =>
                  item.id === selectedGradiliste.id ? { ...item, ...updates } : item,
                ));
              }}
              onRokoviChange={() => void loadRokovi()}
              onOpenNalog={onOpenNalog}
            />
          )}
          {!selectedGradiliste && (
            <div className="hidden min-h-72 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-sm text-slate-400 lg:flex">
              Odaberite gradilište za prikaz detalja.
            </div>
          )}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Uredi gradilište' : 'Novo gradilište'}
        wide="md"
        footer={
          <>
            <button
              onClick={() => setModalOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Odustani
            </button>
            <button
              onClick={save}
              disabled={saving || !form.naziv.trim() || !targetColumn}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        }
      >
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          <Field label="Vrsta gradilišta *">
            <Select value={targetColumn} onChange={(event) => setTargetColumn(event.target.value)}>
              <option value="">Odaberi vrstu gradilišta</option>
              {gradilisteColumnLabels.map((label, index) => (
                <option key={label} value={String(index)}>{label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Naziv *">
            <TextInput
              value={form.naziv}
              onChange={(e) => setForm({ ...form, naziv: e.target.value })}
              placeholder="npr. Stanovi Sunce 2"
            />
          </Field>
          <Field label="Adresa">
            <TextInput
              value={form.adresa}
              onChange={(e) => setForm({ ...form, adresa: e.target.value })}
              placeholder="npr. Ul. Kralja Tomislava 15, Zagreb"
            />
          </Field>
          <Field label="Regija">
            <Select
              value={form.regija}
              onChange={(event) => setForm((previous) => ({ ...previous, regija: event.target.value as GradilisteRegija | '' }))}
            >
              <option value="">Odaberi regiju</option>
              <option value="dalmacija">Dalmacija</option>
              <option value="istra_kvarner">Istra i Kvarner</option>
              <option value="slavonija">Slavonija</option>
              <option value="zagreb_i_okolica">Zagreb i okolica</option>
              <option value="medimurje">Međimurje</option>
            </Select>
          </Field>
          <Field label="Investitor">
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setInvestorMode('manual')}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${investorMode === 'manual' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  Upiši ručno
                </button>
                <button
                  type="button"
                  onClick={() => setInvestorMode('select')}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${investorMode === 'select' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  Iz baze
                </button>
              </div>

              {investorMode === 'manual' ? (
                <TextInput
                  value={form.investitorNaziv}
                  onChange={(e) => {
                    const investitorNaziv = e.target.value;
                    const matchingInvestor = investitori.find((item) => item.naziv.toLocaleLowerCase() === investitorNaziv.trim().toLocaleLowerCase());
                    setForm((prev) => ({
                      ...prev,
                      investitorNaziv,
                      investitorId: matchingInvestor?.id ?? '',
                      objektId: matchingInvestor?.id === prev.investitorId ? prev.objektId : '',
                      objektNaziv: matchingInvestor?.id === prev.investitorId ? prev.objektNaziv : '',
                    }));
                  }}
                  placeholder="npr. Sunce d.o.o."
                />
              ) : (
                <div className="space-y-2">
                  <Select
                    value={form.investitorId}
                    onChange={(e) => {
                      const selectedInvestor = investitori.find((item) => item.id === e.target.value);
                      setForm((prev) => ({
                        ...prev,
                        investitorId: selectedInvestor?.id ?? '',
                        investitorNaziv: selectedInvestor?.naziv ?? '',
                        objektId: '',
                        objektNaziv: '',
                      }));
                    }}
                  >
                    <option value="">- Odaberi iz baze -</option>
                    {investitori.map((investitor) => (
                      <option key={investitor.id} value={investitor.id}>{investitor.naziv}</option>
                    ))}
                  </Select>
                  <div className="flex gap-2">
                    <TextInput
                      value={newInvestorName}
                      onChange={(e) => setNewInvestorName(e.target.value)}
                      placeholder="Naziv novog investitora"
                    />
                    <button
                      type="button"
                      onClick={handleCreateInvestor}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                      disabled={!newInvestorName.trim()}
                    >
                      Dodaj
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Field>
          <Field label="Objekt">
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setObjectMode('manual')}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${objectMode === 'manual' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  Upiši ručno
                </button>
                <button
                  type="button"
                  onClick={() => setObjectMode('select')}
                  disabled={!form.investitorId}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${objectMode === 'select' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  Iz baze
                </button>
              </div>

              {objectMode === 'manual' ? (
                <div className="flex gap-2">
                  <TextInput
                    value={form.objektNaziv}
                    onChange={(e) => setForm((prev) => ({ ...prev, objektNaziv: e.target.value, objektId: '' }))}
                    placeholder="Naziv objekta"
                  />
                  <button
                    type="button"
                    onClick={() => handleCreateObject(form.objektNaziv)}
                    className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                    disabled={!form.objektNaziv.trim() || !form.investitorNaziv.trim()}
                  >
                    Dodaj u bazu
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Select
                    value={form.objektId}
                    onChange={(e) => setForm((prev) => ({ ...prev, objektId: e.target.value, objektNaziv: objekti.find((item) => item.id === e.target.value)?.naziv ?? '' }))}
                  >
                    <option value="">- Odaberi objekt -</option>
                    {objekti.map((objekt) => (
                      <option key={objekt.id} value={objekt.id}>{objekt.naziv}</option>
                    ))}
                  </Select>
                  <div className="flex gap-2">
                    <TextInput
                      value={newObjectName}
                      onChange={(e) => setNewObjectName(e.target.value)}
                      placeholder="Naziv novog objekta"
                    />
                    <button
                      type="button"
                      onClick={() => handleCreateObject()}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                      disabled={!newObjectName.trim() || !form.investitorNaziv.trim()}
                    >
                      Dodaj
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as GradilisteStatus })}
            >
              <option value="ponuda">Ponuda</option>
              <option value="planirano">Planirano</option>
              <option value="aktivno">Aktivno</option>
              <option value="pauzirano">Pauzirano</option>
              <option value="zavrseno">Završeno</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Datum početka">
              <TextInput
                type="date"
                value={form.datum_pocetka}
                onChange={(e) => setForm({ ...form, datum_pocetka: e.target.value })}
              />
            </Field>
            <Field label="Datum završetka">
              <TextInput
                type="date"
                value={form.datum_zavrsetka}
                onChange={(e) => setForm({ ...form, datum_zavrsetka: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Napomena">
            <Textarea
              rows={3}
              value={form.opis}
              onChange={(e) => setForm({ ...form, opis: e.target.value })}
              placeholder="Napomena uz gradilište…"
            />
          </Field>
          {!editing && (
            <div className="md:col-span-2">
              <p className="mb-1 text-sm font-medium text-slate-700">Radni zadaci</p>
              {newZadaci.length > 0 && (
                <div className="mb-2 grid gap-1.5 md:grid-cols-2">
                  {newZadaci.map((z, index) => (
                    <div key={`${z.naziv}-${index}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{z.naziv}</span>
                      {z.rok && <span className="text-xs text-slate-500">{new Date(`${z.rok}T00:00:00`).toLocaleDateString('hr-HR')}</span>}
                      <button
                        type="button"
                        onClick={() => setNewZadaci((prev) => prev.filter((_, i) => i !== index))}
                        className="text-slate-300 hover:text-red-600"
                        aria-label="Ukloni zadatak"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[12rem] flex-1">
                  <TextInput
                    value={zadatakNaziv}
                    onChange={(e) => setZadatakNaziv(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNewZadatak(); } }}
                    placeholder="Novi radni zadatak…"
                  />
                </div>
                <div className="w-40">
                  <TextInput type="date" value={zadatakRok} onChange={(e) => setZadatakRok(e.target.value)} title="Rok (neobavezno)" />
                </div>
                <button
                  type="button"
                  onClick={addNewZadatak}
                  disabled={!zadatakNaziv.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Dodaj
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Izbrisati gradilište?"
        message="Ova radnja je nepovratna. Svi povezani rasporedi će također biti izbrisani."
      />
    </div>
  );
}
