import { useState, useEffect, useRef } from 'react';
import {
  CalendarDays,
  Plus,
  Pencil,
  Trash2,
  MapPin,
  Users,
  Truck,
  ChevronLeft,
  ChevronRight,
  StickyNote,
  ClipboardList,
  Building2,
  GripVertical,
  AlertTriangle,
  Clock,
  ChevronRight as ChevronRightIcon,
} from 'lucide-react';
import type { Raspored, Gradiliste, Radnik, Vozilo, Rok } from '@/types';
import {
  fetchRasporedi,
  fetchGradilista,
  fetchRadnici,
  fetchVozila,
  fetchRokovi,
  createRaspored,
  updateRaspored,
  deleteRaspored,
  createRadniNalog,
  generateNalogBroj,
} from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select, Textarea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/ui/Badge';
import type { View } from '@/components/Sidebar';

interface RasporedViewProps {
  onNavigate?: (view: View) => void;
}

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('hr-HR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function daysUntil(d: string): number {
  const target = new Date(d + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function RasporedView({ onNavigate }: RasporedViewProps) {
  const [rasporedi, setRasporedi] = useState<Raspored[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [radnici, setRadnici] = useState<Radnik[]>([]);
  const [vozila, setVozila] = useState<Vozilo[]>([]);
  const [allRokovi, setAllRokovi] = useState<Rok[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Raspored | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  // Drag state
  const draggedId = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [nalogModalOpen, setNalogModalOpen] = useState(false);
  const [nalogRaspored, setNalogRaspored] = useState<Raspored | null>(null);
  const [nalogForm, setNalogForm] = useState({ naslov: '', opis: '', prioritet: 'srednji' as const });
  const [nalogSaving, setNalogSaving] = useState(false);

  const [form, setForm] = useState({
    datum: new Date().toISOString().split('T')[0],
    gradiliste_id: '',
    napomena: '',
    radnik_ids: [] as string[],
    vozilo_ids: [] as string[],
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, g, rad, v, rok] = await Promise.all([
        fetchRasporedi(),
        fetchGradilista(),
        fetchRadnici(),
        fetchVozila(),
        fetchRokovi(),
      ]);
      setRasporedi(r);
      setGradilista(g);
      setRadnici(rad);
      setVozila(v);
      setAllRokovi(rok);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri učitavanju');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const dayRasporedi = rasporedi.filter((r) => r.datum === selectedDate);

  const rokoviByGradiliste = (gid: string) => allRokovi.filter((r) => r.gradiliste_id === gid);
  const upcomingRokovi = allRokovi
    .filter((r) => r.status === 'otvoren')
    .sort((a, b) => a.datum.localeCompare(b.datum));

  const changeDay = (delta: number) => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const openCreate = (gradilisteId?: string) => {
    setEditing(null);
    setForm({
      datum: selectedDate,
      gradiliste_id: gradilisteId ?? '',
      napomena: '',
      radnik_ids: [],
      vozilo_ids: [],
    });
    setModalOpen(true);
  };

  const openEdit = (r: Raspored) => {
    setEditing(r);
    setForm({
      datum: r.datum,
      gradiliste_id: r.gradiliste_id ?? '',
      napomena: r.napomena ?? '',
      radnik_ids: (r.radnici ?? []).map((rad) => rad.id),
      vozilo_ids: (r.vozila ?? []).map((v) => v.id),
    });
    setModalOpen(true);
  };

  const toggleRadnik = (id: string) => {
    setForm((f) => ({
      ...f,
      radnik_ids: f.radnik_ids.includes(id)
        ? f.radnik_ids.filter((r) => r !== id)
        : [...f.radnik_ids, id],
    }));
  };

  const toggleVozilo = (id: string) => {
    setForm((f) => ({
      ...f,
      vozilo_ids: f.vozilo_ids.includes(id)
        ? f.vozilo_ids.filter((v) => v !== id)
        : [...f.vozilo_ids, id],
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        datum: form.datum,
        gradiliste_id: form.gradiliste_id || null,
        napomena: form.napomena.trim() || null,
        radnik_ids: form.radnik_ids,
        vozilo_ids: form.vozilo_ids,
      };
      if (editing) {
        await updateRaspored(editing.id, payload);
      } else {
        await createRaspored(payload);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri spremanju');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteRaspored(deleteId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri brisanju');
    }
  };

  // HTML5 drag-and-drop
  const handleDragStart = (e: React.DragEvent, g: Gradiliste) => {
    draggedId.current = g.id;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', g.id);
  };

  const handleDragEnd = () => {
    draggedId.current = null;
    setDragOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) {
      setDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const gid = e.dataTransfer.getData('text/plain') || draggedId.current;
    if (gid) {
      openCreate(gid);
    }
    draggedId.current = null;
  };

  // Radni nalog creation
  const openNalogModal = (r: Raspored) => {
    setNalogRaspored(r);
    setNalogForm({ naslov: '', opis: '', prioritet: 'srednji' as const });
    setNalogModalOpen(true);
  };

  const saveNalog = async () => {
    if (!nalogRaspored || !nalogForm.naslov.trim()) return;
    setNalogSaving(true);
    try {
      const broj = await generateNalogBroj();
      const radnikIds = (nalogRaspored.radnici ?? []).map((r) => r.id);
      await createRadniNalog({
        broj,
        gradiliste_id: nalogRaspored.gradiliste_id,
        naslov: nalogForm.naslov.trim(),
        opis: nalogForm.opis.trim() || null,
        status: 'otvoren',
        prioritet: nalogForm.prioritet,
        rok: null,
        radnik_ids: radnikIds,
      });
      setNalogModalOpen(false);
      if (onNavigate) onNavigate('radni_nalozi');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri kreiranju naloga');
    } finally {
      setNalogSaving(false);
    }
  };

  // Capacity validation
  const totalVehicleCapacity = form.vozilo_ids.reduce((sum, vid) => {
    const v = vozila.find((v) => v.id === vid);
    return sum + (v?.broj_mjesta ?? 0);
  }, 0);
  const selectedWorkerCount = form.radnik_ids.length;
  const capacityExceeded = totalVehicleCapacity > 0 && selectedWorkerCount > totalVehicleCapacity;

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dnevni raspored</h1>
          <p className="text-sm text-slate-500 mt-1">
            Povuci gradilište u raspored ili stvori novi unos
          </p>
        </div>
        <button
          onClick={() => openCreate()}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Novi raspored
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Left column: gradilišta + rokovi */}
        <div className="space-y-4 h-fit lg:sticky lg:top-0">
          {/* Gradilišta list */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Building2 className="h-4 w-4 text-sky-600" />
              Gradilišta
            </h2>
            {gradilista.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">Nema gradilišta</p>
            ) : (
              <div className="space-y-2">
                {gradilista.map((g) => {
                  const gRokovi = rokoviByGradiliste(g.id);
                  const nextRok = gRokovi
                    .filter((r) => r.status === 'otvoren')
                    .sort((a, b) => a.datum.localeCompare(b.datum))[0];
                  return (
                    <div
                      key={g.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, g)}
                      onDragEnd={handleDragEnd}
                      onClick={() => openCreate(g.id)}
                      className="group cursor-grab rounded-lg border border-slate-100 p-2.5 hover:border-sky-200 hover:bg-sky-50 transition-colors active:cursor-grabbing"
                    >
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-4 w-4 flex-shrink-0 text-slate-300 group-hover:text-sky-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{g.naziv}</p>
                          {g.adresa && <p className="truncate text-xs text-slate-400">{g.adresa}</p>}
                        </div>
                        <span
                          className={`h-2 w-2 rounded-full flex-shrink-0 ${
                            g.status === 'aktivno'
                              ? 'bg-emerald-500'
                              : g.status === 'planirano'
                                ? 'bg-sky-500'
                                : g.status === 'pauzirano'
                                  ? 'bg-amber-500'
                                    : g.status === 'ponuda'
                                      ? 'bg-violet-500'
                                  : 'bg-slate-300'
                          }`}
                        />
                      </div>
                      {nextRok && (
                        <div className="mt-1.5 ml-6 flex items-center gap-1.5 text-xs">
                          <Clock className="h-3 w-3 text-slate-400" />
                          <span className="text-slate-500">{nextRok.naziv}:</span>
                          <span
                            className={
                              daysUntil(nextRok.datum) < 0
                                ? 'font-medium text-red-600'
                                : daysUntil(nextRok.datum) <= 7
                                  ? 'font-medium text-amber-600'
                                  : 'text-slate-500'
                            }
                          >
                            {daysUntil(nextRok.datum) < 0
                              ? `prekor. ${Math.abs(daysUntil(nextRok.datum))}d`
                              : `${daysUntil(nextRok.datum)}d`}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-3 text-xs text-slate-400">
              Povuci na desnu stranu ili klikni za raspored
            </p>
          </div>

          {/* Svi rokovi - nadolazeći */}
          {upcomingRokovi.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Clock className="h-4 w-4 text-amber-500" />
                Nadolazeći rokovi
              </h2>
              <div className="space-y-2">
                {upcomingRokovi.slice(0, 8).map((r) => {
                  const g = gradilista.find((g) => g.id === r.gradiliste_id);
                  const d = daysUntil(r.datum);
                  return (
                    <div key={r.id} className="rounded-lg border border-slate-100 p-2">
                      <div className="flex items-center justify-between">
                        <p className="truncate text-xs font-medium text-slate-700">{r.naziv}</p>
                        <span
                          className={`text-xs font-semibold flex-shrink-0 ml-2 ${
                            d < 0 ? 'text-red-600' : d <= 7 ? 'text-amber-600' : 'text-slate-500'
                          }`}
                        >
                          {d < 0 ? `${Math.abs(d)}d prekor.` : `${d}d`}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {g?.naziv ?? '—'} · {new Date(r.datum + 'T00:00:00').toLocaleDateString('hr-HR')}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: schedule area */}
        <div>
          {/* Date navigator */}
          <div className="mb-5 flex items-center justify-center gap-4">
            <button
              onClick={() => changeDay(-1)}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="text-center min-w-[280px]">
              <div className="flex items-center justify-center gap-2">
                <CalendarDays className="h-5 w-5 text-sky-600" />
                <span className="text-lg font-semibold text-slate-900 capitalize">
                  {formatDate(selectedDate)}
                </span>
              </div>
              <button
                onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
                className="mt-1 text-xs text-sky-600 hover:text-sky-700"
              >
                Današnji datum
              </button>
            </div>
            <button
              onClick={() => changeDay(1)}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* Drop zone / schedule list */}
          {dayRasporedi.length === 0 ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded-2xl border-2 border-dashed transition-colors ${
                dragOver ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div
                  className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl transition-colors ${
                    dragOver ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  <CalendarDays className="h-7 w-7" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">
                  {dragOver ? 'Pusti za kreiranje rasporeda' : 'Nema rasporeda za ovaj dan'}
                </h3>
                <p className="mt-1.5 max-w-sm text-sm text-slate-500">
                  Povuci gradilište s lijeve strane ovdje, ili klikni gumb za novi raspored.
                </p>
                <button
                  onClick={() => openCreate()}
                  className="mt-5 inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Novi raspored
                </button>
              </div>
            </div>
          ) : (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`space-y-4 rounded-xl transition-colors ${
                dragOver ? 'ring-2 ring-sky-400 ring-inset bg-sky-50/50' : ''
              }`}
            >
              {dragOver && (
                <div className="rounded-xl border-2 border-dashed border-sky-400 bg-sky-50 py-4 text-center text-sm font-medium text-sky-600">
                  Pusti za dodavanje rasporeda
                </div>
              )}

              {dayRasporedi.map((r) => {
                const raspedRadnici = r.radnici ?? [];
                const raspedVozila = r.vozila ?? [];
                const totalCap = raspedVozila.reduce((sum, v) => sum + (v.broj_mjesta ?? 0), 0);
                const capExceeded = totalCap > 0 && raspedRadnici.length > totalCap;

                return (
                  <div
                    key={r.id}
                    className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                          <MapPin className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900">
                            {r.gradilista?.naziv ?? 'Bez gradilišta'}
                          </h3>
                          {r.gradilista?.adresa && (
                            <p className="text-sm text-slate-500">{r.gradilista.adresa}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openNalogModal(r)}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-sky-600 hover:bg-sky-50 transition-colors"
                        >
                          <ClipboardList className="h-4 w-4" />
                          Nalog
                        </button>
                        <button
                          onClick={() => openEdit(r)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600 transition-colors"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(r.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <Users className="h-3.5 w-3.5" />
                          Radnici ({raspedRadnici.length})
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {raspedRadnici.length === 0 ? (
                            <span className="text-sm text-slate-400">Nema dodijeljenih radnika</span>
                          ) : (
                            raspedRadnici.map((rad) => (
                              <Badge key={rad.id} variant="green">
                                {rad.ime} {rad.prezime}
                              </Badge>
                            ))
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <Truck className="h-3.5 w-3.5" />
                          Vozila ({raspedVozila.length})
                          {totalCap > 0 && (
                            <span className="font-normal normal-case text-slate-400">
                              · kapacitet: {totalCap}
                            </span>
                          )}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {raspedVozila.length === 0 ? (
                            <span className="text-sm text-slate-400">Nema dodijeljenih vozila</span>
                          ) : (
                            raspedVozila.map((v) => (
                              <Badge key={v.id} variant="blue">
                                {v.registracija} — {v.marka} ({v.broj_mjesta} mjesta)
                              </Badge>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {capExceeded && (
                      <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 border border-red-100 px-3.5 py-2.5">
                        <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0" />
                        <p className="text-sm text-red-700">
                          Broj radnika ({raspedRadnici.length}) prelazi ukupni kapacitet vozila ({totalCap} mjesta)
                        </p>
                      </div>
                    )}

                    {r.napomena && (
                      <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3.5 py-2.5">
                        <StickyNote className="h-4 w-4 mt-0.5 text-amber-600 flex-shrink-0" />
                        <p className="text-sm text-amber-800">{r.napomena}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Schedule modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Uredi raspored' : 'Novi raspored'}
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
              disabled={saving || capacityExceeded}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Datum">
              <TextInput
                type="date"
                value={form.datum}
                onChange={(e) => setForm({ ...form, datum: e.target.value })}
              />
            </Field>
            <Field label="Gradilište">
              <Select
                value={form.gradiliste_id}
                onChange={(e) => setForm({ ...form, gradiliste_id: e.target.value })}
              >
                <option value="">— Odaberi —</option>
                {gradilista.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.naziv}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Radnici</p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {radnici.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-400">Nema radnika</p>
              ) : (
                radnici.map((rad) => (
                  <label
                    key={rad.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={form.radnik_ids.includes(rad.id)}
                      onChange={() => toggleRadnik(rad.id)}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span className="text-sm text-slate-700">
                      {rad.ime} {rad.prezime} <span className="text-slate-400">— {rad.uloga}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Vozila</p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {vozila.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-400">Nema vozila</p>
              ) : (
                vozila.map((v) => (
                  <label
                    key={v.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={form.vozilo_ids.includes(v.id)}
                      onChange={() => toggleVozilo(v.id)}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span className="text-sm text-slate-700">
                      {v.registracija} <span className="text-slate-400">— {v.marka} {v.model}</span>
                    </span>
                    <span className="ml-auto text-xs text-slate-400">{v.broj_mjesta} mjesta</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {form.vozilo_ids.length > 0 && (
            <div
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm ${
                capacityExceeded
                  ? 'bg-red-50 border border-red-100 text-red-700'
                  : 'bg-emerald-50 border border-emerald-100 text-emerald-700'
              }`}
            >
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {capacityExceeded ? (
                <span>
                  Odabrano {selectedWorkerCount} radnika, ali vozila imaju ukupno {totalVehicleCapacity} mjesta.
                </span>
              ) : (
                <span>
                  {selectedWorkerCount} radnika / {totalVehicleCapacity} mjesta — uredu.
                </span>
              )}
            </div>
          )}

          <Field label="Napomena">
            <Textarea
              rows={2}
              value={form.napomena}
              onChange={(e) => setForm({ ...form, napomena: e.target.value })}
              placeholder="Posebne upute, materijali, zadaci…"
            />
          </Field>
        </div>
      </Modal>

      {/* Create nalog from schedule */}
      <Modal
        open={nalogModalOpen}
        onClose={() => setNalogModalOpen(false)}
        title="Kreiraj radni nalog iz rasporeda"
        footer={
          <>
            <button
              onClick={() => setNalogModalOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Odustani
            </button>
            <button
              onClick={saveNalog}
              disabled={nalogSaving || !nalogForm.naslov.trim()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
            >
              {nalogSaving ? 'Kreiranje…' : 'Kreiraj nalog'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {nalogRaspored && (
            <div className="rounded-lg bg-sky-50 border border-sky-100 p-3">
              <p className="text-sm font-medium text-sky-900">
                {nalogRaspored.gradilista?.naziv ?? 'Bez gradilišta'}
              </p>
              <p className="text-xs text-sky-600 mt-1">
                {(nalogRaspored.radnici ?? []).length} radnika bit će dodijeljeno nalogu
              </p>
            </div>
          )}
          <Field label="Naslov naloga *">
            <TextInput
              value={nalogForm.naslov}
              onChange={(e) => setNalogForm({ ...nalogForm, naslov: e.target.value })}
              placeholder="npr. Zidarski radovi 1. kat"
            />
          </Field>
          <Field label="Opis">
            <Textarea
              rows={3}
              value={nalogForm.opis}
              onChange={(e) => setNalogForm({ ...nalogForm, opis: e.target.value })}
              placeholder="Detaljan opis zadatka…"
            />
          </Field>
          <Field label="Prioritet">
            <Select
              value={nalogForm.prioritet}
              onChange={(e) =>
                setNalogForm({ ...nalogForm, prioritet: e.target.value as typeof nalogForm.prioritet })
              }
            >
              <option value="niski">Niski</option>
              <option value="srednji">Srednji</option>
              <option value="visoki">Visoki</option>
              <option value="hitno">Hitno</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Izbrisati raspored?"
        message="Ova radnja je nepovratna. Raspored će biti trajno uklonjen."
      />
    </div>
  );
}
