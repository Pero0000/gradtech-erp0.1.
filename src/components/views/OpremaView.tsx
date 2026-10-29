import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Cog, FileText, LayoutGrid, MapPin, Pencil, Plus, Table2, Trash2, Wrench } from 'lucide-react';
import type { Gradiliste, Oprema, OpremaDokument, OpremaDokumentVrsta, OpremaKategorija, OpremaStanje, OpremaStatus } from '@/types';
import {
  addOpremaDokument,
  createOprema,
  deleteOprema,
  deleteOpremaDokument,
  fetchGradilista,
  fetchOprema,
  fetchOpremaDokumenti,
  fetchOpremaDokumentiZaResurse,
  fetchOpremaKoristenjaZaResurse,
  fetchStrojKoristenjaZaResurse,
  updateOprema,
  type OpremaKoristenje,
} from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ExportMenu } from '@/components/ui/ExportMenu';
import { Field, Select, TextInput, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { todayISO } from '@/lib/rokovi';

const statusLabels: Record<OpremaStatus, string> = {
  slobodno: 'Slobodno',
  na_gradilistu: 'Na gradilištu',
  servis: 'Servis',
  neaktivno: 'Neaktivno',
};

const statusVariants: Record<OpremaStatus, 'green' | 'blue' | 'yellow' | 'gray'> = {
  slobodno: 'green',
  na_gradilistu: 'blue',
  servis: 'yellow',
  neaktivno: 'gray',
};

const conditionLabels: Record<OpremaStanje, string> = {
  novo: 'Novo',
  dobro: 'Dobro',
  osteceno: 'Oštećeno',
};

const documentLabels: Record<OpremaDokumentVrsta, string> = {
  servis: 'Servis',
  atest: 'Atest / pregled',
  dokument: 'Dokument',
  ostalo: 'Ostalo',
};

const emptyForm = {
  naziv: '',
  marka: '',
  model: '',
  inventarski_broj: '',
  podkategorija: '',
  radnik_id: '',
  serijski_broj: '',
  status: 'slobodno' as OpremaStatus,
  stanje: 'dobro' as OpremaStanje,
  gradiliste_id: '',
  kolicina: '1',
  datum_nabave: '',
  nabavna_vrijednost: '',
  cijena_sata: '',
  radni_sati: '',
  servisni_interval_sati: '',
  servis_upozorenje_sati: '20',
  napomena: '',
};

const dateLabel = (value: string | null | undefined) => value
  ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('hr-HR')
  : '—';
const currency = (value: number) => value.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const errText = (reason: unknown) => reason instanceof Error ? reason.message : 'Dogodila se greška.';
const statusTone = (tone: 'green' | 'orange' | 'red') => tone === 'green' ? 'green' : tone === 'orange' ? 'orange' : 'red';

function itemLocation(item: Oprema, usage: OpremaKoristenje[]) {
  if (item.radnik_id) {
    const worker = usage.flatMap((entry) => entry.radnici).find((candidate) => candidate.id === item.radnik_id);
    return `Kod radnika${worker ? ` · ${worker.ime} ${worker.prezime}` : ''}`;
  }
  return item.gradiliste_id ? `Gradilište · ${item.gradilista?.naziv ?? 'dodijeljeno gradilište'}` : 'Skladište';
}

function itemServiceAlert(item: Oprema, documents: OpremaDokument[]) {
  const dueDates = documents
    .filter((document) => document.vrsta === 'atest' && document.datum_do)
    .map((document) => document.datum_do as string)
    .sort();
  const today = todayISO();
  const nextDueDate = dueDates.find((value) => value >= today) ?? dueDates[dueDates.length - 1];
  const serviceEntries = documents
    .filter((document) => document.vrsta === 'servis' && document.radni_sati != null)
    .sort((first, second) => (second.radni_sati ?? 0) - (first.radni_sati ?? 0));
  const lastServiceHours = serviceEntries[0]?.radni_sati;
  const nextServiceHours = lastServiceHours != null && item.servisni_interval_sati
    ? lastServiceHours + item.servisni_interval_sati
    : null;
  const hoursUntilService = nextServiceHours != null ? nextServiceHours - item.radni_sati : null;
  const daysUntilReview = nextDueDate
    ? Math.ceil((new Date(`${nextDueDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000)
    : null;

  if (hoursUntilService != null && hoursUntilService <= 0) return `Servis prekoračen za ${Math.abs(hoursUntilService).toLocaleString('hr-HR')} h`;
  if (daysUntilReview != null && daysUntilReview < 0) return `Pregled istekao prije ${Math.abs(daysUntilReview)} dana`;
  if (hoursUntilService != null && hoursUntilService <= item.servis_upozorenje_sati) return `Servis za ${hoursUntilService.toLocaleString('hr-HR')} h`;
  if (daysUntilReview != null && daysUntilReview <= 30) return `Pregled ističe za ${daysUntilReview} dana`;
  return null;
}

function inspectionState(documents: OpremaDokument[]) {
  const inspections = documents
    .filter((document) => document.vrsta === 'atest')
    .sort((first, second) => (second.datum_do ?? second.datum_od ?? '').localeCompare(first.datum_do ?? first.datum_od ?? ''));
  const latest = inspections[0];
  if (!latest) return { label: 'Nije evidentiran', tone: 'red' as const };
  if (!latest.datum_do) return { label: 'Evidentiran bez roka', tone: 'orange' as const };
  const remaining = Math.ceil((new Date(`${latest.datum_do}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime()) / 86400000);
  if (remaining < 0) return { label: `Istekao ${dateLabel(latest.datum_do)}`, tone: 'red' as const };
  if (remaining <= 30) return { label: `Istječe za ${remaining} d`, tone: 'orange' as const };
  return { label: `Vrijedi do ${dateLabel(latest.datum_do)}`, tone: 'green' as const };
}

function readinessState(item: Oprema, documents: OpremaDokument[]) {
  const inspection = inspectionState(documents);
  if (item.stanje === 'osteceno' || item.status === 'servis') {
    return { label: 'Neispravan', tone: 'red' as const };
  }
  if (item.status === 'neaktivno' || inspection.tone !== 'green' || itemServiceAlert(item, documents)) {
    return { label: 'Potreban pregled', tone: 'orange' as const };
  }
  return { label: 'Spreman za korištenje', tone: 'green' as const };
}

export function OpremaView({ kategorija }: { kategorija: OpremaKategorija }) {
  const label = kategorija === 'alat' ? 'Alat' : 'Strojevi';
  const Icon = kategorija === 'alat' ? Wrench : Cog;
  const [items, setItems] = useState<Oprema[]>([]);
  const [sites, setSites] = useState<Gradiliste[]>([]);
  const [documents, setDocuments] = useState<Record<string, OpremaDokument[]>>({});
  const [usageHistory, setUsageHistory] = useState<Record<string, OpremaKoristenje[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Oprema | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [query, setQuery] = useState('');
  const [documentForm, setDocumentForm] = useState({
    vrsta: 'servis' as OpremaDokumentVrsta,
    naziv: '',
    datum_od: '',
    datum_do: '',
    radni_sati: '',
    iznos: '',
    napomena: '',
  });
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [savingDocument, setSavingDocument] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [resourceList, siteList] = await Promise.all([fetchOprema(kategorija), fetchGradilista()]);
      const [resourceDocuments, resourceUsage] = await Promise.all([
        fetchOpremaDokumentiZaResurse(resourceList.map((item) => item.id)),
        kategorija === 'stroj'
          ? fetchStrojKoristenjaZaResurse(resourceList.map((item) => item.id))
          : fetchOpremaKoristenjaZaResurse(resourceList.map((item) => item.id)),
      ]);
      setItems(resourceList);
      setSites(siteList);
      setDocuments(resourceDocuments.reduce<Record<string, OpremaDokument[]>>((grouped, document) => {
        grouped[document.oprema_id] ??= [];
        grouped[document.oprema_id].push(document);
        return grouped;
      }, {}));
      setUsageHistory(resourceUsage);
      setExpandedId(null);
    } catch (reason) {
      setError(errText(reason));
    } finally {
      setLoading(false);
    }
  }, [kategorija]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return items;
    return items.filter((item) => [
      item.naziv,
      item.podkategorija,
      item.marka,
      item.model,
      item.inventarski_broj,
      item.serijski_broj,
      item.gradilista?.naziv,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)));
  }, [items, query]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (item: Oprema) => {
    setEditing(item);
    setForm({
      naziv: item.naziv,
      marka: item.marka ?? '',
      model: item.model ?? '',
      inventarski_broj: item.inventarski_broj ?? '',
      podkategorija: item.podkategorija ?? '',
      radnik_id: item.radnik_id ?? '',
      serijski_broj: item.serijski_broj ?? '',
      status: item.status,
      stanje: item.stanje,
      gradiliste_id: item.gradiliste_id ?? '',
      kolicina: String(item.kolicina ?? 1),
      datum_nabave: item.datum_nabave ?? '',
      nabavna_vrijednost: String(item.nabavna_vrijednost ?? ''),
      cijena_sata: String(item.cijena_sata ?? ''),
      radni_sati: String(item.radni_sati ?? ''),
      servisni_interval_sati: String(item.servisni_interval_sati ?? ''),
      servis_upozorenje_sati: String(item.servis_upozorenje_sati ?? 20),
      napomena: item.napomena ?? '',
    });
    setError(null);
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.naziv.trim()) return;
    setSaving(true);
    setError(null);
    const payload = {
      kategorija,
      naziv: form.naziv.trim(),
      marka: form.marka.trim() || null,
      model: form.model.trim() || null,
      inventarski_broj: form.inventarski_broj.trim() || null,
      podkategorija: form.podkategorija.trim() || null,
      radnik_id: form.radnik_id || null,
      serijski_broj: form.serijski_broj.trim() || null,
      status: form.status,
      stanje: form.stanje,
      gradiliste_id: form.gradiliste_id || null,
      kolicina: Math.max(0.01, Number(form.kolicina) || 1),
      datum_nabave: form.datum_nabave || null,
      nabavna_vrijednost: Math.max(0, Number(form.nabavna_vrijednost) || 0),
      cijena_sata: kategorija === 'stroj' ? Math.max(0, Number(form.cijena_sata) || 0) : 0,
      radni_sati: Math.max(0, Number(form.radni_sati) || 0),
      servisni_interval_sati: form.servisni_interval_sati ? Math.max(0, Number(form.servisni_interval_sati)) : null,
      servis_upozorenje_sati: Math.max(0, Number(form.servis_upozorenje_sati) || 20),
      napomena: form.napomena.trim() || null,
    };
    try {
      if (editing) {
        await updateOprema(editing.id, payload);
        setModalOpen(false);
      } else {
        const created = await createOprema(payload);
        setModalOpen(false);
        await load();
        setExpandedId(created.id);
        return;
      }
      await load();
    } catch (reason) {
      setError(errText(reason));
    } finally {
      setSaving(false);
    }
  };

  const toggleDetails = async (item: Oprema) => {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    if (documents[item.id]) return;
    setError(null);
    try {
      const itemDocuments = await fetchOpremaDokumenti(item.id);
      setDocuments((previous) => ({ ...previous, [item.id]: itemDocuments }));
    } catch (reason) {
      setError(errText(reason));
    }
  };

  const addDocument = async (item: Oprema) => {
    if (!documentForm.naziv.trim()) return;
    setSavingDocument(true);
    setError(null);
    try {
      await addOpremaDokument(item.id, {
        vrsta: documentForm.vrsta,
        naziv: documentForm.naziv.trim(),
        datum_od: documentForm.datum_od || null,
        datum_do: documentForm.datum_do || null,
        radni_sati: documentForm.radni_sati ? Math.max(0, Number(documentForm.radni_sati)) : null,
        iznos: documentForm.iznos ? Math.max(0, Number(documentForm.iznos)) : null,
        napomena: documentForm.napomena.trim() || null,
      }, documentFile);
      setDocumentForm({ vrsta: 'servis', naziv: '', datum_od: '', datum_do: '', radni_sati: '', iznos: '', napomena: '' });
      setDocumentFile(null);
      const itemDocuments = await fetchOpremaDokumenti(item.id);
      setDocuments((previous) => ({ ...previous, [item.id]: itemDocuments }));
    } catch (reason) {
      setError(errText(reason));
    } finally {
      setSavingDocument(false);
    }
  };

  const removeDocument = async (item: OpremaDokument) => {
    if (!window.confirm(`Obrisati zapis „${item.naziv}”?`)) return;
    setError(null);
    try {
      await deleteOpremaDokument(item);
      setDocuments((previous) => ({
        ...previous,
        [item.oprema_id]: (previous[item.oprema_id] ?? []).filter((document) => document.id !== item.id),
      }));
    } catch (reason) {
      setError(errText(reason));
    }
  };

  const removeItem = async () => {
    if (!deleteId) return;
    setError(null);
    try {
      await deleteOprema(deleteId);
      setDeleteId(null);
      await load();
    } catch (reason) {
      setError(errText(reason));
    }
  };

  const renderDetails = (item: Oprema) => {
    if (expandedId !== item.id) return null;
    const itemDocuments = documents[item.id] ?? [];
    const itemUsage = usageHistory[item.id] ?? [];
    const services = itemDocuments
      .filter((document) => document.vrsta === 'servis')
      .sort((first, second) => (second.datum_od ?? second.created_at).localeCompare(first.datum_od ?? first.created_at));
    const serviceCost = services.reduce((sum, document) => sum + Number(document.iznos ?? 0), 0);
    const alert = itemServiceAlert(item, itemDocuments);
    const lastUse = itemUsage[0];
    const latestInspection = inspectionState(itemDocuments);
    const readiness = readinessState(item, itemDocuments);
    const location = itemLocation(item, itemUsage);
    return (
      <div className="mt-4 border-t border-slate-200 pt-4" onClick={(event) => event.stopPropagation()}>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Nabavna vrijednost</p><p className="mt-1 font-semibold text-slate-900">{currency(item.nabavna_vrijednost)}</p></div>
          <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Trošak servisa</p><p className="mt-1 font-semibold text-slate-900">{currency(serviceCost)}</p></div>
          <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Broj korištenja</p><p className="mt-1 font-semibold text-slate-900">{itemUsage.length}</p></div>
          <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Datum zadnjeg pregleda</p><p className="mt-1 font-semibold text-slate-900">{dateLabel(itemDocuments.filter((document) => document.vrsta === 'atest').sort((first, second) => (second.datum_od ?? '').localeCompare(first.datum_od ?? ''))[0]?.datum_od)}</p></div>
        </section>
        <section className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div><p className="text-xs text-slate-500">Spremnost</p><Badge variant={statusTone(readiness.tone)}>{readiness.label}</Badge></div>
          <div><p className="text-xs text-slate-500">Trenutna lokacija</p><p className="font-medium text-slate-800">{location}</p></div>
          <div><p className="text-xs text-slate-500">Zadnji korisnik</p><p className="font-medium text-slate-800">{lastUse?.radnici.map((worker) => `${worker.ime} ${worker.prezime}`).join(', ') || 'Nije evidentiran'}</p><p className="text-xs text-slate-500">{lastUse ? dateLabel(lastUse.datum) : '—'}</p></div>
          <div><p className="text-xs text-slate-500">Status pregleda</p><Badge variant={statusTone(latestInspection.tone)}>{latestInspection.label}</Badge></div>
        </section>
        {alert && (
          <p className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {alert}
          </p>
        )}
        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Wrench className="h-4 w-4 text-slate-500" /> Servisna povijest ({services.length})
        </h4>
        <div className="mb-3 space-y-2">
          {services.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Nema evidentiranih servisa.</p>}
          {services.map((document) => (
            <div key={document.id} className="flex items-start gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">
                  {document.url ? <a href={document.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">{document.naziv}</a> : document.naziv}
                </p>
                <p className="mt-0.5 text-slate-500">
                  {dateLabel(document.datum_od)} · {document.naziv}
                  {document.datum_do && ` – ${dateLabel(document.datum_do)}`}
                  {document.radni_sati != null && ` · ${document.radni_sati.toLocaleString('hr-HR')} h`}
                  {document.iznos != null && ` · ${currency(document.iznos)}`}
                </p>
                {document.napomena && <p className="mt-1 whitespace-pre-wrap text-slate-600">{document.napomena}</p>}
              </div>
              <button type="button" onClick={() => void removeDocument(document)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Obriši servis ${document.naziv}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <h4 className="mb-2 mt-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <FileText className="h-4 w-4 text-slate-500" /> Povijest korištenja ({itemUsage.length})
        </h4>
        {kategorija === 'stroj' ? (
          itemUsage.length === 0
            ? <p className="mb-3 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Dnevnik se automatski puni kada se stroj poveže s radnim nalogom. Radni sati se prikazuju nakon unosa na nalogu.</p>
            : <div className="mb-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[68rem] text-left text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  <th className="px-3 py-2">Datum</th>
                  <th className="px-3 py-2">Gradilište</th>
                  <th className="px-3 py-2">Radni nalog</th>
                  <th className="px-3 py-2">Radnik</th>
                  <th className="px-3 py-2 text-right">Radni sati</th>
                  <th className="px-3 py-2 text-right">Cijena sata</th>
                  <th className="px-3 py-2 text-right">Ukupan obračun</th>
                  <th className="px-3 py-2">Napomena</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">{itemUsage.map((usage) => (
                  <tr key={usage.id}>
                    <td className="whitespace-nowrap px-3 py-2">{dateLabel(usage.datum)}</td>
                    <td className="px-3 py-2">{usage.gradiliste ?? '—'}</td>
                    <td className="px-3 py-2">{usage.brojNaloga ? `${usage.brojNaloga} · ${usage.nalog ?? ''}` : '—'}</td>
                    <td className="px-3 py-2">{usage.radnici.map((worker) => `${worker.ime} ${worker.prezime}`).join(', ') || 'Nije evidentiran'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{usage.radniSati == null ? 'Nije uneseno' : `${Number(usage.radniSati).toLocaleString('hr-HR')} h`}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{currency(Number(usage.cijenaSata ?? 0))}/h</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{usage.radniSati == null ? '—' : currency(Number(usage.ukupanObracun ?? 0))}</td>
                    <td className="max-w-xs whitespace-pre-wrap px-3 py-2">{usage.napomena?.trim() || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
        ) : itemUsage.length === 0 ? <p className="mb-3 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Korištenja će se bilježiti kada se alat doda na radni nalog. Stariji zapisi bez poveznice na inventar nisu dostupni.</p> : (
          <ol className="mb-3 space-y-2 border-l border-slate-200 pl-4">
            {itemUsage.map((usage) => (
              <li key={usage.id} className="relative rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs">
                <span className="absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full border-2 border-white bg-sky-600 ring-1 ring-sky-200" />
                <p className="font-medium text-slate-800">{dateLabel(usage.datum)} · {usage.radnici.map((worker) => `${worker.ime} ${worker.prezime}`).join(', ') || 'Korisnik nije evidentiran'}</p>
                <p className="mt-0.5 text-slate-500">{usage.gradiliste ?? 'Bez gradilišta'} · {usage.brojNaloga ? `${usage.brojNaloga} · ${usage.nalog ?? ''}` : 'Bez radnog naloga'}</p>
              </li>
            ))}
          </ol>
        )}
        <h4 className="mb-2 mt-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <FileText className="h-4 w-4 text-slate-500" /> Dokumentacija i pregledi ({itemDocuments.filter((document) => document.vrsta !== 'servis').length})
        </h4>
        <div className="mb-3 space-y-2">
          {itemDocuments.filter((document) => document.vrsta !== 'servis').map((document) => (
            <div key={document.id} className="flex items-start gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">{document.url ? <a href={document.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">{document.naziv}</a> : document.naziv}</p>
                <p className="mt-0.5 text-slate-500">{documentLabels[document.vrsta]} · {dateLabel(document.datum_od)}{document.datum_do && ` – ${dateLabel(document.datum_do)}`}</p>
              </div>
              <button type="button" onClick={() => void removeDocument(document)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Obriši dokument ${document.naziv}`}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <div className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2">
            <Select value={documentForm.vrsta} onChange={(event) => setDocumentForm((previous) => ({ ...previous, vrsta: event.target.value as OpremaDokumentVrsta }))}>
              {Object.entries(documentLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
            </Select>
            <TextInput value={documentForm.naziv} onChange={(event) => setDocumentForm((previous) => ({ ...previous, naziv: event.target.value }))} placeholder="Naziv zapisa *" />
            <label className="text-xs text-slate-500">Datum
              <TextInput type="date" value={documentForm.datum_od} onChange={(event) => setDocumentForm((previous) => ({ ...previous, datum_od: event.target.value }))} />
            </label>
            <label className="text-xs text-slate-500">Vrijedi do / idući servis
              <TextInput type="date" value={documentForm.datum_do} onChange={(event) => setDocumentForm((previous) => ({ ...previous, datum_do: event.target.value }))} />
            </label>
            {kategorija === 'stroj' && (
              <TextInput type="number" min="0" step="0.1" value={documentForm.radni_sati} onChange={(event) => setDocumentForm((previous) => ({ ...previous, radni_sati: event.target.value }))} placeholder="Radni sati kod servisa" />
            )}
            <TextInput type="number" min="0" step="0.01" value={documentForm.iznos} onChange={(event) => setDocumentForm((previous) => ({ ...previous, iznos: event.target.value }))} placeholder="Trošak (€)" />
            <TextInput value={documentForm.napomena} onChange={(event) => setDocumentForm((previous) => ({ ...previous, napomena: event.target.value }))} placeholder="Napomena" />
            <TextInput type="file" onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)} />
          </div>
          <button type="button" onClick={() => void addDocument(item)} disabled={savingDocument || !documentForm.naziv.trim()} className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" /> {savingDocument ? 'Spremanje…' : 'Dodaj zapis'}
          </button>
        </div>
      </div>
    );
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;

  return (
    <div className="min-w-0 max-w-full break-words">
      <div className="mb-6 flex min-w-0 flex-col items-stretch justify-between gap-3 xl:flex-row xl:flex-wrap xl:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{label}</h1>
          <p className="mt-1 text-sm text-slate-500">Evidencija {label.toLocaleLowerCase()}, lokacije, stanja, nabave, servisa i rokova</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center">
          <div className="inline-flex self-start rounded-lg border border-slate-200 bg-white p-0.5">
            <button type="button" onClick={() => setView('cards')} className={`rounded-md p-2 ${view === 'cards' ? 'bg-sky-100 text-sky-700' : 'text-slate-500 hover:bg-slate-50'}`} title="Kartice"><LayoutGrid className="h-4 w-4" /></button>
            <button type="button" onClick={() => setView('table')} className={`rounded-md p-2 ${view === 'table' ? 'bg-sky-100 text-sky-700' : 'text-slate-500 hover:bg-slate-50'}`} title="Tablica"><Table2 className="h-4 w-4" /></button>
          </div>
          <ExportMenu
            disabled={items.length === 0}
            build={() => ({
              file: label,
              title: label,
              rows: items,
              columns: [
                { header: 'Naziv', get: (item: Oprema) => item.naziv },
                { header: 'Kategorija', get: (item: Oprema) => item.podkategorija ?? '' },
                { header: 'Marka / model', get: (item: Oprema) => [item.marka, item.model].filter(Boolean).join(' ') },
                { header: 'Inventarski broj', get: (item: Oprema) => item.inventarski_broj ?? '' },
                { header: 'Serijski broj', get: (item: Oprema) => item.serijski_broj ?? '' },
                { header: 'Status', get: (item: Oprema) => statusLabels[item.status] },
                { header: 'Stanje', get: (item: Oprema) => conditionLabels[item.stanje] },
                { header: 'Gradilište', get: (item: Oprema) => item.gradilista?.naziv ?? '' },
                { header: 'Količina', kind: 'num', get: (item: Oprema) => item.kolicina },
                { header: 'Nabavna vrijednost', kind: 'eur', get: (item: Oprema) => item.nabavna_vrijednost },
                { header: 'Radni sati', kind: 'num', get: (item: Oprema) => item.radni_sati },
                ...(kategorija === 'stroj' ? [{ header: 'Cijena radnog sata', kind: 'eur' as const, get: (item: Oprema) => item.cijena_sata }] : []),
              ],
            })}
          />
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-700">
            <Plus className="h-4 w-4" /> Novi {kategorija}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="mb-4 flex min-w-0 flex-col items-stretch gap-3 xl:flex-row xl:items-center">
        <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Pretraži ${label.toLocaleLowerCase()}…`} className="max-w-md" />
        <span className="text-xs text-slate-500">{visibleItems.length} / {items.length} zapisa</span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Icon className="h-7 w-7" />}
          title={`Nema zapisa za ${label.toLocaleLowerCase()}`}
          description={`Dodajte ${label.toLocaleLowerCase()} kako biste pratili stanje, lokaciju i održavanje.`}
          action={<button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700"><Plus className="h-4 w-4" /> Novi {kategorija}</button>}
        />
      ) : visibleItems.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Nema rezultata za traženi pojam.</p>
      ) : view === 'table' ? (
        <div className="min-w-0 max-w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <th className="px-4 py-3">Naziv / kategorija</th><th className="px-4 py-3">Inventarski broj</th><th className="px-4 py-3">Status / spremnost</th><th className="px-4 py-3">Lokacija / zadnji korisnik</th><th className="px-4 py-3">Pregled</th><th className="px-4 py-3 text-right">Nabavna vrijednost</th>
              {kategorija === 'stroj' && <th className="px-4 py-3 text-right">Radni sati</th>}
              <th className="px-4 py-3 text-right">Akcije</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {visibleItems.map((item) => {
                const itemDocuments = documents[item.id] ?? [];
                const itemUsage = usageHistory[item.id] ?? [];
                const readiness = readinessState(item, itemDocuments);
                const inspection = inspectionState(itemDocuments);
                const lastUse = itemUsage[0];
                return (
                <tr key={item.id} className="group hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => void toggleDetails(item)} className="text-left font-medium text-slate-900 hover:text-sky-700">{item.naziv}</button>
                    <p className="text-xs text-slate-500">{item.podkategorija || [item.marka, item.model].filter(Boolean).join(' ') || '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.inventarski_broj || '—'}</td>
                  <td className="px-4 py-3"><Badge variant={statusVariants[item.status]}>{statusLabels[item.status]}</Badge><p className="mt-1 text-xs text-slate-600">{readiness.label}</p><p className="text-xs text-slate-500">Stanje: {conditionLabels[item.stanje]}</p></td>
                  <td className="px-4 py-3 text-slate-600">{itemLocation(item, itemUsage)}<p className="mt-1 text-xs text-slate-500">{lastUse?.radnici.map((worker) => `${worker.ime} ${worker.prezime}`).join(', ') || 'Bez zadnjeg korisnika'}{lastUse ? ` · ${dateLabel(lastUse.datum)}` : ''}</p></td>
                  <td className="px-4 py-3 text-slate-600">{inspection.label}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{currency(item.nabavna_vrijednost)}</td>
                  {kategorija === 'stroj' && <td className="px-4 py-3 text-right text-slate-600">{item.radni_sati.toLocaleString('hr-HR')} h · {currency(item.cijena_sata ?? 0)}/h</td>}
                  <td className="px-4 py-3"><div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100">
                    <button type="button" onClick={() => openEdit(item)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-700" aria-label={`Uredi ${item.naziv}`}><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={() => setDeleteId(item.id)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Obriši ${item.naziv}`}><Trash2 className="h-4 w-4" /></button>
                  </div></td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {visibleItems.map((item) => renderDetails(item))}
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {visibleItems.map((item) => {
            const itemDocuments = documents[item.id] ?? [];
            const itemUsage = usageHistory[item.id] ?? [];
            const alert = itemServiceAlert(item, itemDocuments);
            const readiness = readinessState(item, itemDocuments);
            const inspection = inspectionState(itemDocuments);
            const lastUse = itemUsage[0];
            return (
              <article key={item.id} className={`min-w-0 rounded-2xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${expandedId === item.id ? 'border-sky-300 ring-1 ring-sky-100 xl:col-span-2 2xl:col-span-3' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => void toggleDetails(item)} className="flex min-w-0 items-center gap-3 text-left">
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><Icon className="h-5 w-5" /></span>
                    <span className="min-w-0"><span className="block truncate font-semibold text-slate-900">{item.naziv}</span><span className="block truncate text-xs text-slate-500">{[item.podkategorija, [item.marka, item.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'Bez kategorije i marke/modela'}</span></span>
                  </button>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => openEdit(item)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-700" aria-label={`Uredi ${item.naziv}`}><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={() => setDeleteId(item.id)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Obriši ${item.naziv}`}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2"><Badge variant={statusVariants[item.status]}>{statusLabels[item.status]}</Badge><Badge variant={item.stanje === 'osteceno' ? 'red' : item.stanje === 'novo' ? 'blue' : 'gray'}>{conditionLabels[item.stanje]}</Badge><Badge variant={statusTone(readiness.tone)}>{readiness.label}</Badge></div>
                <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 text-xs text-slate-500 xl:grid-cols-2">
                  <span>{item.inventarski_broj ? `Inv. ${item.inventarski_broj}` : item.serijski_broj ? `Ser. ${item.serijski_broj}` : 'Bez inventarskog broja'}</span>
                  <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{itemLocation(item, itemUsage)}</span>
                  <span>Pregled: {inspection.label}</span>
                  <span>Zadnji korisnik: {lastUse?.radnici.map((worker) => `${worker.ime} ${worker.prezime}`).join(', ') || 'Nije evidentiran'}{lastUse ? ` · ${dateLabel(lastUse.datum)}` : ''}</span>
                  <span>Količina: {item.kolicina.toLocaleString('hr-HR')}</span>
                  <span>Nabava: {currency(item.nabavna_vrijednost)}{item.datum_nabave ? ` · ${dateLabel(item.datum_nabave)}` : ''}</span>
                  {kategorija === 'stroj' && <span className="flex items-center gap-1"><Wrench className="h-3.5 w-3.5" />{item.radni_sati.toLocaleString('hr-HR')} radnih sati</span>}
                  {kategorija === 'stroj' && <span>Cijena sata: {currency(item.cijena_sata ?? 0)}/h</span>}
                  {kategorija === 'stroj' && item.servisni_interval_sati && <span>Servis svakih {item.servisni_interval_sati.toLocaleString('hr-HR')} h</span>}
                </div>
                {alert && <p className="mt-3 flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800"><AlertTriangle className="h-3.5 w-3.5" />{alert}</p>}
                {item.napomena && <p className="mt-3 line-clamp-2 text-xs text-slate-600">{item.napomena}</p>}
                {renderDetails(item)}
                {expandedId !== item.id && <button type="button" onClick={() => void toggleDetails(item)} className="mt-3 text-xs font-medium text-sky-700 hover:underline">Dokumenti i servisi</button>}
              </article>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Uredi ${kategorija}` : `Novi ${kategorija}`}
        wide="md"
        footer={(
          <>
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Odustani</button>
            <button type="button" onClick={() => void save()} disabled={saving || !form.naziv.trim()} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">{saving ? 'Spremanje…' : 'Spremi'}</button>
          </>
        )}
      >
        {error && <p className="mb-3 rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}
        <div className="space-y-3">
          <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
            <Field label="Naziv *"><TextInput value={form.naziv} onChange={(event) => setForm((previous) => ({ ...previous, naziv: event.target.value }))} placeholder={kategorija === 'alat' ? 'npr. Bušilica' : 'npr. Mini bager'} /></Field>
            <Field label={kategorija === 'alat' ? 'Kategorija alata' : 'Kategorija stroja'}><TextInput value={form.podkategorija} onChange={(event) => setForm((previous) => ({ ...previous, podkategorija: event.target.value }))} placeholder="npr. Aku alati, rezni alati" /></Field>
            <Field label="Marka"><TextInput value={form.marka} onChange={(event) => setForm((previous) => ({ ...previous, marka: event.target.value }))} /></Field>
            <Field label="Model"><TextInput value={form.model} onChange={(event) => setForm((previous) => ({ ...previous, model: event.target.value }))} /></Field>
            <Field label="Inventarski broj"><TextInput value={form.inventarski_broj} onChange={(event) => setForm((previous) => ({ ...previous, inventarski_broj: event.target.value }))} /></Field>
            <Field label="Serijski broj"><TextInput value={form.serijski_broj} onChange={(event) => setForm((previous) => ({ ...previous, serijski_broj: event.target.value }))} /></Field>
            <Field label="Status"><Select value={form.status} onChange={(event) => setForm((previous) => ({ ...previous, status: event.target.value as OpremaStatus }))}>
              {Object.entries(statusLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
            </Select></Field>
            <Field label="Stanje"><Select value={form.stanje} onChange={(event) => setForm((previous) => ({ ...previous, stanje: event.target.value as OpremaStanje }))}>
              {Object.entries(conditionLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
            </Select></Field>
            <Field label="Gradilište"><Select value={form.gradiliste_id} onChange={(event) => setForm((previous) => ({ ...previous, gradiliste_id: event.target.value, radnik_id: '' }))}>
              <option value="">Skladište / nije dodijeljeno</option>
              {sites.map((site) => <option key={site.id} value={site.id}>{site.naziv}</option>)}
            </Select></Field>
            <Field label="Količina"><TextInput type="number" min="0.01" step="0.01" value={form.kolicina} onChange={(event) => setForm((previous) => ({ ...previous, kolicina: event.target.value }))} /></Field>
            <Field label="Datum nabave"><TextInput type="date" value={form.datum_nabave} onChange={(event) => setForm((previous) => ({ ...previous, datum_nabave: event.target.value }))} /></Field>
            <Field label="Nabavna vrijednost (€)"><TextInput type="number" min="0" step="0.01" value={form.nabavna_vrijednost} onChange={(event) => setForm((previous) => ({ ...previous, nabavna_vrijednost: event.target.value }))} /></Field>
            {kategorija === 'stroj' && <>
              <Field label="Cijena radnog sata (€/h)"><TextInput type="number" min="0" step="0.01" value={form.cijena_sata} onChange={(event) => setForm((previous) => ({ ...previous, cijena_sata: event.target.value }))} placeholder="npr. 45" /></Field>
              <Field label="Trenutni radni sati"><TextInput type="number" min="0" step="0.1" value={form.radni_sati} onChange={(event) => setForm((previous) => ({ ...previous, radni_sati: event.target.value }))} /></Field>
              <Field label="Servisni interval (sati)"><TextInput type="number" min="0" step="1" value={form.servisni_interval_sati} onChange={(event) => setForm((previous) => ({ ...previous, servisni_interval_sati: event.target.value }))} placeholder="npr. 500" /></Field>
              <Field label="Upozori prije servisa (sati)"><TextInput type="number" min="0" step="1" value={form.servis_upozorenje_sati} onChange={(event) => setForm((previous) => ({ ...previous, servis_upozorenje_sati: event.target.value }))} /></Field>
            </>}
          </div>
          <Field label="Napomena"><Textarea rows={2} value={form.napomena} onChange={(event) => setForm((previous) => ({ ...previous, napomena: event.target.value }))} placeholder="Posebnosti, kvarovi, napomene…" /></Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => void removeItem()}
        title={`Obrisati ${kategorija === 'alat' ? 'alat' : 'stroj'}?`}
        message="Oprema i njezini zapisi o servisima/dokumentima bit će trajno obrisani."
      />
    </div>
  );
}
