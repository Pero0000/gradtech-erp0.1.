import { useState, useEffect, useMemo } from 'react';
import { Receipt, Plus, Pencil, Trash2, Euro, Search, ArrowUp, ArrowDown, ArrowUpDown, X } from 'lucide-react';
import type { Trosak, TrosakKategorija, Gradiliste, Kooperant } from '@/types';
import {
  fetchTroskovi,
  fetchKooperanti,
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
import { ExportMenu } from '@/components/ui/ExportMenu';

const kategorijaInfo: Record<TrosakKategorija, { variant: 'blue' | 'orange' | 'green' | 'gray' | 'red'; label: string }> = {
  materijal: { variant: 'blue', label: 'Materijal' },
  gorivo: { variant: 'orange', label: 'Gorivo' },
  put: { variant: 'blue', label: 'Put' },
  smjestaj: { variant: 'orange', label: 'Smještaj' },
  kooperanti: { variant: 'red', label: 'Kooperanti' },
  place: { variant: 'green', label: 'Plaće' },
  oprema: { variant: 'gray', label: 'Oprema' },
  direktni: { variant: 'orange', label: 'Direktni trošak' },
  ostalo: { variant: 'red', label: 'Ostalo' },
};

const barColor: Record<TrosakKategorija, string> = {
  materijal: 'bg-sky-500',
  gorivo: 'bg-amber-500',
  put: 'bg-indigo-400',
  smjestaj: 'bg-orange-400',
  kooperanti: 'bg-rose-500',
  place: 'bg-emerald-500',
  oprema: 'bg-slate-400',
  direktni: 'bg-yellow-500',
  ostalo: 'bg-red-400',
};

type SortKey = 'datum' | 'gradiliste' | 'kategorija' | 'opis' | 'iznos';
type GroupBy = 'none' | 'gradiliste' | 'kategorija';
type Row = { type: 'group'; key: string; label: string; sum: number; count: number } | { type: 'item'; t: Trosak };

const eur = (v: number) => v.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });

const emptyForm = {
  gradiliste_id: '',
  kategorija: 'materijal' as TrosakKategorija,
  kooperant_id: '',
  opis: '',
  iznos: '',
  datum: new Date().toISOString().split('T')[0],
};

