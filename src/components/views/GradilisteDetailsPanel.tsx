import { useEffect, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ClipboardList,
  FileText,
  Pencil,
  Plus,
  Receipt,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Faktura,
  FakturaStatus,
  Gradiliste,
  GradilisteZadatak,
  RadniNalog,
  RadnoVrijeme,
  Rok,
  Trosak,
  TrosakKategorija,
  UgovoreniRad,
} from '@/types';
import {
  createFaktura,
  createGradilisteZadatak,
  deleteGradilisteZadatak,
  fetchGradilisteZadaci,
  updateGradilisteZadatak,
  createRok,
  deleteRok,
  updateRok,
  createTrosak,
  deleteTrosak,
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
  onRokoviChange?: () => void;
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

function errText(reason: unknown, fallback: string) {
  if (typeof reason === 'object' && reason !== null && 'message' in reason && typeof reason.message === 'string') return reason.message;
  return fallback;
}

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

export function GradilisteDetailsPanel({ gradiliste, onClose, onEdit, onGradilisteUpdate, onRokoviChange }: GradilisteDetailsPanelProps) {
  const [details, setDetails] = useState<GradilisteDetails | null>(null);
  const [openCostGroups, setOpenCostGroups] = useState<Set<string>>(new Set());
  const [satnica, setSatnicaState] = useState<number>(() => {
    const saved = Number(localStorage.getItem('tm_univerzalna_satnica'));
    return saved > 0 ? saved : 18;
  });
  const [showWorkers, setShowWorkers] = useState(false);
  const [showTeren, setShowTerenState] = useState(() => localStorage.getItem('tm_prikaz_teren') !== '0');
  const [showNight, setShowNightState] = useState(() => localStorage.getItem('tm_prikaz_nocna') !== '0');
  const setSatnica = (value: number) => {
    setSatnicaState(value);
    localStorage.setItem('tm_univerzalna_satnica', String(value));
  };
  const setShowTeren = (value: boolean) => {
    setShowTerenState(value);
    localStorage.setItem('tm_prikaz_teren', value ? '1' : '0');
  };
  const setShowNight = (value: boolean) => {
    setShowNightState(value);
    localStorage.setItem('tm_prikaz_nocna', value ? '1' : '0');
  };
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

  const [zadaci, setZadaci] = useState<GradilisteZadatak[]>([]);
  const [newZadatak, setNewZadatak] = useState('');
  const [newZadatakRok, setNewZadatakRok] = useState('');
  const [editingZadatakId, setEditingZadatakId] = useState<string | null>(null);
  const [editingZadatakText, setEditingZadatakText] = useState('');

  const loadZadaci = async () => {
    try {
      setZadaci(await fetchGradilisteZadaci(gradiliste.id));
    } catch (reason) {
      setZadaci([]);
      setError(errText(reason, 'Greška pri učitavanju zadataka. Pokreni migraciju 20261015200000_create_gradiliste_zadaci.sql.'));
    }
  };

  useEffect(() => {
    void loadZadaci();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradiliste.id]);

  const afterZadatakChange = async () => {
    await loadZadaci();
    await reloadDetails();
    onRokoviChange?.();
  };

  const addZadatak = async () => {
    if (!newZadatak.trim()) return;
    try {
      await createGradilisteZadatak(gradiliste.id, newZadatak.trim(), newZadatakRok);
      setNewZadatak('');
      setNewZadatakRok('');
      await afterZadatakChange();
    } catch (reason) {
      setError(errText(reason, 'Greška pri spremanju zadatka.'));
    }
  };

  const toggleZadatak = async (z: GradilisteZadatak) => {
    setZadaci((previous) => previous.map((item) => (item.id === z.id ? { ...item, gotovo: !z.gotovo } : item)));
    try {
      await updateGradilisteZadatak(z.id, { gotovo: !z.gotovo });
      await afterZadatakChange();
    } catch (reason) {
      setError(errText(reason, 'Greška pri spremanju zadatka.'));
      await loadZadaci();
    }
  };

  const setZadatakRok = async (z: GradilisteZadatak, rok: string) => {
    try {
      await updateGradilisteZadatak(z.id, { rok: rok || null });
      await afterZadatakChange();
    } catch (reason) {
      setError(errText(reason, 'Greška pri spremanju roka zadatka. Pokreni migraciju 20261015210000_zadaci_rok.sql.'));
    }
  };

  const saveZadatakText = async (z: GradilisteZadatak) => {
    const text = editingZadatakText.trim();
    setEditingZadatakId(null);
    if (!text || text === z.naziv) return;
    try {
      await updateGradilisteZadatak(z.id, { naziv: text });
      await afterZadatakChange();
    } catch (reason) {
      setError(errText(reason, 'Greška pri spremanju zadatka.'));
    }
  };

  const removeZadatak = async (id: string) => {
    try {
      await deleteGradilisteZadatak(id);
      await afterZadatakChange();
    } catch (reason) {
      setError(errText(reason, 'Greška pri brisanju zadatka.'));
    }
  };

  const reloadDetails = async () => {
    setDetails(await fetchFullRekapitulacija(gradiliste.id));
  };

  const [deadlineModalOpen, setDeadlineModalOpen] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState<Rok | null>(null);
  const [savingDeadline, setSavingDeadline] = useState(false);
  const [deadlineForm, setDeadlineForm] = useState({ naziv: '', datum: '', opis: '' });

  const afterDeadlineChange = async () => {
    await reloadDetails();
    onRokoviChange?.();
  };

  const openDeadlineEditor = (item?: Rok) => {
    setEditingDeadline(item ?? null);
    setDeadlineForm({ naziv: item?.naziv ?? '', datum: item?.datum ?? '', opis: item?.opis ?? '' });
    setError(null);
    setDeadlineModalOpen(true);
  };

  const saveDeadline = async () => {
    if (!deadlineForm.naziv.trim() || !deadlineForm.datum) return;
    setSavingDeadline(true);
    setError(null);
    try {
      const payload = { naziv: deadlineForm.naziv.trim(), datum: deadlineForm.datum, opis: deadlineForm.opis.trim() || null };
      if (editingDeadline) await updateRok(editingDeadline.id, payload);
      else await createRok({ ...payload, gradiliste_id: gradiliste.id, status: 'otvoren' });
      await afterDeadlineChange();
      setDeadlineModalOpen(false);
    } catch (reason) {
      setError(errText(reason, 'Greška pri spremanju roka.'));
    } finally {
      setSavingDeadline(false);
    }
  };

  const toggleDeadline = async (item: Rok) => {
    try {
      await updateRok(item.id, { status: item.status === 'zavrsen' ? 'otvoren' : 'zavrsen' });
      await afterDeadlineChange();
    } catch (reason) {
      setError(errText(reason, 'Greška pri spremanju roka.'));
    }
  };

  const removeDeadline = async (id: string) => {
    try {
      await deleteRok(id);
      await afterDeadlineChange();
    } catch (reason) {
      setError(errText(reason, 'Greška pri brisanju roka.'));
    }
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

  const removeCost = async (item: Trosak) => {
    if (!window.confirm(`Obrisati trošak „${item.opis}”?`)) return;
    try {
      await deleteTrosak(item.id);
      await reloadDetails();
    } catch (reason) {
      setError(errText(reason, 'Greška pri brisanju troška.'));
    }
  };

  const costs = (details?.troskovi ?? []) as Trosak[];
  const workTime = (details?.radnoVrijeme ?? []) as RadnoVrijeme[];
  const deadlines = (details?.rokovi ?? []) as Rok[];
  const invoices = (details?.fakture ?? []) as Faktura[];
  const contractedWorks = (details?.ugovoreniRadovi ?? []) as UgovoreniRad[];
  const tasks = (details?.nalozi ?? []) as RadniNalog[];

  const directCosts = costs.reduce((sum, item) => sum + item.iznos, 0) - (showTeren ? 0 : costs.filter((t) => t.kategorija === 'place' && t.opis.startsWith('Teren')).reduce((s, t) => s + t.iznos, 0)) - (showNight ? 0 : costs.filter((t) => t.kategorija === 'place' && t.opis.startsWith('Noćni rad')).reduce((s, t) => s + t.iznos, 0));
  const totalHours = workTime.reduce((sum, item) => sum + item.sati, 0);
  const laborCosts = totalHours * satnica;
  const totalCosts = directCosts + laborCosts;
  const invoiced = invoices.reduce((sum, item) => sum + item.iznos, 0);
  const paid = invoices.filter((item) => item.status === 'placena').reduce((sum, item) => sum + item.iznos, 0);
  const unpaid = invoices.filter((item) => item.status !== 'placena').reduce((sum, item) => sum + item.iznos, 0);
  const balance = paid - totalCosts;
  const offer = gradiliste.ugovorena_vrijednost ?? 0;
  const offerMargin = offer - totalCosts;
  const marginPct = offer > 0 ? (offerMargin / offer) * 100 : 0;
  const invoicedBalance = invoiced - totalCosts;
  const invoicedMarginPct = invoiced > 0 ? (invoicedBalance / invoiced) * 100 : 0;
  const invoicedPct = offer > 0 ? (invoiced / offer) * 100 : 0;
  const costPct = offer > 0 ? (totalCosts / offer) * 100 : 0;
  const workerTotals = workTime.reduce<Record<string, { name: string; hours: number; cost: number }>>((totals, item) => {
    const key = item.radnik_id;
    const rate = satnica;
    const name = item.radnici ? `${item.radnici.ime} ${item.radnici.prezime}` : 'Nepoznat radnik';
    totals[key] ??= { name, hours: 0, cost: 0 };
    totals[key].hours += item.sati;
    totals[key].cost += item.sati * rate;
    return totals;
  }, {});
  const costRow = (t: Trosak) => ({ id: t.id, title: t.opis, sub: `${expenseLabels[t.kategorija]} · ${date(t.datum)}`, amount: t.iznos, trosak: t });
  const isTeren = (t: Trosak) => t.kategorija === 'place' && t.opis.startsWith('Teren');
  const isNight = (t: Trosak) => t.kategorija === 'place' && t.opis.startsWith('Noćni rad');
  const sumOf = (list: Trosak[]) => list.reduce((s, t) => s + t.iznos, 0);
  const byKat = (k: TrosakKategorija) => costs.filter((t) => t.kategorija === k);
  const terenList = costs.filter(isTeren);
  const nightList = costs.filter(isNight);
  const kmList = byKat('put');
  const otherList = costs.filter((t) => !isTeren(t) && !isNight(t) && !['materijal', 'smjestaj', 'kooperanti', 'put'].includes(t.kategorija));
  const costGroups: { key: string; label: string; hint?: string; total: number; hidden?: boolean; toggle?: 'teren' | 'nocna'; rows: { id: string; title: string; sub?: string; amount: number; trosak?: Trosak }[] }[] = [
    {
      key: 'sati',
      label: 'Utrošeni sati',
      hint: `${totalHours.toLocaleString('hr-HR')} h × ${satnica.toLocaleString('hr-HR')} €`,
      total: laborCosts,
      rows: showWorkers ? Object.entries(workerTotals).map(([id, w]) => ({ id, title: w.name, sub: `${w.hours.toLocaleString('hr-HR')} h × ${satnica.toLocaleString('hr-HR')} €`, amount: w.cost })) : [],
    },
    { key: 'teren', label: 'Teren', total: showTeren ? sumOf(terenList) : 0, hidden: !showTeren, toggle: 'teren', rows: terenList.map(costRow) },
    { key: 'nocna', label: 'Noćna', total: showNight ? sumOf(nightList) : 0, hidden: !showNight, toggle: 'nocna', rows: nightList.map(costRow) },
    { key: 'materijal', label: 'Materijal', total: sumOf(byKat('materijal')), rows: byKat('materijal').map(costRow) },
    { key: 'smjestaj', label: 'Smještaj', total: sumOf(byKat('smjestaj')), rows: byKat('smjestaj').map(costRow) },
    { key: 'kooperanti', label: 'Kooperanti', total: sumOf(byKat('kooperanti')), rows: byKat('kooperanti').map(costRow) },
    { key: 'km', label: 'Kilometri vozila', total: sumOf(kmList), rows: kmList.map(costRow) },
    ...(otherList.length > 0 ? [{ key: 'ostalo', label: 'Ostalo', total: sumOf(otherList), rows: otherList.map(costRow) }] : []),
  ];
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
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-sky-100 bg-sky-50 p-3">
                  <p className="text-[10px] font-bold uppercase text-sky-800">Ponuda (ugovoreno)</p>
                  <p className="mt-1 text-base font-bold text-slate-900">{currency(offer)}</p>
                  {(gradiliste.proracun ?? 0) > 0 && <p className="mt-0.5 text-[10px] text-sky-800">Proračun {currency(gradiliste.proracun ?? 0)}</p>}
                </div>
                <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                  <p className="text-[10px] font-bold uppercase text-red-800">Trošak</p>
                  <p className="mt-1 text-base font-bold text-red-800">{currency(totalCosts)}</p>
                  <p className="mt-0.5 text-[10px] text-red-700">Direktno {currency(directCosts)} · Rad {currency(laborCosts)}</p>
                </div>
                <div className={`rounded-lg border p-3 ${offerMargin >= 0 ? 'border-emerald-100 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                  <p className={`text-[10px] font-bold uppercase ${offerMargin >= 0 ? 'text-emerald-900' : 'text-rose-800'}`}>Razlika ponuda − trošak</p>
                  <p className={`mt-1 text-base font-bold ${offerMargin >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>{currency(offerMargin)}</p>
                  <p className={`mt-0.5 text-[10px] ${offerMargin >= 0 ? 'text-emerald-800' : 'text-rose-700'}`}>
                    Marža {offer > 0 ? `${marginPct.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} %` : '—'}
                    {(gradiliste.predvidena_marza ?? 0) > 0 && ` · planirano ${currency(gradiliste.predvidena_marza ?? 0)}`}
                  </p>
                </div>
                <div className="rounded-lg border border-violet-100 bg-violet-50 p-3">
                  <p className="text-[10px] font-bold uppercase text-violet-900">Fakturirano</p>
                  <p className="mt-1 text-base font-bold text-violet-800">{currency(invoiced)}</p>
                  <p className="mt-0.5 text-[10px] text-violet-800">
                    {offer > 0 ? `${invoicedPct.toLocaleString('hr-HR', { maximumFractionDigits: 0 })} % ponude · ` : ''}za fakturirati {currency(Math.max(0, offer - invoiced))}
                  </p>
                </div>
                <div className={`rounded-lg border p-3 ${invoicedBalance >= 0 ? 'border-teal-100 bg-teal-50' : 'border-rose-200 bg-rose-50'}`}>
                  <p className={`text-[10px] font-bold uppercase ${invoicedBalance >= 0 ? 'text-teal-900' : 'text-rose-800'}`}>Razlika fakturirano − trošak</p>
                  <p className={`mt-1 text-base font-bold ${invoicedBalance >= 0 ? 'text-teal-800' : 'text-rose-800'}`}>{currency(invoicedBalance)}</p>
                  <p className={`mt-0.5 text-[10px] ${invoicedBalance >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>
                    {invoiced > 0 ? `Marža na fakturirano ${invoicedMarginPct.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} %` : 'Nema faktura'}
                  </p>
                </div>
                <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
                  <p className="text-[10px] font-bold uppercase text-amber-900">Naplaćeno</p>
                  <p className="mt-1 text-base font-bold text-amber-900">{currency(paid)}</p>
                  <p className="mt-0.5 text-[10px] text-amber-800">Neplaćeno {currency(unpaid)} · razlika naplaćeno − trošak {currency(balance)}</p>
                </div>
              </div>
              {offer > 0 && (
                <div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" title="Trošak, fakturirano i naplaćeno u odnosu na ponudu">
                    <div className="bg-emerald-500" style={{ width: `${Math.min(100, (paid / offer) * 100)}%` }} />
                    <div className="bg-violet-400" style={{ width: `${Math.max(0, Math.min(100, (invoiced / offer) * 100) - Math.min(100, (paid / offer) * 100))}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Iskorišteno troškom {costPct.toLocaleString('hr-HR', { maximumFractionDigits: 0 })} % ponude · zeleno naplaćeno, ljubičasto fakturirano
                  </p>
                </div>
              )}
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
            <Section
              title="Rokovi i važni datumi"
              icon={<Calendar className="h-4 w-4" />}
              action={(
                <button type="button" onClick={() => openDeadlineEditor()} className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900">
                  <Plus className="h-3.5 w-3.5" />
                  Rok
                </button>
              )}
            >
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
                <div className="space-y-1.5">
                  {deadlines.map((item) => {
                    const late = item.status === 'otvoren' && item.datum < new Date().toISOString().slice(0, 10);
                    return (
                      <div key={item.id} className="group flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={item.status === 'zavrsen'}
                          onChange={() => void toggleDeadline(item)}
                          disabled={!!item.zadatak_id}
                          title={item.zadatak_id ? 'Upravlja se iz radnog zadatka' : 'Označi kao završeno'}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                        />
                        <div className="min-w-0 flex-1">
                          <p className={item.status === 'zavrsen' ? 'text-slate-400 line-through' : 'text-slate-700'}>{item.naziv}</p>
                          {item.opis && <p className="text-[11px] text-slate-500">{item.opis}</p>}
                        </div>
                        <span className={`flex-shrink-0 font-medium ${late ? 'text-red-600' : 'text-slate-600'}`}>{date(item.datum)}</span>
                        {item.zadatak_id ? (
                          <span className="flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">Zadatak</span>
                        ) : (
                          <>
                            <button type="button" onClick={() => openDeadlineEditor(item)} className="flex-shrink-0 text-slate-400 hover:text-sky-600" aria-label="Uredi rok">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => void removeDeadline(item.id)} className="flex-shrink-0 text-slate-300 hover:text-red-600" aria-label="Obriši rok">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title={`Radni zadaci (${zadaci.filter((z) => z.gotovo).length}/${zadaci.length})`} icon={<ClipboardList className="h-4 w-4" />}>
              {zadaci.length === 0 && <p className="mb-2 text-xs text-slate-400">Nema radnih zadataka.</p>}
              <div className="space-y-1.5">
                {zadaci.map((z) => (
                  <div
                    key={z.id}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${z.gotovo ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}
                  >
                    <input
                      type="checkbox"
                      checked={z.gotovo}
                      onChange={() => void toggleZadatak(z)}
                      className="h-4 w-4 flex-shrink-0 accent-emerald-600"
                      title="Označi kao riješeno"
                    />
                    {editingZadatakId === z.id ? (
                      <input
                        autoFocus
                        value={editingZadatakText}
                        onChange={(event) => setEditingZadatakText(event.target.value)}
                        onBlur={() => void saveZadatakText(z)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveZadatakText(z);
                          if (event.key === 'Escape') setEditingZadatakId(null);
                        }}
                        className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                      />
                    ) : (
                      <span className={`min-w-0 flex-1 break-words ${z.gotovo ? 'font-medium text-emerald-800 line-through decoration-emerald-400' : 'text-slate-800'}`}>{z.naziv}</span>
                    )}
                    <input
                      type="date"
                      value={z.rok ?? ''}
                      onChange={(event) => void setZadatakRok(z, event.target.value)}
                      title="Rok izvršenja"
                      className={`w-[7.5rem] flex-shrink-0 rounded border px-1 py-0.5 text-[11px] ${z.gotovo ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : z.rok && z.rok < new Date().toISOString().slice(0, 10) ? 'border-red-300 text-red-600' : 'border-slate-200 text-slate-600'}`}
                    />
                    <button type="button" onClick={() => { setEditingZadatakId(z.id); setEditingZadatakText(z.naziv); }} className="flex-shrink-0 text-slate-400 hover:text-sky-600" aria-label="Uredi zadatak">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => void removeZadatak(z.id)} className="flex-shrink-0 text-slate-300 hover:text-red-600" aria-label="Obriši zadatak">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={newZadatak}
                  onChange={(event) => setNewZadatak(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void addZadatak(); }}
                  placeholder="Novi zadatak…"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                />
                <input
                  type="date"
                  value={newZadatakRok}
                  onChange={(event) => setNewZadatakRok(event.target.value)}
                  title="Rok izvršenja (neobavezno)"
                  className="w-[8rem] flex-shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => void addZadatak()}
                  disabled={!newZadatak.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Dodaj
                </button>
              </div>
            </Section>

            <Section title={`Radni nalozi (${tasks.length})`} icon={<ClipboardList className="h-4 w-4" />}>
              {tasks.length === 0 ? <p className="text-xs text-slate-400">Nema radnih naloga.</p> : (
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

            <Section
              title={`Obračun troškova (${currency(totalCosts)})`}
              icon={<Receipt className="h-4 w-4" />}
              action={(
                <button type="button" onClick={() => openCostEditor()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50">
                  <Plus className="h-3.5 w-3.5" />
                  Trošak
                </button>
              )}
            >
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {costGroups.map((group) => {
                  const isOpen = openCostGroups.has(group.key);
                  return (
                    <div key={group.key}>
                      <button
                        type="button"
                        onClick={() => setOpenCostGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                          return next;
                        })}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"
                        aria-expanded={isOpen}
                      >
                        <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                        <span className={`flex-1 font-medium ${group.hidden ? 'text-slate-400' : 'text-slate-800'}`}>{group.label}{group.hidden ? ' (skriveno)' : ''}</span>
                        {group.hint && <span className="text-[11px] text-slate-500">{group.hint}</span>}
                        <span className="w-24 text-right font-semibold text-slate-900">{currency(group.total)}</span>
                      </button>
                      {isOpen && (
                        <div className="space-y-1.5 bg-slate-50 px-3 py-2 pl-8">
                          {group.key === 'sati' && (
                            <div className="mb-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                              <label className="inline-flex items-center gap-1.5">
                                Univerzalna satnica
                                <input
                                  type="number"
                                  min={0}
                                  step="0.5"
                                  value={satnica}
                                  onChange={(event) => setSatnica(Math.max(0, Number(event.target.value)))}
                                  className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                                />
                                €/h
                              </label>
                              <label className="inline-flex items-center gap-1.5">
                                <input type="checkbox" checked={showWorkers} onChange={(event) => setShowWorkers(event.target.checked)} />
                                Netto po radnicima
                              </label>
                            </div>
                          )}
                          {group.toggle && (
                            <label className="mb-1 inline-flex items-center gap-1.5 text-xs text-slate-600">
                              <input
                                type="checkbox"
                                checked={!group.hidden}
                                onChange={(event) => (group.toggle === 'teren' ? setShowTeren(event.target.checked) : setShowNight(event.target.checked))}
                              />
                              Prikaži u troškovima
                            </label>
                          )}
                          {group.rows.length === 0 ? <p className="text-xs text-slate-400">{group.key === 'sati' && !showWorkers ? 'Uključi „Netto po radnicima” za pregled.' : 'Nema podataka.'}</p> : group.rows.map((row) => (
                            <div key={row.id} className="flex items-center gap-2 text-xs">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-slate-700">{row.title}</p>
                                {row.sub && <p className="text-[10px] text-slate-500">{row.sub}</p>}
                              </div>
                              <span className="flex-shrink-0 font-medium text-slate-700">{currency(row.amount)}</span>
                              {row.trosak && !(row.trosak as Trosak & { nalog_id?: string | null }).nalog_id && (
                                <>
                                  <button type="button" onClick={() => openCostEditor(row.trosak)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-700" aria-label={`Uredi trošak ${row.title}`}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button type="button" onClick={() => row.trosak && void removeCost(row.trosak)} className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600" aria-label={`Obriši trošak ${row.title}`}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 bg-sky-50 px-3 py-2 text-xs">
                  <span className="flex-1 font-semibold text-sky-900">Ukupno</span>
                  <span className="w-24 text-right font-bold text-sky-900">{currency(totalCosts)}</span>
                </div>
              </div>
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

      <Modal
        open={deadlineModalOpen}
        onClose={() => setDeadlineModalOpen(false)}
        title={editingDeadline ? 'Uredi rok' : 'Novi rok / važan datum'}
        footer={(
          <>
            <button type="button" onClick={() => setDeadlineModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Odustani
            </button>
            <button type="button" onClick={() => void saveDeadline()} disabled={savingDeadline || !deadlineForm.naziv.trim() || !deadlineForm.datum} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {savingDeadline ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          <Field label="Naziv *">
            <TextInput value={deadlineForm.naziv} onChange={(event) => setDeadlineForm((previous) => ({ ...previous, naziv: event.target.value }))} placeholder="npr. Dolazak materijala" />
          </Field>
          <Field label="Datum *">
            <TextInput type="date" value={deadlineForm.datum} onChange={(event) => setDeadlineForm((previous) => ({ ...previous, datum: event.target.value }))} />
          </Field>
          <Field label="Napomena">
            <Textarea rows={2} value={deadlineForm.opis} onChange={(event) => setDeadlineForm((previous) => ({ ...previous, opis: event.target.value }))} />
          </Field>
        </div>
      </Modal>
    </aside>
  );
}
