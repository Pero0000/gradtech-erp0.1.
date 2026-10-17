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
  ExternalLink,
  FolderOpen,
} from 'lucide-react';
import type {
  Faktura,
  FakturaStatus,
  Gradiliste,
  GradilisteZadatak,
  Investitor,
  Kooperant,
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
  createKooperant,
  fetchKooperanti,
  fetchInvestitori,
  deleteTrosak,
  fetchFullRekapitulacija,
  createUgovoreniRad,
  deleteUgovoreniRad,
  deleteUgovoreniRadDokument,
  uploadUgovoreniRadDokument,
  updateFaktura,
  updateGradiliste,
  updateTrosak,
  getPrivateFileUrl,
  iznosFakture,
} from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { GradilisteMaterijalDokumenti } from '@/components/views/GradilisteMaterijalDokumenti';
import { GradilisteTroskovnik } from '@/components/views/GradilisteTroskovnik';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, TextInput, Textarea } from '@/components/ui/Field';
import { fetchPonude, fetchSvePonudeStavke, ponudaBroj, ponudaUkupno, updatePonuda, type Ponuda, type PonudaStavka } from '@/lib/ponude';

interface GradilisteDetailsPanelProps {
  gradiliste: Gradiliste;
  onClose: () => void;
  onEdit: () => void;
  onGradilisteUpdate: (updates: Partial<Gradiliste>) => void;
  onRokoviChange?: () => void;
  onOpenNalog?: (nalogId: string) => void;
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
  direktni: 'Direktni trošak',
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

export function GradilisteDetailsPanel({ gradiliste, onClose, onEdit, onGradilisteUpdate, onRokoviChange, onOpenNalog }: GradilisteDetailsPanelProps) {
  const [details, setDetails] = useState<GradilisteDetails | null>(null);
  const [vtrDocumentUrls, setVtrDocumentUrls] = useState<Record<string, string>>({});
  const [openCostGroups, setOpenCostGroups] = useState<Set<string>>(new Set());
  const [satnica, setSatnicaState] = useState<number>(() => {
    const saved = Number(localStorage.getItem('tm_univerzalna_satnica'));
    return saved > 0 ? saved : 18;
  });
  const [showWorkers, setShowWorkersState] = useState(() => localStorage.getItem('tm_netto_po_radnicima') === '1');
  const [showTeren, setShowTerenState] = useState(() => localStorage.getItem('tm_prikaz_teren') !== '0');
  const [showNight, setShowNightState] = useState(() => localStorage.getItem('tm_prikaz_nocna') !== '0');
  const setSatnica = (value: number) => {
    setSatnicaState(value);
    localStorage.setItem('tm_univerzalna_satnica', String(value));
  };
  const setShowWorkers = (value: boolean) => {
    setShowWorkersState(value);
    localStorage.setItem('tm_netto_po_radnicima', value ? '1' : '0');
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
    predvidena_marza: '30',
  });
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Faktura | null>(null);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [invoiceInvestitori, setInvoiceInvestitori] = useState<Investitor[]>([]);
  const [vtrModalOpen, setVtrModalOpen] = useState(false);
  const [savingVtr, setSavingVtr] = useState(false);
  const [loadingVtrOffers, setLoadingVtrOffers] = useState(false);
  const [vtrOffers, setVtrOffers] = useState<Ponuda[]>([]);
  const [vtrOfferLines, setVtrOfferLines] = useState<PonudaStavka[]>([]);
  const [vtrSource, setVtrSource] = useState<'ponuda' | 'rucno'>('ponuda');
  const [vtrOfferMethod, setVtrOfferMethod] = useState<'existing' | 'file'>('existing');
  const [vtrOfferId, setVtrOfferId] = useState('');
  const [vtrFile, setVtrFile] = useState<File | null>(null);
  const [vtrForm, setVtrForm] = useState({ naziv: '', opis: '', ugovoreni_iznos: '', ostvareni_iznos: '0' });
  const [invoiceForm, setInvoiceForm] = useState({
    broj: '',
    investitor_id: gradiliste.objekti?.investitori?.id ?? '',
    kupac: gradiliste.objekti?.investitori?.naziv ?? '',
    iznos: '',
    rabat: '0',
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
    kooperant_id: '',
    novi_kooperant: '',
    opis: '',
    iznos: '',
    datum: new Date().toISOString().slice(0, 10),
  });
  const [kooperanti, setKooperanti] = useState<Kooperant[]>([]);

