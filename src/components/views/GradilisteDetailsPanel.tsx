import { useEffect, useState } from 'react';
import {
  Calendar,
  ClipboardList,
  Clock,
  FileText,
  Pencil,
  Plus,
  Receipt,
  Save,
  X,
} from 'lucide-react';
import type {
  Faktura,
  FakturaStatus,
  Gradiliste,
  RadniNalog,
  RadnoVrijeme,
  Rok,
  Trosak,
  TrosakKategorija,
  UgovoreniRad,
} from '@/types';
import {
  createFaktura,
  createTrosak,
  fetchFullRekapitulacija,
  updateFaktura,
  updateGradiliste,
  updateTrosak,
} from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextInput, Textarea } from '@/components/ui/Field';

interface GradilisteDetailsPanelProps {
  gradiliste: Gradiliste;
  onClose: () => void;
  onEdit: () => void;
  onGradilisteUpdate: (updates: Partial<Gradiliste>) => void;
}

type GradilisteDetails = Awaited<ReturnType<typeof fetchFullRekapitulacija>>;

const expenseLabels: Record<TrosakKategorija, string> = {
  materijal: 'Materijal',
  gorivo: 'Gorivo',
  put: 'Put',
  smjestaj: 'Smještaj',
  kooperanti: 'Kooperanti',
  place: 'Plaće',
  oprema: 'Oprema',
  ostalo: 'Ostalo',
};

function currency(value: number) {
  return value.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
}

function date(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString('hr-HR') : '—';
}

