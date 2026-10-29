import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Handshake,
  Pencil,
  Plus,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type {
  Faktura,
  Gradiliste,
  Kooperant,
  KooperantAngazman,
  KooperantDokument,
  KooperantDokumentVrsta,
  KooperantAngazmanStatus,
  Trosak,
} from '@/types';
import { parseKooperantRacun } from '@/lib/aiKooperantRacun';
import type { KooperantRacun, KooperantRacunStavka } from '@/lib/aiKooperantRacun';
import {
  createKooperant,
  createTrosak,
  createTroskovi,
  deleteKooperant,
  deleteKooperantDokument,
  deleteKooperantRacun,
  deleteTrosak,
  fetchFakture,
  fetchGradilista,
  fetchKooperantAngazmani,
  fetchKooperantDokumenti,
  fetchKooperanti,
  fetchTroskovi,
  getKooperantDokumentUrl,
  saveKooperantAngazman,
  updateKooperantDokumentGradiliste,
  updateKooperantRacunPaid,
  updateKooperant,
  updateTrosak,
  uploadKooperantDokument,
  iznosFakture,
} from '@/lib/api';
import { useAuth } from '@/auth/useAuth';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ExportMenu } from '@/components/ui/ExportMenu';
import { Field, Select, Textarea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';

const emptyForm = {
  naziv: '',
  djelatnost: '',
  oib: '',
  iban: '',
  adresa: '',
  mjesto: '',
  postanski_broj: '',
  kontakt_osoba: '',
  telefon: '',
  email: '',
  web: '',
  napomena: '',
};

const emptyEngagementForm = {
  gradiliste_id: '',
  dogovoreni_iznos: '',
  status: 'aktivno' as KooperantAngazmanStatus,
  datum_pocetka: new Date().toISOString().slice(0, 10),
  datum_zavrsetka: '',
  napomena: '',
};

const emptyCostForm = {
  gradiliste_id: '',
  opis: '',
  iznos: '',
  datum: new Date().toISOString().slice(0, 10),
};

const eur = (value: number) => value.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const displayDate = (value: string | null | undefined) =>
  value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('hr-HR') : '—';

const documentTypes: { value: KooperantDokumentVrsta; label: string }[] = [
  { value: 'ugovor', label: 'Ugovori' },
  { value: 'licenca', label: 'Licence' },
  { value: 'atest', label: 'Atesti' },
  { value: 'osiguranje', label: 'Osiguranja' },
  { value: 'ponuda', label: 'Ponude' },
  { value: 'racun', label: 'Računi' },
];

type ProfileTab = 'pregled' | 'aktivna' | 'povijest' | 'ponude' | 'dokumenti' | 'aktivnosti';

interface CostDisplayGroup {
  key: string;
  costs: Trosak[];
  invoice: boolean;
  invoiceId: string | null;
}

function groupCostsForDisplay(costs: Trosak[]): CostDisplayGroup[] {
  const groups = new Map<string, CostDisplayGroup>();
  for (const cost of costs) {
    const key = cost.kooperant_racun_id ? `invoice:${cost.kooperant_racun_id}` : `cost:${cost.id}`;
    const group = groups.get(key) ?? {
      key,
      costs: [],
      invoice: Boolean(cost.kooperant_racun_id),
      invoiceId: cost.kooperant_racun_id ?? null,
    };
    group.costs.push(cost);
    groups.set(key, group);
  }
  return [...groups.values()];
}

interface EngagementRow {
  id: string;
  kooperant_id: string;
  gradiliste_id: string;
  dogovoreni_iznos: number | null;
  status: KooperantAngazmanStatus;
  datum_pocetka: string | null;
  datum_zavrsetka: string | null;
  napomena: string | null;
  created_at: string;
  updated_at: string;
  gradiliste: Pick<Gradiliste, 'id' | 'naziv' | 'status' | 'datum_pocetka' | 'datum_zavrsetka' | 'ugovorena_vrijednost'> | null;
}

function errorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'object' && reason !== null && 'message' in reason && typeof reason.message === 'string') return reason.message;
  return 'Došlo je do greške.';
}

function statusLabel(status: KooperantAngazmanStatus) {
  if (status === 'aktivno') return 'Aktivno';
  return status === 'zavrseno' ? 'Završeno' : 'Otkazano';
}

function effectiveEngagementStatus(engagement: Pick<EngagementRow, 'status' | 'gradiliste'>): KooperantAngazmanStatus {
  if (engagement.gradiliste?.status === 'zavrseno' || engagement.gradiliste?.status === 'neplaceno') return 'zavrseno';
  return engagement.status;
}

function statusVariant(status: KooperantAngazmanStatus): 'green' | 'gray' | 'red' {
  return status === 'aktivno' ? 'green' : status === 'zavrseno' ? 'gray' : 'red';
}

