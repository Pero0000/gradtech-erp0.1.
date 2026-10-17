import { useState, useEffect } from 'react';
import { Clock, Plus, Pencil, Trash2, Calendar } from 'lucide-react';
import type { RadnoVrijeme, Gradiliste, Radnik } from '@/types';
import {
  fetchRadnoVrijeme,
  createRadnoVrijeme,
  updateRadnoVrijeme,
  deleteRadnoVrijeme,
  fetchGradilista,
  fetchRadnici,
} from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select, Textarea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';

const emptyForm = {
  radnik_id: '',
  gradiliste_id: '',
  datum: new Date().toISOString().split('T')[0],
  sati: '8',
  napomena: '',
};

export function RadnoVrijemeView() {
  const [items, setItems] = useState<RadnoVrijeme[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [radnici, setRadnici] = useState<Radnik[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RadnoVrijeme | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterDatum, setFilterDatum] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [rv, g, r] = await Promise.all([fetchRadnoVrijeme(), fetchGradilista(), fetchRadnici()]);
      setItems(rv);
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

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (rv: RadnoVrijeme) => {
    setEditing(rv);
    setForm({
      radnik_id: rv.radnik_id,
      gradiliste_id: rv.gradiliste_id ?? '',
      datum: rv.datum,
      sati: rv.sati.toString(),
      napomena: rv.napomena ?? '',
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.radnik_id || !form.sati) return;
    setSaving(true);
    try {
      const payload = {
        radnik_id: form.radnik_id,
        gradiliste_id: form.gradiliste_id || null,
        datum: form.datum,
        sati: parseFloat(form.sati),
        napomena: form.napomena.trim() || null,
      };
      if (editing) {
        await updateRadnoVrijeme(editing.id, payload);
      } else {
        await createRadnoVrijeme(payload);
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
      await deleteRadnoVrijeme(deleteId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri brisanju');
    }
  };

  const filtered = filterDatum ? items.filter((rv) => rv.datum === filterDatum) : items;
  const ukupnoSati = filtered.reduce((sum, rv) => sum + rv.sati, 0);

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Radno vrijeme</h1>
          <p className="text-sm text-slate-500 mt-1">Evidencija radnih sati po radnicima i gradilištima</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Zabilježi sate
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Filter + summary */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-slate-400" />
          <input
            type="date"
            value={filterDatum}
            onChange={(e) => setFilterDatum(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none"
          />
          {filterDatum && (
            <button
              onClick={() => setFilterDatum('')}
              className="text-xs text-sky-600 hover:text-sky-700"
            >
              Ukloni filter
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-white">
          <Clock className="h-5 w-5" />
          <span className="text-sm text-slate-300">Ukupno sati:</span>
          <span className="font-bold">{ukupnoSati.toFixed(1)}h</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Clock className="h-7 w-7" />}
          title="Nema zabilježenih sati"
          description="Zabilježite radne sate radnika da biste pratili radno vrijeme."
          action={
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Zabilježi sate
            </button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Datum</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Radnik</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Gradilište</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Sati</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Napomena</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((rv) => (
                <tr key={rv.id} className="group hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 text-sm text-slate-600">
                    {new Date(rv.datum + 'T00:00:00').toLocaleDateString('hr-HR')}
                  </td>
                  <td className="px-5 py-3.5 text-sm font-medium text-slate-900">
                    {rv.radnici ? `${rv.radnici.ime} ${rv.radnici.prezime}` : '—'}
                    {rv.radnici?.uloga && (
                      <span className="ml-2 text-xs text-slate-400">{rv.radnici.uloga}</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-slate-600">
                    {rv.gradilista?.naziv ?? '—'}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Badge variant="blue">{rv.sati.toFixed(1)}h</Badge>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-slate-500">{rv.napomena ?? '—'}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit(rv)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600 transition-colors"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteId(rv.id)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Uredi radno vrijeme' : 'Zabilježi radno vrijeme'}
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
              disabled={saving || !form.radnik_id || !form.sati}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Radnik *">
            <Select
              value={form.radnik_id}
              onChange={(e) => setForm({ ...form, radnik_id: e.target.value })}
            >
              <option value="">— Odaberi —</option>
              {radnici.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.ime} {r.prezime} — {r.uloga}
                </option>
              ))}
            </Select>
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
          <div className="grid grid-cols-2 gap-4">
            <Field label="Datum">
              <TextInput
                type="date"
                value={form.datum}
                onChange={(e) => setForm({ ...form, datum: e.target.value })}
              />
            </Field>
            <Field label="Sati *">
              <TextInput
                type="number"
                step="0.5"
                value={form.sati}
                onChange={(e) => setForm({ ...form, sati: e.target.value })}
                placeholder="8"
              />
            </Field>
          </div>
          <Field label="Napomena">
            <Textarea
              rows={2}
              value={form.napomena}
              onChange={(e) => setForm({ ...form, napomena: e.target.value })}
              placeholder="Prekovremeno, posebni zadaci…"
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Izbrisati zapis?"
        message="Ova radnja je nepovratna."
      />
    </div>
  );
}