function Section({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-t border-slate-200 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className="inline-flex items-center gap-2 rounded-md bg-sky-50 px-2.5 py-1.5 text-sky-900">
            <span className="text-sky-700">{icon}</span>
            {title}
          </span>
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function GradilisteDetailsPanel({ gradiliste, onClose, onEdit, onGradilisteUpdate }: GradilisteDetailsPanelProps) {
  const [details, setDetails] = useState<GradilisteDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingFinancials, setEditingFinancials] = useState(false);
  const [savingFinancials, setSavingFinancials] = useState(false);
  const [financialForm, setFinancialForm] = useState({
    ugovorena_vrijednost: String(gradiliste.ugovorena_vrijednost ?? 0),
    proracun: String(gradiliste.proracun ?? 0),
    predvidena_marza: String(gradiliste.predvidena_marza ?? 0),
  });
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Faktura | null>(null);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({
    broj: '',
    kupac: gradiliste.objekti?.investitori?.naziv ?? '',
    iznos: '',
    datum_izdavanja: new Date().toISOString().slice(0, 10),
    datum_dospjecja: '',
    status: 'izdana' as FakturaStatus,
    opis: '',
  });
  const [costModalOpen, setCostModalOpen] = useState(false);
  const [editingCost, setEditingCost] = useState<Trosak | null>(null);
  const [savingCost, setSavingCost] = useState(false);
  const [costForm, setCostForm] = useState({
    kategorija: 'materijal' as TrosakKategorija,
    opis: '',
    iznos: '',
    datum: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setLoading(true);
    setError(null);
    fetchFullRekapitulacija(gradiliste.id)
      .then((data) => {
        if (!cancelled) setDetails(data);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Greška pri učitavanju detalja gradilišta.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [gradiliste.id]);

  useEffect(() => {
    setFinancialForm({
      ugovorena_vrijednost: String(gradiliste.ugovorena_vrijednost ?? 0),
      proracun: String(gradiliste.proracun ?? 0),
      predvidena_marza: String(gradiliste.predvidena_marza ?? 0),
    });
  }, [gradiliste.id, gradiliste.ugovorena_vrijednost, gradiliste.proracun, gradiliste.predvidena_marza]);

  const reloadDetails = async () => {
    setDetails(await fetchFullRekapitulacija(gradiliste.id));
  };

  const beginFinancialEdit = () => {
    setFinancialForm({
      ugovorena_vrijednost: String(gradiliste.ugovorena_vrijednost ?? 0),
      proracun: String(gradiliste.proracun ?? 0),
      predvidena_marza: String(gradiliste.predvidena_marza ?? 0),
    });
    setEditingFinancials(true);
    setError(null);
  };

  const saveFinancials = async () => {
    const updates = {
      ugovorena_vrijednost: Number(financialForm.ugovorena_vrijednost) || 0,
      proracun: Number(financialForm.proracun) || 0,
      predvidena_marza: Number(financialForm.predvidena_marza) || 0,
    };
    setSavingFinancials(true);
    setError(null);
    try {
      await updateGradiliste(gradiliste.id, updates);
      onGradilisteUpdate(updates);
      setEditingFinancials(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Greška pri spremanju financija.');
    } finally {
      setSavingFinancials(false);
    }
  };

  const openInvoiceEditor = (invoice?: Faktura) => {
    setEditingInvoice(invoice ?? null);
    setInvoiceForm({
      broj: invoice?.broj ?? '',
      kupac: invoice?.kupac ?? gradiliste.objekti?.investitori?.naziv ?? '',
      iznos: invoice ? String(invoice.iznos) : '',
      datum_izdavanja: invoice?.datum_izdavanja ?? new Date().toISOString().slice(0, 10),
      datum_dospjecja: invoice?.datum_dospjecja ?? '',
      status: invoice?.status ?? 'izdana',
      opis: invoice?.opis ?? '',
    });
    setError(null);
    setInvoiceModalOpen(true);
  };

  const saveInvoice = async () => {
    if (!invoiceForm.broj.trim() || !invoiceForm.iznos) return;
    setSavingInvoice(true);
    setError(null);
    const payload = {
      gradiliste_id: gradiliste.id,
      broj: invoiceForm.broj.trim(),
      kupac: invoiceForm.kupac.trim() || null,
      iznos: Number(invoiceForm.iznos),
      datum_izdavanja: invoiceForm.datum_izdavanja,
      datum_dospjecja: invoiceForm.datum_dospjecja || null,
      status: invoiceForm.status,
      opis: invoiceForm.opis.trim() || null,
    };
    try {
      if (editingInvoice) await updateFaktura(editingInvoice.id, payload);
      else await createFaktura(payload);
      await reloadDetails();
      setInvoiceModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Greška pri spremanju fakture.');
    } finally {
      setSavingInvoice(false);
    }
  };

  const openCostEditor = (cost?: Trosak) => {
    setEditingCost(cost ?? null);
    setCostForm({
      kategorija: cost?.kategorija ?? 'materijal',
      opis: cost?.opis ?? '',
      iznos: cost ? String(cost.iznos) : '',
      datum: cost?.datum ?? new Date().toISOString().slice(0, 10),
    });
    setError(null);
    setCostModalOpen(true);
  };

  const saveCost = async () => {
    if (!costForm.opis.trim() || !costForm.iznos) return;
    setSavingCost(true);
    setError(null);
    const payload = {
      gradiliste_id: gradiliste.id,
      kategorija: costForm.kategorija,
      opis: costForm.opis.trim(),
      iznos: Number(costForm.iznos),
      datum: costForm.datum,
    };
    try {
      if (editingCost) await updateTrosak(editingCost.id, payload);
      else await createTrosak(payload);
      await reloadDetails();
      setCostModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Greška pri spremanju troška.');
    } finally {
      setSavingCost(false);
    }
  };

  const costs = (details?.troskovi ?? []) as Trosak[];
  const workTime = (details?.radnoVrijeme ?? []) as RadnoVrijeme[];
  const deadlines = (details?.rokovi ?? []) as Rok[];
  const invoices = (details?.fakture ?? []) as Faktura[];
  const contractedWorks = (details?.ugovoreniRadovi ?? []) as UgovoreniRad[];
  const tasks = (details?.nalozi ?? []) as RadniNalog[];

  const directCosts = costs.reduce((sum, item) => sum + item.iznos, 0);
  const laborCosts = workTime.reduce((sum, item) => sum + item.sati * (item.radnici?.cijena_sata ?? 0), 0);
  const totalCosts = directCosts + laborCosts;
  const totalHours = workTime.reduce((sum, item) => sum + item.sati, 0);
  const invoiced = invoices.reduce((sum, item) => sum + item.iznos, 0);
  const paid = invoices.filter((item) => item.status === 'placena').reduce((sum, item) => sum + item.iznos, 0);
  const unpaid = invoices.filter((item) => item.status !== 'placena').reduce((sum, item) => sum + item.iznos, 0);
  const balance = paid - totalCosts;
  const costsByCategory = costs.reduce<Partial<Record<TrosakKategorija, number>>>((totals, item) => {
    totals[item.kategorija] = (totals[item.kategorija] ?? 0) + item.iznos;
    return totals;
  }, {});
  const workerTotals = workTime.reduce<Record<string, { name: string; hours: number; cost: number }>>((totals, item) => {
    const key = item.radnik_id;
    const rate = item.radnici?.cijena_sata ?? 0;
    const name = item.radnici ? `${item.radnici.ime} ${item.radnici.prezime}` : 'Nepoznat radnik';
    totals[key] ??= { name, hours: 0, cost: 0 };
    totals[key].hours += item.sati;
    totals[key].cost += item.sati * rate;
    return totals;
  }, {});
  const statusVariant = gradiliste.status === 'aktivno'
    ? 'green'
    : gradiliste.status === 'ponuda' || gradiliste.status === 'pauzirano'
      ? 'yellow'
      : gradiliste.status === 'zavrseno'
        ? 'gray'
        : 'blue';
  const statusLabel = {
    ponuda: 'Ponuda',
    planirano: 'Planirano',
    aktivno: 'Aktivno',
    pauzirano: 'Pauzirano',
    zavrseno: 'Završeno',
  }[gradiliste.status];

  return (
    <aside className="flex min-h-[28rem] min-w-0 flex-col border-l border-slate-200 bg-white lg:sticky lg:top-4 lg:max-h-[calc(100vh-4rem)]">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{gradiliste.naziv}</h2>
            <Badge variant={statusVariant}>{statusLabel}</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {[
              gradiliste.objekti?.investitori?.naziv,
              gradiliste.regija ? ({ dalmacija: 'Dalmacija', istra_kvarner: 'Istra i Kvarner', slavonija: 'Slavonija', zagreb_i_okolica: 'Zagreb i okolica', medimurje: 'Međimurje' }[gradiliste.regija]) : null,
              gradiliste.objekti?.naziv,
              gradiliste.adresa,
              gradiliste.voditelj_gradilista ? `Voditelj: ${gradiliste.voditelj_gradilista}` : null,
            ].filter(Boolean).join(' · ') || 'Detalji gradilišta'}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-sky-700"
            aria-label="Uredi gradilište"
            title="Uredi gradilište"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Zatvori detalje"
            title="Zatvori detalje"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <section className="border-b border-slate-200 py-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Financije</h3>
            {editingFinancials ? (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setEditingFinancials(false)} className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                  Odustani
                </button>
                <button type="button" onClick={saveFinancials} disabled={savingFinancials} className="inline-flex items-center gap-1 rounded-md bg-sky-700 px-2 py-1 text-xs font-medium text-white hover:bg-sky-800 disabled:opacity-50">
                  <Save className="h-3.5 w-3.5" />
                  {savingFinancials ? 'Spremanje…' : 'Spremi'}
                </button>
              </div>
            ) : (
              <button type="button" onClick={beginFinancialEdit} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50">
                <Pencil className="h-3.5 w-3.5" />
                Uredi iznose
              </button>
            )}
          </div>
          {editingFinancials ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Ugovorena vrijednost">
                <TextInput type="number" min="0" step="0.01" value={financialForm.ugovorena_vrijednost} onChange={(event) => setFinancialForm((previous) => ({ ...previous, ugovorena_vrijednost: event.target.value }))} />
              </Field>
              <Field label="Proračun">
                <TextInput type="number" min="0" step="0.01" value={financialForm.proracun} onChange={(event) => setFinancialForm((previous) => ({ ...previous, proracun: event.target.value }))} />
              </Field>
              <Field label="Predviđena marža">
                <TextInput type="number" min="0" step="0.01" value={financialForm.predvidena_marza} onChange={(event) => setFinancialForm((previous) => ({ ...previous, predvidena_marza: event.target.value }))} />
              </Field>
              <div className="self-end pb-2 text-[10px] text-slate-500">Naplaćeno i troškovi računaju se iz povezanih zapisa.</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-sky-100 bg-sky-50 p-3">
                <p className="text-[10px] font-bold uppercase text-sky-800">Ugovorena vrijednost</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{currency(gradiliste.ugovorena_vrijednost ?? 0)}</p>
              </div>
              <div className="rounded-lg border border-cyan-100 bg-cyan-50 p-3">
                <p className="text-[10px] font-bold uppercase text-cyan-900">Proračun</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{currency(gradiliste.proracun ?? 0)}</p>
              </div>
              <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
                <p className="text-[10px] font-bold uppercase text-amber-900">Predviđena marža</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{currency(gradiliste.predvidena_marza ?? 0)}</p>
              </div>
              <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                <p className="text-[10px] font-bold uppercase text-red-800">Trenutni trošak</p>
                <p className="mt-1 text-sm font-bold text-red-800">{currency(totalCosts)}</p>
                <p className="mt-0.5 text-[10px] text-red-700">Direktno {currency(directCosts)} · Rad {currency(laborCosts)}</p>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                <p className="text-[10px] font-bold uppercase text-emerald-900">Naplaćeno</p>
                <p className="mt-1 text-sm font-bold text-emerald-800">{currency(paid)}</p>
                <p className="mt-0.5 text-[10px] text-emerald-800">Fakturirano {currency(invoiced)} · Neplaćeno {currency(unpaid)}</p>
              </div>
              <div className={`rounded-lg border p-3 ${balance >= 0 ? 'border-teal-100 bg-teal-50' : 'border-rose-100 bg-rose-50'}`}>
                <p className={`text-[10px] font-bold uppercase ${balance >= 0 ? 'text-teal-900' : 'text-rose-800'}`}>Razlika naplaćeno − troškovi</p>
                <p className={`mt-1 text-sm font-bold ${balance >= 0 ? 'text-teal-800' : 'text-rose-800'}`}>{currency(balance)}</p>
              </div>
            </div>
          )}
        </section>

        {loading && <p className="py-6 text-center text-sm text-slate-400">Učitavanje detalja…</p>}
        {error && <p className="my-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {gradiliste.opis && (
          <section className="border-t border-slate-200 py-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Napomena</h3>
            <p className="whitespace-pre-wrap text-xs leading-5 text-slate-600">{gradiliste.opis}</p>
          </section>
        )}

        {!loading && details && (
          <>
            <Section title="Rokovi i važni datumi" icon={<Calendar className="h-4 w-4" />}>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div className="rounded-md border border-sky-100 bg-sky-50 px-2.5 py-2">
                  <p className="text-[10px] font-semibold text-sky-800">Početak gradilišta</p>
                  <p className="mt-0.5 text-xs font-bold text-slate-900">{date(gradiliste.datum_pocetka)}</p>
                </div>
                <div className="rounded-md border border-emerald-100 bg-emerald-50 px-2.5 py-2">
                  <p className="text-[10px] font-semibold text-emerald-800">Kraj gradilišta</p>
                  <p className="mt-0.5 text-xs font-bold text-slate-900">{date(gradiliste.datum_zavrsetka)}</p>
                </div>
              </div>
              {deadlines.length === 0 ? <p className="text-xs text-slate-400">Nema dodatnih rokova.</p> : (
                <div className="space-y-2">
                  {deadlines.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-3 text-xs">
                      <span className="min-w-0 text-slate-700">{item.naziv}</span>
                      <span className="flex-shrink-0 font-medium text-slate-600">{date(item.datum)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title={`Radni zadaci (${tasks.length})`} icon={<ClipboardList className="h-4 w-4" />}>
              {tasks.length === 0 ? <p className="text-xs text-slate-400">Nema radnih zadataka.</p> : (
                <div className="space-y-2">
                  {tasks.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800">{item.broj} · {item.naslov}</p>
                        <p className="text-slate-500">{item.prioritet} · rok {date(item.rok)}</p>
                      </div>
                      <span className="flex-shrink-0 text-slate-500">{item.status.replace('_', ' ')}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title={`Utrošeni sati (${totalHours.toLocaleString('hr-HR')} h)`} icon={<Clock className="h-4 w-4" />}>
              {Object.values(workerTotals).length === 0 ? <p className="text-xs text-slate-400">Nema evidentiranih sati.</p> : (
                <div className="space-y-2">
                  {Object.values(workerTotals).map((worker) => (
                    <div key={worker.name} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-slate-700">{worker.name} · {worker.hours.toLocaleString('hr-HR')} h</span>
                      <span className="font-medium text-slate-600">{currency(worker.cost)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title={`Troškovi (${currency(directCosts)})`}
              icon={<Receipt className="h-4 w-4" />}
              action={(
                <button type="button" onClick={() => openCostEditor()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50">
                  <Plus className="h-3.5 w-3.5" />
                  Trošak
                </button>
              )}
            >
              {Object.keys(costsByCategory).length === 0 ? <p className="text-xs text-slate-400">Nema evidentiranih troškova.</p> : (
                <div className="space-y-2">
                  {Object.entries(costsByCategory).map(([category, amount]) => (
                    <div key={category} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-slate-700">{expenseLabels[category as TrosakKategorija]}</span>
                      <span className="font-medium text-slate-600">{currency(amount ?? 0)}</span>
                    </div>
                  ))}
                </div>
              )}
              {costs.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                  {costs.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-slate-700">{item.opis}</p>
                        <p className="text-[10px] text-slate-500">{expenseLabels[item.kategorija]} · {date(item.datum)}</p>
                      </div>
                      <span className="flex-shrink-0 font-medium text-slate-700">{currency(item.iznos)}</span>
                      <button type="button" onClick={() => openCostEditor(item)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-700" aria-label={`Uredi trošak ${item.opis}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title={`Ugovoreni radovi (${contractedWorks.length})`} icon={<FileText className="h-4 w-4" />}>
              {contractedWorks.length === 0 ? <p className="text-xs text-slate-400">Nema ugovorenih radova.</p> : (
                <div className="space-y-2">
                  {contractedWorks.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-3 text-xs">
                      <span className="min-w-0 text-slate-700">{item.naziv}</span>
                      <span className="flex-shrink-0 font-medium text-slate-600">{currency(item.ostvareni_iznos ?? 0)} / {currency(item.ugovoreni_iznos)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title={`Fakture (${invoices.length})`}
              icon={<Receipt className="h-4 w-4" />}
              action={(
                <button type="button" onClick={() => openInvoiceEditor()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50">
                  <Plus className="h-3.5 w-3.5" />
                  Faktura
                </button>
              )}
            >
              {invoices.length === 0 ? <p className="text-xs text-slate-400">Nema faktura.</p> : (
                <div className="space-y-2">
                  {invoices.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-700">{item.broj} · {item.status === 'placena' ? 'Plaćena' : item.status === 'izdana' ? 'Izdana' : 'Neplaćena'}</span>
                      <span className="font-medium text-slate-600">{currency(item.iznos)}</span>
                      <button type="button" onClick={() => openInvoiceEditor(item)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-700" aria-label={`Uredi fakturu ${item.broj}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </div>

      <Modal
        open={invoiceModalOpen}
        onClose={() => setInvoiceModalOpen(false)}
        title={editingInvoice ? 'Uredi fakturu' : 'Nova faktura'}
        footer={(
          <>
            <button type="button" onClick={() => setInvoiceModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Odustani
            </button>
            <button type="button" onClick={saveInvoice} disabled={savingInvoice || !invoiceForm.broj.trim() || !invoiceForm.iznos} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
              {savingInvoice ? 'Spremanje…' : 'Spremi fakturu'}
            </button>
          </>
        )}
      >
        {error && <p className="mb-3 rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}
        <div className="space-y-3">
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">Faktura će biti povezana s gradilištem <strong>{gradiliste.naziv}</strong>.</p>
          <Field label="Broj fakture *">
            <TextInput value={invoiceForm.broj} onChange={(event) => setInvoiceForm((previous) => ({ ...previous, broj: event.target.value }))} placeholder="F-2026-001" />
          </Field>
          <Field label="Kupac">
            <TextInput value={invoiceForm.kupac} onChange={(event) => setInvoiceForm((previous) => ({ ...previous, kupac: event.target.value }))} />
          </Field>
          <Field label="Iznos (EUR) *">
            <TextInput type="number" min="0" step="0.01" value={invoiceForm.iznos} onChange={(event) => setInvoiceForm((previous) => ({ ...previous, iznos: event.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Datum izdavanja">
              <TextInput type="date" value={invoiceForm.datum_izdavanja} onChange={(event) => setInvoiceForm((previous) => ({ ...previous, datum_izdavanja: event.target.value }))} />
            </Field>
            <Field label="Dospijeće">
              <TextInput type="date" value={invoiceForm.datum_dospjecja} onChange={(event) => setInvoiceForm((previous) => ({ ...previous, datum_dospjecja: event.target.value }))} />
            </Field>
          </div>
          <Field label="Status naplate">
            <Select value={invoiceForm.status} onChange={(event) => setInvoiceForm((previous) => ({ ...previous, status: event.target.value as FakturaStatus }))}>
              <option value="izdana">Izdana</option>
              <option value="placena">Plaćena</option>
              <option value="nep placena">Neplaćena</option>
            </Select>
          </Field>
          <Field label="Opis">
            <Textarea rows={2} value={invoiceForm.opis} onChange={(event) => setInvoiceForm((previous) => ({ ...previous, opis: event.target.value }))} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={costModalOpen}
        onClose={() => setCostModalOpen(false)}
        title={editingCost ? 'Uredi trošak' : 'Novi trošak'}
        footer={(
          <>
            <button type="button" onClick={() => setCostModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Odustani
            </button>
            <button type="button" onClick={saveCost} disabled={savingCost || !costForm.opis.trim() || !costForm.iznos} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
              {savingCost ? 'Spremanje…' : 'Spremi trošak'}
            </button>
          </>
        )}
      >
        {error && <p className="mb-3 rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}
        <div className="space-y-3">
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">Trošak će biti povezan s gradilištem <strong>{gradiliste.naziv}</strong>.</p>
          <Field label="Kategorija">
            <Select value={costForm.kategorija} onChange={(event) => setCostForm((previous) => ({ ...previous, kategorija: event.target.value as TrosakKategorija }))}>
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
          <Field label="Opis troška *">
            <TextInput value={costForm.opis} onChange={(event) => setCostForm((previous) => ({ ...previous, opis: event.target.value }))} placeholder="Opis stavke" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Iznos (EUR) *">
              <TextInput type="number" min="0" step="0.01" value={costForm.iznos} onChange={(event) => setCostForm((previous) => ({ ...previous, iznos: event.target.value }))} />
            </Field>
            <Field label="Datum">
              <TextInput type="date" value={costForm.datum} onChange={(event) => setCostForm((previous) => ({ ...previous, datum: event.target.value }))} />
            </Field>
          </div>
        </div>
      </Modal>
    </aside>
  );
}
