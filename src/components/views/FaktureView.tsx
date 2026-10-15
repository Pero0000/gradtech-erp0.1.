import { useState, useEffect } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Plus, Pencil, Trash2, Euro } from 'lucide-react';
import type { Faktura, FakturaStatus, Gradiliste } from '@/types';
import {
  fetchFakture,
  createFaktura,
  updateFaktura,
  deleteFaktura,
  fetchGradilista,
} from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select, Textarea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';

const statusInfo: Record<FakturaStatus, { variant: 'blue' | 'green' | 'red'; label: string }> = {
  izdana: { variant: 'blue', label: 'Izdana' },
  placena: { variant: 'green', label: 'Plaćena' },
  'nep placena': { variant: 'red', label: 'Neplaćena' },
};

type FakturaSortKey = 'broj' | 'gradiliste' | 'kupac' | 'datum_izdavanja' | 'datum_dospjecja' | 'iznos' | 'status';
type SortDirection = 'asc' | 'desc';

function compareSortValues(first: string | number | null, second: string | number | null, direction: SortDirection) {
  if (first === null || second === null) {
    if (first === second) return 0;
    return first === null ? 1 : -1;
  }

  const comparison = typeof first === 'number' && typeof second === 'number'
    ? first - second
    : String(first).localeCompare(String(second), 'hr', { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? comparison : -comparison;
}

const emptyForm = {
  gradiliste_id: '',
  broj: '',
  kupac: '',
  iznos: '',
  datum_izdavanja: new Date().toISOString().split('T')[0],
  datum_dospjecja: '',
  status: 'izdana' as FakturaStatus,
  opis: '',
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

export function FaktureView() {
  const [items, setItems] = useState<Faktura[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Faktura | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterGradiliste, setFilterGradiliste] = useState('');
  const [sortKey, setSortKey] = useState<FakturaSortKey>('datum_izdavanja');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [f, g] = await Promise.all([fetchFakture(), fetchGradilista()]);
      setItems(f);
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

  const openEdit = (f: Faktura) => {
    setEditing(f);
    setForm({
      gradiliste_id: f.gradiliste_id ?? '',
      broj: f.broj,
      kupac: f.kupac ?? '',
      iznos: f.iznos.toString(),
      datum_izdavanja: f.datum_izdavanja,
      datum_dospjecja: f.datum_dospjecja ?? '',
      status: f.status,
      opis: f.opis ?? '',
    });
    setModalOpen(true);
  };

  const handleGradilisteChange = (gradilisteId: string) => {
    const selectedGradiliste = gradilista.find((gradiliste) => gradiliste.id === gradilisteId);
    const investitor = selectedGradiliste?.objekti?.investitori?.naziv ?? '';
    setForm((prev) => ({ ...prev, gradiliste_id: gradilisteId, kupac: investitor }));
  };

  const save = async () => {
    if (!form.broj.trim() || !form.iznos) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        gradiliste_id: form.gradiliste_id || null,
        broj: form.broj.trim(),
        kupac: form.kupac.trim() || null,
        iznos: parseFloat(form.iznos),
        datum_izdavanja: form.datum_izdavanja,
        datum_dospjecja: form.datum_dospjecja || null,
        status: form.status,
        opis: form.opis.trim() || null,
      };
      if (editing) {
        await updateFaktura(editing.id, payload);
      } else {
        await createFaktura(payload);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(getErrorMessage(e, 'Greška pri spremanju fakture'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteFaktura(deleteId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri brisanju');
    }
  };

  const filtered = filterGradiliste
    ? items.filter((f) => f.gradiliste_id === filterGradiliste)
    : items;
  const sortedItems = [...filtered].sort((first, second) => {
    const getValue = (faktura: Faktura): string | number | null => {
      switch (sortKey) {
        case 'broj': return faktura.broj;
        case 'gradiliste': return faktura.gradilista?.naziv ?? null;
        case 'kupac': return faktura.kupac;
        case 'datum_izdavanja': return faktura.datum_izdavanja;
        case 'datum_dospjecja': return faktura.datum_dospjecja;
        case 'iznos': return faktura.iznos;
        case 'status': return statusInfo[faktura.status].label;
      }
    };
    return compareSortValues(getValue(first), getValue(second), sortDirection);
  });
  const ukupno = filtered.reduce((sum, f) => sum + f.iznos, 0);
  const placeno = filtered.filter((f) => f.status === 'placena').reduce((sum, f) => sum + f.iznos, 0);

  const handleSort = (key: FakturaSortKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const sortHeader = (key: FakturaSortKey, label: string) => {
    const Icon = sortKey !== key ? ArrowUpDown : sortDirection === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => handleSort(key)}
        className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-900"
        aria-label={`Sortiraj po: ${label}`}
        title={`Sortiraj po: ${label}`}
      >
        {label}
        <Icon className="h-3.5 w-3.5" />
      </button>
    );
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Fakture</h1>
          <p className="text-sm text-slate-500 mt-1">Izdane fakture po gradilištima</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Nova faktura
        </button>
      </div>

      {error && !modalOpen && (
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
          <Euro className="h-5 w-5" />
          <span className="text-sm text-slate-300">Ukupno:</span>
          <span className="font-bold">
            {ukupno.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-white">
          <span className="text-sm text-emerald-200">Plaćeno:</span>
          <span className="font-bold">
            {placeno.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-7 w-7" />}
          title="Nema faktura"
          description="Dodajte fakture da biste pratili izdana i plaćana dugovanja."
          action={
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Nova faktura
            </button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th aria-sort={sortKey === 'broj' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-left text-xs">
                  {sortHeader('broj', 'Broj')}
                </th>
                <th aria-sort={sortKey === 'gradiliste' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-left text-xs">
                  {sortHeader('gradiliste', 'Gradilište')}
                </th>
                <th aria-sort={sortKey === 'kupac' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-left text-xs">
                  {sortHeader('kupac', 'Kupac')}
                </th>
                <th aria-sort={sortKey === 'datum_izdavanja' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-left text-xs">
                  {sortHeader('datum_izdavanja', 'Datum')}
                </th>
                <th aria-sort={sortKey === 'datum_dospjecja' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-left text-xs">
                  {sortHeader('datum_dospjecja', 'Dospjeće')}
                </th>
                <th aria-sort={sortKey === 'iznos' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-right text-xs">
                  {sortHeader('iznos', 'Iznos')}
                </th>
                <th aria-sort={sortKey === 'status' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-left text-xs">
                  {sortHeader('status', 'Status')}
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedItems.map((f) => {
                const si = statusInfo[f.status];
                return (
                  <tr key={f.id} className="group hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 text-sm font-mono font-medium text-slate-700">{f.broj}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-600">{f.gradilista?.naziv ?? '—'}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-600">{f.kupac ?? '—'}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-500">
                      {new Date(f.datum_izdavanja + 'T00:00:00').toLocaleDateString('hr-HR')}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-500">
                      {f.datum_dospjecja ? new Date(f.datum_dospjecja + 'T00:00:00').toLocaleDateString('hr-HR') : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm font-semibold text-slate-900">
                      {f.iznos.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge variant={si.variant}>{si.label}</Badge>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEdit(f)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600 transition-colors"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(f.id)}
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
        title={editing ? 'Uredi fakturu' : 'Nova faktura'}
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
              disabled={saving || !form.broj.trim() || !form.iznos}
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
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Broj fakture *">
              <TextInput
                value={form.broj}
                onChange={(e) => setForm({ ...form, broj: e.target.value })}
                placeholder="F-2026-001"
              />
            </Field>
            <Field label="Gradilište">
              <Select
                value={form.gradiliste_id}
                onChange={(e) => handleGradilisteChange(e.target.value)}
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
          <Field label="Kupac">
            <TextInput
              value={form.kupac}
              onChange={(e) => setForm({ ...form, kupac: e.target.value })}
              placeholder="npr. Investitor d.o.o."
            />
          </Field>
          <Field label="Iznos (EUR) *">
            <TextInput
              type="number"
              value={form.iznos}
              onChange={(e) => setForm({ ...form, iznos: e.target.value })}
              placeholder="0.00"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Datum izdavanja">
              <TextInput
                type="date"
                value={form.datum_izdavanja}
                onChange={(e) => setForm({ ...form, datum_izdavanja: e.target.value })}
              />
            </Field>
            <Field label="Datum dospjeća">
              <TextInput
                type="date"
                value={form.datum_dospjecja}
                onChange={(e) => setForm({ ...form, datum_dospjecja: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as FakturaStatus })}
            >
              <option value="izdana">Izdana</option>
              <option value="placena">Plaćena</option>
              <option value="nep placena">Neplaćena</option>
            </Select>
          </Field>
          <Field label="Opis">
            <Textarea
              rows={2}
              value={form.opis}
              onChange={(e) => setForm({ ...form, opis: e.target.value })}
              placeholder="Opis usluge…"
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Izbrisati fakturu?"
        message="Ova radnja je nepovratna."
      />
    </div>
  );
}
