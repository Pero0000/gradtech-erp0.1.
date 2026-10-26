import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Building2, Pencil, Plus, RotateCcw, Search, Trash2, Users } from 'lucide-react';
import type { Faktura, Gradiliste, Investitor, Objekt, RadnoVrijeme, Trosak } from '@/types';
import {
  createInvestitor,
  deleteInvestitor,
  deleteObjekt,
  fetchAllObjekti,
  fetchFakture,
  fetchGradilista,
  fetchInvestitori,
  fetchRadnoVrijeme,
  fetchTroskovi,
  saveObjekt,
  updateInvestitor,
  iznosFakture,
} from '@/lib/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Field, Select, Textarea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ExportMenu } from '@/components/ui/ExportMenu';

const months = [
  'Siječanj',
  'Veljača',
  'Ožujak',
  'Travanj',
  'Svibanj',
  'Lipanj',
  'Srpanj',
  'Kolovoz',
  'Rujan',
  'Listopad',
  'Studeni',
  'Prosinac',
];

type InvestorSortKey = 'naziv' | 'objekti' | 'totalCosts' | 'invoiced' | 'difference' | 'created_at';
type ObjektSortKey = 'naziv' | 'investitor' | 'gradiliste' | 'datum_pocetka' | 'datum_zavrsetka' | 'naplaceno';
type SortDirection = 'asc' | 'desc';

interface GradilisteRow {
  gradiliste: Gradiliste;
  naplaceno: number;
}

const emptyInvestitorForm = {
  naziv: '',
  oib: '',
  adresa: '',
  mjesto: '',
  postanski_broj: '',
  kontakt_osoba: '',
  telefon: '',
  email: '',
  web: '',
  napomena: '',
};

const emptyObjektForm = {
  naziv: '',
  investitor_id: '',
  adresa: '',
  mjesto: '',
  postanski_broj: '',
  kontakt_osoba: '',
  telefon: '',
  napomena: '',
};

