import { useState, useEffect } from 'react';
import { Receipt, Plus, Pencil, Trash2, DollarSign } from 'lucide-react';
import type { Trosak, TrosakKategorija, Gradiliste } from '@/types';
import {
  fetchTroskovi,
  createTrosak,
  updateTrosak,
  deleteTrosak,
  fetchGradilista,
} from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';

const kategorijaInfo: Record<TrosakKategorija, { variant: 'blue' | 'orange' | 'green' | 'gray' | 'red'; label: string }> = {
  materijal: { variant: 'blue', label: 'Materijal' },
  gorivo: { variant: 'orange', label: 'Gorivo' },
  put: { variant: 'blue', label: 'Put' },
  smjestaj: { variant: 'orange', label: 'Smještaj' },
  kooperanti: { variant: 'red', label: 'Kooperanti' },
  place: { variant: 'green', label: 'Plaće' },
  oprema: { variant: 'gray', label: 'Oprema' },
  ostalo: { variant: 'red', label: 'Ostalo' },
};

const emptyForm = {
  gradiliste_id: '',
  kategorija: 'materijal' as TrosakKategorija,
  opis: '',
  iznos: '',
  datum: new Date().toISOString().split('T')[0],
};

export function TroskoviView() {
  const [items, setItems] = useState<Trosak[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Trosak | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterGradiliste, setFilterGradiliste] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, g] = await Promise.all([fetchTroskovi(), fetchGradilista()]);
      setItems(t);
      setGradilista(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri učitavanju');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, gradiliste_id: filterGradiliste });
    setModalOpen(true);
  };

  const openEdit = (t: Trosak) => {
    setEditing(t);
    setForm({
      gradiliste_id: t.gradiliste_id ?? '',
      kategorija: t.kategorija,
      opis: t.opis,
      iznos: t.iznos.toString(),
      datum: t.datum,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.opis.trim() || !form.iznos) return;
    setSaving(true);
    try {
      const payload = {
        gradiliste_id: form.gradiliste_id || null,
        kategorija: form.kategorija,
        opis: form.opis.trim(),
        iznos: parseFloat(form.iznos),
        datum: form.datum,
      };
      if (editing) {
        await updateTrosak(editing.id, payload);
      } else {
        await createTrosak(payload);
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
      await deleteTrosak(deleteId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri brisanju');
    }
  };

  const filtered = filterGradiliste
    ? items.filter((t) => t.gradiliste_id === filterGradiliste)
    : items;

  const ukupno = filtered.reduce((sum, t) => sum + t.iznos, 0);

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Troškovi</h1>
          <p className="text-sm text-slate-500 mt-1">Pratite troškove po gradilištima</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Novi trošak
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Filter + summary */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="w-64">
          <Select value={filterGradiliste} onChange={(e) => setFilterGradiliste(e.target.value)}>
            <option value="">Sva gradilišta</option>
            {gradilista.map((g) => (
              <option key={g.id} value={g.id}>
                {g.naziv}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-white">
          <DollarSign className="h-5 w-5" />
          <span className="text-sm text-slate-300">Ukupno:</span>
          <span className="font-bold">
            {ukupno.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-7 w-7" />}
          title="Nema troškova"
          description="Dodajte troškove da biste pratili financije gradilišta."
          action={
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Novi trošak
            </button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Datum</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Gradilište</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Kategorija</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Opis</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Iznos</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((t) => {
                const ki = kategorijaInfo[t.kategorija];
                return (
                  <tr key={t.id} className="group hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 text-sm text-slate-600">
                      {new Date(t.datum + 'T00:00:00').toLocaleDateString('hr-HR')}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-600">
                      {t.gradilista?.naziv ?? '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge variant={ki.variant}>{ki.label}</Badge>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-700">{t.opis}</td>
                    <td className="px-5 py-3.5 text-right text-sm font-semibold text-slate-900">
                      {t.iznos.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEdit(t)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600 transition-colors"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(t.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Uredi trošak' : 'Novi trošak'}
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
              disabled={saving || !form.opis.trim() || !form.iznos}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
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
          <Field label="Kategorija">
            <Select
              value={form.kategorija}
              onChange={(e) => setForm({ ...form, kategorija: e.target.value as TrosakKategorija })}
            >
              <option value="materijal">Materijal</option>
              <option value="gorivo">Gorivo</option>
              <option value="put">Put</option>
              <option value="smjestaj">Smještaj</option>
              <option value="kooperanti">Kooperanti</option>
              <option value="place">Plaće</option>
              <option value="oprema">Oprema</option>
              <option value="ostalo">Ostalo</option>
            </Select>
          </Field>
          <Field label="Opis *">
            <TextInput
              value={form.opis}
              onChange={(e) => setForm({ ...form, opis: e.target.value })}
              placeholder="npr. Cement 50x, Cigla 1000 kom"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Iznos (EUR) *">
              <TextInput
                type="number"
                value={form.iznos}
                onChange={(e) => setForm({ ...form, iznos: e.target.value })}
                placeholder="0.00"
              />
            </Field>
            <Field label="Datum">
              <TextInput
                type="date"
                value={form.datum}
                onChange={(e) => setForm({ ...form, datum: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Izbrisati trošak?"
        message="Ova radnja je nepovratna."
      />
    </div>
  );
}
