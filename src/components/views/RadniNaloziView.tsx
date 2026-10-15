import { useState, useEffect } from 'react';
import { ClipboardList, Plus, Pencil, Trash2, Users, Calendar, AlertCircle } from 'lucide-react';
import type { RadniNalog, Gradiliste, Radnik, NalogStatus, NalogPrioritet } from '@/types';
import {
  fetchRadniNalozi,
  createRadniNalog,
  updateRadniNalog,
  deleteRadniNalog,
  generateNalogBroj,
  fetchGradilista,
  fetchRadnici,
} from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select, Textarea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';

const statusInfo: Record<NalogStatus, { variant: 'blue' | 'yellow' | 'green' | 'red'; label: string }> = {
  otvoren: { variant: 'blue', label: 'Otvoren' },
  u_tijeku: { variant: 'yellow', label: 'U tijeku' },
  zavrsen: { variant: 'green', label: 'Završen' },
  otkazan: { variant: 'red', label: 'Otkazan' },
};

const prioritetInfo: Record<NalogPrioritet, { variant: 'gray' | 'blue' | 'orange' | 'red'; label: string }> = {
  niski: { variant: 'gray', label: 'Niski' },
  srednji: { variant: 'blue', label: 'Srednji' },
  visoki: { variant: 'orange', label: 'Visoki' },
  hitno: { variant: 'red', label: 'Hitno' },
};

const emptyForm = {
  broj: '',
  gradiliste_id: '',
  naslov: '',
  opis: '',
  status: 'otvoren' as NalogStatus,
  prioritet: 'srednji' as NalogPrioritet,
  rok: '',
  radnik_ids: [] as string[],
};

export function RadniNaloziView() {
  const [items, setItems] = useState<RadniNalog[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [radnici, setRadnici] = useState<Radnik[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RadniNalog | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [n, g, r] = await Promise.all([fetchRadniNalozi(), fetchGradilista(), fetchRadnici()]);
      setItems(n);
      setGradilista(g);
      setRadnici(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri učitavanju');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = async () => {
    setEditing(null);
    try {
      const broj = await generateNalogBroj();
      setForm({ ...emptyForm, broj });
    } catch {
      setForm({ ...emptyForm, broj: `RN-${new Date().getFullYear()}-${Date.now().toString().slice(-3)}` });
    }
    setModalOpen(true);
  };

  const openEdit = (n: RadniNalog) => {
    setEditing(n);
    setForm({
      broj: n.broj,
      gradiliste_id: n.gradiliste_id ?? '',
      naslov: n.naslov,
      opis: n.opis ?? '',
      status: n.status,
      prioritet: n.prioritet,
      rok: n.rok ?? '',
      radnik_ids: (n.radnici ?? []).map((r) => r.id),
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

  const save = async () => {
    if (!form.naslov.trim()) return;
    setSaving(true);
    try {
      const payload = {
        gradiliste_id: form.gradiliste_id || null,
        naslov: form.naslov.trim(),
        opis: form.opis.trim() || null,
        status: form.status,
        prioritet: form.prioritet,
        rok: form.rok || null,
        radnik_ids: form.radnik_ids,
      };
      if (editing) {
        await updateRadniNalog(editing.id, payload);
      } else {
        await createRadniNalog({ ...payload, broj: form.broj });
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
      await deleteRadniNalog(deleteId);
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
          <h1 className="text-2xl font-bold text-slate-900">Radni nalozi</h1>
          <p className="text-sm text-slate-500 mt-1">Kreirajte i pratile radne naloge za gradilišta</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Novi nalog
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-7 w-7" />}
          title="Nema radnih naloga"
          description="Kreirajte prvi radni nalog da biste dodijelili zadatke radnicima."
          action={
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Novi nalog
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          {items.map((n) => {
            const si = statusInfo[n.status];
            const pi = prioritetInfo[n.prioritet];
            return (
              <div
                key={n.id}
                className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                      <ClipboardList className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium text-slate-400">{n.broj}</span>
                        <h3 className="font-semibold text-slate-900">{n.naslov}</h3>
                      </div>
                      {n.gradilista?.naziv && (
                        <p className="text-sm text-slate-500 mt-0.5">{n.gradilista.naziv}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEdit(n)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600 transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteId(n.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {n.opis && <p className="text-sm text-slate-600 mb-3">{n.opis}</p>}

                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={si.variant}>{si.label}</Badge>
                  <Badge variant={pi.variant}>{pi.label}</Badge>
                  {(n.radnici ?? []).length > 0 && (
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Users className="h-3.5 w-3.5" />
                      {(n.radnici ?? []).map((r) => `${r.ime} ${r.prezime}`).join(', ')}
                    </span>
                  )}
                  {n.rok && (
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Calendar className="h-3.5 w-3.5" />
                      Rok: {new Date(n.rok + 'T00:00:00').toLocaleDateString('hr-HR')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Uredi radni nalog' : 'Novi radni nalog'}
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
              disabled={saving || !form.naslov.trim()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {!editing && (
            <Field label="Broj naloga">
              <TextInput value={form.broj} readOnly className="font-mono bg-slate-50" />
            </Field>
          )}
          <Field label="Naslov *">
            <TextInput
              value={form.naslov}
              onChange={(e) => setForm({ ...form, naslov: e.target.value })}
              placeholder="npr. Ugradnja armature 1. kat"
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
          <Field label="Opis">
            <Textarea
              rows={3}
              value={form.opis}
              onChange={(e) => setForm({ ...form, opis: e.target.value })}
              placeholder="Detaljan opis zadatka…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Status">
              <Select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as NalogStatus })}
              >
                <option value="otvoren">Otvoren</option>
                <option value="u_tijeku">U tijeku</option>
                <option value="zavrsen">Završen</option>
                <option value="otkazan">Otkazan</option>
              </Select>
            </Field>
            <Field label="Prioritet">
              <Select
                value={form.prioritet}
                onChange={(e) => setForm({ ...form, prioritet: e.target.value as NalogPrioritet })}
              >
                <option value="niski">Niski</option>
                <option value="srednji">Srednji</option>
                <option value="visoki">Visoki</option>
                <option value="hitno">Hitno</option>
              </Select>
            </Field>
          </div>
          <Field label="Rok izvršenja">
            <TextInput
              type="date"
              value={form.rok}
              onChange={(e) => setForm({ ...form, rok: e.target.value })}
            />
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Dodijeljeni radnici</p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {radnici.length === 0 ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400">
                  <AlertCircle className="h-4 w-4" />
                  Nema radnika. Dodajte radnike prvo.
                </div>
              ) : (
                radnici.map((r) => (
                  <label
                    key={r.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={form.radnik_ids.includes(r.id)}
                      onChange={() => toggleRadnik(r.id)}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span className="text-sm text-slate-700">
                      {r.ime} {r.prezime} <span className="text-slate-400">— {r.uloga}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Izbrisati radni nalog?"
        message="Ova radnja je nepovratna."
      />
    </div>
  );
}
