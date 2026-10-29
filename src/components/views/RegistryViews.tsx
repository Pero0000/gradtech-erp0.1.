import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Building2, Pencil, Plus, RotateCcw, Search, Trash2, Users } from 'lucide-react';
import type { Faktura, Gradiliste, Investitor, InvestitorKontakt, Objekt, RadniNalog, RadnoVrijeme, Trosak } from '@/types';
import {
  createInvestitor,
  deleteInvestitor,
  deleteObjekt,
  fetchAllObjekti,
  fetchFakture,
  fetchGradilista,
  fetchInvestitori,
  fetchInvestitorKontakti,
  saveInvestitorKontakt,
  deleteInvestitorKontakt,
  fetchRadniNalozi,
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

function formatDate(value: string | null | undefined) {
  return value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('hr-HR') : '—';
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
  const [nalozi, setNalozi] = useState<RadniNalog[]>([]);
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
  const [selectedInvestor, setSelectedInvestor] = useState<Investitor | null>(null);
  const [investorContacts, setInvestorContacts] = useState<InvestitorKontakt[]>([]);
  const [contactEditing, setContactEditing] = useState<InvestitorKontakt | null>(null);
  const [contactForm, setContactForm] = useState({ uloga: '', ime: '', telefon: '', email: '', napomena: '' });
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactSaving, setContactSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchInvestitori(),
      fetchAllObjekti(),
      fetchGradilista(),
      fetchTroskovi(),
      fetchRadnoVrijeme(),
      fetchFakture(),
      fetchRadniNalozi(),
    ])
      .then(([nextInvestitori, nextObjekti, nextGradilista, nextTroskovi, nextRadnoVrijeme, nextFakture, nextNalozi]) => {
        if (cancelled) return;
        setInvestitori(nextInvestitori);
        setObjekti(nextObjekti);
        setGradilista(nextGradilista);
        setTroskovi(nextTroskovi);
        setRadnoVrijeme(nextRadnoVrijeme);
        setNalozi(nextNalozi);
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
    const investorSites = gradilista.filter((gradiliste) => siteIds.has(gradiliste.id));
    const invoices = fakture.filter((faktura) =>
      (faktura.gradiliste_id !== null && siteIds.has(faktura.gradiliste_id))
      || (faktura.investitor_id === investitor.id && !faktura.gradiliste_id));
    const invoiced = invoices.reduce((sum, faktura) => sum + iznosFakture(faktura), 0);
    const paid = invoices
      .filter((faktura) => faktura.status === 'placena')
      .reduce((sum, faktura) => sum + iznosFakture(faktura), 0);
    const totalCosts = directCosts + laborCosts;
    const investorObjects = objekti.filter((objekt) => objekt.investitor_id === investitor.id);
    const relevantSites = investorSites;
    const startedDates = relevantSites.map((site) => site.datum_pocetka).filter((date): date is string => Boolean(date)).sort();
    const latestSite = [...relevantSites].filter((site) => site.status === 'zavrseno' || site.status === 'neplaceno').sort((a, b) =>
      (b.datum_zavrsetka ?? b.datum_pocetka ?? '').localeCompare(a.datum_zavrsetka ?? a.datum_pocetka ?? ''),
    )[0] ?? null;
    const latestInvoice = [...invoices].sort((a, b) => b.datum_izdavanja.localeCompare(a.datum_izdavanja))[0] ?? null;
    const latestPaidInvoice = [...invoices]
      .filter((invoice) => invoice.status === 'placena' && invoice.datum_naplate)
      .sort((a, b) => (b.datum_naplate ?? '').localeCompare(a.datum_naplate ?? ''))[0] ?? null;
    const latestOrder = nalozi
      .filter((nalog) => nalog.gradiliste_id && siteIds.has(nalog.gradiliste_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
    const activityDates = [
      ...relevantSites.flatMap((site) => [site.datum_zavrsetka, site.datum_pocetka]),
      ...invoices.map((invoice) => invoice.datum_izdavanja),
      ...troskovi.filter((expense) => expense.gradiliste_id && siteIds.has(expense.gradiliste_id)).map((expense) => expense.datum),
      latestOrder?.created_at,
    ].filter((date): date is string => Boolean(date)).sort();
    const lastActivity = activityDates.length ? activityDates[activityDates.length - 1] : null;

    return [investitor.id, {
      directCosts,
      laborCosts,
      totalCosts,
      invoiced,
      paid,
      unpaid: invoiced - paid,
      difference: invoiced - totalCosts,
      objectCount: investorObjects.length,
      siteCount: relevantSites.length,
      activeSites: relevantSites.filter((site) => site.status === 'aktivno').length,
      completedSites: relevantSites.filter((site) => site.status === 'zavrseno' || site.status === 'neplaceno').length,
      margin: invoiced > 0 ? ((invoiced - totalCosts) / invoiced) * 100 : null,
      collaborationStart: startedDates[0] ?? null,
      latestSite,
      latestInvoice,
      latestPaidInvoice,
      latestOrder,
      lastActivity,
      objectIds,
      siteIds,
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

  const openInvestorOverview = async (investitor: Investitor) => {
    setSelectedInvestor(investitor);
    setContactError(null);
    setContactEditing(null);
    setContactForm({ uloga: '', ime: '', telefon: '', email: '', napomena: '' });
    try {
      setInvestorContacts(await fetchInvestitorKontakti(investitor.id));
    } catch (e) {
      setContactError(errorMessage(e));
      setInvestorContacts([]);
    }
  };

  const submitContact = async () => {
    if (!selectedInvestor || !contactForm.uloga.trim() || !contactForm.ime.trim()) return;
    setContactSaving(true);
    setContactError(null);
    try {
      const saved = await saveInvestitorKontakt(selectedInvestor.id, {
        uloga: contactForm.uloga.trim(),
        ime: contactForm.ime.trim(),
        telefon: contactForm.telefon.trim() || null,
        email: contactForm.email.trim() || null,
        napomena: contactForm.napomena.trim() || null,
      }, contactEditing?.id);
      setInvestorContacts((current) => [...current.filter((item) => item.id !== saved.id), saved]
        .sort((a, b) => a.uloga.localeCompare(b.uloga, 'hr') || a.ime.localeCompare(b.ime, 'hr')));
      setContactEditing(null);
      setContactForm({ uloga: '', ime: '', telefon: '', email: '', napomena: '' });
    } catch (e) {
      setContactError(errorMessage(e));
    } finally {
      setContactSaving(false);
    }
  };

  const removeContact = async (kontakt: InvestitorKontakt) => {
    setContactError(null);
    try {
      await deleteInvestitorKontakt(kontakt.id);
      setInvestorContacts((current) => current.filter((item) => item.id !== kontakt.id));
      if (contactEditing?.id === kontakt.id) {
        setContactEditing(null);
        setContactForm({ uloga: '', ime: '', telefon: '', email: '', napomena: '' });
      }
    } catch (e) {
      setContactError(errorMessage(e));
    }
  };

  const selectedInvestorFinances = selectedInvestor ? financesByInvestor.get(selectedInvestor.id) : undefined;
  const selectedInvestorObjects = selectedInvestor
    ? objekti.filter((objekt) => objekt.investitor_id === selectedInvestor.id).map((objekt) => {
      const objectSites = gradilista.filter((site) => site.objekt_id === objekt.id);
      const objectSiteIds = new Set(objectSites.map((site) => site.id));
      const invoices = fakture.filter((invoice) => invoice.gradiliste_id && objectSiteIds.has(invoice.gradiliste_id));
      const objectLastActivity = [
        ...objectSites.flatMap((site) => [site.datum_pocetka, site.datum_zavrsetka]),
        ...invoices.map((invoice) => invoice.datum_izdavanja),
        ...troskovi.filter((expense) => expense.gradiliste_id && objectSiteIds.has(expense.gradiliste_id)).map((expense) => expense.datum),
        ...nalozi.filter((order) => order.gradiliste_id && objectSiteIds.has(order.gradiliste_id)).map((order) => order.created_at),
      ].filter((date): date is string => Boolean(date)).sort().pop() ?? null;
      return {
        objekt,
        sites: objectSites,
        activeCount: objectSites.filter((site) => site.status === 'aktivno').length,
        invoiced: invoices.reduce((sum, invoice) => sum + iznosFakture(invoice), 0),
        lastActivity: objectLastActivity,
      };
    }).sort((a, b) => a.objekt.naziv.localeCompare(b.objekt.naziv, 'hr', { sensitivity: 'base' }))
    : [];
  const selectedInvestorSiteIds = new Set(
    selectedInvestor ? gradilista.filter((site) => site.objekt_id && objekti.some((object) => object.id === site.objekt_id && object.investitor_id === selectedInvestor.id)).map((site) => site.id) : [],
  );
  const selectedInvestorLastWorkOrder = selectedInvestor
    ? nalozi.filter((order) => order.gradiliste_id && selectedInvestorSiteIds.has(order.gradiliste_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
    : null;

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  return (
    <div className="min-w-0 max-w-full">
      <div className="mb-6 flex min-w-0 flex-col items-stretch justify-between gap-4 xl:flex-row xl:flex-wrap xl:items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Investitori</h1>
          <p className="mt-1 text-sm text-slate-500">Sažetak poslovnog odnosa, naplate i objekata po investitoru</p>
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
                      <button
                        type="button"
                        onClick={() => void openInvestorOverview(investitor)}
                        className="text-left font-semibold text-sky-700 hover:text-sky-900 hover:underline"
                      >
                        {investitor.naziv}
                      </button>
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
        open={selectedInvestor !== null}
        onClose={() => setSelectedInvestor(null)}
        title={selectedInvestor?.naziv ?? 'Investitor'}
        wide
      >
        {selectedInvestor && selectedInvestorFinances && (
          <div className="space-y-5">
            <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Objekata', selectedInvestorFinances.objectCount],
                ['Gradilišta', selectedInvestorFinances.siteCount],
                ['Aktivna gradilišta', selectedInvestorFinances.activeSites],
                ['Završena gradilišta', selectedInvestorFinances.completedSites],
                ['Fakturirano', formatCurrency(selectedInvestorFinances.invoiced)],
                ['Naplaćeno', formatCurrency(selectedInvestorFinances.paid)],
                ['Otvoreno za naplatu', formatCurrency(selectedInvestorFinances.unpaid)],
                ['Prosječna marža', selectedInvestorFinances.margin === null ? '—' : `${selectedInvestorFinances.margin.toFixed(1)} %`],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{value}</p>
                </div>
              ))}
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Odnos s investitorom</h3>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-slate-500">Prvi posao</dt>
                  <dd className="text-right font-medium">{formatDate(selectedInvestorFinances.collaborationStart)}</dd>
                  <dt className="text-slate-500">Posljednji posao</dt>
                  <dd className="text-right font-medium">{formatDate(selectedInvestorFinances.latestSite?.datum_zavrsetka ?? selectedInvestorFinances.latestSite?.datum_pocetka)}</dd>
                  <dt className="text-slate-500">Trajanje suradnje</dt>
                  <dd className="text-right font-medium">
                    {selectedInvestorFinances.collaborationStart
                      ? `${Math.floor((Date.now() - new Date(`${selectedInvestorFinances.collaborationStart}T00:00:00`).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} god.`
                      : '—'}
                  </dd>
                  <dt className="text-slate-500">Postotak naplaćenosti</dt>
                  <dd className="text-right font-medium">{selectedInvestorFinances.invoiced > 0 ? `${(selectedInvestorFinances.paid / selectedInvestorFinances.invoiced * 100).toFixed(1)} %` : '—'}</dd>
                </dl>
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Posljednja aktivnost</h4>
                  <p className="mt-2 text-sm text-slate-700">
                    Zadnji radni nalog: <strong>{selectedInvestorLastWorkOrder?.broj ?? '—'}</strong>
                    {selectedInvestorLastWorkOrder && <span className="text-slate-500"> · {formatDate(selectedInvestorLastWorkOrder.created_at)}</span>}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">Zadnja faktura: <strong>{formatDate(selectedInvestorFinances.latestInvoice?.datum_izdavanja)}</strong></p>
                  <p className="mt-1 text-sm text-slate-700">
                    Zadnja naplata: <strong>{selectedInvestorFinances.latestPaidInvoice?.datum_naplate ? formatDate(selectedInvestorFinances.latestPaidInvoice.datum_naplate) : 'Nije evidentiran datum naplate'}</strong>
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    Zadnje završeno gradilište: <strong>{selectedInvestorFinances.latestSite?.naziv ?? '—'}</strong>
                  </p>
                  <p className="mt-1 text-sm text-slate-700">Posljednja aktivnost: <strong>{formatDate(selectedInvestorFinances.lastActivity)}</strong></p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Financijski pregled</h3>
                <p className="mt-1 text-xs text-slate-500">Naplaćeno se računa prema statusu fakture; djelomične uplate nisu zasebno evidentirane.</p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Ukupno fakturirano</dt><dd className="font-semibold">{formatCurrency(selectedInvestorFinances.invoiced)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Ukupno naplaćeno</dt><dd className="font-semibold">{formatCurrency(selectedInvestorFinances.paid)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Otvoreno</dt><dd className="font-semibold text-red-700">{formatCurrency(selectedInvestorFinances.unpaid)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Prosječna marža (ponderirana)</dt><dd className="font-semibold">{selectedInvestorFinances.margin === null ? '—' : `${selectedInvestorFinances.margin.toFixed(1)} %`}</dd></div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Najveće aktivno gradilište</dt>
                    <dd className="text-right font-semibold">
                      {[...gradilista].filter((site) => selectedInvestorFinances.siteIds.has(site.id) && site.status === 'aktivno')
                        .sort((a, b) => (b.ugovorena_vrijednost ?? 0) - (a.ugovorena_vrijednost ?? 0))[0]?.naziv ?? '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Najveći otvoreni dug</dt>
                    <dd className="font-semibold">{formatCurrency(Math.max(0, ...fakture
                      .filter((invoice) => invoice.investitor_id === selectedInvestor.id || (invoice.gradiliste_id && selectedInvestorFinances.siteIds.has(invoice.gradiliste_id)))
                      .filter((invoice) => invoice.status !== 'placena')
                      .map(iznosFakture)))}</dd>
                  </div>
                </dl>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Objekti investitora</h3>
              {selectedInvestorObjects.length ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {selectedInvestorObjects.map(({ objekt, sites, activeCount, invoiced, lastActivity }) => (
                    <div key={objekt.id} className="rounded-lg bg-slate-50 p-3">
                      <p className="font-semibold text-slate-900">{objekt.naziv}</p>
                      <p className="mt-1 text-xs text-slate-500">{[objekt.adresa, objekt.mjesto].filter(Boolean).join(', ') || 'Adresa nije unesena'}</p>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                        <span>Aktivna gradilišta: {activeCount}</span>
                        <span>Ukupno: {sites.length}</span>
                        <span>Fakturirano: {formatCurrency(invoiced)}</span>
                        <span>Aktivnost: {formatDate(lastActivity)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="mt-2 text-sm text-slate-500">Investitor još nema povezanih objekata.</p>}
            </section>

            <section className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">Kontakti investitora</h3>
                <button
                  type="button"
                  onClick={() => {
                    setContactEditing(null);
                    setContactForm({ uloga: '', ime: '', telefon: '', email: '', napomena: '' });
                  }}
                  className="text-xs font-semibold text-sky-700 hover:text-sky-900"
                >
                  Novi kontakt
                </button>
              </div>
              {contactError && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{contactError}</p>}
              <div className="mt-3 space-y-2">
                {investorContacts.map((kontakt) => (
                  <div key={kontakt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{kontakt.ime} <span className="font-normal text-slate-500">· {kontakt.uloga}</span></p>
                      <p className="text-xs text-slate-600">{[kontakt.telefon, kontakt.email, kontakt.napomena].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => {
                        setContactEditing(kontakt);
                        setContactForm({ uloga: kontakt.uloga, ime: kontakt.ime, telefon: kontakt.telefon ?? '', email: kontakt.email ?? '', napomena: kontakt.napomena ?? '' });
                      }} className="rounded p-1.5 text-slate-500 hover:bg-white hover:text-sky-700" aria-label={`Uredi kontakt ${kontakt.ime}`}><Pencil className="h-4 w-4" /></button>
                      <button type="button" onClick={() => void removeContact(kontakt)} className="rounded p-1.5 text-slate-500 hover:bg-white hover:text-red-700" aria-label={`Izbriši kontakt ${kontakt.ime}`}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
                {investorContacts.length === 0 && <p className="text-sm text-slate-500">Nema dodatnih kontakata.</p>}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <TextInput value={contactForm.uloga} onChange={(event) => setContactForm({ ...contactForm, uloga: event.target.value })} placeholder="Uloga (npr. Nabava)" aria-label="Uloga kontakta" />
                <TextInput value={contactForm.ime} onChange={(event) => setContactForm({ ...contactForm, ime: event.target.value })} placeholder="Ime i prezime" aria-label="Ime kontakta" />
                <TextInput type="tel" value={contactForm.telefon} onChange={(event) => setContactForm({ ...contactForm, telefon: event.target.value })} placeholder="Telefon" aria-label="Telefon kontakta" />
                <TextInput type="email" value={contactForm.email} onChange={(event) => setContactForm({ ...contactForm, email: event.target.value })} placeholder="Email" aria-label="Email kontakta" />
                <TextInput value={contactForm.napomena} onChange={(event) => setContactForm({ ...contactForm, napomena: event.target.value })} placeholder="Napomena" aria-label="Napomena kontakta" />
                <button type="button" disabled={contactSaving || !contactForm.uloga.trim() || !contactForm.ime.trim()} onClick={() => void submitContact()} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
                  {contactSaving ? 'Spremanje…' : contactEditing ? 'Spremi kontakt' : 'Dodaj kontakt'}
                </button>
              </div>
            </section>
          </div>
        )}
      </Modal>

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

export function ObjektiView({ onOpenGradiliste }: { onOpenGradiliste?: (id: string) => void } = {}) {
  const [objekti, setObjekti] = useState<Objekt[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [fakture, setFakture] = useState<Faktura[]>([]);
  const [troskovi, setTroskovi] = useState<Trosak[]>([]);
  const [radnoVrijeme, setRadnoVrijeme] = useState<RadnoVrijeme[]>([]);
  const [nalozi, setNalozi] = useState<RadniNalog[]>([]);
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
  const [selectedObjekt, setSelectedObjekt] = useState<Objekt | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAllObjekti(), fetchGradilista(), fetchFakture(), fetchInvestitori(), fetchTroskovi(), fetchRadnoVrijeme(), fetchRadniNalozi()])
      .then(([nextObjekti, nextGradilista, nextFakture, nextInvestitori, nextTroskovi, nextRadnoVrijeme, nextNalozi]) => {
        if (cancelled) return;
        setObjekti(nextObjekti);
        setGradilista(nextGradilista);
        setFakture(nextFakture);
        setInvestitori(nextInvestitori);
        setTroskovi(nextTroskovi);
        setRadnoVrijeme(nextRadnoVrijeme);
        setNalozi(nextNalozi);
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
    if (faktura.gradiliste_id) {
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
      <button type="button" onClick={() => setSelectedObjekt(objekt)} className="text-left font-semibold text-sky-700 hover:text-sky-900 hover:underline">
        {objekt.naziv}
      </button>
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

  const selectedObjektHistory = selectedObjekt
    ? (gradilistaPoObjektu.get(selectedObjekt.id) ?? [])
      .map((site) => {
        const revenue = fakture.filter((invoice) => invoice.gradiliste_id === site.id)
          .reduce((sum, invoice) => sum + iznosFakture(invoice), 0);
        const expenseCost = troskovi.filter((expense) => expense.gradiliste_id === site.id)
          .reduce((sum, expense) => sum + expense.iznos, 0);
        const laborCost = radnoVrijeme.filter((entry) => entry.gradiliste_id === site.id)
          .reduce((sum, entry) => sum + entry.sati * (entry.radnici?.cijena_sata ?? 0), 0);
        const cost = expenseCost + laborCost;
        const margin = revenue > 0 ? ((revenue - cost) / revenue) * 100 : null;
        return { site, revenue, cost, margin };
      })
      .sort((a, b) => (a.site.datum_pocetka ?? '').localeCompare(b.site.datum_pocetka ?? ''))
    : [];
  const selectedObjektActivity = selectedObjektHistory
    .flatMap(({ site }) => [site.datum_pocetka, site.datum_zavrsetka])
    .concat(fakture.filter((invoice) => selectedObjektHistory.some(({ site }) => site.id === invoice.gradiliste_id)).map((invoice) => invoice.datum_izdavanja))
    .concat(troskovi.filter((expense) => selectedObjektHistory.some(({ site }) => site.id === expense.gradiliste_id)).map((expense) => expense.datum))
    .concat(nalozi.filter((order) => selectedObjektHistory.some(({ site }) => site.id === order.gradiliste_id)).map((order) => order.created_at))
    .filter((date): date is string => Boolean(date))
    .sort()
    .pop() ?? null;

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
                  {sortHeader('gradiliste', 'Gradilišta')}
                </th>
                <th aria-sort={sortKey === 'datum_pocetka' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-right text-xs">
                  {sortHeader('datum_pocetka', 'Prvi posao')}
                </th>
                <th aria-sort={sortKey === 'datum_zavrsetka' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-right text-xs">
                  {sortHeader('datum_zavrsetka', 'Posljednja aktivnost')}
                </th>
                <th aria-sort={sortKey === 'naplaceno' ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className="px-5 py-3 text-right text-xs">
                  {sortHeader('naplaceno', 'Fakturirano')}
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-slate-500">Akcije</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedObjekti.map((objekt) => {
                const relatedGradilista = redoviPoObjektu.get(objekt.id) ?? [];
                const siteRows = relatedGradilista.map((row) => row.gradiliste);
                const firstDate = siteRows.map((site) => site.datum_pocetka).filter((date): date is string => Boolean(date)).sort()[0] ?? null;
                const activityDates = [
                  ...siteRows.flatMap((site) => [site.datum_zavrsetka, site.datum_pocetka]),
                  ...fakture.filter((invoice) => invoice.gradiliste_id && siteRows.some((site) => site.id === invoice.gradiliste_id)).map((invoice) => invoice.datum_izdavanja),
                  ...troskovi.filter((expense) => expense.gradiliste_id && siteRows.some((site) => site.id === expense.gradiliste_id)).map((expense) => expense.datum),
                  ...nalozi.filter((order) => order.gradiliste_id && siteRows.some((site) => site.id === order.gradiliste_id)).map((order) => order.created_at),
                ].filter((date): date is string => Boolean(date)).sort();
                const lastDate = activityDates.length ? activityDates[activityDates.length - 1] : null;
                const invoiced = relatedGradilista.reduce((sum, row) => sum + row.naplaceno, 0);
                return (
                  <tr key={objekt.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5 text-sm font-medium text-slate-900">{objektDetails(objekt)}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-600">{objekt.investitori?.naziv ?? 'Bez investitora'}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-600">
                      {siteRows.filter((site) => site.status === 'aktivno').length} aktivnih / {siteRows.length} ukupno
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm text-slate-600">{formatDate(firstDate)}</td>
                    <td className="px-5 py-3.5 text-right text-sm text-slate-600">{formatDate(lastDate)}</td>
                    <td className="px-5 py-3.5 text-right text-sm font-medium text-slate-900">{formatCurrency(invoiced)}</td>
                    <td className="px-5 py-3.5">{actionButtons(objekt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={selectedObjekt !== null}
        onClose={() => setSelectedObjekt(null)}
        title={selectedObjekt?.naziv ?? 'Objekt'}
        wide
      >
        {selectedObjekt && (
          <div className="space-y-5">
            <section className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <div><p className="text-xs text-slate-500">Adresa</p><p className="mt-1 text-sm font-medium">{[selectedObjekt.adresa, selectedObjekt.postanski_broj, selectedObjekt.mjesto].filter(Boolean).join(', ') || 'Nije unesena'}</p></div>
              <div><p className="text-xs text-slate-500">Investitor</p><p className="mt-1 text-sm font-medium">{selectedObjekt.investitori?.naziv ?? investitori.find((item) => item.id === selectedObjekt.investitor_id)?.naziv ?? '—'}</p></div>
              <div><p className="text-xs text-slate-500">Gradilišta</p><p className="mt-1 text-sm font-medium">{selectedObjektHistory.length} ukupno · {selectedObjektHistory.filter(({ site }) => site.status === 'aktivno').length} aktivnih</p></div>
              <div><p className="text-xs text-slate-500">Posljednja aktivnost</p><p className="mt-1 text-sm font-medium">{formatDate(selectedObjektActivity)}</p></div>
            </section>
            <section>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Povijest gradilišta na lokaciji</h3>
              {selectedObjektHistory.length ? (
                <div className="space-y-2">
                  {selectedObjektHistory.map(({ site, revenue, cost, margin }) => (
                    <div key={site.id} className="grid gap-2 rounded-lg border border-slate-200 p-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,0.7fr))_auto] lg:items-center">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">{site.naziv}</p>
                        <p className="mt-1 text-xs text-slate-500">{formatDate(site.datum_pocetka)} – {formatDate(site.datum_zavrsetka)}</p>
                      </div>
                      <div><p className="text-xs text-slate-500">Status</p><p className="text-sm font-medium">{site.status === 'neplaceno' ? 'Završeno · neplaćeno' : site.status === 'zavrseno' ? 'Završeno' : site.status === 'aktivno' ? 'Aktivno' : site.status === 'pauzirano' ? 'Pauzirano' : site.status === 'planirano' ? 'Planirano' : 'Ponuda'}</p></div>
                      <div><p className="text-xs text-slate-500">Vrijednost</p><p className="text-sm font-medium">{formatCurrency(site.ugovorena_vrijednost ?? 0)}</p></div>
                      <div><p className="text-xs text-slate-500">Fakturirano</p><p className="text-sm font-medium">{formatCurrency(revenue)}</p></div>
                      <div><p className="text-xs text-slate-500">Trošak / marža</p><p className="text-sm font-medium">{formatCurrency(cost)} · {margin === null ? '—' : `${margin.toFixed(1)} %`}</p></div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedObjekt(null);
                          onOpenGradiliste?.(site.id);
                        }}
                        disabled={!onOpenGradiliste}
                        className="rounded-lg border border-sky-200 px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                      >
                        Otvori gradilište
                      </button>
                    </div>
                  ))}
                </div>
              ) : <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Za ovaj objekt još nema evidentiranih gradilišta.</p>}
            </section>
          </div>
        )}
      </Modal>

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