export function TroskoviView() {
  const [items, setItems] = useState<Trosak[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [kooperanti, setKooperanti] = useState<Kooperant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Trosak | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterGradiliste, setFilterGradiliste] = useState('');
  const [query, setQuery] = useState('');
  const [filterKat, setFilterKat] = useState<'' | TrosakKategorija>('');
  const [od, setOd] = useState('');
  const [doDatuma, setDoDatuma] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('datum');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, g, k] = await Promise.all([fetchTroskovi(), fetchGradilista(), fetchKooperanti().catch(() => [])]);
      setItems(t);
      setGradilista(g);
      setKooperanti(k);
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
      kooperant_id: t.kooperant_id ?? '',
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
        kooperant_id: form.kategorija === 'kooperanti' && form.kooperant_id ? form.kooperant_id : null,
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((t) =>
      (!filterGradiliste || t.gradiliste_id === filterGradiliste)
      && (!filterKat || t.kategorija === filterKat)
      && (!od || t.datum >= od)
      && (!doDatuma || t.datum <= doDatuma)
      && (!q || [t.opis, t.gradilista?.naziv, t.kooperanti?.naziv, kategorijaInfo[t.kategorija].label].some((v) => (v ?? '').toLowerCase().includes(q))));
    const val = (t: Trosak): string | number => {
      if (sortKey === 'datum') return t.datum;
      if (sortKey === 'gradiliste') return t.gradilista?.naziv ?? '';
      if (sortKey === 'kategorija') return kategorijaInfo[t.kategorija].label;
      if (sortKey === 'opis') return t.opis;
      return t.iznos;
    };
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'hr')) * dir;
    });
  }, [items, query, filterGradiliste, filterKat, od, doDatuma, sortKey, sortDir]);

  const ukupno = filtered.reduce((sum, t) => sum + t.iznos, 0);

  const byKat = useMemo(() => {
    const m = new Map<TrosakKategorija, number>();
    filtered.forEach((t) => m.set(t.kategorija, (m.get(t.kategorija) ?? 0) + t.iznos));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const rows = useMemo<Row[]>(() => {
    if (groupBy === 'none') return filtered.map((t) => ({ type: 'item', t }));
    const m = new Map<string, { label: string; list: Trosak[] }>();
    filtered.forEach((t) => {
      const key = groupBy === 'gradiliste' ? t.gradiliste_id ?? '-' : t.kategorija;
      const label = groupBy === 'gradiliste' ? t.gradilista?.naziv ?? 'Bez gradilišta' : kategorijaInfo[t.kategorija].label;
      const g = m.get(key) ?? { label, list: [] };
      g.list.push(t);
      m.set(key, g);
    });
    return [...m.entries()]
      .sort((a, b) => b[1].list.reduce((s, t) => s + t.iznos, 0) - a[1].list.reduce((s, t) => s + t.iznos, 0))
      .flatMap(([key, g]): Row[] => [
        { type: 'group', key, label: g.label, sum: g.list.reduce((s, t) => s + t.iznos, 0), count: g.list.length },
        ...g.list.map((t): Row => ({ type: 'item', t })),
      ]);
  }, [filtered, groupBy]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir(k === 'iznos' || k === 'datum' ? 'desc' : 'asc');
    }
  };

  const hasFilters = !!(query || filterGradiliste || filterKat || od || doDatuma);
  const resetFilters = () => {
    setQuery('');
    setFilterGradiliste('');
    setFilterKat('');
    setOd('');
    setDoDatuma('');
  };

  const SortTh = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th className={`px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 ${right ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-slate-800 ${sortKey === k ? 'text-sky-700' : ''}`}>
        {label}
        {sortKey === k ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );

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
        <div className="flex items-center gap-2">
        <ExportMenu
          disabled={filtered.length === 0}
          build={() => ({
            file: 'Troskovi',
            title: 'Troškovi',
            subtitle: `${filtered.length} stavki · izvezeno ${new Date().toLocaleDateString('hr-HR')}`,
            rows: filtered,
            columns: [
              { header: 'Datum', kind: 'date', get: (t: Trosak) => t.datum },
              { header: 'Gradilište', get: (t: Trosak) => t.gradilista?.naziv ?? '' },
              { header: 'Kategorija', get: (t: Trosak) => kategorijaInfo[t.kategorija].label },
              { header: 'Opis', get: (t: Trosak) => (t.kooperanti?.naziv ? `${t.kooperanti.naziv}: ${t.opis}` : t.opis) },
              { header: 'Iznos', kind: 'eur', get: (t: Trosak) => t.iznos },
            ],
            totals: { Iznos: ukupno },
          })}
        />
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Novi trošak
        </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Pregled */}
      <div className="mb-4 grid gap-3 lg:grid-cols-[16rem_1fr]">
        <div className="rounded-2xl bg-slate-800 p-4 text-white shadow-sm">
          <div className="flex items-center gap-2 text-sm text-slate-300"><Euro className="h-4 w-4" /> Ukupno{hasFilters ? ' (filtrirano)' : ''}</div>
          <p className="mt-1 text-2xl font-bold">{eur(ukupno)}</p>
          <p className="mt-1 text-xs text-slate-400">{filtered.length} troškova · prosjek {eur(filtered.length ? ukupno / filtered.length : 0)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Raspodjela po kategorijama</p>
          {byKat.length === 0 ? <p className="text-sm text-slate-400">Nema podataka.</p> : (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                {byKat.map(([k, v]) => <div key={k} className={barColor[k]} style={{ width: `${ukupno ? (v / ukupno) * 100 : 0}%` }} title={`${kategorijaInfo[k].label}: ${eur(v)}`} />)}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {byKat.map(([k, v]) => (
                  <button key={k} type="button" onClick={() => setFilterKat(filterKat === k ? '' : k)} className={`inline-flex items-center gap-1.5 text-xs ${filterKat === k ? 'font-bold text-sky-700' : 'text-slate-600 hover:text-slate-900'}`}>
                    <span className={`h-2 w-2 rounded-full ${barColor[k]}`} />
                    {kategorijaInfo[k].label} <span className="font-semibold">{eur(v)}</span>
                    <span className="text-slate-400">({ukupno ? Math.round((v / ukupno) * 100) : 0}%)</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Filteri */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Traži opis, gradilište, kooperanta…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm" />
        </div>
        <select value={filterGradiliste} onChange={(e) => setFilterGradiliste(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="">Sva gradilišta</option>
          {gradilista.map((g) => <option key={g.id} value={g.id}>{g.naziv}</option>)}
        </select>
        <select value={filterKat} onChange={(e) => setFilterKat(e.target.value as '' | TrosakKategorija)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="">Sve kategorije</option>
          {(Object.keys(kategorijaInfo) as TrosakKategorija[]).map((k) => <option key={k} value={k}>{kategorijaInfo[k].label}</option>)}
        </select>
        <input type="date" value={od} onChange={(e) => setOd(e.target.value)} title="Od datuma" className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm" />
        <input type="date" value={doDatuma} onChange={(e) => setDoDatuma(e.target.value)} title="Do datuma" className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm" />
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="none">Bez grupiranja</option>
          <option value="gradiliste">Grupiraj po gradilištu</option>
          <option value="kategorija">Grupiraj po kategoriji</option>
        </select>
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" /> Očisti
          </button>
        )}
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
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <SortTh k="datum" label="Datum" />
                <SortTh k="gradiliste" label="Gradilište" />
                <SortTh k="kategorija" label="Kategorija" />
                <SortTh k="opis" label="Opis" />
                <SortTh k="iznos" label="Iznos" right />
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                if (r.type === 'group') {
                  return (
                    <tr key={`g-${r.key}`} className="bg-slate-100">
                      <td colSpan={4} className="px-5 py-2 text-sm font-semibold text-slate-800">{r.label} <span className="font-normal text-slate-400">· {r.count} stavki</span></td>
                      <td className="px-5 py-2 text-right text-sm font-bold text-slate-900">{eur(r.sum)}</td>
                      <td />
                    </tr>
                  );
                }
                const t = r.t;
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
                    <td className="px-5 py-3.5 text-sm text-slate-700">{t.kooperanti?.naziv ? <strong className="mr-1">{t.kooperanti.naziv}:</strong> : null}{t.opis}</td>
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
              <option value="direktni">Direktni trošak</option>
              <option value="ostalo">Ostalo</option>
            </Select>
          </Field>
          {form.kategorija === 'kooperanti' && (
            <Field label="Kooperant">
              <Select value={form.kooperant_id} onChange={(e) => setForm({ ...form, kooperant_id: e.target.value })}>
                <option value="">— Odaberi —</option>
                {kooperanti.map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}
              </Select>
            </Field>
          )}
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