function compareValues(first: string | number | null, second: string | number | null, direction: SortDirection) {
  if (first === null || second === null) {
    if (first === second) return 0;
    return first === null ? 1 : -1;
  }

  const comparison = typeof first === 'number' && typeof second === 'number'
    ? first - second
    : String(first).localeCompare(String(second), 'hr', { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? comparison : -comparison;
}

function formatCurrency(value: number) {
  return value.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Greška pri učitavanju baze.';
}

export function InvestitoriView() {
  const [investitori, setInvestitori] = useState<Investitor[]>([]);
  const [objekti, setObjekti] = useState<Objekt[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [troskovi, setTroskovi] = useState<Trosak[]>([]);
  const [radnoVrijeme, setRadnoVrijeme] = useState<RadnoVrijeme[]>([]);
  const [fakture, setFakture] = useState<Faktura[]>([]);
  const [query, setQuery] = useState('');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<InvestorSortKey>('naziv');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Investitor | null>(null);
  const [form, setForm] = useState(emptyInvestitorForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Investitor | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchInvestitori(),
      fetchAllObjekti(),
      fetchGradilista(),
      fetchTroskovi(),
      fetchRadnoVrijeme(),
      fetchFakture(),
    ])
      .then(([nextInvestitori, nextObjekti, nextGradilista, nextTroskovi, nextRadnoVrijeme, nextFakture]) => {
        if (cancelled) return;
        setInvestitori(nextInvestitori);
        setObjekti(nextObjekti);
        setGradilista(nextGradilista);
        setTroskovi(nextTroskovi);
        setRadnoVrijeme(nextRadnoVrijeme);
        setFakture(nextFakture);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const years = Array.from(new Set(investitori.map((investitor) => investitor.created_at.slice(0, 4))))
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
  const filtered = investitori.filter((investitor) => {
    const addedDate = investitor.created_at.slice(0, 10);
    const searchText = [
      investitor.naziv,
      investitor.oib,
      investitor.adresa,
      investitor.mjesto,
      investitor.postanski_broj,
      investitor.kontakt_osoba,
      investitor.telefon,
      investitor.email,
      investitor.web,
      investitor.napomena,
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return searchText.includes(query.trim().toLocaleLowerCase())
      && (!year || addedDate.slice(0, 4) === year)
      && (!month || addedDate.slice(5, 7) === month)
      && (!dateFrom || addedDate >= dateFrom)
      && (!dateTo || addedDate <= dateTo);
  });
  const financesByInvestor = new Map(investitori.map((investitor) => {
    const objectIds = new Set(
      objekti.filter((objekt) => objekt.investitor_id === investitor.id).map((objekt) => objekt.id),
    );
    const siteIds = new Set(
      gradilista.filter((gradiliste) => gradiliste.objekt_id && objectIds.has(gradiliste.objekt_id)).map((gradiliste) => gradiliste.id),
    );
    const directCosts = troskovi
      .filter((trosak) => trosak.gradiliste_id && siteIds.has(trosak.gradiliste_id))
      .reduce((sum, trosak) => sum + trosak.iznos, 0);
    const laborCosts = radnoVrijeme
      .filter((entry) => entry.gradiliste_id && siteIds.has(entry.gradiliste_id))
      .reduce((sum, entry) => sum + entry.sati * (entry.radnici?.cijena_sata ?? 0), 0);
    const invoices = fakture.filter((faktura) => faktura.gradiliste_id && siteIds.has(faktura.gradiliste_id));
    const invoiced = invoices.reduce((sum, faktura) => sum + iznosFakture(faktura), 0);
    const paid = invoices
      .filter((faktura) => faktura.status === 'placena')
      .reduce((sum, faktura) => sum + iznosFakture(faktura), 0);
    const totalCosts = directCosts + laborCosts;

    return [investitor.id, {
      directCosts,
      laborCosts,
      totalCosts,
      invoiced,
      paid,
      unpaid: invoiced - paid,
      difference: invoiced - totalCosts,
    }] as const;
  }));
  const sortedInvestitori = [...filtered].sort((first, second) => {
    let comparison = 0;
    if (sortKey === 'naziv') {
      comparison = first.naziv.localeCompare(second.naziv, 'hr', { sensitivity: 'base' });
    } else if (sortKey === 'objekti') {
      const firstCount = objekti.filter((objekt) => objekt.investitor_id === first.id).length;
      const secondCount = objekti.filter((objekt) => objekt.investitor_id === second.id).length;
      comparison = firstCount - secondCount;
    } else if (sortKey === 'created_at') {
      comparison = first.created_at.localeCompare(second.created_at);
    } else {
      comparison = financesByInvestor.get(first.id)![sortKey] - financesByInvestor.get(second.id)![sortKey];
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });
  const hasFilters = Boolean(query || year || month || dateFrom || dateTo);

  const handleSort = (key: InvestorSortKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const sortHeader = (key: InvestorSortKey, label: string) => {
    const Icon = sortKey !== key ? ArrowUpDown : sortDirection === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => handleSort(key)}
        className="inline-flex items-center gap-1.5 font-semibold uppercase text-slate-500 hover:text-slate-900"
        aria-label={`Sortiraj po: ${label}`}
        title={`Sortiraj po: ${label}`}
      >
        {label}
        <Icon className="h-3.5 w-3.5" />
      </button>
    );
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyInvestitorForm);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (investitor: Investitor) => {
    setEditing(investitor);
    setForm({
      naziv: investitor.naziv,
      oib: investitor.oib ?? '',
      adresa: investitor.adresa ?? '',
      mjesto: investitor.mjesto ?? '',
      postanski_broj: investitor.postanski_broj ?? '',
      kontakt_osoba: investitor.kontakt_osoba ?? '',
      telefon: investitor.telefon ?? '',
      email: investitor.email ?? '',
      web: investitor.web ?? '',
      napomena: investitor.napomena ?? '',
    });
    setError(null);
    setModalOpen(true);
  };

  const saveInvestitor = async () => {
    if (!form.naziv.trim()) return;
    setSaving(true);
    setError(null);
    const payload = {
      naziv: form.naziv.trim(),
      oib: form.oib.trim() || null,
      adresa: form.adresa.trim() || null,
      mjesto: form.mjesto.trim() || null,
      postanski_broj: form.postanski_broj.trim() || null,
      kontakt_osoba: form.kontakt_osoba.trim() || null,
      telefon: form.telefon.trim() || null,
      email: form.email.trim() || null,
      web: form.web.trim() || null,
      napomena: form.napomena.trim() || null,
    };
    try {
      const saved = editing
        ? await updateInvestitor(editing.id, payload)
        : await createInvestitor(payload);
      setInvestitori((current) => [...current.filter((item) => item.id !== saved.id), saved]
        .sort((first, second) => first.naziv.localeCompare(second.naziv, 'hr', { sensitivity: 'base' })));
      setModalOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const removeInvestitor = async () => {
    if (!deleteTarget) return;
    setError(null);
    try {
      await deleteInvestitor(deleteTarget.id);
      setInvestitori((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  return (
    <div className="min-w-0 max-w-full">
      <div className="mb-6 flex min-w-0 flex-col items-stretch justify-between gap-4 xl:flex-row xl:flex-wrap xl:items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Investitori</h1>
          <p className="mt-1 text-sm text-slate-500">Financije po investitoru: fakture, troškovi i rad; filtriranje po datumu dodavanja</p>
        </div>
        <div className="flex min-w-0 w-full flex-col gap-3 xl:w-auto xl:flex-row xl:flex-wrap xl:items-end xl:justify-end">
          <div className="relative min-w-0 w-full xl:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <TextInput
              aria-label="Pretraži investitore"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pretraži investitore"
              className="pl-9"
            />
          </div>
          <ExportMenu
            disabled={sortedInvestitori.length === 0}
            build={() => ({
              file: 'Investitori',
              title: 'Investitori',
              rows: sortedInvestitori,
              columns: [
                { header: 'Naziv', get: (i: Investitor) => i.naziv },
                { header: 'OIB', get: (i: Investitor) => i.oib ?? '' },
                { header: 'Adresa', get: (i: Investitor) => [i.adresa, i.postanski_broj, i.mjesto].filter(Boolean).join(', ') },
                { header: 'Kontakt', get: (i: Investitor) => i.kontakt_osoba ?? '' },
                { header: 'Telefon', get: (i: Investitor) => i.telefon ?? '' },
                { header: 'Email', get: (i: Investitor) => i.email ?? '' },
                { header: 'Objekata', kind: 'num', get: (i: Investitor) => objekti.filter((o) => o.investitor_id === i.id).length },
                { header: 'Troškovi', kind: 'eur', get: (i: Investitor) => financesByInvestor.get(i.id)?.totalCosts ?? 0 },
                { header: 'Fakturirano', kind: 'eur', get: (i: Investitor) => financesByInvestor.get(i.id)?.invoiced ?? 0 },
                { header: 'Razlika', kind: 'eur', get: (i: Investitor) => financesByInvestor.get(i.id)?.difference ?? 0 },
              ],
            })}
          />
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-700"
          >
            <Plus className="h-4 w-4" />
            Novi investitor
          </button>
        </div>
      </div>

      <div className="mb-5 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <Field label="Godina">
          <Select value={year} onChange={(event) => setYear(event.target.value)}>
            <option value="">Sve godine</option>
            {years.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>
        <Field label="Mjesec">
          <Select value={month} onChange={(event) => setMonth(event.target.value)}>
            <option value="">Svi mjeseci</option>
            {months.map((item, index) => (
              <option key={item} value={String(index + 1).padStart(2, '0')}>{item}</option>
            ))}
          </Select>
        </Field>
        <Field label="Datum od">
          <TextInput type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </Field>
        <Field label="Datum do">
          <TextInput type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </Field>
        <button
          type="button"
          onClick={() => {
            setQuery('');
            setYear('');
            setMonth('');
            setDateFrom('');
            setDateTo('');
          }}
          disabled={!hasFilters}
          className="inline-flex items-center justify-center gap-2 self-end rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Očisti filtre"
          title="Očisti filtre"
        >
          <RotateCcw className="h-4 w-4" />
          Očisti
        </button>
      </div>

      <p className="mb-3 text-xs text-slate-500">Prikazano {filtered.length} od {investitori.length} investitora</p>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {investitori.length === 0 ? (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="Nema investitora"
          description="Dodajte investitora sa svim poslovnim i kontakt podacima."
          action={
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700"
            >
              <Plus className="h-4 w-4" />
              Novi investitor
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">Nema investitora za zadanu pretragu.</p>
      ) : (
        <div className="min-w-0 max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[72rem]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th aria-sort={sortKey === 'naziv' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-left text-xs">
                  {sortHeader('naziv', 'Investitor')}
                </th>
                <th aria-sort={sortKey === 'objekti' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-right text-xs">
                  {sortHeader('objekti', 'Objekti')}
                </th>
                <th aria-sort={sortKey === 'totalCosts' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-right text-xs">
                  {sortHeader('totalCosts', 'Ukupni troškovi')}
                </th>
                <th aria-sort={sortKey === 'invoiced' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-right text-xs">
                  {sortHeader('invoiced', 'Fakture')}
                </th>
                <th aria-sort={sortKey === 'difference' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-right text-xs">
                  {sortHeader('difference', 'Razlika')}
                </th>
                <th aria-sort={sortKey === 'created_at' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-right text-xs">
                  {sortHeader('created_at', 'Dodano')}
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-slate-500">Akcije</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedInvestitori.map((investitor) => {
                const finances = financesByInvestor.get(investitor.id)!;
                return (
                  <tr key={investitor.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5 text-sm text-slate-700">
                      <div className="font-medium text-slate-900">{investitor.naziv}</div>
                      {investitor.oib && <div className="mt-1 text-xs text-slate-500">OIB: {investitor.oib}</div>}
                      {(investitor.adresa || investitor.mjesto || investitor.postanski_broj) && (
                        <div className="mt-1 text-xs text-slate-500">
                          {[investitor.adresa, investitor.postanski_broj, investitor.mjesto].filter(Boolean).join(', ')}
                        </div>
                      )}
                      {(investitor.kontakt_osoba || investitor.telefon || investitor.email) && (
                        <div className="mt-1 text-xs text-slate-500">
                          {[investitor.kontakt_osoba, investitor.telefon, investitor.email].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm text-slate-600">
                      {objekti.filter((objekt) => objekt.investitor_id === investitor.id).length}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm font-medium text-slate-900">
                      {formatCurrency(finances.totalCosts)}
                      <p className="mt-1 text-xs font-normal text-slate-500">
                        Evidentirani: {formatCurrency(finances.directCosts)} · Rad: {formatCurrency(finances.laborCosts)}
                      </p>
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm font-medium text-slate-900">
                      {formatCurrency(finances.invoiced)}
                      <p className="mt-1 text-xs font-normal text-slate-500">
                        Plaćeno: {formatCurrency(finances.paid)} · Neplaćeno: {formatCurrency(finances.unpaid)}
                      </p>
                    </td>
                    <td className={`px-5 py-3.5 text-right text-sm font-semibold ${finances.difference >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {formatCurrency(finances.difference)}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm text-slate-500">
                      {new Date(investitor.created_at).toLocaleDateString('hr-HR')}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(investitor)}
                          aria-label={`Uredi investitora ${investitor.naziv}`}
                          title="Uredi investitora"
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-sky-600"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(investitor)}
                          aria-label={`Izbriši investitora ${investitor.naziv}`}
                          title="Izbriši investitora"
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600"
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
        title={editing ? 'Uredi investitora' : 'Novi investitor'}
        footer={
          <>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              Odustani
            </button>
            <button
              type="submit"
              form="investitor-form"
              disabled={saving || !form.naziv.trim()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
            >
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        }
      >
        <form
          id="investitor-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveInvestitor();
          }}
        >
          <Field label="Naziv investitora *">
            <TextInput value={form.naziv} onChange={(event) => setForm({ ...form, naziv: event.target.value })} autoFocus />
          </Field>
          <Field label="OIB">
            <TextInput value={form.oib} onChange={(event) => setForm({ ...form, oib: event.target.value })} />
          </Field>
          <Field label="Adresa">
            <TextInput value={form.adresa} onChange={(event) => setForm({ ...form, adresa: event.target.value })} />
          </Field>
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <Field label="Poštanski broj">
              <TextInput value={form.postanski_broj} onChange={(event) => setForm({ ...form, postanski_broj: event.target.value })} />
            </Field>
            <Field label="Mjesto">
              <TextInput value={form.mjesto} onChange={(event) => setForm({ ...form, mjesto: event.target.value })} />
            </Field>
          </div>
          <Field label="Kontakt osoba">
            <TextInput value={form.kontakt_osoba} onChange={(event) => setForm({ ...form, kontakt_osoba: event.target.value })} />
          </Field>
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <Field label="Telefon">
              <TextInput type="tel" value={form.telefon} onChange={(event) => setForm({ ...form, telefon: event.target.value })} />
            </Field>
            <Field label="E-pošta">
              <TextInput type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </Field>
          </div>
          <Field label="Web-stranica">
            <TextInput type="url" value={form.web} onChange={(event) => setForm({ ...form, web: event.target.value })} placeholder="https://" />
          </Field>
          <Field label="Napomena">
            <Textarea rows={3} value={form.napomena} onChange={(event) => setForm({ ...form, napomena: event.target.value })} />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeInvestitor}
        title="Izbrisati investitora?"
        message="Investitora je moguće izbrisati samo ako nema povezane objekte."
      />
    </div>
  );
}

export function ObjektiView() {
  const [objekti, setObjekti] = useState<Objekt[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [fakture, setFakture] = useState<Faktura[]>([]);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<ObjektSortKey>('naziv');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [investitori, setInvestitori] = useState<Investitor[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Objekt | null>(null);
  const [form, setForm] = useState(emptyObjektForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Objekt | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAllObjekti(), fetchGradilista(), fetchFakture(), fetchInvestitori()])
      .then(([nextObjekti, nextGradilista, nextFakture, nextInvestitori]) => {
        if (cancelled) return;
        setObjekti(nextObjekti);
        setGradilista(nextGradilista);
        setFakture(nextFakture);
        setInvestitori(nextInvestitori);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const gradilistaPoObjektu = new Map<string, Gradiliste[]>();
  for (const gradiliste of gradilista) {
    if (!gradiliste.objekt_id) continue;
    const related = gradilistaPoObjektu.get(gradiliste.objekt_id) ?? [];
    related.push(gradiliste);
    gradilistaPoObjektu.set(gradiliste.objekt_id, related);
  }

  const naplacenoPoGradilistu = fakture.reduce<Record<string, number>>((totals, faktura) => {
    if (faktura.status === 'placena' && faktura.gradiliste_id) {
      totals[faktura.gradiliste_id] = (totals[faktura.gradiliste_id] ?? 0) + iznosFakture(faktura);
    }
    return totals;
  }, {});

  const redoviPoObjektu = new Map<string, GradilisteRow[]>();
  for (const objekt of objekti) {
    const rows = (gradilistaPoObjektu.get(objekt.id) ?? []).map((gradiliste) => ({
      gradiliste,
      naplaceno: naplacenoPoGradilistu[gradiliste.id] ?? 0,
    }));
    const siteSortKey: ObjektSortKey = sortKey === 'naziv' || sortKey === 'investitor' ? 'gradiliste' : sortKey;
    rows.sort((first, second) => {
      const firstValue = siteSortKey === 'gradiliste'
        ? first.gradiliste.naziv
        : siteSortKey === 'datum_pocetka'
          ? first.gradiliste.datum_pocetka
          : siteSortKey === 'datum_zavrsetka'
            ? first.gradiliste.datum_zavrsetka
            : first.naplaceno;
      const secondValue = siteSortKey === 'gradiliste'
        ? second.gradiliste.naziv
        : siteSortKey === 'datum_pocetka'
          ? second.gradiliste.datum_pocetka
          : siteSortKey === 'datum_zavrsetka'
            ? second.gradiliste.datum_zavrsetka
            : second.naplaceno;
      return compareValues(firstValue, secondValue, sortKey === 'naziv' || sortKey === 'investitor' ? 'asc' : sortDirection);
    });
    redoviPoObjektu.set(objekt.id, rows);
  }

  const filtered = objekti.filter((objekt) => {
    const siteNames = (gradilistaPoObjektu.get(objekt.id) ?? []).map((site) => site.naziv).join(' ');
    return `${objekt.naziv} ${objekt.investitori?.naziv ?? ''} ${siteNames} ${[objekt.adresa, objekt.mjesto, objekt.postanski_broj, objekt.kontakt_osoba, objekt.telefon, objekt.napomena].filter(Boolean).join(' ')}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
  });
  const sortedObjekti = [...filtered].sort((first, second) => {
    if (sortKey === 'naziv') {
      return compareValues(first.naziv, second.naziv, sortDirection);
    }
    if (sortKey === 'investitor') {
      return compareValues(first.investitori?.naziv ?? null, second.investitori?.naziv ?? null, sortDirection);
    }

    const firstRows = redoviPoObjektu.get(first.id) ?? [];
    const secondRows = redoviPoObjektu.get(second.id) ?? [];
    const firstValue = sortKey === 'naplaceno'
      ? firstRows.reduce((sum, row) => sum + row.naplaceno, 0)
      : firstRows[0]
        ? sortKey === 'gradiliste'
          ? firstRows[0].gradiliste.naziv
          : sortKey === 'datum_pocetka'
            ? firstRows[0].gradiliste.datum_pocetka
            : firstRows[0].gradiliste.datum_zavrsetka
        : null;
    const secondValue = sortKey === 'naplaceno'
      ? secondRows.reduce((sum, row) => sum + row.naplaceno, 0)
      : secondRows[0]
        ? sortKey === 'gradiliste'
          ? secondRows[0].gradiliste.naziv
          : sortKey === 'datum_pocetka'
            ? secondRows[0].gradiliste.datum_pocetka
            : secondRows[0].gradiliste.datum_zavrsetka
        : null;
    return compareValues(firstValue, secondValue, sortDirection);
  });

  const handleSort = (key: ObjektSortKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const sortHeader = (key: ObjektSortKey, label: string) => {
    const Icon = sortKey !== key ? ArrowUpDown : sortDirection === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => handleSort(key)}
        className="inline-flex items-center gap-1.5 font-semibold uppercase text-slate-500 hover:text-slate-900"
        aria-label={`Sortiraj po: ${label}`}
        title={`Sortiraj po: ${label}`}
      >
        {label}
        <Icon className="h-3.5 w-3.5" />
      </button>
    );
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyObjektForm);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (objekt: Objekt) => {
    setEditing(objekt);
    setForm({
      naziv: objekt.naziv,
      investitor_id: objekt.investitor_id ?? '',
      adresa: objekt.adresa ?? '',
      mjesto: objekt.mjesto ?? '',
      postanski_broj: objekt.postanski_broj ?? '',
      kontakt_osoba: objekt.kontakt_osoba ?? '',
      telefon: objekt.telefon ?? '',
      napomena: objekt.napomena ?? '',
    });
    setError(null);
    setModalOpen(true);
  };

  const submitObjekt = async () => {
    if (!form.naziv.trim() || !form.investitor_id) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveObjekt(editing?.id ?? null, {
        naziv: form.naziv.trim(),
        investitor_id: form.investitor_id,
        adresa: form.adresa.trim() || null,
        mjesto: form.mjesto.trim() || null,
        postanski_broj: form.postanski_broj.trim() || null,
        kontakt_osoba: form.kontakt_osoba.trim() || null,
        telefon: form.telefon.trim() || null,
        napomena: form.napomena.trim() || null,
      });
      setObjekti((current) => [...current.filter((item) => item.id !== saved.id), saved]
        .sort((first, second) => first.naziv.localeCompare(second.naziv, 'hr', { sensitivity: 'base' })));
      setModalOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const removeObjekt = async () => {
    if (!deleteTarget) return;
    setError(null);
    try {
      await deleteObjekt(deleteTarget.id);
      setObjekti((current) => current.filter((item) => item.id !== deleteTarget.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDeleteTarget(null);
    }
  };

  const actionButtons = (objekt: Objekt) => (
    <div className="flex justify-end gap-1">
      <button
        type="button"
        onClick={() => openEdit(objekt)}
        aria-label={`Uredi objekt ${objekt.naziv}`}
        title="Uredi objekt"
        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-sky-600"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setDeleteTarget(objekt)}
        aria-label={`Izbriši objekt ${objekt.naziv}`}
        title="Izbriši objekt"
        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );

  const objektDetails = (objekt: Objekt) => (
    <>
      <div>{objekt.naziv}</div>
      {(objekt.adresa || objekt.mjesto || objekt.postanski_broj) && (
        <div className="mt-1 text-xs font-normal text-slate-500">
          {[objekt.adresa, objekt.postanski_broj, objekt.mjesto].filter(Boolean).join(', ')}
        </div>
      )}
      {(objekt.kontakt_osoba || objekt.telefon) && (
        <div className="mt-1 text-xs font-normal text-slate-500">
          {[objekt.kontakt_osoba, objekt.telefon].filter(Boolean).join(' · ')}
        </div>
      )}
    </>
  );

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  return (
    <div className="min-w-0 max-w-full">
      <div className="mb-6 flex min-w-0 flex-col items-stretch justify-between gap-4 xl:flex-row xl:flex-wrap xl:items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Objekti</h1>
          <p className="mt-1 text-sm text-slate-500">Gradilišta, termini i naplaćene fakture po objektu</p>
        </div>
        <div className="flex min-w-0 w-full flex-col gap-3 xl:w-auto xl:flex-row xl:flex-wrap xl:items-end xl:justify-end">
          <div className="relative min-w-0 w-full xl:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <TextInput
              aria-label="Pretraži objekte"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pretraži objekte ili investitore"
              className="pl-9"
            />
          </div>
          <ExportMenu
            disabled={sortedObjekti.length === 0}
            build={() => ({
              file: 'Objekti',
              title: 'Objekti',
              rows: sortedObjekti,
              columns: [
                { header: 'Objekt', get: (o: Objekt) => o.naziv },
                { header: 'Investitor', get: (o: Objekt) => o.investitori?.naziv ?? '' },
                { header: 'Adresa', get: (o: Objekt) => [o.adresa, o.postanski_broj, o.mjesto].filter(Boolean).join(', ') },
                { header: 'Kontakt', get: (o: Objekt) => o.kontakt_osoba ?? '' },
                { header: 'Telefon', get: (o: Objekt) => o.telefon ?? '' },
                { header: 'Gradilišta', get: (o: Objekt) => (gradilistaPoObjektu.get(o.id) ?? []).map((g) => g.naziv).join('; ') },
                { header: 'Naplaćeno', kind: 'eur', get: (o: Objekt) => (redoviPoObjektu.get(o.id) ?? []).reduce((s, r) => s + r.naplaceno, 0) },
              ],
            })}
          />
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-700"
          >
            <Plus className="h-4 w-4" />
            Novi objekt
          </button>
        </div>
      </div>

      {error && !modalOpen && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {objekti.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-7 w-7" />}
          title="Nema objekata"
          description="Dodajte objekt i povežite ga s investitorom."
          action={
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700"
            >
              <Plus className="h-4 w-4" />
              Novi objekt
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">Nema objekata za zadanu pretragu.</p>
      ) : (
        <div className="min-w-0 max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[64rem]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th aria-sort={sortKey === 'naziv' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-left text-xs">
                  {sortHeader('naziv', 'Objekt')}
                </th>
                <th aria-sort={sortKey === 'investitor' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-left text-xs">
                  {sortHeader('investitor', 'Investitor')}
                </th>
                <th aria-sort={sortKey === 'gradiliste' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-left text-xs">
                  {sortHeader('gradiliste', 'Gradilište')}
                </th>
                <th aria-sort={sortKey === 'datum_pocetka' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-right text-xs">
                  {sortHeader('datum_pocetka', 'Početak')}
                </th>
                <th aria-sort={sortKey === 'datum_zavrsetka' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-right text-xs">
                  {sortHeader('datum_zavrsetka', 'Završetak')}
                </th>
                <th aria-sort={sortKey === 'naplaceno' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-right text-xs">
                  {sortHeader('naplaceno', 'Naplaćeno')}
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-slate-500">Akcije</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedObjekti.map((objekt) => {
                const relatedGradilista = redoviPoObjektu.get(objekt.id) ?? [];
                if (relatedGradilista.length === 0) {
                  return (
                    <tr key={objekt.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3.5 text-sm font-medium text-slate-900">{objektDetails(objekt)}</td>
                      <td className="px-5 py-3.5 text-sm text-slate-600">{objekt.investitori?.naziv ?? 'Bez investitora'}</td>
                      <td colSpan={4} className="px-5 py-3.5 text-sm text-slate-400">Nema povezanih gradilišta</td>
                      <td className="px-5 py-3.5">{actionButtons(objekt)}</td>
                    </tr>
                  );
                }

                return relatedGradilista.map(({ gradiliste, naplaceno }, index) => (
                  <tr key={`${objekt.id}-${gradiliste.id}`} className="hover:bg-slate-50">
                    {index === 0 && (
                      <>
                        <td rowSpan={relatedGradilista.length} className="border-r border-slate-100 px-5 py-3.5 align-top text-sm font-medium text-slate-900">
                          {objektDetails(objekt)}
                        </td>
                        <td rowSpan={relatedGradilista.length} className="border-r border-slate-100 px-5 py-3.5 align-top text-sm text-slate-600">
                          {objekt.investitori?.naziv ?? 'Bez investitora'}
                        </td>
                      </>
                    )}
                    <td className="px-5 py-3.5 text-sm font-medium text-slate-900">{gradiliste.naziv}</td>
                    <td className="px-5 py-3.5 text-right text-sm text-slate-600">
                      {gradiliste.datum_pocetka ? new Date(gradiliste.datum_pocetka).toLocaleDateString('hr-HR') : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm text-slate-600">
                      {gradiliste.datum_zavrsetka ? new Date(gradiliste.datum_zavrsetka).toLocaleDateString('hr-HR') : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm font-medium text-slate-900">
                      {formatCurrency(naplaceno)}
                    </td>
                    {index === 0 && (
                      <td rowSpan={relatedGradilista.length} className="border-l border-slate-100 px-5 py-3.5 align-top">
                        {actionButtons(objekt)}
                      </td>
                    )}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Uredi objekt' : 'Novi objekt'}
        footer={
          <>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              Odustani
            </button>
            <button
              type="submit"
              form="objekt-form"
              disabled={saving || !form.naziv.trim() || !form.investitor_id}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
            >
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        }
      >
        <form
          id="objekt-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submitObjekt();
          }}
        >
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <Field label="Naziv objekta *">
            <TextInput value={form.naziv} onChange={(event) => setForm({ ...form, naziv: event.target.value })} autoFocus />
          </Field>
          <Field label="Investitor *">
            <Select value={form.investitor_id} onChange={(event) => setForm({ ...form, investitor_id: event.target.value })}>
              <option value="">Odaberi investitora</option>
              {investitori.map((item) => <option key={item.id} value={item.id}>{item.naziv}</option>)}
            </Select>
          </Field>
          <Field label="Adresa">
            <TextInput value={form.adresa} onChange={(event) => setForm({ ...form, adresa: event.target.value })} />
          </Field>
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <Field label="Poštanski broj">
              <TextInput value={form.postanski_broj} onChange={(event) => setForm({ ...form, postanski_broj: event.target.value })} />
            </Field>
            <Field label="Mjesto">
              <TextInput value={form.mjesto} onChange={(event) => setForm({ ...form, mjesto: event.target.value })} />
            </Field>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <Field label="Kontakt osoba">
              <TextInput value={form.kontakt_osoba} onChange={(event) => setForm({ ...form, kontakt_osoba: event.target.value })} />
            </Field>
            <Field label="Telefon">
              <TextInput type="tel" value={form.telefon} onChange={(event) => setForm({ ...form, telefon: event.target.value })} />
            </Field>
          </div>
          <Field label="Napomena">
            <Textarea rows={3} value={form.napomena} onChange={(event) => setForm({ ...form, napomena: event.target.value })} />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeObjekt}
        title="Izbrisati objekt?"
        message="Objekt je moguće izbrisati samo ako nema povezana gradilišta."
      />
    </div>
  );
}