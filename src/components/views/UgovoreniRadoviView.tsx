import { useState, useEffect } from 'react';
import { ClipboardCheck, Plus, Pencil, Trash2, DollarSign } from 'lucide-react';
import type { UgovoreniRad, UgovoreniRadStatus, Gradiliste } from '@/types';
import {
  fetchUgovoreniRadovi,
  createUgovoreniRad,
  updateUgovoreniRad,
  deleteUgovoreniRad,
  fetchGradilista,
} from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select, Textarea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';

const statusInfo: Record<UgovoreniRadStatus, { variant: 'blue' | 'yellow' | 'green'; label: string }> = {
  planirano: { variant: 'blue', label: 'Planirano' },
  u_tijeku: { variant: 'yellow', label: 'U tijeku' },
  zavrseno: { variant: 'green', label: 'Završeno' },
};

const emptyForm = {
  gradiliste_id: '',
  naziv: '',
  opis: '',
  ugovoreni_iznos: '',
  ostvareni_iznos: '',
  status: 'planirano' as UgovoreniRadStatus,
};

export function UgovoreniRadoviView() {
  const [items, setItems] = useState<UgovoreniRad[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UgovoreniRad | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterGradiliste, setFilterGradiliste] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, g] = await Promise.all([fetchUgovoreniRadovi(), fetchGradilista()]);
      setItems(u);
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

  const openEdit = (u: UgovoreniRad) => {
    setEditing(u);
    setForm({
      gradiliste_id: u.gradiliste_id ?? '',
      naziv: u.naziv,
      opis: u.opis ?? '',
      ugovoreni_iznos: u.ugovoreni_iznos.toString(),
      ostvareni_iznos: u.ostvareni_iznos?.toString() ?? '',
      status: u.status,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.naziv.trim()) return;
    setSaving(true);
    try {
      const payload = {
        gradiliste_id: form.gradiliste_id || null,
        naziv: form.naziv.trim(),
        opis: form.opis.trim() || null,
        ugovoreni_iznos: form.ugovoreni_iznos ? parseFloat(form.ugovoreni_iznos) : 0,
        ostvareni_iznos: form.ostvareni_iznos ? parseFloat(form.ostvareni_iznos) : 0,
        status: form.status,
      };
      if (editing) {
        await updateUgovoreniRad(editing.id, payload);
      } else {
        await createUgovoreniRad(payload);
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
      await deleteUgovoreniRad(deleteId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri brisanju');
    }
  };

  const filtered = filterGradiliste
    ? items.filter((u) => u.gradiliste_id === filterGradiliste)
    : items;
  const ukupnoUgovoreno = filtered.reduce((sum, u) => sum + u.ugovoreni_iznos, 0);
  const ukupnoOstvareno = filtered.reduce((sum, u) => sum + (u.ostvareni_iznos ?? 0), 0);

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ugovoreni radovi</h1>
          <p className="text-sm text-slate-500 mt-1">Pratite ugovorene i ostvarene iznose po radovima</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Novi rad
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

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
          <span className="text-sm text-slate-300">Ugovoreno:</span>
          <span className="font-bold">
            {ukupnoUgovoreno.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-white">
          <span className="text-sm text-emerald-200">Ostvareno:</span>
          <span className="font-bold">
            {ukupnoOstvareno.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-7 w-7" />}
          title="Nema ugovorenih radova"
          description="Dodajte ugovorene radove da biste pratili napredak i ostvarene iznose."
          action={
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Novi rad
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((u) => {
            const si = statusInfo[u.status];
            const pct = u.ugovoreni_iznos > 0 ? (u.ostvareni_iznos / u.ugovoreni_iznos) * 100 : 0;
            return (
              <div
                key={u.id}
                className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                      <ClipboardCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">{u.naziv}</h3>
                      {u.gradilista?.naziv && (
                        <p className="text-sm text-slate-500">{u.gradilista.naziv}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEdit(u)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600 transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteId(u.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {u.opis && <p className="text-sm text-slate-600 mb-3">{u.opis}</p>}

                <div className="flex items-center gap-3 mb-3">
                  <Badge variant={si.variant}>{si.label}</Badge>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Ugovoreno</p>
                    <p className="text-lg font-bold text-slate-900">
                      {u.ugovoreni_iznos.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Ostvareno</p>
                    <p className="text-lg font-bold text-emerald-600">
                      {(u.ostvareni_iznos ?? 0).toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
                    </p>
                  </div>
                </div>

                {u.ugovoreni_iznos > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span>Realizacija</span>
                      <span>{pct.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-sky-500 transition-all"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Uredi ugovoreni rad' : 'Novi ugovoreni rad'}
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
              disabled={saving || !form.naziv.trim()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Naziv *">
            <TextInput
              value={form.naziv}
              onChange={(e) => setForm({ ...form, naziv: e.target.value })}
              placeholder="npr. Zidarski radovi 1. kat"
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
              rows={2}
              value={form.opis}
              onChange={(e) => setForm({ ...form, opis: e.target.value })}
              placeholder="Opis radova…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Ugovoreni iznos (EUR)">
              <TextInput
                type="number"
                value={form.ugovoreni_iznos}
                onChange={(e) => setForm({ ...form, ugovoreni_iznos: e.target.value })}
                placeholder="0.00"
              />
            </Field>
            <Field label="Ostvareni iznos (EUR)">
              <TextInput
                type="number"
                value={form.ostvareni_iznos}
                onChange={(e) => setForm({ ...form, ostvareni_iznos: e.target.value })}
                placeholder="0.00"
              />
            </Field>
          </div>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as UgovoreniRadStatus })}
            >
              <option value="planirano">Planirano</option>
              <option value="u_tijeku">U tijeku</option>
              <option value="zavrseno">Završeno</option>
            </Select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Izbrisati ugovoreni rad?"
        message="Ova radnja je nepovratna."
      />
    </div>
  );
}