export function KooperantiView() {
  const { canAccess } = useAuth();
  const canEditKooperanti = canAccess('kooperanti', 'edit');
  const canEditCosts = canAccess('troskovi', 'edit');
  const canViewSites = canAccess('gradilista', 'view');
  const canViewInvoices = canAccess('fakture', 'view');
  const [items, setItems] = useState<Kooperant[]>([]);
  const [troskovi, setTroskovi] = useState<Trosak[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [fakture, setFakture] = useState<Faktura[]>([]);
  const [angazmani, setAngazmani] = useState<KooperantAngazman[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Kooperant | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Kooperant | null>(null);
  const [selected, setSelected] = useState<Kooperant | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>('pregled');
  const [documents, setDocuments] = useState<KooperantDokument[]>([]);
  const [documentUrls, setDocumentUrls] = useState<Record<string, string>>({});
  const [documentType, setDocumentType] = useState<KooperantDokumentVrsta>('ugovor');
  const [uploading, setUploading] = useState(false);
  const [pendingDocumentDelete, setPendingDocumentDelete] = useState<KooperantDokument | null>(null);
  const [pendingCostDelete, setPendingCostDelete] = useState<CostDisplayGroup | null>(null);
  const [deletingCost, setDeletingCost] = useState(false);
  const [engagementForm, setEngagementForm] = useState(emptyEngagementForm);
  const [editingEngagementId, setEditingEngagementId] = useState<string | null>(null);
  const [showEngagementForm, setShowEngagementForm] = useState(false);
  const [savingEngagement, setSavingEngagement] = useState(false);
  const [showCostForm, setShowCostForm] = useState(false);
  const [costForm, setCostForm] = useState(emptyCostForm);
  const [savingCost, setSavingCost] = useState(false);
  const [invoiceDraft, setInvoiceDraft] = useState<{ file: File; data: KooperantRacun } | null>(null);
  const [invoiceSiteId, setInvoiceSiteId] = useState('');
  const [analyzingInvoice, setAnalyzingInvoice] = useState(false);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [updatingOfferId, setUpdatingOfferId] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    if (!showLoading) setProfileError(null);
    try {
      const [nextItems, nextCosts, nextEngagements, nextSites, nextInvoices] = await Promise.all([
        fetchKooperanti(),
        fetchTroskovi(),
        fetchKooperantAngazmani(),
        canViewSites ? fetchGradilista() : Promise.resolve([]),
        canViewInvoices ? fetchFakture() : Promise.resolve([]),
      ]);
      setItems(nextItems);
      setTroskovi(nextCosts);
      setAngazmani(nextEngagements);
      setGradilista(nextSites);
      setFakture(nextInvoices);
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      if (!showLoading) setProfileError(message);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [canViewInvoices, canViewSites]);

  useEffect(() => {
    void load();
  }, [load]);

  const byKooperant = useMemo(() => {
    const map = new Map<string, Trosak[]>();
    for (const cost of troskovi) {
      if (!cost.kooperant_id) continue;
      const list = map.get(cost.kooperant_id) ?? [];
      list.push(cost);
      map.set(cost.kooperant_id, list);
    }
    return map;
  }, [troskovi]);

  const engagementsByKooperant = useMemo(() => {
    const map = new Map<string, EngagementRow[]>();
    const known = new Set<string>();
    for (const engagement of angazmani) {
      known.add(`${engagement.kooperant_id}:${engagement.gradiliste_id}`);
      const row: EngagementRow = {
        ...engagement,
        gradiliste: engagement.gradilista
          ? {
            id: engagement.gradilista.id,
            naziv: engagement.gradilista.naziv,
            status: engagement.gradilista.status,
            datum_pocetka: engagement.gradilista.datum_pocetka,
            datum_zavrsetka: engagement.gradilista.datum_zavrsetka,
            ugovorena_vrijednost: engagement.gradilista.ugovorena_vrijednost,
          }
          : null,
      };
      const list = map.get(engagement.kooperant_id) ?? [];
      list.push(row);
      map.set(engagement.kooperant_id, list);
    }
    for (const cost of troskovi) {
      if (!cost.kooperant_id || !cost.gradiliste_id) continue;
      const key = `${cost.kooperant_id}:${cost.gradiliste_id}`;
      if (known.has(key)) continue;
      known.add(key);
      const site = gradilista.find((item) => item.id === cost.gradiliste_id);
      const row: EngagementRow = {
        id: `legacy:${key}`,
        kooperant_id: cost.kooperant_id,
        gradiliste_id: cost.gradiliste_id,
        dogovoreni_iznos: null,
        status: site?.status === 'aktivno' ? 'aktivno' : 'zavrseno',
        datum_pocetka: cost.datum,
        datum_zavrsetka: null,
        napomena: null,
        created_at: cost.created_at,
        updated_at: cost.created_at,
        gradiliste: site
          ? {
            id: site.id,
            naziv: site.naziv,
            status: site.status,
            datum_pocetka: site.datum_pocetka,
            datum_zavrsetka: site.datum_zavrsetka,
            ugovorena_vrijednost: site.ugovorena_vrijednost,
          }
          : cost.gradilista
            ? {
              id: cost.gradilista.id,
              naziv: cost.gradilista.naziv,
              status: 'zavrseno',
              datum_pocetka: null,
              datum_zavrsetka: null,
              ugovorena_vrijednost: null,
            }
            : null,
      };
      const list = map.get(cost.kooperant_id) ?? [];
      list.push(row);
      map.set(cost.kooperant_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (b.datum_pocetka ?? b.datum_zavrsetka ?? b.created_at.slice(0, 10))
        .localeCompare(a.datum_pocetka ?? a.datum_zavrsetka ?? a.created_at.slice(0, 10)));
    }
    return map;
  }, [angazmani, troskovi, gradilista]);

  const summaryFor = (kooperantId: string) => {
    const expenses = byKooperant.get(kooperantId) ?? [];
    const jobs = engagementsByKooperant.get(kooperantId) ?? [];
    const thisYear = String(new Date().getFullYear());
    const total = expenses.reduce((sum, item) => sum + item.iznos, 0);
    const annual = expenses.filter((item) => item.datum.slice(0, 4) === thisYear).reduce((sum, item) => sum + item.iznos, 0);
    const openExpenses = expenses.filter((item) => !item.placen);
    const uniqueSites = new Set(jobs.map((item) => item.gradiliste_id));
    return {
      total,
      annual,
      openCount: openExpenses.length,
      openTotal: openExpenses.reduce((sum, item) => sum + item.iznos, 0),
      siteCount: uniqueSites.size,
      activeCount: jobs.filter((item) => effectiveEngagementStatus(item) === 'aktivno').length,
      activeAgreedTotal: jobs
        .filter((item) => effectiveEngagementStatus(item) === 'aktivno')
        .reduce((sum, item) => sum + (item.dogovoreni_iznos ?? 0), 0),
      average: uniqueSites.size ? total / uniqueSites.size : 0,
      lastEngagement: jobs[0] ?? null,
      engagementCount: jobs.length,
    };
  };

  const filtered = items.filter((item) => {
    const q = query.trim().toLocaleLowerCase('hr');
    return !q || [item.naziv, item.djelatnost, item.oib, item.kontakt_osoba, item.mjesto, item.telefon, item.email]
      .some((value) => (value ?? '').toLocaleLowerCase('hr').includes(q));
  });

  const openForm = (kooperant?: Kooperant) => {
    setEditing(kooperant ?? null);
    setForm(kooperant ? {
      naziv: kooperant.naziv,
      djelatnost: kooperant.djelatnost ?? '',
      oib: kooperant.oib ?? '',
      iban: kooperant.iban ?? '',
      adresa: kooperant.adresa ?? '',
      mjesto: kooperant.mjesto ?? '',
      postanski_broj: kooperant.postanski_broj ?? '',
      kontakt_osoba: kooperant.kontakt_osoba ?? '',
      telefon: kooperant.telefon ?? '',
      email: kooperant.email ?? '',
      web: kooperant.web ?? '',
      napomena: kooperant.napomena ?? '',
    } : emptyForm);
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.naziv.trim()) return;
    setSaving(true);
    setError(null);
    const payload = {
      naziv: form.naziv.trim(),
      djelatnost: form.djelatnost.trim() || null,
      oib: form.oib.trim() || null,
      iban: form.iban.trim() || null,
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
      if (editing) await updateKooperant(editing.id, payload);
      else await createKooperant(payload);
      setModalOpen(false);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setError(null);
    try {
      await deleteKooperant(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const openProfile = async (kooperant: Kooperant) => {
    setSelected(kooperant);
    setActiveTab('pregled');
    setShowCostForm(false);
    setShowEngagementForm(false);
    setInvoiceDraft(null);
    setInvoiceSiteId('');
    setProfileError(null);
    setDocuments([]);
    setDocumentUrls({});
    try {
      const nextDocuments = await fetchKooperantDokumenti(kooperant.id);
      setDocuments(nextDocuments);
      const results = await Promise.all(nextDocuments.map(async (document) => {
        try {
          return { id: document.id, url: await getKooperantDokumentUrl(document.putanja), error: null };
        } catch (reason) {
          return { id: document.id, url: null, error: errorMessage(reason) };
        }
      }));
      setDocumentUrls(Object.fromEntries(results.flatMap((result) => result.url ? [[result.id, result.url]] : [])));
      const failedUrl = results.find((result) => result.error);
      if (failedUrl?.error) setProfileError(`Dokumenti su učitani, ali poveznica nije dostupna: ${failedUrl.error}`);
    } catch (reason) {
      setProfileError(errorMessage(reason));
    }
  };

  const openEngagementForm = (engagement?: EngagementRow) => {
    setEditingEngagementId(engagement && !engagement.id.startsWith('legacy:') ? engagement.id : null);
    setEngagementForm(engagement ? {
      gradiliste_id: engagement.gradiliste_id,
      dogovoreni_iznos: engagement.dogovoreni_iznos === null ? '' : String(engagement.dogovoreni_iznos),
      status: engagement.status,
      datum_pocetka: engagement.datum_pocetka ?? '',
      datum_zavrsetka: engagement.datum_zavrsetka ?? '',
      napomena: engagement.napomena ?? '',
    } : emptyEngagementForm);
    setShowEngagementForm(true);
  };

  const saveEngagement = async () => {
    if (!selected || !engagementForm.gradiliste_id) return;
    const amount = engagementForm.dogovoreni_iznos.trim() ? Number(engagementForm.dogovoreni_iznos) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setProfileError('Dogovoreni iznos mora biti nula ili pozitivan broj.');
      return;
    }
    setSavingEngagement(true);
    setProfileError(null);
    try {
      await saveKooperantAngazman({
        kooperant_id: selected.id,
        gradiliste_id: engagementForm.gradiliste_id,
        dogovoreni_iznos: amount,
        status: engagementForm.status,
        datum_pocetka: engagementForm.datum_pocetka || null,
        datum_zavrsetka: engagementForm.datum_zavrsetka || null,
        napomena: engagementForm.napomena.trim() || null,
      }, editingEngagementId ?? undefined);
      setShowEngagementForm(false);
      setEditingEngagementId(null);
      await load(false);
    } catch (reason) {
      setProfileError(errorMessage(reason));
    } finally {
      setSavingEngagement(false);
    }
  };

  const saveCost = async () => {
    if (!selected || !costForm.opis.trim() || !costForm.iznos.trim()) return;
    const amount = Number(costForm.iznos);
    if (!Number.isFinite(amount) || amount <= 0) {
      setProfileError('Unesi ispravan iznos veći od nule.');
      return;
    }
    setSavingCost(true);
    setProfileError(null);
    try {
      await createTrosak({
        gradiliste_id: costForm.gradiliste_id || null,
        kategorija: 'kooperanti',
        kooperant_id: selected.id,
        opis: costForm.opis.trim(),
        iznos: amount,
        datum: costForm.datum,
        placen: false,
      });
      setCostForm(emptyCostForm);
      setShowCostForm(false);
      await load(false);
    } catch (reason) {
      setProfileError(errorMessage(reason));
    } finally {
      setSavingCost(false);
    }
  };

  const toggleCostPaid = async (cost: Trosak) => {
    setProfileError(null);
    try {
      const placen = !cost.placen;
      const placenoAt = placen ? new Date().toISOString().slice(0, 10) : null;
      if (selected && cost.kooperant_racun_id) {
        await updateKooperantRacunPaid(selected.id, cost.kooperant_racun_id, placen, placenoAt);
      } else {
        await updateTrosak(cost.id, { placen, placeno_at: placenoAt });
      }
      await load(false);
    } catch (reason) {
      setProfileError(errorMessage(reason));
    }
  };

  const uploadDocument = async (file: File | undefined) => {
    if (!selected || !file) return;
    setUploading(true);
    setProfileError(null);
    try {
      const saved = await uploadKooperantDokument(selected.id, documentType === 'ponuda' ? 'ugovor' : documentType, file);
      setDocuments((current) => [saved, ...current]);
      try {
        const url = await getKooperantDokumentUrl(saved.putanja);
        setDocumentUrls((current) => ({ ...current, [saved.id]: url }));
      } catch (reason) {
        setProfileError(`Dokument je učitan, ali poveznica nije dostupna: ${errorMessage(reason)}`);
      }
    } catch (reason) {
      setProfileError(errorMessage(reason));
    } finally {
      setUploading(false);
    }
  };

  const uploadOffer = async (file: File | undefined) => {
    if (!selected || !file) return;
    setUploading(true);
    setProfileError(null);
    try {
      const saved = await uploadKooperantDokument(selected.id, 'ponuda', file);
      setDocuments((current) => [saved, ...current]);
      try {
        const url = await getKooperantDokumentUrl(saved.putanja);
        setDocumentUrls((current) => ({ ...current, [saved.id]: url }));
      } catch (reason) {
        setProfileError(`Ponuda je učitana, ali poveznica nije dostupna: ${errorMessage(reason)}`);
      }
    } catch (reason) {
      setProfileError(errorMessage(reason));
    } finally {
      setUploading(false);
    }
  };

  const attachOfferToSite = async (document: KooperantDokument, gradilisteId: string) => {
    setUpdatingOfferId(document.id);
    setProfileError(null);
    try {
      const updated = await updateKooperantDokumentGradiliste(document.id, gradilisteId || null);
      setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) {
      setProfileError(errorMessage(reason));
    } finally {
      setUpdatingOfferId(null);
    }
  };

  const analyzeInvoice = async (file: File | undefined) => {
    if (!file) return;
    setAnalyzingInvoice(true);
    setProfileError(null);
    setInvoiceDraft(null);
    try {
      const data = await parseKooperantRacun(file);
      setInvoiceDraft({ file, data });
    } catch (reason) {
      setProfileError(errorMessage(reason));
    } finally {
      setAnalyzingInvoice(false);
    }
  };

  const updateInvoiceLine = (index: number, key: keyof KooperantRacunStavka, value: string) => {
    setInvoiceDraft((current) => {
      if (!current) return current;
      const stavke = current.data.stavke.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        if (key === 'opis' || key === 'jedinica') return { ...item, [key]: value };
        const number = Number(value);
        return { ...item, [key]: Number.isFinite(number) ? number : 0 };
      });
      return { ...current, data: { ...current.data, stavke } };
    });
  };

  const removeInvoiceLine = (index: number) => {
    setInvoiceDraft((current) => current
      ? { ...current, data: { ...current.data, stavke: current.data.stavke.filter((_, itemIndex) => itemIndex !== index) } }
      : current);
  };

  const updateInvoiceField = (key: 'datum' | 'valuta', value: string) => {
    setInvoiceDraft((current) => current
      ? { ...current, data: { ...current.data, [key]: key === 'valuta' ? value.toUpperCase() : value } }
      : current);
  };

  const saveInvoiceCosts = async () => {
    if (!selected || !invoiceDraft || !invoiceSiteId) return;
    if (invoiceDraft.data.valuta.toUpperCase() !== 'EUR') {
      setProfileError('Troškovi se vode u EUR. Ovaj račun nije u EUR; unesite ili preračunajte iznose ručno prije knjiženja.');
      return;
    }
    if (!invoiceDraft.data.datum) {
      setProfileError('Unesi datum računa prije spremanja troškova.');
      return;
    }
    const lines = invoiceDraft.data.stavke.filter((item) =>
      item.opis.trim()
      && Number.isFinite(item.kolicina)
      && item.kolicina >= 0
      && Number.isFinite(item.cijena)
      && item.cijena >= 0
      && Number.isFinite(item.iznos)
      && item.iznos > 0);
    if (lines.length === 0) {
      setProfileError('Račun mora sadržavati barem jednu stavku s ispravnim iznosom većim od nule.');
      return;
    }
    if (lines.length !== invoiceDraft.data.stavke.length) {
      setProfileError('Provjeri da svaka stavka ima opis, nenegativnu količinu i cijenu te iznos veći od nule.');
      return;
    }
    const datum = invoiceDraft.data.datum;
    const invoiceNumber = invoiceDraft.data.broj_racuna ? ` · Račun ${invoiceDraft.data.broj_racuna}` : '';
    setSavingInvoice(true);
    setProfileError(null);
    let uploadedDocument: KooperantDokument | null = null;
    let followupWarning: string | null = null;
    try {
      uploadedDocument = await uploadKooperantDokument(selected.id, 'racun', invoiceDraft.file);
      try {
        const costs = lines.map((item) => ({
          gradiliste_id: invoiceSiteId,
          kategorija: 'kooperanti' as const,
          kooperant_id: selected.id,
          kooperant_racun_id: uploadedDocument!.id,
          opis: `${item.opis.trim()}${item.kolicina > 0 ? ` · ${item.kolicina} ${item.jedinica} × ${eur(item.cijena)}` : ''}${invoiceNumber}`,
          iznos: Math.round(item.iznos * 100) / 100,
          datum,
          placen: false,
        }));
        await createTroskovi(costs);
      } catch (reason) {
        try {
          await deleteKooperantDokument(uploadedDocument);
          uploadedDocument = null;
        } catch (cleanupReason) {
          throw new Error(`Troškovi nisu spremljeni: ${errorMessage(reason)} Račun je učitan, ali ga nije moguće automatski ukloniti: ${errorMessage(cleanupReason)}`);
        }
        throw reason;
      }

      if (uploadedDocument) {
        const savedDocument = uploadedDocument;
        setDocuments((current) => [savedDocument, ...current]);
        try {
          const url = await getKooperantDokumentUrl(savedDocument.putanja);
          setDocumentUrls((current) => ({ ...current, [savedDocument.id]: url }));
        } catch (reason) {
          followupWarning = `Troškovi su spremljeni, ali poveznica na učitani račun nije dostupna: ${errorMessage(reason)}`;
        }
      }
      setInvoiceDraft(null);
      setInvoiceSiteId('');
      await load(false);
      if (followupWarning) setProfileError(followupWarning);
    } catch (reason) {
      setProfileError(errorMessage(reason));
    } finally {
      setSavingInvoice(false);
    }
  };

  const removeDocument = async () => {
    if (!pendingDocumentDelete) return;
    setProfileError(null);
    let followupWarning: string | null = null;
    try {
      const invoiceCosts = selected && pendingDocumentDelete.vrsta === 'racun'
        ? (byKooperant.get(selected.id) ?? []).filter((cost) => cost.kooperant_racun_id === pendingDocumentDelete.id)
        : [];
      if (selected && invoiceCosts.length > 0) {
        await deleteKooperantRacun(selected.id, pendingDocumentDelete.id);
      }
      await deleteKooperantDokument(pendingDocumentDelete);
      setDocuments((current) => current.filter((document) => document.id !== pendingDocumentDelete.id));
      setDocumentUrls((current) => {
        const next = { ...current };
        delete next[pendingDocumentDelete.id];
        return next;
      });
      setPendingDocumentDelete(null);
      if (invoiceCosts.length > 0) await load(false);
    } catch (reason) {
      followupWarning = errorMessage(reason);
    }
    if (followupWarning) setProfileError(followupWarning);
  };

  const removeCostGroup = async () => {
    if (!selected || !pendingCostDelete) return;
    setDeletingCost(true);
    setProfileError(null);
    const group = pendingCostDelete;
    let followupWarning: string | null = null;
    try {
      if (group.invoice && group.invoiceId) {
        await deleteKooperantRacun(selected.id, group.invoiceId);
        const sourceDocument = documents.find((document) => document.id === group.invoiceId && document.vrsta === 'racun');
        if (sourceDocument) {
          try {
            await deleteKooperantDokument(sourceDocument);
            setDocuments((current) => current.filter((document) => document.id !== sourceDocument.id));
            setDocumentUrls((current) => {
              const next = { ...current };
              delete next[sourceDocument.id];
              return next;
            });
          } catch (reason) {
            followupWarning = `Stavke računa su obrisane, ali izvorni dokument nije: ${errorMessage(reason)}`;
          }
        }
      } else {
        const cost = group.costs[0];
        if (cost) await deleteTrosak(cost.id);
      }
      await load(false);
    } catch (reason) {
      followupWarning = errorMessage(reason);
    } finally {
      setDeletingCost(false);
      setPendingCostDelete(null);
    }
    if (followupWarning) setProfileError(followupWarning);
  };

  const selectedSummary = selected ? summaryFor(selected.id) : null;
  const selectedCosts = selected ? byKooperant.get(selected.id) ?? [] : [];
  const selectedCostGroups = groupCostsForDisplay(selectedCosts);
  const selectedOffers = documents.filter((document) => document.vrsta === 'ponuda');
  const selectedOtherDocuments = documents.filter((document) => document.vrsta !== 'ponuda');
  const invoiceLinesTotal = invoiceDraft?.data.stavke.reduce((total, item) => total + (Number(item.iznos) || 0), 0) ?? 0;
  const selectedEngagements = selected ? engagementsByKooperant.get(selected.id) ?? [] : [];
  const activeEngagements = selectedEngagements.filter((item) => effectiveEngagementStatus(item) === 'aktivno');
  const selectedLastEngagement = selectedSummary?.lastEngagement ?? null;
  const activityItems = selected
    ? [
      ...selectedCosts.flatMap((cost) => [
        {
          id: `cost:${cost.id}`,
          date: cost.created_at,
          title: 'Evidentiran trošak',
          detail: `${cost.opis} · ${cost.gradilista?.naziv ?? 'Bez gradilišta'} · ${eur(cost.iznos)}`,
          kind: 'cost' as const,
        },
        ...(cost.placen && cost.placeno_at ? [{
          id: `paid:${cost.id}`,
          date: cost.placeno_at,
          title: 'Trošak označen kao plaćen',
          detail: `${cost.opis} · ${eur(cost.iznos)}`,
          kind: 'paid' as const,
        }] : []),
      ]),
      ...selectedEngagements.map((engagement) => ({
        id: `engagement:${engagement.id}`,
        date: engagement.updated_at || engagement.created_at,
        title: engagement.updated_at !== engagement.created_at ? 'Ažuriran angažman' : 'Novi angažman',
        detail: `${engagement.gradiliste?.naziv ?? 'Gradilište'} · ${statusLabel(effectiveEngagementStatus(engagement))}${engagement.dogovoreni_iznos !== null ? ` · ${eur(engagement.dogovoreni_iznos)}` : ''}`,
        kind: 'engagement' as const,
      })),
      ...documents.map((document) => ({
        id: `document:${document.id}`,
        date: document.created_at,
        title: 'Dodana dokumentacija',
        detail: `${documentTypes.find((type) => type.value === document.vrsta)?.label ?? 'Dokument'} · ${document.naziv}`,
        kind: 'document' as const,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date))
    : [];

  if (loading) return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;

  const totalCosts = troskovi.filter((cost) => cost.kooperant_id).reduce((sum, cost) => sum + cost.iznos, 0);
  const setField = (key: keyof typeof emptyForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));
  const profileTabs: { id: ProfileTab; label: string }[] = [
    { id: 'pregled', label: 'Pregled' },
    { id: 'aktivna', label: 'Aktivna gradilišta' },
    { id: 'povijest', label: 'Povijest suradnje' },
    { id: 'ponude', label: 'Ponude' },
    { id: 'dokumenti', label: 'Dokumenti' },
    { id: 'aktivnosti', label: 'Aktivnosti' },
  ];

  return (
    <div className="min-w-0 max-w-full break-words">
      <div className="mb-6 flex min-w-0 flex-col items-stretch justify-between gap-3 xl:flex-row xl:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Kooperanti</h1>
          <p className="mt-1 text-sm text-slate-500">Poslovni odnosi, angažmani, dokumenti i troškovi · ukupno {eur(totalCosts)}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center">
          <ExportMenu
            disabled={filtered.length === 0}
            build={() => ({
              file: 'Kooperanti',
              title: 'Kooperanti',
              rows: filtered,
              columns: [
                { header: 'Naziv', get: (item: Kooperant) => item.naziv },
                { header: 'Djelatnost', get: (item: Kooperant) => item.djelatnost ?? '' },
                { header: 'OIB', get: (item: Kooperant) => item.oib ?? '' },
                { header: 'IBAN', get: (item: Kooperant) => item.iban ?? '' },
                { header: 'Adresa', get: (item: Kooperant) => [item.adresa, item.postanski_broj, item.mjesto].filter(Boolean).join(', ') },
                { header: 'Ukupni trošak', kind: 'eur', get: (item: Kooperant) => summaryFor(item.id).total },
                { header: 'Trošak ove godine', kind: 'eur', get: (item: Kooperant) => summaryFor(item.id).annual },
                { header: 'Otvoreno', kind: 'eur', get: (item: Kooperant) => summaryFor(item.id).openTotal },
                { header: 'Gradilišta', kind: 'num', get: (item: Kooperant) => summaryFor(item.id).siteCount },
              ],
            })}
          />
          {canEditKooperanti && (
            <button type="button" onClick={() => openForm()} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-700">
              <Plus className="h-4 w-4" /> Novi kooperant
            </button>
          )}
        </div>
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pretraži kooperante…" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Handshake className="h-7 w-7" />}
          title="Nema kooperanata"
          description="Dodajte kooperanta pa evidentirajte angažmane, troškove i dokumentaciju."
        />
      ) : (
        <div className="grid min-w-0 gap-3 2xl:grid-cols-2">
          {filtered.map((kooperant) => {
            const summary = summaryFor(kooperant.id);
            return (
              <article key={kooperant.id} className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
                <button type="button" onClick={() => void openProfile(kooperant)} className="block w-full min-w-0 p-4 text-left hover:bg-slate-50">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-slate-900">{kooperant.naziv}</h2>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {[kooperant.djelatnost, kooperant.kontakt_osoba, kooperant.telefon, kooperant.email].filter(Boolean).join(' · ') || 'Kontaktni podaci nisu uneseni'}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">Detalji</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                    {[
                      ['Aktivna gradilišta', summary.activeCount],
                      ['Ukupan trošak', eur(summary.total)],
                      ['Ove godine', eur(summary.annual)],
                      ['Angažmani', summary.engagementCount],
                      ['Otvoreno za plaćanje', eur(summary.openTotal)],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="min-w-0 rounded-lg bg-slate-50 px-2.5 py-2">
                        <p className="truncate text-[11px] text-slate-500">{label}</p>
                        <p className="mt-1 truncate text-sm font-semibold text-slate-900">{value}</p>
                      </div>
                    ))}
                  </div>
                </button>
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
                  <span>
                    {summary.siteCount} gradilišta · prosjek {eur(summary.average)} / gradilište
                    {summary.lastEngagement && ` · zadnji angažman ${summary.lastEngagement.gradiliste?.naziv ?? displayDate(summary.lastEngagement.datum_pocetka)}`}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    {canEditKooperanti && (
                      <>
                        <button type="button" onClick={() => openForm(kooperant)} aria-label={`Uredi ${kooperant.naziv}`} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-sky-700"><Pencil className="h-4 w-4" /></button>
                        <button type="button" onClick={() => setDeleteTarget(kooperant)} aria-label={`Izbriši ${kooperant.naziv}`} className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.naziv ?? 'Kooperant'}
        wide="screen"
      >
        {selected && selectedSummary && (
          <div className="space-y-4">
            {profileError && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{profileError}</p>}
            <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {[
                ['Aktivna gradilišta', selectedSummary.activeCount, <Building2 className="h-4 w-4 text-sky-600" />],
                ['Ukupan trošak', eur(selectedSummary.total), <CircleDollarSign className="h-4 w-4 text-slate-600" />],
                ['Trošak ove godine', eur(selectedSummary.annual), <CalendarDays className="h-4 w-4 text-slate-600" />],
                ['Broj angažmana', selectedSummary.engagementCount, <Handshake className="h-4 w-4 text-slate-600" />],
                ['Otvoreno za plaćanje', eur(selectedSummary.openTotal), <ClipboardList className="h-4 w-4 text-orange-600" />],
              ].map(([label, value, icon]) => (
                <div key={String(label)} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-2 text-xs text-slate-500">{icon}{label}</div>
                  <p className="mt-2 truncate text-lg font-bold text-slate-900">{value}</p>
                </div>
              ))}
            </section>

            <nav className="flex min-w-0 gap-1 overflow-x-auto border-b border-slate-200">
              {profileTabs.map((tab) => (
                <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${activeTab === tab.id ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                  {tab.label}
                </button>
              ))}
            </nav>

            {activeTab === 'pregled' && (
              <div className="grid gap-4 xl:grid-cols-2">
                <section className="rounded-xl border border-slate-200 p-4">
                  <h3 className="font-semibold text-slate-900">Poslovna suradnja</h3>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-slate-500">Gradilišta ukupno</dt><dd className="text-right font-medium">{selectedSummary.siteCount}</dd>
                    <dt className="text-slate-500">Aktivna gradilišta</dt><dd className="text-right font-medium">{selectedSummary.activeCount}</dd>
                    <dt className="text-slate-500">Evidentirani dogovoreni iznos (aktivno)</dt><dd className="text-right font-medium">{eur(selectedSummary.activeAgreedTotal)}</dd>
                    <dt className="text-slate-500">Broj angažmana</dt><dd className="text-right font-medium">{selectedSummary.engagementCount}</dd>
                    <dt className="text-slate-500">Prosječan trošak po gradilištu</dt><dd className="text-right font-medium">{eur(selectedSummary.average)}</dd>
                    <dt className="text-slate-500">Posljednji angažman</dt><dd className="text-right font-medium">{selectedLastEngagement?.gradiliste?.naziv ?? displayDate(selectedLastEngagement?.datum_pocetka)}</dd>
                    <dt className="text-slate-500">Otvoreno za plaćanje</dt><dd className="text-right font-medium text-orange-700">{eur(selectedSummary.openTotal)}</dd>
                  </dl>
                </section>
                <section className="rounded-xl border border-slate-200 p-4">
                  <h3 className="font-semibold text-slate-900">Kontaktni podaci</h3>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-slate-500">Djelatnost</dt><dd className="text-right">{selected.djelatnost ?? '—'}</dd>
                    <dt className="text-slate-500">OIB</dt><dd className="text-right">{selected.oib ?? '—'}</dd>
                    <dt className="text-slate-500">IBAN</dt><dd className="text-right break-all">{selected.iban ?? '—'}</dd>
                    <dt className="text-slate-500">Kontakt</dt><dd className="text-right">{selected.kontakt_osoba ?? '—'}</dd>
                    <dt className="text-slate-500">Telefon</dt><dd className="text-right">{selected.telefon ?? '—'}</dd>
                    <dt className="text-slate-500">Email</dt><dd className="text-right break-all">{selected.email ?? '—'}</dd>
                    <dt className="text-slate-500">Adresa</dt><dd className="text-right">{[selected.adresa, selected.postanski_broj, selected.mjesto].filter(Boolean).join(', ') || '—'}</dd>
                  </dl>
                </section>
                <section className="rounded-xl border border-slate-200 p-4 xl:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-900">Najnoviji troškovi</h3>
                      <p className="mt-1 text-xs text-slate-500">Otvorene stavke se računaju kao neplaćene dok ih ne označite plaćenima.</p>
                    </div>
                    {canEditCosts && <button type="button" onClick={() => { setCostForm(emptyCostForm); setShowCostForm(true); }} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700"><Plus className="h-4 w-4" /> Novi trošak</button>}
                  </div>
                  {showCostForm && canEditCosts && (
                    <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2 xl:grid-cols-4">
                      <Select value={costForm.gradiliste_id} onChange={(event) => setCostForm({ ...costForm, gradiliste_id: event.target.value })} aria-label="Gradilište troška">
                        <option value="">Bez gradilišta</option>
                        {gradilista.map((site) => <option key={site.id} value={site.id}>{site.naziv}</option>)}
                      </Select>
                      <TextInput value={costForm.opis} onChange={(event) => setCostForm({ ...costForm, opis: event.target.value })} placeholder="Opis troška" aria-label="Opis troška" />
                      <TextInput type="number" min="0.01" step="0.01" value={costForm.iznos} onChange={(event) => setCostForm({ ...costForm, iznos: event.target.value })} placeholder="Iznos (€)" aria-label="Iznos troška" />
                      <div className="flex gap-2">
                        <TextInput type="date" value={costForm.datum} onChange={(event) => setCostForm({ ...costForm, datum: event.target.value })} aria-label="Datum troška" />
                        <button type="button" onClick={() => void saveCost()} disabled={savingCost || !costForm.opis.trim() || !costForm.iznos.trim()} className="shrink-0 rounded-lg bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">{savingCost ? '…' : 'Spremi'}</button>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 divide-y divide-slate-100">
                    {selectedCostGroups.slice(0, 6).map((group) => {
                      const representative = group.costs[0];
                      const paid = group.costs.every((cost) => cost.placen);
                      const amount = group.costs.reduce((sum, cost) => sum + cost.iznos, 0);
                      return (
                        <div key={group.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-800">
                              {group.invoice ? 'Račun kooperanta' : representative.opis}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {group.invoice ? group.costs.map((cost) => cost.opis).join(' · ') : `${displayDate(representative.datum)} · ${representative.gradilista?.naziv ?? 'Bez gradilišta'}`}
                            </p>
                            {group.invoice && <p className="text-xs text-slate-500">{displayDate(representative.datum)} · {representative.gradilista?.naziv ?? 'Bez gradilišta'}</p>}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{eur(amount)}</span>
                            <Badge variant={paid ? 'green' : 'orange'}>{paid ? 'Plaćeno' : 'Otvoreno'}</Badge>
                            {canEditCosts && <button type="button" onClick={() => void toggleCostPaid(representative)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">{paid ? 'Označi otvoreno' : 'Označi plaćeno'}</button>}
                            {canEditCosts && (
                              <button
                                type="button"
                                onClick={() => setPendingCostDelete(group)}
                                aria-label={group.invoice ? 'Izbriši cijeli račun kooperanta' : `Izbriši trošak ${representative.opis}`}
                                title={group.invoice ? 'Izbriši cijeli račun' : 'Izbriši trošak'}
                                className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {selectedCosts.length === 0 && <p className="py-4 text-sm text-slate-500">Još nema evidentiranih troškova.</p>}
                  </div>
                  {!canEditCosts && <p className="mt-2 text-xs text-slate-500">Za unos troška i promjenu statusa plaćanja potrebna su prava uređivanja modula Troškovi.</p>}
                </section>
              </div>
            )}

            {activeTab === 'aktivna' && (
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">Aktivna gradilišta</h3>
                    <p className="text-xs text-slate-500">Fakturirano prikazuje ukupne fakture vezane uz gradilište, ne zasebne fakture kooperanta.</p>
                    <p className="text-xs text-slate-500">Kod ranijih angažmana početak je prvi evidentirani trošak; završetak ostaje prazan ako nije posebno upisan.</p>
                  </div>
                  {canEditKooperanti && canViewSites && <button type="button" onClick={() => openEngagementForm()} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700"><Plus className="h-4 w-4" /> Novi angažman</button>}
                </div>
                {showEngagementForm && canEditKooperanti && (
                  <div className="grid gap-3 rounded-xl border border-sky-200 bg-sky-50/50 p-4 sm:grid-cols-2 xl:grid-cols-4">
                    <Field label="Gradilište *">
                      <Select value={engagementForm.gradiliste_id} onChange={(event) => setEngagementForm({ ...engagementForm, gradiliste_id: event.target.value })}>
                        <option value="">Odaberi gradilište</option>
                        {gradilista.map((site) => <option key={site.id} value={site.id}>{site.naziv}</option>)}
                      </Select>
                    </Field>
                    <Field label="Dogovoreni iznos (€)"><TextInput type="number" min="0" step="0.01" value={engagementForm.dogovoreni_iznos} onChange={(event) => setEngagementForm({ ...engagementForm, dogovoreni_iznos: event.target.value })} /></Field>
                    <Field label="Status">
                      <Select value={engagementForm.status} onChange={(event) => setEngagementForm({ ...engagementForm, status: event.target.value as KooperantAngazmanStatus })}>
                        <option value="aktivno">Aktivno</option><option value="zavrseno">Završeno</option><option value="otkazano">Otkazano</option>
                      </Select>
                    </Field>
                    <Field label="Početak"><TextInput type="date" value={engagementForm.datum_pocetka} onChange={(event) => setEngagementForm({ ...engagementForm, datum_pocetka: event.target.value })} /></Field>
                    <Field label="Završetak"><TextInput type="date" value={engagementForm.datum_zavrsetka} onChange={(event) => setEngagementForm({ ...engagementForm, datum_zavrsetka: event.target.value })} /></Field>
                    <Field label="Napomena"><TextInput value={engagementForm.napomena} onChange={(event) => setEngagementForm({ ...engagementForm, napomena: event.target.value })} /></Field>
                    <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-2">
                      <button type="button" onClick={() => void saveEngagement()} disabled={savingEngagement || !engagementForm.gradiliste_id} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">{savingEngagement ? 'Spremanje…' : 'Spremi angažman'}</button>
                      <button type="button" onClick={() => { setShowEngagementForm(false); setEditingEngagementId(null); }} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-white">Odustani</button>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[850px] text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr><th className="px-3 py-3 text-left">Gradilište</th><th className="px-3 py-3 text-right">Dogovoreni iznos</th><th className="px-3 py-3 text-right">Fakturirano na gradilištu</th><th className="px-3 py-3 text-left">Status</th><th className="px-3 py-3 text-left">Početak / prvi trošak</th><th className="px-3 py-3 text-left">Završetak angažmana</th><th className="px-3 py-3" /></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeEngagements.map((engagement) => {
                        const siteInvoices = fakture.filter((invoice) => invoice.gradiliste_id === engagement.gradiliste_id);
                        const billed = siteInvoices.reduce((sum, invoice) => sum + iznosFakture(invoice), 0);
                        return (
                          <tr key={engagement.id}>
                            <td className="px-3 py-3 font-medium text-slate-900">{engagement.gradiliste?.naziv ?? 'Gradilište'}</td>
                            <td className="px-3 py-3 text-right">{engagement.dogovoreni_iznos === null ? '—' : eur(engagement.dogovoreni_iznos)}</td>
                            <td className="px-3 py-3 text-right">{canViewInvoices ? eur(billed) : '—'}</td>
                            <td className="px-3 py-3"><Badge variant={statusVariant(effectiveEngagementStatus(engagement))}>{statusLabel(effectiveEngagementStatus(engagement))}</Badge></td>
                            <td className="px-3 py-3">{displayDate(engagement.datum_pocetka)}</td>
                            <td className="px-3 py-3">{displayDate(engagement.datum_zavrsetka)}</td>
                            <td className="px-3 py-3 text-right">{canEditKooperanti && <button type="button" onClick={() => openEngagementForm(engagement)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Uredi angažman"><Pencil className="h-4 w-4" /></button>}</td>
                          </tr>
                        );
                      })}
                      {activeEngagements.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Nema aktivnih angažmana.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {activeTab === 'povijest' && (
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><h3 className="font-semibold text-slate-900">Povijest suradnje</h3><p className="text-xs text-slate-500">Sva gradilišta povezana s angažmanima ili evidentiranim troškovima kooperanta.</p></div>
                  {canEditKooperanti && canViewSites && <button type="button" onClick={() => { setActiveTab('aktivna'); openEngagementForm(); }} className="inline-flex items-center gap-2 rounded-lg border border-sky-200 px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50"><Plus className="h-4 w-4" /> Dodaj gradilište</button>}
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[700px] text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr><th className="px-3 py-3 text-left">Datum</th><th className="px-3 py-3 text-left">Gradilište</th><th className="px-3 py-3 text-right">Dogovoreni iznos</th><th className="px-3 py-3 text-right">Trošak</th><th className="px-3 py-3 text-left">Status</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedEngagements.map((engagement) => {
                        const siteCosts = selectedCosts.filter((cost) => cost.gradiliste_id === engagement.gradiliste_id);
                        const amount = siteCosts.reduce((sum, cost) => sum + cost.iznos, 0);
                        return (
                          <tr key={engagement.id}>
                            <td className="px-3 py-3">{displayDate(engagement.datum_pocetka ?? engagement.created_at)}</td>
                            <td className="px-3 py-3 font-medium text-slate-900">{engagement.gradiliste?.naziv ?? 'Gradilište'}</td>
                            <td className="px-3 py-3 text-right">{engagement.dogovoreni_iznos === null ? '—' : eur(engagement.dogovoreni_iznos)}</td>
                            <td className="px-3 py-3 text-right">{eur(amount)}</td>
                            <td className="px-3 py-3"><Badge variant={statusVariant(effectiveEngagementStatus(engagement))}>{statusLabel(effectiveEngagementStatus(engagement))}</Badge></td>
                          </tr>
                        );
                      })}
                      {selectedEngagements.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Povijest gradilišta još nije evidentirana.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-xl border border-slate-200">
                  <h4 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Log troškova po gradilištu</h4>
                  <div className="divide-y divide-slate-100">
                    {selectedCosts.map((cost) => (
                      <div key={cost.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                        <div><p className="font-medium text-slate-800">{cost.gradilista?.naziv ?? 'Bez gradilišta'} · {cost.opis}</p><p className="text-xs text-slate-500">{displayDate(cost.datum)}</p></div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{eur(cost.iznos)}</span>
                          <Badge variant={cost.placen ? 'green' : 'orange'}>{cost.placen ? 'Plaćeno' : 'Otvoreno'}</Badge>
                          {canEditCosts && (
                            <button
                              type="button"
                              onClick={() => setPendingCostDelete({ key: `cost:${cost.id}`, costs: [cost], invoice: false, invoiceId: null })}
                              aria-label={`Izbriši stavku troška ${cost.opis}`}
                              title="Izbriši stavku troška"
                              className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {selectedCosts.length === 0 && <p className="px-4 py-5 text-sm text-slate-500">Nema troškova za prikaz.</p>}
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'dokumenti' && (
              <section className="space-y-3">
                {canEditCosts && canEditKooperanti && (
                  <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">Unos računa uz AI</h3>
                        <p className="mt-1 text-xs text-slate-600">Učitaj PDF ili fotografiju računa. Provjeri prepoznate stavke prije spremanja troškova.</p>
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700">
                        <UploadCloud className="h-4 w-4" /> {analyzingInvoice ? 'AI čita račun…' : 'Učitaj i analiziraj račun'}
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                          className="sr-only"
                          disabled={analyzingInvoice || savingInvoice}
                          onChange={(event) => { void analyzeInvoice(event.target.files?.[0]); event.currentTarget.value = ''; }}
                        />
                      </label>
                    </div>
                    {analyzingInvoice && <p className="text-sm text-sky-800">Račun se obrađuje. Ovo može potrajati nekoliko sekundi…</p>}
                    {invoiceDraft && (
                      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                          <div>
                            <p className="text-xs text-slate-500">Kooperant / dobavljač</p>
                            <p className="text-sm font-medium">{invoiceDraft.data.dobavljac || selected.naziv}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Broj računa</p>
                            <p className="text-sm font-medium">{invoiceDraft.data.broj_racuna || 'Nije prepoznat'}</p>
                          </div>
                          <Field label="Datum računa *">
                            <TextInput type="date" value={invoiceDraft.data.datum} onChange={(event) => updateInvoiceField('datum', event.target.value)} />
                          </Field>
                          <Field label="Valuta (EUR) *">
                            <TextInput value={invoiceDraft.data.valuta} onChange={(event) => updateInvoiceField('valuta', event.target.value)} maxLength={3} />
                          </Field>
                          <div>
                            <p className="text-xs text-slate-500">Ukupno po AI-u</p>
                            <p className="text-sm font-semibold">{invoiceDraft.data.ukupno === null ? 'Nije prepoznato' : `${invoiceDraft.data.ukupno.toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${invoiceDraft.data.valuta || ''}`}</p>
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Gradilište na koje se knjiži trošak *">
                            <Select value={invoiceSiteId} onChange={(event) => setInvoiceSiteId(event.target.value)}>
                              <option value="">Odaberi gradilište</option>
                              {gradilista.map((site) => <option key={site.id} value={site.id}>{site.naziv}</option>)}
                            </Select>
                          </Field>
                          <div className="flex items-end pb-2 text-sm text-slate-600">
                            Stavki: <strong className="ml-1 text-slate-900">{invoiceDraft.data.stavke.length}</strong>
                            <span className="mx-2">·</span>
                            Zbroj stavki: <strong className="ml-1 text-slate-900">{eur(invoiceLinesTotal)}</strong>
                          </div>
                        </div>
                        {invoiceDraft.data.valuta.toUpperCase() !== 'EUR' && (
                          <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">Valuta računa je {invoiceDraft.data.valuta}. Troškovi se vode u EUR pa se ovaj račun ne može knjižiti ovim putem.</p>
                        )}
                        {!invoiceDraft.data.datum && <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">Datum računa nije prepoznat. Unesi ga prije knjiženja.</p>}
                        {invoiceDraft.data.ukupno !== null && Math.abs(invoiceLinesTotal - invoiceDraft.data.ukupno) > 0.02 && (
                          <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">Zbroj stavki se razlikuje od ukupnog iznosa računa ({eur(invoiceDraft.data.ukupno)}). Uredi stavke prema računu prije spremanja.</p>
                        )}
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                          <table className="w-full min-w-[760px] text-left text-sm">
                            <thead className="bg-slate-50 text-xs text-slate-500">
                              <tr>
                                <th className="px-3 py-2">Stavka</th>
                                <th className="w-24 px-3 py-2">Količina</th>
                                <th className="w-24 px-3 py-2">Jedinica</th>
                                <th className="w-32 px-3 py-2">Jed. cijena</th>
                                <th className="w-32 px-3 py-2">Iznos</th>
                                <th className="w-10 px-2 py-2" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {invoiceDraft.data.stavke.map((item, index) => (
                                <tr key={`${index}-${item.opis}`}>
                                  <td className="px-3 py-2"><TextInput value={item.opis} onChange={(event) => updateInvoiceLine(index, 'opis', event.target.value)} aria-label={`Opis stavke ${index + 1}`} /></td>
                                  <td className="px-3 py-2"><TextInput type="number" min="0" step="any" value={item.kolicina} onChange={(event) => updateInvoiceLine(index, 'kolicina', event.target.value)} aria-label={`Količina stavke ${index + 1}`} /></td>
                                  <td className="px-3 py-2"><TextInput value={item.jedinica} onChange={(event) => updateInvoiceLine(index, 'jedinica', event.target.value)} aria-label={`Jedinica stavke ${index + 1}`} /></td>
                                  <td className="px-3 py-2"><TextInput type="number" min="0" step="0.01" value={item.cijena} onChange={(event) => updateInvoiceLine(index, 'cijena', event.target.value)} aria-label={`Jedinična cijena stavke ${index + 1}`} /></td>
                                  <td className="px-3 py-2"><TextInput type="number" min="0.01" step="0.01" value={item.iznos} onChange={(event) => updateInvoiceLine(index, 'iznos', event.target.value)} aria-label={`Iznos stavke ${index + 1}`} /></td>
                                  <td className="px-2 py-2"><button type="button" onClick={() => removeInvoiceLine(index)} aria-label={`Ukloni stavku ${index + 1}`} className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" /></button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-slate-500">Svaka stavka sprema se kao zaseban neplaćeni trošak na odabranom gradilištu. Račun se sprema u dokumente kooperanta.</p>
                          <button
                            type="button"
                            onClick={() => void saveInvoiceCosts()}
                            disabled={savingInvoice || !invoiceSiteId || !invoiceDraft.data.datum || invoiceDraft.data.stavke.length === 0 || invoiceDraft.data.valuta.toUpperCase() !== 'EUR'}
                            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {savingInvoice ? 'Spremanje…' : 'Potvrdi i spremi troškove'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <Field label="Vrsta dokumenta">
                    <Select value={documentType === 'ponuda' ? 'ugovor' : documentType} onChange={(event) => setDocumentType(event.target.value as KooperantDokumentVrsta)}>
                      {documentTypes.filter((type) => type.value !== 'ponuda').map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                    </Select>
                  </Field>
                  {canEditKooperanti && (
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700">
                      <UploadCloud className="h-4 w-4" /> {uploading ? 'Učitavanje…' : 'Učitaj dokument'}
                      <input type="file" className="sr-only" disabled={uploading} onChange={(event) => { void uploadDocument(event.target.files?.[0]); event.currentTarget.value = ''; }} />
                    </label>
                  )}
                  <p className="text-xs text-slate-500">PDF, slike i drugi dokumenti do 20 MB po datoteci.</p>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {selectedOtherDocuments.map((document) => (
                    <div key={document.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <FileText className="h-5 w-5 shrink-0 text-sky-600" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{document.naziv}</p>
                          <p className="text-xs text-slate-500">{documentTypes.find((type) => type.value === document.vrsta)?.label} · {displayDate(document.created_at)}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {documentUrls[document.id] && <a href={documentUrls[document.id]} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50">Otvori</a>}
                        {canEditKooperanti && <button type="button" onClick={() => setPendingDocumentDelete(document)} aria-label={`Izbriši dokument ${document.naziv}`} className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>}
                      </div>
                    </div>
                  ))}
                </div>
                {selectedOtherDocuments.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Dokumentacija kooperanta još nije učitana.</p>}
              </section>
            )}

            {activeTab === 'ponude' && (
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Ponude kooperanta</h3>
                    <p className="mt-1 text-xs text-slate-500">Učitaj ponudu i poveži je s gradilištem sada ili naknadno.</p>
                  </div>
                  {canEditKooperanti && (
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700">
                      <UploadCloud className="h-4 w-4" /> {uploading ? 'Učitavanje…' : 'Učitaj ponudu'}
                      <input type="file" className="sr-only" disabled={uploading} onChange={(event) => { void uploadOffer(event.target.files?.[0]); event.currentTarget.value = ''; }} />
                    </label>
                  )}
                  <p className="w-full text-xs text-slate-500">Dokumenti do 20 MB po datoteci.</p>
                </div>
                <div className="space-y-2">
                  {selectedOffers.map((offer) => (
                    <div key={offer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <FileText className="h-5 w-5 shrink-0 text-sky-600" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{offer.naziv}</p>
                          <p className="text-xs text-slate-500">Učitano {displayDate(offer.created_at)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {documentUrls[offer.id] && <a href={documentUrls[offer.id]} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50">Otvori ponudu</a>}
                        <Select
                          value={offer.gradiliste_id ?? ''}
                          disabled={!canEditKooperanti || !canViewSites || updatingOfferId === offer.id}
                          onChange={(event) => void attachOfferToSite(offer, event.target.value)}
                          aria-label={`Poveži ponudu ${offer.naziv} s gradilištem`}
                        >
                          <option value="">Bez gradilišta</option>
                          {gradilista.map((site) => <option key={site.id} value={site.id}>{site.naziv}</option>)}
                        </Select>
                        {updatingOfferId === offer.id && <span className="text-xs text-slate-500">Spremanje…</span>}
                        {canEditKooperanti && (
                          <button
                            type="button"
                            onClick={() => setPendingDocumentDelete(offer)}
                            aria-label={`Izbriši ponudu ${offer.naziv}`}
                            title="Izbriši ponudu"
                            className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {selectedOffers.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Još nema učitanih ponuda za ovog kooperanta.</p>}
                </div>
                {(!canViewSites || !canEditKooperanti) && selectedOffers.length > 0 && (
                  <p className="text-xs text-slate-500">Za povezivanje ponude s gradilištem potrebna su prava pregleda gradilišta i uređivanja kooperanata.</p>
                )}
              </section>
            )}

            {activeTab === 'aktivnosti' && (
              <section className="rounded-xl border border-slate-200 p-4">
                <h3 className="font-semibold text-slate-900">Aktivnosti suradnje</h3>
                <div className="mt-4 space-y-0">
                  {activityItems.map((activity, index) => (
                    <div key={activity.id} className="relative flex gap-3 pb-5 last:pb-0">
                      <div className="flex w-5 shrink-0 flex-col items-center">
                        <span className={`mt-1 h-2.5 w-2.5 rounded-full ${activity.kind === 'paid' ? 'bg-emerald-500' : activity.kind === 'cost' ? 'bg-orange-500' : activity.kind === 'document' ? 'bg-violet-500' : 'bg-sky-500'}`} />
                        {index < activityItems.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                          <p className="text-sm font-semibold text-slate-900">{activity.title}</p>
                          <time className="text-xs text-slate-500">{displayDate(activity.date)}</time>
                        </div>
                        <p className="mt-0.5 text-sm text-slate-600">{activity.detail}</p>
                      </div>
                    </div>
                  ))}
                  {activityItems.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Nema evidentiranih događaja.</p>}
                </div>
              </section>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Uredi kooperanta' : 'Novi kooperant'}
        footer={(
          <>
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Odustani</button>
            <button type="button" onClick={() => void save()} disabled={saving || !form.naziv.trim()} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        )}
      >
        <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="min-w-0 xl:col-span-2"><Field label="Naziv *"><TextInput value={form.naziv} onChange={setField('naziv')} /></Field></div>
          <Field label="Djelatnost"><TextInput value={form.djelatnost} onChange={setField('djelatnost')} placeholder="npr. elektro, vodoinstalacije" /></Field>
          <Field label="OIB"><TextInput value={form.oib} onChange={setField('oib')} /></Field>
          <div className="min-w-0 xl:col-span-2"><Field label="IBAN"><TextInput value={form.iban} onChange={setField('iban')} /></Field></div>
          <div className="min-w-0 xl:col-span-2"><Field label="Adresa"><TextInput value={form.adresa} onChange={setField('adresa')} /></Field></div>
          <Field label="Mjesto"><TextInput value={form.mjesto} onChange={setField('mjesto')} /></Field>
          <Field label="Poštanski broj"><TextInput value={form.postanski_broj} onChange={setField('postanski_broj')} /></Field>
          <Field label="Kontakt osoba"><TextInput value={form.kontakt_osoba} onChange={setField('kontakt_osoba')} /></Field>
          <Field label="Telefon"><TextInput value={form.telefon} onChange={setField('telefon')} /></Field>
          <Field label="Email"><TextInput value={form.email} onChange={setField('email')} /></Field>
          <Field label="Web"><TextInput value={form.web} onChange={setField('web')} /></Field>
          <div className="min-w-0 xl:col-span-2"><Field label="Napomena"><Textarea value={form.napomena} onChange={setField('napomena')} rows={3} /></Field></div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        title="Izbrisati kooperanta?"
        message="Postojeći troškovi ostaju na gradilištu, ali neće više biti povezani s ovim kooperantom."
      />
      <ConfirmDialog
        open={pendingDocumentDelete !== null}
        onClose={() => setPendingDocumentDelete(null)}
        onConfirm={removeDocument}
        title="Izbrisati dokument?"
        message="Datoteka i njezina evidencija bit će uklonjene."
      />
      <ConfirmDialog
        open={pendingCostDelete !== null}
        onClose={() => { if (!deletingCost) setPendingCostDelete(null); }}
        onConfirm={removeCostGroup}
        title={pendingCostDelete?.invoice ? 'Izbrisati cijeli račun?' : 'Izbrisati trošak?'}
        message={pendingCostDelete?.invoice
          ? `Bit će izbrisane sve ${pendingCostDelete.costs.length} stavke računa${documents.some((document) => document.id === pendingCostDelete.invoiceId && document.vrsta === 'racun') ? ' i izvorni dokument računa' : ''}. Ova radnja se ne može poništiti.`
          : 'Trošak će biti trajno izbrisan. Ova radnja se ne može poništiti.'}
      />
    </div>
  );
}