  useEffect(() => {
    fetchKooperanti().then(setKooperanti).catch(() => setKooperanti([]));
    fetchInvestitori().then(setInvoiceInvestitori).catch(() => setInvoiceInvestitori([]));
  }, []);

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
    const documents = (details?.ugovoreniRadovi ?? []) as UgovoreniRad[];
    const withDocuments = documents.filter((item) => item.dokument_putanja);
    setVtrDocumentUrls({});
    if (withDocuments.length === 0) return;
    let cancelled = false;
    void Promise.all(withDocuments.map(async (item) => [
      item.id,
      await getPrivateFileUrl(item.dokument_putanja!),
    ] as const))
      .then((entries) => {
        if (!cancelled) setVtrDocumentUrls(Object.fromEntries(entries));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errText(reason, 'VTR dokument nije moguće otvoriti.'));
      });
    return () => { cancelled = true; };
  }, [details?.ugovoreniRadovi]);

  useEffect(() => {
    setFinancialForm({
      ugovorena_vrijednost: String(gradiliste.ugovorena_vrijednost ?? 0),
      predvidena_marza: gradiliste.predvidena_marza && gradiliste.ugovorena_vrijednost
        ? String((gradiliste.predvidena_marza / gradiliste.ugovorena_vrijednost) * 100)
        : '30',
    });
  }, [gradiliste.id, gradiliste.ugovorena_vrijednost, gradiliste.predvidena_marza]);

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
    const vtrValue = ((details?.ugovoreniRadovi ?? []) as UgovoreniRad[])
      .filter((item) => item.vrsta === 'vtr')
      .reduce((sum, item) => sum + (item.ugovoreni_iznos ?? 0), 0);
    const currentOffer = (gradiliste.ugovorena_vrijednost ?? 0) + vtrValue;
    setFinancialForm({
      ugovorena_vrijednost: String(gradiliste.ugovorena_vrijednost ?? 0),
      predvidena_marza: gradiliste.predvidena_marza && currentOffer > 0
        ? String((gradiliste.predvidena_marza / currentOffer) * 100)
        : '30',
    });
    setEditingFinancials(true);
    setError(null);
  };

  const saveFinancials = async () => {
    const vtrValue = ((details?.ugovoreniRadovi ?? []) as UgovoreniRad[])
      .filter((item) => item.vrsta === 'vtr')
      .reduce((sum, item) => sum + (item.ugovoreni_iznos ?? 0), 0);
    const currentOffer = (Number(financialForm.ugovorena_vrijednost) || 0) + vtrValue;
    const marginPercent = Number(financialForm.predvidena_marza);
    const updates = {
      ugovorena_vrijednost: Number(financialForm.ugovorena_vrijednost) || 0,
      predvidena_marza: currentOffer * (Number.isFinite(marginPercent) ? marginPercent : 30) / 100,
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
      investitor_id: invoice?.investitor_id ?? gradiliste.objekti?.investitori?.id ?? '',
      kupac: invoice?.kupac ?? gradiliste.objekti?.investitori?.naziv ?? '',
      iznos: invoice ? String(invoice.iznos) : '',
      rabat: String(invoice?.rabat ?? 0),
      datum_izdavanja: invoice?.datum_izdavanja ?? new Date().toISOString().slice(0, 10),
      datum_dospjecja: invoice?.datum_dospjecja ?? '',
      status: invoice?.status ?? 'izdana',
      opis: invoice?.opis ?? '',
    });
    setError(null);
    setInvoiceModalOpen(true);
  };

  const saveInvoice = async () => {
    const iznos = Number(invoiceForm.iznos || 0);
    const rabat = Number(invoiceForm.rabat || 0);
    if (!invoiceForm.broj.trim() || !Number.isFinite(iznos) || !Number.isFinite(rabat) || iznos < 0 || rabat < 0 || iznos + rabat <= 0) return;
    setSavingInvoice(true);
    setError(null);
    const payload = {
      gradiliste_id: gradiliste.id,
      investitor_id: invoiceForm.investitor_id || null,
      broj: invoiceForm.broj.trim(),
      kupac: invoiceForm.kupac.trim() || null,
      iznos,
      rabat,
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

  const invoiceAmount = Number(invoiceForm.iznos || 0);
  const invoiceRabat = Number(invoiceForm.rabat || 0);
  const canSaveInvoice = Boolean(invoiceForm.broj.trim())
    && Number.isFinite(invoiceAmount)
    && Number.isFinite(invoiceRabat)
    && invoiceAmount >= 0
    && invoiceRabat >= 0
    && invoiceAmount + invoiceRabat > 0;

  const openVtrEditor = async () => {
    setError(null);
    setVtrSource('ponuda');
    setVtrOfferMethod('existing');
    setVtrOfferId('');
    setVtrForm({ naziv: '', opis: '', ugovoreni_iznos: '', ostvareni_iznos: '0' });
    setVtrFile(null);
    setVtrModalOpen(true);
    setLoadingVtrOffers(true);
    try {
      const [offers, lines] = await Promise.all([fetchPonude(), fetchSvePonudeStavke()]);
      const siteSearchTerms = [gradiliste.naziv, gradiliste.adresa]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim().toLocaleLowerCase());
      setVtrOffers(offers.filter((offer) => {
        if (offer.status === 'odbijena') return false;
        const linkedByLocation = Boolean(offer.adresa_radova?.trim())
          && siteSearchTerms.some((term) => offer.adresa_radova!.toLocaleLowerCase().includes(term));
        return offer.gradiliste_id === gradiliste.id
          || offer.gradiliste_id === null
          || (Boolean(gradiliste.objekt_id) && offer.objekt_id === gradiliste.objekt_id)
          || linkedByLocation;
      }));
      setVtrOfferLines(lines);
    } catch (reason) {
      setError(errText(reason, 'Greška pri učitavanju potvrđenih ponuda.'));
    } finally {
      setLoadingVtrOffers(false);
    }
  };

  const saveVtr = async () => {
    const selectedOffer = vtrSource === 'ponuda' && vtrOfferMethod === 'existing'
      ? vtrOffers.find((offer) => offer.id === vtrOfferId)
      : undefined;
    const uploadedOffer = vtrSource === 'ponuda' && vtrOfferMethod === 'file';
    if (vtrSource === 'ponuda' && vtrOfferMethod === 'existing' && (!selectedOffer || contractedWorks.some((item) => item.ponuda_id === selectedOffer.id))) return;
    if (vtrSource === 'rucno' && !vtrForm.naziv.trim()) return;
    if (uploadedOffer && (!vtrForm.naziv.trim() || !vtrForm.ugovoreni_iznos || !vtrFile)) return;
    setSavingVtr(true);
    setError(null);
    let dokumentPutanja: string | null = null;
    let created = false;
    try {
      const offerLines = selectedOffer ? vtrOfferLines.filter((line) => line.ponuda_id === selectedOffer.id) : [];
      const offerTotal = selectedOffer ? ponudaUkupno(selectedOffer, offerLines).neto : 0;
      const naziv = selectedOffer ? `VTR · ${selectedOffer.naslov}` : vtrForm.naziv.trim();
      const opis = selectedOffer
        ? `Ponuda ${ponudaBroj(selectedOffer)}${offerLines.length ? `\n${offerLines.map((line) => line.opis).join('\n')}` : ''}`
        : vtrForm.opis.trim() || null;
      if (vtrFile) dokumentPutanja = await uploadUgovoreniRadDokument(gradiliste.id, vtrFile);
      await createUgovoreniRad({
        gradiliste_id: gradiliste.id,
        naziv,
        opis,
        ugovoreni_iznos: selectedOffer ? offerTotal : Number(vtrForm.ugovoreni_iznos) || 0,
        ostvareni_iznos: selectedOffer ? 0 : Number(vtrForm.ostvareni_iznos) || 0,
        status: 'planirano',
        vrsta: 'vtr',
        ponuda_id: selectedOffer?.id ?? null,
        dokument_putanja: dokumentPutanja,
        dokument_naziv: vtrFile?.name ?? null,
      });
      created = true;
      if (selectedOffer && (selectedOffer.status !== 'potvrdena' || selectedOffer.gradiliste_id !== gradiliste.id)) {
        await updatePonuda(selectedOffer.id, { status: 'potvrdena', gradiliste_id: gradiliste.id });
      }
      setVtrModalOpen(false);
      await reloadDetails();
    } catch (reason) {
      const message = errText(reason, 'Greška pri spremanju VTR rada.');
      if (created) {
        setVtrModalOpen(false);
        try {
          await reloadDetails();
        } catch (refreshReason) {
          setError(`VTR rad je spremljen, ali nije dovršena potvrda ponude ili osvježavanje: ${message}. Osvježavanje: ${errText(refreshReason, 'nepoznata greška')}`);
          return;
        }
        setError(`VTR rad je spremljen, ali ponuda nije automatski potvrđena: ${message}`);
        return;
      }
      if (dokumentPutanja) {
        try {
          await deleteUgovoreniRadDokument(dokumentPutanja);
        } catch (cleanupReason) {
          setError(`${message} Datoteku nije bilo moguće očistiti: ${errText(cleanupReason, 'nepoznata greška')}`);
          return;
        }
      }
      setError(message);
    } finally {
      setSavingVtr(false);
    }
  };

  const removeVtr = async (item: UgovoreniRad) => {
    if (!window.confirm(`Obrisati VTR rad „${item.naziv}”?`)) return;
    setError(null);
    try {
      await deleteUgovoreniRad(item.id);
      await reloadDetails();
    } catch (reason) {
      setError(errText(reason, 'Greška pri brisanju VTR rada.'));
      return;
    }
    if (item.dokument_putanja) {
      try {
        await deleteUgovoreniRadDokument(item.dokument_putanja);
      } catch (reason) {
        setError(`VTR rad je obrisan, ali njegova datoteka nije uklonjena: ${errText(reason, 'nepoznata greška')}`);
      }
    }
  };

  const openCostEditor = (cost?: Trosak) => {
    setEditingCost(cost ?? null);
    setCostForm({
      kategorija: cost?.kategorija ?? 'materijal',
      kooperant_id: cost?.kooperant_id ?? '',
      novi_kooperant: '',
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
      kooperant_id: null as string | null,
      opis: costForm.opis.trim(),
      iznos: Number(costForm.iznos),
      datum: costForm.datum,
    };
    try {
      if (costForm.kategorija === 'kooperanti') {
        if (costForm.kooperant_id) payload.kooperant_id = costForm.kooperant_id;
        else if (costForm.novi_kooperant.trim()) {
          const created = await createKooperant({ naziv: costForm.novi_kooperant.trim() });
          payload.kooperant_id = created.id;
          setKooperanti((previous) => [...previous, created].sort((a, b) => a.naziv.localeCompare(b.naziv)));
        }
      }
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
  const vtrAvailableOffers = vtrOffers.filter((offer) => !contractedWorks.some((item) => item.ponuda_id === offer.id));
  const selectedVtrOffer = vtrOffers.find((offer) => offer.id === vtrOfferId);
  const selectedVtrLines = selectedVtrOffer ? vtrOfferLines.filter((line) => line.ponuda_id === selectedVtrOffer.id) : [];
  const selectedVtrOfferTotal = selectedVtrOffer ? ponudaUkupno(selectedVtrOffer, selectedVtrLines).neto : 0;

  const directCosts = costs.reduce((sum, item) => sum + item.iznos, 0) - (showTeren ? 0 : costs.filter((t) => t.kategorija === 'place' && t.opis.startsWith('Teren')).reduce((s, t) => s + t.iznos, 0)) - (showNight ? 0 : costs.filter((t) => t.kategorija === 'place' && t.opis.startsWith('Noćni rad')).reduce((s, t) => s + t.iznos, 0));
  const totalHours = workTime.reduce((sum, item) => sum + item.sati, 0);
  const workerTotals = workTime.reduce<Record<string, { name: string; hours: number; cost: number; rate: number }>>((totals, item) => {
    const key = item.radnik_id;
    const rate = showWorkers ? item.radnici?.cijena_sata ?? satnica : satnica;
    const name = item.radnici ? `${item.radnici.ime} ${item.radnici.prezime}` : 'Nepoznat radnik';
    totals[key] ??= { name, hours: 0, cost: 0, rate };
    totals[key].hours += item.sati;
    totals[key].cost += item.sati * rate;
    return totals;
  }, {});
  const laborCosts = showWorkers
    ? Object.values(workerTotals).reduce((sum, worker) => sum + worker.cost, 0)
    : totalHours * satnica;
  const totalCosts = directCosts + laborCosts;
  const invoiced = invoices.reduce((sum, item) => sum + iznosFakture(item), 0);
  const paid = invoices.filter((item) => item.status === 'placena').reduce((sum, item) => sum + iznosFakture(item), 0);
  const collectionDebt = invoiced - paid;
  const baseOffer = gradiliste.ugovorena_vrijednost ?? 0;
  const vtrOffer = contractedWorks
    .filter((item) => item.vrsta === 'vtr')
    .reduce((sum, item) => sum + (item.ugovoreni_iznos ?? 0), 0);
  const offer = baseOffer + vtrOffer;
  const baseOfferPct = offer > 0 ? (baseOffer / offer) * 100 : 0;
  const vtrOfferPct = offer > 0 ? (vtrOffer / offer) * 100 : 0;
  const offerMargin = offer - totalCosts;
  const plannedMargin = gradiliste.predvidena_marza && gradiliste.predvidena_marza > 0
    ? gradiliste.predvidena_marza
    : offer * 0.3;
  const marginVariance = offerMargin - plannedMargin;
  const marginPct = offer > 0 ? (offerMargin / offer) * 100 : 0;
  const plannedMarginPct = offer > 0 ? (plannedMargin / offer) * 100 : 0;
  const invoicedBalance = invoiced - totalCosts;
  const invoicedMarginPct = invoiced > 0 ? (invoicedBalance / invoiced) * 100 : 0;
  const invoicedPct = offer > 0 ? (invoiced / offer) * 100 : 0;
  const costPct = offer > 0 ? (totalCosts / offer) * 100 : 0;
  const costRow = (t: Trosak) => ({ id: t.id, title: t.opis, sub: `${t.kooperanti?.naziv ? `${t.kooperanti.naziv} · ` : kooperanti.find((k) => k.id === t.kooperant_id)?.naziv ? `${kooperanti.find((k) => k.id === t.kooperant_id)?.naziv} · ` : ''}${expenseLabels[t.kategorija]} · ${date(t.datum)}`, amount: t.iznos, trosak: t });
  const isTeren = (t: Trosak) => t.kategorija === 'place' && t.opis.startsWith('Teren');
  const isNight = (t: Trosak) => t.kategorija === 'place' && t.opis.startsWith('Noćni rad');
  const sumOf = (list: Trosak[]) => list.reduce((s, t) => s + t.iznos, 0);
  const byKat = (k: TrosakKategorija) => costs.filter((t) => t.kategorija === k);
  const terenList = costs.filter(isTeren);
  const nightList = costs.filter(isNight);
  const kmList = byKat('put');
  const otherList = costs.filter((t) => !isTeren(t) && !isNight(t) && !['materijal', 'smjestaj', 'kooperanti', 'direktni', 'put'].includes(t.kategorija));
  const costGroups: { key: string; label: string; hint?: string; total: number; hidden?: boolean; toggle?: 'teren' | 'nocna'; rows: { id: string; title: string; sub?: string; amount: number; trosak?: Trosak }[] }[] = [
    {
      key: 'sati',
      label: 'Utrošeni sati',
      hint: showWorkers
        ? `${totalHours.toLocaleString('hr-HR')} h · neto satnica po radniku`
        : `${totalHours.toLocaleString('hr-HR')} h × ${satnica.toLocaleString('hr-HR')} €`,
      total: laborCosts,
      rows: showWorkers ? Object.entries(workerTotals).map(([id, w]) => ({ id, title: w.name, sub: `${w.hours.toLocaleString('hr-HR')} h × ${w.rate.toLocaleString('hr-HR')} €`, amount: w.cost })) : [],
    },
    { key: 'teren', label: 'Teren', total: showTeren ? sumOf(terenList) : 0, hidden: !showTeren, toggle: 'teren', rows: terenList.map(costRow) },
    { key: 'nocna', label: 'Noćna', total: showNight ? sumOf(nightList) : 0, hidden: !showNight, toggle: 'nocna', rows: nightList.map(costRow) },
    { key: 'materijal', label: 'Materijal', total: sumOf(byKat('materijal')), rows: byKat('materijal').map(costRow) },
    { key: 'smjestaj', label: 'Smještaj', total: sumOf(byKat('smjestaj')), rows: byKat('smjestaj').map(costRow) },
    { key: 'kooperanti', label: 'Kooperanti', total: sumOf(byKat('kooperanti')), rows: byKat('kooperanti').map(costRow) },
    { key: 'direktni', label: 'Direktni troškovi', total: sumOf(byKat('direktni')), rows: byKat('direktni').map(costRow) },
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
          <p className="mt-1 text-xs text-slate-500">Za otvaranje u Exploreru instaliraj pomoćni program iz mape windows-helper.</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <a
            href={`tmcolor-folder://open/${encodeURIComponent(gradiliste.id)}`}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-100"
            title="Otvori lokalnu mapu u Windows Exploreru"
          >
            <FolderOpen className="h-4 w-4" />
            Otvori u Exploreru
          </a>
          <a
            href={`tmcolor-folder://select/${encodeURIComponent(gradiliste.id)}`}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-sky-700"
            aria-label="Odaberi ili promijeni mapu za Windows Explorer"
            title="Odaberi ili promijeni mapu"
          >
            <Pencil className="h-4 w-4" />
          </a>
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
              <Field label="Osnovna ugovorena ponuda">
                <TextInput type="number" min="0" step="0.01" value={financialForm.ugovorena_vrijednost} onChange={(event) => setFinancialForm((previous) => ({ ...previous, ugovorena_vrijednost: event.target.value }))} />
              </Field>
              <Field label="Planirana marža (%)">
                <TextInput type="number" min="0" step="0.1" value={financialForm.predvidena_marza} onChange={(event) => setFinancialForm((previous) => ({ ...previous, predvidena_marza: event.target.value }))} />
              </Field>
              <div className="self-end pb-2 text-[10px] text-slate-500">Naplaćeno i troškovi računaju se iz povezanih zapisa.</div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="min-w-0 rounded-lg border border-sky-100 bg-sky-50 p-2 sm:p-3">
                  <p className="text-[10px] font-bold uppercase text-sky-800">Ponuda (ugovoreno)</p>
                  <p className="mt-1 break-words text-sm font-bold text-slate-900 sm:text-base">{currency(offer)}</p>
                  <div className="mt-1 space-y-0.5 border-t border-sky-100 pt-1 text-[10px] text-sky-800">
                    <p className="flex justify-between gap-2">
                      <span>Osnovna ponuda ({baseOfferPct.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} %)</span>
                      <span>{currency(baseOffer)}</span>
                    </p>
                    <p className="flex justify-between gap-2">
                      <span>VTR ({vtrOfferPct.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} %)</span>
                      <span>{currency(vtrOffer)}</span>
                    </p>
                  </div>
                </div>
                <div className="min-w-0 rounded-lg border border-red-100 bg-red-50 p-2 sm:p-3">
                  <p className="text-[10px] font-bold uppercase text-red-800">Trošak</p>
                  <p className="mt-1 break-words text-sm font-bold text-red-800 sm:text-base">{currency(totalCosts)}</p>
                  <p className="mt-0.5 text-[10px] text-red-700">Direktno {currency(directCosts)} · Rad {currency(laborCosts)}</p>
                </div>
                <div className={`min-w-0 rounded-lg border p-2 sm:p-3 ${offerMargin >= 0 ? 'border-emerald-100 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                  <p className={`text-[10px] font-bold uppercase ${offerMargin >= 0 ? 'text-emerald-900' : 'text-rose-800'}`}>Razlika ponuda − trošak</p>
                  <p className={`mt-1 break-words text-sm font-bold sm:text-base ${offerMargin >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>{currency(offerMargin)}</p>
                  <p className={`mt-0.5 text-[10px] ${offerMargin >= 0 ? 'text-emerald-800' : 'text-rose-700'}`}>
                    Marža {offer > 0 ? `${marginPct.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} %` : '—'}
                    {(gradiliste.predvidena_marza ?? 0) > 0 && ` · planirano ${currency(gradiliste.predvidena_marza ?? 0)}`}
                  </p>
                </div>
                <div className="min-w-0 rounded-lg border border-violet-100 bg-violet-50 p-2 sm:p-3">
                  <p className="text-[10px] font-bold uppercase text-violet-900">Fakturirano</p>
                  <p className="mt-1 break-words text-sm font-bold text-violet-800 sm:text-base">{currency(invoiced)}</p>
                  <p className="mt-0.5 text-[10px] text-violet-800">
                    {offer > 0 ? `${invoicedPct.toLocaleString('hr-HR', { maximumFractionDigits: 0 })} % ponude · ` : ''}za fakturirati {currency(Math.max(0, offer - invoiced))}
                  </p>
                </div>
                <div className={`min-w-0 rounded-lg border p-2 sm:p-3 ${invoicedBalance >= 0 ? 'border-teal-100 bg-teal-50' : 'border-rose-200 bg-rose-50'}`}>
                  <p className={`text-[10px] font-bold uppercase ${invoicedBalance >= 0 ? 'text-teal-900' : 'text-rose-800'}`}>Razlika fakturirano − trošak</p>
                  <p className={`mt-1 break-words text-sm font-bold sm:text-base ${invoicedBalance >= 0 ? 'text-teal-800' : 'text-rose-800'}`}>{currency(invoicedBalance)}</p>
                  <p className={`mt-0.5 text-[10px] ${invoicedBalance >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>
                    {invoiced > 0 ? `Marža na fakturirano ${invoicedMarginPct.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} %` : 'Nema faktura'}
                  </p>
                </div>
                <div className="min-w-0 rounded-lg border border-amber-100 bg-amber-50 p-2 sm:p-3">
                  <p className="text-[10px] font-bold uppercase text-amber-900">Preostalo za naplatu</p>
                  <p className="mt-1 break-words text-sm font-bold text-amber-900 sm:text-base">{currency(offer - invoiced)}</p>
                  <p className="mt-0.5 text-[10px] text-amber-800">Ponuda {currency(offer)} − fakturirano {currency(invoiced)}</p>
                </div>
                <div className="min-w-0 rounded-lg border border-emerald-100 bg-emerald-50 p-2 sm:p-3">
                  <p className="text-[10px] font-bold uppercase text-emerald-900">Naplaćeno</p>
                  <p className="mt-1 break-words text-sm font-bold text-emerald-800 sm:text-base">{currency(paid)}</p>
                  <p className="mt-0.5 text-[10px] text-emerald-800">{offer > 0 ? `${((paid / offer) * 100).toLocaleString('hr-HR', { maximumFractionDigits: 1 })} % ponude` : 'Plaćene fakture'}</p>
                </div>
                <div className={`min-w-0 rounded-lg border p-2 sm:p-3 ${collectionDebt > 0 ? 'border-amber-100 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                  <p className={`text-[10px] font-bold uppercase ${collectionDebt > 0 ? 'text-amber-900' : 'text-slate-700'}`}>Dug za naplatu</p>
                  <p className={`mt-1 break-words text-sm font-bold sm:text-base ${collectionDebt > 0 ? 'text-amber-900' : 'text-slate-800'}`}>{currency(collectionDebt)}</p>
                  <p className={`mt-0.5 text-[10px] ${collectionDebt > 0 ? 'text-amber-800' : 'text-slate-600'}`}>Fakturirano {currency(invoiced)} − naplaćeno {currency(paid)}</p>
                </div>
                <div className={`min-w-0 rounded-lg border p-2 sm:p-3 ${marginVariance >= 0 ? 'border-teal-100 bg-teal-50' : 'border-rose-200 bg-rose-50'}`}>
                  <p className={`text-[10px] font-bold uppercase ${marginVariance >= 0 ? 'text-teal-900' : 'text-rose-800'}`}>Planirana vs. stvarna marža</p>
                  <p className={`mt-1 break-words text-sm font-bold sm:text-base ${marginVariance >= 0 ? 'text-teal-800' : 'text-rose-800'}`}>{currency(plannedMargin)} / {currency(offerMargin)}</p>
                  <p className={`mt-0.5 text-[10px] ${marginVariance >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>
                    Planirana {plannedMarginPct.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} % · stvarna {marginPct.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} % · razlika {currency(marginVariance)}
                  </p>
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

            <GradilisteMaterijalDokumenti gradilisteId={gradiliste.id} />

            <Section title={`Radni nalozi (${tasks.length})`} icon={<ClipboardList className="h-4 w-4" />}>
              {tasks.length === 0 ? <p className="text-xs text-slate-400">Nema radnih naloga.</p> : (
                <div className="space-y-2">
                  {tasks.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => onOpenNalog?.(item.id)}
                      className="flex w-full items-start justify-between gap-3 rounded-md px-1.5 py-1 text-left text-xs hover:bg-sky-50"
                      title="Otvori radni nalog"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800">{item.broj} · {item.naslov}</p>
                        <p className="text-slate-500">{item.prioritet} · rok {date(item.rok)}</p>
                      </div>
                      <span className="flex-shrink-0 text-slate-500">{item.status.replace('_', ' ')}</span>
                    </button>
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

            <Section
              title={`Ugovoreni radovi (${contractedWorks.length})`}
              icon={<FileText className="h-4 w-4" />}
              action={(
                <button type="button" onClick={() => void openVtrEditor()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50">
                  <Plus className="h-3.5 w-3.5" />
                  Dodaj VTR rad
                </button>
              )}
            >
              {contractedWorks.length === 0 ? <p className="text-xs text-slate-400">Nema ugovorenih radova.</p> : (
                <div className="space-y-2">
                  {contractedWorks.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-3 rounded-md border border-slate-100 px-2 py-1.5 text-xs">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {item.vrsta === 'vtr' && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">VTR</span>}
                          <span className="text-slate-700">{item.naziv}</span>
                        </div>
                        {item.opis && <p className="mt-1 whitespace-pre-line text-[10px] text-slate-500">{item.opis}</p>}
                        {item.dokument_putanja && item.dokument_naziv && (
                          <a
                            href={vtrDocumentUrls[item.id] ?? '#'}
                            aria-disabled={!vtrDocumentUrls[item.id]}
                            onClick={(event) => { if (!vtrDocumentUrls[item.id]) event.preventDefault(); }}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[10px] text-sky-700 hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {item.dokument_naziv}
                          </a>
                        )}
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <span className="font-medium text-slate-600">{currency(item.ostvareni_iznos ?? 0)} / {currency(item.ugovoreni_iznos)}</span>
                        {item.vrsta === 'vtr' && (
                          <button type="button" onClick={() => void removeVtr(item)} className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600" aria-label={`Obriši VTR rad ${item.naziv}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <GradilisteTroskovnik gradilisteId={gradiliste.id} naziv={gradiliste.naziv} />

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
                      <span className="text-right">
                        <span className="block font-medium text-slate-600">{currency(iznosFakture(item))}</span>
                        {item.rabat > 0 && <span className="block text-[10px] text-slate-400">{currency(item.iznos)} + rabat {currency(item.rabat)}</span>}
                      </span>
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
            <button type="button" onClick={saveInvoice} disabled={savingInvoice || !canSaveInvoice} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
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
          <Field label="Investitor">
            <Select
              value={invoiceForm.investitor_id}
              onChange={(event) => {
                const investor = invoiceInvestitori.find((item) => item.id === event.target.value);
                setInvoiceForm((previous) => ({ ...previous, investitor_id: event.target.value, kupac: investor?.naziv ?? previous.kupac }));
              }}
            >
              <option value="">— Odaberi investitora —</option>
              {invoiceInvestitori.map((investor) => <option key={investor.id} value={investor.id}>{investor.naziv}</option>)}
            </Select>
          </Field>
          <Field label="Kupac">
            <TextInput value={invoiceForm.kupac} onChange={(event) => setInvoiceForm((previous) => ({ ...previous, kupac: event.target.value }))} />
          </Field>
          <Field label="Osnovni iznos (EUR)">
            <TextInput type="number" min="0" step="0.01" value={invoiceForm.iznos} onChange={(event) => setInvoiceForm((previous) => ({ ...previous, iznos: event.target.value }))} />
          </Field>
          <Field label="Rabat (EUR, pribraja se)">
            <TextInput type="number" min="0" step="0.01" value={invoiceForm.rabat} onChange={(event) => setInvoiceForm((previous) => ({ ...previous, rabat: event.target.value }))} />
          </Field>
          <p className="-mt-2 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
            Ukupna izlazna faktura: <strong>{((Number(invoiceForm.iznos) || 0) + (Number(invoiceForm.rabat) || 0)).toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}</strong>
          </p>
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
        open={vtrModalOpen}
        onClose={() => setVtrModalOpen(false)}
        title="Dodaj VTR rad"
        footer={(
          <>
            <button type="button" onClick={() => setVtrModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Odustani
            </button>
            <button
              type="button"
              onClick={() => void saveVtr()}
              disabled={savingVtr || (vtrSource === 'ponuda'
                ? vtrOfferMethod === 'existing'
                  ? !vtrOfferId || loadingVtrOffers
                  : !vtrForm.naziv.trim() || !vtrForm.ugovoreni_iznos || !vtrFile
                : !vtrForm.naziv.trim())}
              className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
            >
              {savingVtr ? 'Spremanje…' : 'Spremi VTR rad'}
            </button>
          </>
        )}
      >
        {error && <p className="mb-3 rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}
        <div className="space-y-3">
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">VTR rad će biti povezan s gradilištem <strong>{gradiliste.naziv}</strong>.</p>
          <Field label="Način unosa">
            <Select value={vtrSource} onChange={(event) => setVtrSource(event.target.value as 'ponuda' | 'rucno')}>
              <option value="ponuda">Ugovorena ponuda</option>
              <option value="rucno">Ručni unos</option>
            </Select>
          </Field>
          {vtrSource === 'ponuda' ? (
            <>
              <Field label="Izvor ugovorene ponude">
                <Select value={vtrOfferMethod} onChange={(event) => setVtrOfferMethod(event.target.value as 'existing' | 'file')}>
                  <option value="existing">Odaberi postojeću ponudu iz aplikacije</option>
                  <option value="file">Učitaj ponudu kao datoteku</option>
                </Select>
              </Field>
              {vtrOfferMethod === 'existing' ? (
                <>
                  <Field label="Potvrđena ponuda *">
                    <Select
                      value={vtrOfferId}
                      disabled={loadingVtrOffers}
                      onChange={(event) => setVtrOfferId(event.target.value)}
                    >
                      <option value="">{loadingVtrOffers ? 'Učitavanje ponuda…' : '— Odaberi ponudu —'}</option>
                      {vtrAvailableOffers.map((offer) => (
                        <option key={offer.id} value={offer.id}>
                          {ponudaBroj(offer)} · {offer.naslov}
                          {offer.adresa_radova ? ` · ${offer.adresa_radova}` : ''}
                          {offer.status === 'nepotvrdena' ? ' · nepotvrđena (potvrdit će se)' : ' · potvrđena'}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {!loadingVtrOffers && vtrAvailableOffers.length === 0 && (
                    <p className="text-xs text-slate-500">Nema novih potvrđenih ponuda povezanih s ovim gradilištem. Možeš učitati ponudu ili odabrati ručni unos.</p>
                  )}
                  {selectedVtrOffer && (
                    <div className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
                      Ugovoreni iznos bez PDV-a: <strong>{currency(selectedVtrOfferTotal)}</strong>
                      {selectedVtrLines.length > 0 && <span> · {selectedVtrLines.length} stavki ponude</span>}
                    </div>
                  )}
                  <Field label="Priložiti dodatni dokument (neobavezno)">
                    <TextInput type="file" onChange={(event) => setVtrFile(event.target.files?.[0] ?? null)} />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Naziv VTR rada *">
                    <TextInput value={vtrForm.naziv} onChange={(event) => setVtrForm((previous) => ({ ...previous, naziv: event.target.value }))} placeholder="Naziv rada iz ponude" />
                  </Field>
                  <Field label="Ugovoreni iznos (EUR) *">
                    <TextInput type="number" min="0" step="0.01" value={vtrForm.ugovoreni_iznos} onChange={(event) => setVtrForm((previous) => ({ ...previous, ugovoreni_iznos: event.target.value }))} />
                  </Field>
                  <Field label="Datoteka ponude *">
                    <TextInput type="file" onChange={(event) => setVtrFile(event.target.files?.[0] ?? null)} />
                  </Field>
                </>
              )}
            </>
          ) : (
            <>
              <Field label="Naziv rada *">
                <TextInput value={vtrForm.naziv} onChange={(event) => setVtrForm((previous) => ({ ...previous, naziv: event.target.value }))} placeholder="Naziv VTR rada" />
              </Field>
              <Field label="Opis">
                <Textarea rows={3} value={vtrForm.opis} onChange={(event) => setVtrForm((previous) => ({ ...previous, opis: event.target.value }))} placeholder="Opis ili stavke rada" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Ugovoreni iznos (EUR)">
                  <TextInput type="number" min="0" step="0.01" value={vtrForm.ugovoreni_iznos} onChange={(event) => setVtrForm((previous) => ({ ...previous, ugovoreni_iznos: event.target.value }))} />
                </Field>
                <Field label="Ostvareni iznos (EUR)">
                  <TextInput type="number" min="0" step="0.01" value={vtrForm.ostvareni_iznos} onChange={(event) => setVtrForm((previous) => ({ ...previous, ostvareni_iznos: event.target.value }))} />
                </Field>
              </div>
              <Field label="Priložiti dokument (neobavezno)">
                <TextInput type="file" onChange={(event) => setVtrFile(event.target.files?.[0] ?? null)} />
              </Field>
            </>
          )}
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
              <option value="direktni">Direktni trošak</option>
              <option value="ostalo">Ostalo</option>
            </Select>
          </Field>
          {costForm.kategorija === 'kooperanti' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kooperant">
                <Select value={costForm.kooperant_id} onChange={(event) => setCostForm((previous) => ({ ...previous, kooperant_id: event.target.value }))}>
                  <option value="">— Odaberi —</option>
                  {kooperanti.map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}
                </Select>
              </Field>
              <Field label="ili novi kooperant">
                <TextInput value={costForm.novi_kooperant} disabled={!!costForm.kooperant_id} onChange={(event) => setCostForm((previous) => ({ ...previous, novi_kooperant: event.target.value }))} placeholder="Naziv" />
              </Field>
            </div>
          )}
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
