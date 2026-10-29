import { useState, useEffect } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Plus, Pencil, Trash2, Euro, Search, X } from 'lucide-react';
import type { Faktura, FakturaStatus, Gradiliste, Investitor } from '@/types';
import {
  fetchInvestitori,
  createInvestitor,
  fetchFakture,
  createFaktura,
  updateFaktura,
  deleteFaktura,
  fetchGradilista,
  iznosFakture,
} from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select, Textarea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ExportMenu } from '@/components/ui/ExportMenu';
import { useAuth } from '@/auth/useAuth';

const statusInfo: Record<FakturaStatus, { variant: 'blue' | 'green' | 'red'; label: string }> = {
  izdana: { variant: 'blue', label: 'Izdana' },
  placena: { variant: 'green', label: 'Plaćena' },
  'nep placena': { variant: 'red', label: 'Neplaćena' },
};

type FakturaSortKey = 'broj' | 'gradiliste' | 'investitor' | 'kupac' | 'datum_izdavanja' | 'datum_dospjecja' | 'iznos' | 'status';
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
  investitor_id: '',
  broj: '',
  kupac: '',
  iznos: '',
  rabat: '0',
  datum_izdavanja: new Date().toISOString().split('T')[0],
  datum_dospjecja: '',
  datum_naplate: '',
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
  const { company } = useAuth();
  const [items, setItems] = useState<Faktura[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [investitori, setInvestitori] = useState<Investitor[]>([]);
  const [newInv, setNewInv] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Faktura | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterGradiliste, setFilterGradiliste] = useState('');
  const [filterInvestitor, setFilterInvestitor] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | FakturaStatus>('');
  const [query, setQuery] = useState('');
  const [od, setOd] = useState('');
  const [doDatuma, setDoDatuma] = useState('');
  const [sortKey, setSortKey] = useState<FakturaSortKey>('datum_izdavanja');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const rabatSmjer = editing?.rabat_smjer ?? company?.postavke.invoice_rebate_mode ?? 'pribroji';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [f, g, inv] = await Promise.all([fetchFakture(), fetchGradilista(), fetchInvestitori().catch(() => [])]);
      setItems(f);
      setGradilista(g);
      setInvestitori(inv);
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
    setNewInv(null);
    setEditing(null);
    const selectedSite = gradilista.find((site) => site.id === filterGradiliste);
    setForm({
      ...emptyForm,
      gradiliste_id: filterGradiliste,
      investitor_id: filterInvestitor || selectedSite?.objekti?.investitori?.id || '',
      kupac: investitori.find((investor) => investor.id === filterInvestitor)?.naziv ?? selectedSite?.objekti?.investitori?.naziv ?? '',
    });
    setModalOpen(true);
  };

  const openEdit = (f: Faktura) => {
    setNewInv(null);
    setEditing(f);
    setForm({
      gradiliste_id: f.gradiliste_id ?? '',
      investitor_id: f.investitor_id ?? investitori.find((investor) => investor.naziv.toLocaleLowerCase() === (f.kupac ?? '').toLocaleLowerCase())?.id ?? '',
      broj: f.broj,
      kupac: f.kupac ?? '',
      iznos: f.iznos.toString(),
      rabat: String(f.rabat ?? 0),
      datum_izdavanja: f.datum_izdavanja,
      datum_dospjecja: f.datum_dospjecja ?? '',
      datum_naplate: f.datum_naplate ?? '',
      status: f.status,
      opis: f.opis ?? '',
    });
    setModalOpen(true);
  };

  const addInvestitor = async () => {
    const naziv = (newInv ?? '').trim();
    if (!naziv) return;
    try {
      const created = await createInvestitor({ naziv });
      setInvestitori((prev) => [...prev, created].sort((a, b) => a.naziv.localeCompare(b.naziv, 'hr')));
      setForm((prev) => ({ ...prev, investitor_id: created.id, kupac: created.naziv }));
      setNewInv(null);
    } catch (e) {
      setError(getErrorMessage(e, 'Greška pri dodavanju investitora'));
    }
  };

  const handleGradilisteChange = (gradilisteId: string) => {
    const selectedGradiliste = gradilista.find((gradiliste) => gradiliste.id === gradilisteId);
    const investor = selectedGradiliste?.objekti?.investitori;
    setForm((prev) => ({
      ...prev,
      gradiliste_id: gradilisteId,
      investitor_id: investor?.id ?? '',
      kupac: investor?.naziv ?? '',
    }));
  };

  const handleInvestitorChange = (investitorId: string) => {
    const investor = investitori.find((item) => item.id === investitorId);
    setForm((prev) => ({ ...prev, investitor_id: investitorId, kupac: investor?.naziv ?? '' }));
  };

  const save = async () => {
    const iznos = Number(form.iznos || 0);
    const rabat = Number(form.rabat || 0);
    const total = rabatSmjer === 'oduzmi' ? iznos - rabat : iznos + rabat;
    if (!form.broj.trim() || !Number.isFinite(iznos) || !Number.isFinite(rabat) || iznos < 0 || rabat < 0 || total <= 0) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        gradiliste_id: form.gradiliste_id || null,
        investitor_id: form.investitor_id || null,
        broj: form.broj.trim(),
        kupac: form.kupac.trim() || null,
        iznos,
        rabat,
        datum_izdavanja: form.datum_izdavanja,
        datum_dospjecja: form.datum_dospjecja || null,
        datum_naplate: form.status === 'placena' ? form.datum_naplate || null : null,
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

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = items.filter((faktura) =>
    (!filterGradiliste || faktura.gradiliste_id === filterGradiliste)
    && (!filterInvestitor || faktura.investitor_id === filterInvestitor)
    && (!filterStatus || faktura.status === filterStatus)
    && (!od || faktura.datum_izdavanja >= od)
    && (!doDatuma || faktura.datum_izdavanja <= doDatuma)
    && (!normalizedQuery || [faktura.broj, faktura.kupac, faktura.gradilista?.naziv, faktura.investitori?.naziv]
      .some((value) => (value ?? '').toLocaleLowerCase().includes(normalizedQuery))),
  );
  const sortedItems = [...filtered].sort((first, second) => {
    const getValue = (faktura: Faktura): string | number | null => {
      switch (sortKey) {
        case 'broj': return faktura.broj;
        case 'gradiliste': return faktura.gradilista?.naziv ?? null;
        case 'investitor': return faktura.investitori?.naziv ?? faktura.kupac;
        case 'kupac': return faktura.kupac;
        case 'datum_izdavanja': return faktura.datum_izdavanja;
        case 'datum_dospjecja': return faktura.datum_dospjecja;
        case 'iznos': return iznosFakture(faktura);
        case 'status': return statusInfo[faktura.status].label;
      }
    };
    return compareSortValues(getValue(first), getValue(second), sortDirection);
  });
  const ukupno = filtered.reduce((sum, f) => sum + iznosFakture(f), 0);
  const ukupnoOsnovno = filtered.reduce((sum, f) => sum + f.iznos, 0);
  const ukupnoRabata = filtered.reduce((sum, f) => sum + (f.rabat ?? 0), 0);
  const placeno = filtered.filter((f) => f.status === 'placena').reduce((sum, f) => sum + iznosFakture(f), 0);
  const iznosZaSpremanje = Number(form.iznos || 0);
  const rabatZaSpremanje = Number(form.rabat || 0);
  const ukupnoZaSpremanje = rabatSmjer === 'oduzmi'
    ? iznosZaSpremanje - rabatZaSpremanje
    : iznosZaSpremanje + rabatZaSpremanje;
  const mozeSpremitiFakturu = Boolean(form.broj.trim())
    && Number.isFinite(iznosZaSpremanje)
    && Number.isFinite(rabatZaSpremanje)
    && iznosZaSpremanje >= 0
    && rabatZaSpremanje >= 0
    && ukupnoZaSpremanje > 0;
  const hasFilters = Boolean(query || filterGradiliste || filterInvestitor || filterStatus || od || doDatuma);
  const resetFilters = () => {
    setQuery('');
    setFilterGradiliste('');
    setFilterInvestitor('');
    setFilterStatus('');
    setOd('');
    setDoDatuma('');
  };

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
    <div className="min-w-0 max-w-full break-words">
      <div className="mb-6 flex min-w-0 flex-col items-stretch justify-between gap-3 xl:flex-row xl:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Fakture</h1>
          <p className="text-sm text-slate-500 mt-1">Izdane fakture po gradilištima</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center">
          <ExportMenu
            disabled={sortedItems.length === 0}
            build={() => ({
              file: 'Fakture',
              title: 'Fakture',
              rows: sortedItems,
              columns: [
                { header: 'Broj', get: (f: Faktura) => f.broj },
                { header: 'Gradilište', get: (f: Faktura) => f.gradilista?.naziv ?? '' },
                { header: 'Investitor', get: (f: Faktura) => f.investitori?.naziv ?? '' },
                { header: 'Kupac', get: (f: Faktura) => f.kupac ?? '' },
                { header: 'Izdana', kind: 'date', get: (f: Faktura) => f.datum_izdavanja },
                { header: 'Dospijeće', kind: 'date', get: (f: Faktura) => f.datum_dospjecja },
                { header: 'Status', get: (f: Faktura) => statusInfo[f.status].label },
                { header: 'Iznos', kind: 'eur', get: (f: Faktura) => f.iznos },
                { header: 'Rabat', kind: 'eur', get: (f: Faktura) => f.rabat ?? 0 },
                { header: 'Ukupno', kind: 'eur', get: (f: Faktura) => iznosFakture(f) },
              ],
              totals: { Iznos: filtered.reduce((sum, f) => sum + f.iznos, 0), Rabat: filtered.reduce((sum, f) => sum + (f.rabat ?? 0), 0), Ukupno: ukupno },
            })}
          />
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Nova faktura
          </button>
        </div>
      </div>

      {error && !modalOpen && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 flex min-w-0 flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center">
        <div className="relative min-w-0 xl:min-w-56 xl:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Traži broj, kupca ili gradilište…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm" />
        </div>
        <select value={filterInvestitor} onChange={(event) => setFilterInvestitor(event.target.value)} className="min-w-0 max-w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="">Svi investitori</option>
          {investitori.map((investitor) => <option key={investitor.id} value={investitor.id}>{investitor.naziv}</option>)}
        </select>
        <select value={filterGradiliste} onChange={(event) => setFilterGradiliste(event.target.value)} className="min-w-0 max-w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="">Sva gradilišta</option>
          {gradilista.map((g) => <option key={g.id} value={g.id}>{g.naziv}</option>)}
        </select>
        <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as '' | FakturaStatus)} className="min-w-0 max-w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="">Svi statusi</option>
          {Object.entries(statusInfo).map(([value, info]) => <option key={value} value={value}>{info.label}</option>)}
        </select>
        <input type="date" value={od} onChange={(event) => setOd(event.target.value)} title="Datum izdavanja od" aria-label="Datum izdavanja od" className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm" />
        <input type="date" value={doDatuma} onChange={(event) => setDoDatuma(event.target.value)} title="Datum izdavanja do" aria-label="Datum izdavanja do" className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm" />
        {hasFilters && <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /> Očisti</button>}
      </div>

      <div className="mb-6 flex min-w-0 flex-col gap-4 xl:flex-row xl:flex-wrap xl:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-white">
          <Euro className="h-5 w-5" />
          <span className="text-sm text-slate-300">Ukupno{hasFilters ? ' (filtrirano)' : ''}:</span>
          <span className="font-bold">
            {ukupno.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-white">
          <span className="text-sm text-emerald-200">Plaćeno:</span>
          <span className="font-bold">
            {placeno.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
          </span>
        </div>
        <span className="text-sm text-slate-500">{filtered.length} faktura</span>
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
        <div className="min-w-0 max-w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1200px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th aria-sort={sortKey === 'broj' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-left text-xs">
                  {sortHeader('broj', 'Broj')}
                </th>
                <th aria-sort={sortKey === 'gradiliste' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="min-w-48 px-5 py-3 text-left text-xs whitespace-nowrap">
                  {sortHeader('gradiliste', 'Gradilište')}
                </th>
                <th aria-sort={sortKey === 'investitor' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="min-w-56 px-5 py-3 text-left text-xs whitespace-nowrap">
                  {sortHeader('investitor', 'Investitor')}
                </th>
                <th aria-sort={sortKey === 'kupac' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="min-w-56 px-5 py-3 text-left text-xs whitespace-nowrap">
                  {sortHeader('kupac', 'Kupac')}
                </th>
                <th aria-sort={sortKey === 'datum_izdavanja' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-left text-xs">
                  {sortHeader('datum_izdavanja', 'Datum')}
                </th>
                <th aria-sort={sortKey === 'datum_dospjecja' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-left text-xs">
                  {sortHeader('datum_dospjecja', 'Dospjeće')}
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Iznos</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Rabat</th>
                <th aria-sort={sortKey === 'iznos' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-right text-xs">
                  {sortHeader('iznos', 'Ukupno')}
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
                    <td className="max-w-64 truncate whitespace-nowrap px-5 py-3.5 text-sm text-slate-600" title={f.gradilista?.naziv ?? '—'}>{f.gradilista?.naziv ?? '—'}</td>
                    <td className="max-w-72 truncate whitespace-nowrap px-5 py-3.5 text-sm text-slate-600" title={f.investitori?.naziv ?? '—'}>{f.investitori?.naziv ?? '—'}</td>
                    <td className="max-w-72 truncate whitespace-nowrap px-5 py-3.5 text-sm text-slate-600" title={f.kupac ?? '—'}>{f.kupac ?? '—'}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-500">
                      {new Date(f.datum_izdavanja + 'T00:00:00').toLocaleDateString('hr-HR')}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-500">
                      {f.datum_dospjecja ? new Date(f.datum_dospjecja + 'T00:00:00').toLocaleDateString('hr-HR') : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm text-slate-600">
                      {f.iznos.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm text-slate-600">
                      {(f.rabat ?? 0).toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm font-semibold text-slate-900">
                      {iznosFakture(f).toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
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
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-800">
                <td colSpan={6} className="px-5 py-3 text-sm">Ukupno ({filtered.length} faktura)</td>
                <td className="px-5 py-3 text-right text-sm">{ukupnoOsnovno.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}</td>
                <td className="px-5 py-3 text-right text-sm">{ukupnoRabata.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}</td>
                <td className="px-5 py-3 text-right text-sm font-bold">{ukupno.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
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
              disabled={saving || !mozeSpremitiFakturu}
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
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
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
          <Field label="Investitor">
            {newInv === null ? (
              <div className="flex min-w-0 flex-col gap-2 xl:flex-row">
                <Select value={form.investitor_id} onChange={(e) => handleInvestitorChange(e.target.value)}>
                  <option value="">— Odaberi investitora —</option>
                  {investitori.map((investitor) => <option key={investitor.id} value={investitor.id}>{investitor.naziv}</option>)}
                </Select>
                <button
                  type="button"
                  onClick={() => setNewInv('')}
                  className="shrink-0 rounded-lg border border-slate-200 px-3 text-sm font-medium text-sky-700 hover:bg-sky-50"
                >
                  + Novi
                </button>
              </div>
            ) : (
              <div className="flex min-w-0 flex-col gap-2 xl:flex-row">
                <TextInput
                  autoFocus
                  value={newInv}
                  onChange={(e) => setNewInv(e.target.value)}
                  placeholder="Naziv novog investitora"
                />
                <button
                  type="button"
                  onClick={addInvestitor}
                  disabled={!newInv.trim()}
                  className="shrink-0 rounded-lg bg-sky-600 px-3 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  Dodaj
                </button>
                <button
                  type="button"
                  onClick={() => setNewInv(null)}
                  className="shrink-0 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Odustani
                </button>
              </div>
            )}
          </Field>
          <Field label="Kupac na fakturi">
            <TextInput value={form.kupac} onChange={(event) => setForm({ ...form, kupac: event.target.value })} />
          </Field>
          <Field label="Osnovni iznos (EUR)">
            <TextInput
              type="number"
              min="0"
              step="0.01"
              value={form.iznos}
              onChange={(e) => setForm({ ...form, iznos: e.target.value })}
              placeholder="0.00"
            />
          </Field>
          <Field label={`Rabat (EUR, ${rabatSmjer === 'oduzmi' ? 'oduzima se' : 'pribraja se'})`}>
            <TextInput
              type="number"
              min="0"
              step="0.01"
              value={form.rabat}
              onChange={(e) => setForm({ ...form, rabat: e.target.value })}
              placeholder="0.00"
            />
          </Field>
          <p className="-mt-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
            Ukupna izlazna faktura: <strong>{(rabatSmjer === 'oduzmi'
              ? (Number(form.iznos) || 0) - (Number(form.rabat) || 0)
              : (Number(form.iznos) || 0) + (Number(form.rabat) || 0)
            ).toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}</strong>
          </p>
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
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
              onChange={(e) => {
                const status = e.target.value as FakturaStatus;
                setForm({
                  ...form,
                  status,
                  datum_naplate: status === 'placena' && !form.datum_naplate && editing?.status !== 'placena'
                    ? new Date().toISOString().slice(0, 10)
                    : form.datum_naplate,
                });
              }}
            >
              <option value="izdana">Izdana</option>
              <option value="placena">Plaćena</option>
            </Select>
          </Field>
          {form.status === 'placena' && (
            <Field label="Datum naplate">
              <TextInput
                type="date"
                value={form.datum_naplate}
                onChange={(e) => setForm({ ...form, datum_naplate: e.target.value })}
              />
            </Field>
          )}
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
