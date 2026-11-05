import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { fetchFuelChangeHistory, restoreFuelChange, fetchResourceChangeHistory, restoreResourceChange,
  fetchDocumentChangeHistory, restoreDocumentChange,
  fetchDeadlineChangeHistory, restoreDeadlineChange,
  fetchWorkTimeChangeHistory, restoreWorkTimeChange,
  fetchCostChangeHistory, restoreCostChange,
  fetchInvoiceChangeHistory, restoreInvoiceChange,
  fetchContractedWorkChangeHistory, restoreContractedWorkChange,
  fetchTaskChangeHistory, restoreTaskChange, type TaskChangeHistory,
  fetchOrderChangeHistory, restoreOrderChange,
  fetchWorkOrderTeamChangeHistory, restoreWorkOrderTeamChange,
  fetchInvestorChangeHistory, restoreInvestorChange,
  fetchObjectChangeHistory, restoreObjectChange,
  fetchCooperatorChangeHistory, restoreCooperatorChange,
  fetchEngagementChangeHistory, restoreEngagementChange,
  fetchCatalogChangeHistory, restoreCatalogChange,
  type DocumentChangeHistory, type DocumentHistoryTable,
  type FuelChangeHistory as Change, type ResourceChangeHistory, type ResourceHistoryTable } from '@/lib/api';
import { resourceHistoryDifferences, taskDeadlineHistoryLines } from '@/lib/resourceHistory';
import { useAuth } from '@/auth/useAuth';
import type { AppModule } from '@/auth/permissions';
import { formatHrDate, formatHrDateTime } from '@/lib/localization';
import { useRequestScope } from '@/lib/useRequestScope';
import { HistoryButton, HistoryDialog } from './HistoryDialog';

const operationLabel = { INSERT: 'Dodano točenje', UPDATE: 'Izmijenjeno točenje', DELETE: 'Obrisano točenje' };
const documentOperationLabel = { INSERT: 'Dodan dokument', UPDATE: 'Izmijenjen dokument', DELETE: 'Obrisan dokument' };
const errorText = (reason: unknown) => reason && typeof reason === 'object' && 'message' in reason
  ? String(reason.message) : 'Povijest promjena nije dostupna.';

function fuelSnapshotLabel(snapshot: Change['before_data']): string {
  return snapshot
    ? `${formatHrDate(snapshot.datum)} · ${Number(snapshot.litara).toLocaleString('hr-HR')} l · ${snapshot.kilometraza.toLocaleString('hr-HR')} km · ${snapshot.tocio_ime}`
    : 'Nema zapisa';
}

export function FuelChangeHistory({ vehicleId, refreshVersion, onRestore, resourceTable, documentTable, deadlineHistory = false, workTimeHistory = false, costHistory = false, invoiceHistory = false, contractedWorkHistory = false, taskHistory = false, orderHistory = false, orderTeamHistory = false, investorHistory = false, objectHistory = false, cooperatorHistory = false, engagementHistory = false, catalogHistory = false, disabled = false, onRestoringChange }: {
  vehicleId: string;
  refreshVersion: number;
  onRestore: () => Promise<void>;
  resourceTable?: ResourceHistoryTable;
  documentTable?: DocumentHistoryTable;
  deadlineHistory?: boolean;
  workTimeHistory?: boolean;
  costHistory?: boolean;
  invoiceHistory?: boolean;
  contractedWorkHistory?: boolean;
  taskHistory?: boolean;
  orderHistory?: boolean;
  orderTeamHistory?: boolean;
  investorHistory?: boolean;
  objectHistory?: boolean;
  cooperatorHistory?: boolean;
  engagementHistory?: boolean;
  catalogHistory?: boolean;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Array<Change | ResourceChangeHistory | DocumentChangeHistory | TaskChangeHistory>>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestScope = useRequestScope();
  const restoreScope = useRequestScope();

  const load = useCallback(async (beforeSequence?: string) => {
    const isCurrent = requestScope.start();
    if (!isCurrent()) return;
    setLoading(true);
    setError(null);
    try {
      const page = catalogHistory ? await fetchCatalogChangeHistory(vehicleId, beforeSequence)
        : engagementHistory ? await fetchEngagementChangeHistory(vehicleId, beforeSequence)
        : cooperatorHistory ? await fetchCooperatorChangeHistory(vehicleId, beforeSequence)
        : objectHistory ? await fetchObjectChangeHistory(vehicleId, beforeSequence)
        : investorHistory ? await fetchInvestorChangeHistory(vehicleId, beforeSequence)
        : orderTeamHistory ? await fetchWorkOrderTeamChangeHistory(vehicleId, beforeSequence)
        : orderHistory ? await fetchOrderChangeHistory(vehicleId, beforeSequence)
        : taskHistory ? await fetchTaskChangeHistory(vehicleId, beforeSequence)
        : contractedWorkHistory ? await fetchContractedWorkChangeHistory(vehicleId, beforeSequence)
        : invoiceHistory ? await fetchInvoiceChangeHistory(vehicleId, beforeSequence)
        : costHistory ? await fetchCostChangeHistory(vehicleId, beforeSequence)
        : workTimeHistory ? await fetchWorkTimeChangeHistory(vehicleId, beforeSequence)
        : deadlineHistory ? await fetchDeadlineChangeHistory(vehicleId, beforeSequence)
        : documentTable ? await fetchDocumentChangeHistory(documentTable, vehicleId, beforeSequence) : resourceTable
        ? await fetchResourceChangeHistory(resourceTable, vehicleId, beforeSequence)
        : await fetchFuelChangeHistory(vehicleId, beforeSequence);
      if (!isCurrent()) return;
      setItems((current) => beforeSequence ? [...current, ...page] : page);
      setHasMore(page.length === 50);
    } catch (reason) {
      if (isCurrent()) setError(errorText(reason));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [vehicleId, requestScope, resourceTable, documentTable, deadlineHistory, workTimeHistory, costHistory, invoiceHistory, contractedWorkHistory, taskHistory, orderHistory, orderTeamHistory, investorHistory, objectHistory, cooperatorHistory, engagementHistory, catalogHistory]);

  useEffect(() => {
    if (open) void load();
    return () => requestScope.invalidate();
  }, [load, open, refreshVersion, requestScope]);

  const restore = async (change: Change | ResourceChangeHistory | DocumentChangeHistory | TaskChangeHistory) => {
    if (disabled || restoring !== null || !change.can_restore) return;
    const message = 'blocked_reason' in change ? [
      documentTable ? `${documentOperationLabel[change.operation]}: vratiti prethodno stanje?`
        : orderTeamHistory ? `${change.operation === 'INSERT' ? 'Poništiti dodjelu' : 'Vratiti uklonjenu dodjelu'} djelatnika?`
          : 'Vratiti prethodne podatke?',
      ...resourceHistoryDifferences(change).map((field) => `${field.label}: ${field.after} → ${field.before}`),
      ...('before_deadlines' in change ? [
        'Zajedno sa zadatkom vratit će se izvorni rokovi:',
        ...taskDeadlineHistoryLines(change.before_deadlines),
      ] : []),
      documentTable ? 'Obrazac dokumenta bit će resetiran; nespremljene izmjene neće se sačuvati.' : 'Otvoreni obrazac bit će zatvoren; nespremljene izmjene neće se sačuvati.',
      orderTeamHistory ? 'Povrat je moguć samo prije početka rada i bez evidentiranih sati. Ostali podaci naloga i obračuni se ne mijenjaju.'
        : taskHistory ? 'Vraćaju se zadatak i njegovi povezani rokovi. Nalog, obračuni i drugi zapisi ne mijenjaju se.'
        : 'Povezani dokumenti, obračuni i drugi zapisi neće se vratiti ovom radnjom.',
      ...(invoiceHistory ? ['Ovo je povrat ERP podataka, ne storno ni ispravak već poslanog računa. Ne provodi se bankovna naplata.'] : []),
      ...(resourceTable === 'vozila' ? ['Vraćanje kilometraže može sniziti stanje vozila. Točenja i kilometri na nalozima ostaju nepromijenjeni.'] : []),
    ].join('\n') : [
      `${operationLabel[change.operation]}:`,
      `Sada: ${fuelSnapshotLabel(change.after_data)}`,
      `Vratiti na: ${fuelSnapshotLabel(change.before_data)}`,
      'Otvoreni obrazac točenja bit će vraćen na početno stanje.',
      'Kilometraža vozila neće se automatski smanjiti. Potrošnja i anomalije osvježit će se prema vraćenom zapisu.',
      'Potvrditi vraćanje?',
    ].join('\n');
    if (!window.confirm(message)) return;
    const isCurrent = restoreScope.start();
    if (!isCurrent()) return;
    setRestoring(change.id);
    onRestoringChange?.(true);
    setError(null);
    setNotice(null);
    try {
      if (catalogHistory) await restoreCatalogChange(change.id);
      else if (engagementHistory) await restoreEngagementChange(change.id);
      else if (cooperatorHistory) await restoreCooperatorChange(change.id);
      else if (objectHistory) await restoreObjectChange(change.id);
      else if (investorHistory) await restoreInvestorChange(change.id);
      else if (orderTeamHistory) await restoreWorkOrderTeamChange(change.id);
      else if (orderHistory) await restoreOrderChange(change.id);
      else if (taskHistory) await restoreTaskChange(change.id);
      else if (contractedWorkHistory) await restoreContractedWorkChange(change.id);
      else if (invoiceHistory) await restoreInvoiceChange(change.id);
      else if (costHistory) await restoreCostChange(change.id);
      else if (workTimeHistory) await restoreWorkTimeChange(change.id);
      else if (deadlineHistory) await restoreDeadlineChange(change.id);
      else if (documentTable) await restoreDocumentChange(change.id);
      else if (resourceTable) await restoreResourceChange(change.id);
      else await restoreFuelChange(change.id);
      if (!isCurrent()) return;
      setNotice('Promjena je vraćena.');
      await load();
      if (!isCurrent()) return;
      try {
        await onRestore();
      } catch (reason) {
        if (isCurrent()) setError(`Promjena je vraćena, ali prikaz nije osvježen: ${errorText(reason)}`);
      }
    } catch (reason) {
      if (isCurrent()) setError(errorText(reason));
    } finally {
      if (isCurrent()) setRestoring(null);
      onRestoringChange?.(false);
    }
  };

  return (
    <>
      <HistoryButton onClick={() => setOpen(true)} disabled={restoring !== null} />
      <HistoryDialog open={open} onClose={() => setOpen(false)} title="Povijest promjena i vraćanje (30 dana)">
        {catalogHistory ? <p className="text-xs text-slate-500">
          Vraćaju se šifra, naziv, vrsta posla, podgrupa, jedinica, kataloška cijena i opis.
          Promjena cijene bilježi se kao novi zapis s aktualnim vremenom; stara povijest cijene ostaje sačuvana.
          Spremljene ponude, nalozi, gradilišta i računi ne preračunavaju se. Dodavanje i brisanje stavke nisu obuhvaćeni.
        </p> : engagementHistory ? <p className="text-xs text-slate-500">
          Vraćaju se dogovoreni iznos, spremljeni status, datum početka i završetka te napomena angažmana.
          Kooperant i gradilište ne mijenjaju se. Računi, troškovi, dokumenti, zadaci i rokovi ne vraćaju se.
          Status završenog gradilišta i dalje može određivati prikaz angažmana.
          Novi i obrisani angažmani te izvedeni zapisi iz troškova nisu obuhvaćeni.
        </p> : cooperatorHistory ? <p className="text-xs text-slate-500">
          Vraćaju se osnovni i kontaktni podaci kooperanta, OIB, IBAN i boja terminskog plana.
          Angažmani, dokumenti, ponude, računi i troškovi ne vraćaju se niti preračunavaju.
          Povrat IBAN-a ne provodi plaćanje. Dodavanje i brisanje kooperanta nisu obuhvaćeni.
        </p> : objectHistory ? <p className="text-xs text-slate-500">
          Vraćaju se naziv, investitor, adresa, mjesto, poštanski broj, kontakt osoba, telefon i napomena objekta.
          Znanje objekta, povezana gradilišta i financijski zapisi ne vraćaju se niti preračunavaju.
          Dodavanje i brisanje objekta nisu obuhvaćeni.
        </p> : investorHistory ? <p className="text-xs text-slate-500">
          Vraćaju se naziv, OIB, adresa, mjesto, poštanski broj, kontakt osoba, telefon, e-pošta, web i napomena investitora.
          Zasebni kontakti, objekti, gradilišta i fakture ne mijenjaju se. Ovo nije ispravak već izdanog računa.
          Dodavanje i brisanje investitora nisu obuhvaćeni.
        </p> : orderTeamHistory ? <p className="text-xs text-slate-500">
          Vraća se pojedinačno dodavanje ili uklanjanje djelatnika. Povrat je moguć samo prije početka rada i dok nema sati ni mobilnog izvršenja.
          Vraćajte najnoviju promjenu iste dodjele prvu; rasporedi, poslovođa, vozač i ostali podaci naloga ne mijenjaju se.
        </p> : orderHistory ? <p className="text-xs text-slate-500">
          Vraćaju se naslov, opis, prioritet i rok naloga. Povrat roka može promijeniti raspored i vidljivost naloga djelatnicima.
          Status, gradilište, ekipa, izvršenje, sati i financije nisu obuhvaćeni; miješana izmjena nepodržanih polja blokira cijelu radnju.
          Nema ponovnog obračuna ni slanja obavijesti. Za obrisani nalog najprije vratite brisanje.
        </p> : taskHistory ? <p className="text-xs text-slate-500">
          Zajedno se vraćaju naziv, datum, dovršenost i kooperant zadatka te izvorni povezani rokovi.
          Promjene vrste i veze gradilišta/naloga nisu obuhvaćene. Nalog i obračuni ne mijenjaju se.
          Naknadne promjene rokova, uključujući brisanje i obnovu, blokiraju stari povrat.
        </p> : contractedWorkHistory ? <p className="text-xs text-slate-500">
          Vraćaju se naziv, opis, ugovoreni i ostvareni iznos, status i gradilište rada.
          Promjene vrste rada, veze ponude i priloga nisu obuhvaćene. Ponuda i dokumenti ne mijenjaju se.
          Vraćajte od najnovije izmjene prema starijoj. Za obrisani rad najprije vratite brisanje.
        </p> : invoiceHistory ? <p className="text-xs text-slate-500">
          Vraćaju se podaci fakture: broj, kupac, iznos, rabat i njegov izvorni smjer, datumi, status naplate,
          opis i veze s gradilištem i investitorom. Vraćajte od najnovije izmjene prema starijoj.
          Za obrisanu fakturu najprije vratite brisanje. Ovo nije storno ni ispravak već poslanog računa;
          ne šalje se novi račun i ne provodi se bankovna naplata.
        </p> : costHistory ? <p className="text-xs text-slate-500">
          Vraćaju se izmjene ručnih troškova: gradilište, kooperant, kategorija, opis, iznos, datum i podaci plaćanja.
          Stavke naloga i grupnih računa nisu obuhvaćene. Za obrisani trošak najprije vratite brisanje iz zasebnog panela.
          Vraćajte od najnovije izmjene prema starijoj. Povezani obračuni i dokumenti ne mijenjaju se.
        </p> : workTimeHistory ? <p className="text-xs text-slate-500">
          Vraćaju se izmjene ručno unesene evidencije: djelatnik, gradilište, datum, ukupni i noćni sati te napomena.
          Sati povezani s radnim nalogom nisu obuhvaćeni. Za obrisani zapis najprije vratite brisanje iz zasebnog panela.
          Vraćajte od najnovije izmjene prema starijoj. Satnice, odsustva i povezani troškovi ne mijenjaju se.
        </p> : deadlineHistory ? <p className="text-xs text-slate-500">
          Vraćaju se izmjene ručnih rokova: naziv, datumi, status, opis i veze s gradilištem, nalogom i kooperantom.
          Rokovi koje održava zadatak nisu obuhvaćeni. Za obrisani rok najprije vratite brisanje iz zasebnog panela.
          Vraćajte od najnovije izmjene prema starijoj. Povezani zadaci ne mijenjaju se.
        </p> : documentTable ? <p className="text-xs text-slate-500">
          Vraćaju se dodavanja, izmjene i brisanja dokumenata nakon aktivacije zaštite, uključujući sačuvane priloge.
          Resurs mora postojati. Vraćajte od najnovije promjene istog dokumenta prema starijoj.
          Ranije trajno obrisane datoteke nisu obnovljive. Već izdane poveznice na prilog vrijede do svojeg isteka.
        </p> : resourceTable ? <p className="text-xs text-slate-500">
          Vraćaju se samo podržane izmjene osnovnih podataka nakon aktivacije zaštite.
          {resourceTable === 'gradilista'
            ? ' Za povrat brisanja koristite zasebni panel obrisanih gradilišta. Ovdje se ne vraćaju financijski iznosi, prilozi ni povezani zadaci, rokovi i nalozi. Novi investitori i objekti ostaju sačuvani; vraća se samo veza postojećeg objekta.'
            : ' Za povrat brisanja koristite zasebni panel obrisanih resursa. Dodjele i promjene cijena/obračuna ne vraćaju se ovdje.'}
          {' '}Vraćajte od najnovije izmjene prema starijoj.
        </p> : <p className="text-xs text-slate-500">
          Zaštićeni su samo unosi goriva nastali ili promijenjeni nakon aktivacije zaštite.
          Za više koraka istog zapisa vraćajte od najnovije promjene prema starijoj.
          Za obnovu obrisanog vozila koristite zasebni panel obrisanih resursa. Promjene iz drugih modula ne vraćaju se ovdje.
        </p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{notice}</p>}
        <button type="button" onClick={() => void load()} disabled={loading || restoring !== null} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50">Osvježi povijest</button>
        {loading && <p role="status" className="text-sm text-slate-500">Učitavanje povijesti…</p>}
        {!loading && !error && items.length === 0 && <p className="text-sm text-slate-500">Nema zabilježenih promjena u zadnjih 30 dana.</p>}
        {items.map((change) => <article key={change.id} className="space-y-1 rounded-lg border border-slate-200 p-3">
          <p className="text-sm font-semibold text-slate-800">{change.reverses_id ? 'Vraćanje promjene' : orderTeamHistory ? change.operation === 'INSERT' ? 'Dodijeljen djelatnik' : 'Uklonjen djelatnik' : documentTable ? documentOperationLabel[change.operation] : resourceTable || deadlineHistory || workTimeHistory || taskHistory || orderHistory || investorHistory || objectHistory || cooperatorHistory || engagementHistory || catalogHistory ? 'Izmijenjeni podaci' : operationLabel[change.operation]}</p>
          <p className="text-xs text-slate-500">{formatHrDateTime(new Date(change.created_at))} · {change.actor_name}</p>
          {'blocked_reason' in change ? resourceHistoryDifferences(change).map((field) => (
            <p key={field.key} className="break-words text-xs text-slate-700">{field.label}: {field.before} → {field.after}</p>
          )) : <>
            <p className="text-xs text-slate-700">Prije: {fuelSnapshotLabel(change.before_data)}</p>
            <p className="text-xs text-slate-700">Poslije: {fuelSnapshotLabel(change.after_data)}</p>
          </>}
          {'before_deadlines' in change && <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-700">Rokovi prije izmjene:</p>
            {taskDeadlineHistoryLines(change.before_deadlines).map((line, index) => <p key={`before:${index}`} className="break-words text-xs text-slate-700">{line}</p>)}
            <p className="text-xs font-semibold text-slate-700">Rokovi poslije izmjene:</p>
            {taskDeadlineHistoryLines(change.after_deadlines).map((line, index) => <p key={`after:${index}`} className="break-words text-xs text-slate-700">{line}</p>)}
          </div>}
          {change.reversed_at
            ? <p className="text-xs text-emerald-700">Vraćeno {formatHrDateTime(new Date(change.reversed_at))}</p>
            : change.reverses_id ? null : <>
              <p className="text-xs text-slate-500">Moguće vratiti do {formatHrDateTime(new Date(change.expires_at))}.</p>
              <button type="button" onClick={() => void restore(change)} disabled={disabled || !change.can_restore || restoring !== null || loading} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-sky-700 disabled:opacity-50">
                <RotateCcw className="h-3.5 w-3.5" /> {restoring === change.id ? 'Vraćanje…' : 'Vrati promjenu'}
              </button>
              {!change.can_restore && <p className="text-xs text-amber-800">{'blocked_reason' in change ? change.blocked_reason : 'Zapis ima noviju promjenu; prvo provjerite nju.'}</p>}
            </>}
        </article>)}
        {hasMore && <button type="button" onClick={() => void load(items[items.length - 1]?.sequence)} disabled={loading || restoring !== null} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Starije promjene</button>}
      </HistoryDialog>
    </>
  );
}

export function WorkTimeChangeHistoryPanel({ recordId, onRestore, refreshVersion = 0, disabled, onRestoringChange }: {
  recordId: string;
  onRestore: () => Promise<void>;
  refreshVersion?: number;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess('radno_vrijeme', 'edit')
    ? <FuelChangeHistory key={`radno_vrijeme:${recordId}`} vehicleId={recordId} workTimeHistory refreshVersion={refreshVersion} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function CatalogChangeHistoryPanel({ recordId, onRestore, disabled, onRestoringChange }: {
  recordId: string;
  onRestore: () => Promise<void>;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess('stavke', 'edit')
    ? <FuelChangeHistory key={`stavka:${recordId}`} vehicleId={recordId} catalogHistory refreshVersion={0} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function EngagementChangeHistoryPanel({ recordId, onRestore, disabled, onRestoringChange }: {
  recordId: string;
  onRestore: () => Promise<void>;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess('kooperanti', 'edit')
    ? <FuelChangeHistory key={`angazman:${recordId}`} vehicleId={recordId} engagementHistory refreshVersion={0} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function CooperatorChangeHistoryPanel({ recordId, onRestore, disabled, onRestoringChange }: {
  recordId: string;
  onRestore: () => Promise<void>;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess('kooperanti', 'edit')
    ? <FuelChangeHistory key={`kooperant:${recordId}`} vehicleId={recordId} cooperatorHistory refreshVersion={0} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function ObjectChangeHistoryPanel({ recordId, onRestore, disabled, onRestoringChange }: {
  recordId: string;
  onRestore: () => Promise<void>;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess('objekti', 'edit')
    ? <FuelChangeHistory key={`objekt:${recordId}`} vehicleId={recordId} objectHistory refreshVersion={0} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function InvestorChangeHistoryPanel({ recordId, onRestore, disabled, onRestoringChange }: {
  recordId: string;
  onRestore: () => Promise<void>;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess('investitori', 'edit')
    ? <FuelChangeHistory key={`investitor:${recordId}`} vehicleId={recordId} investorHistory refreshVersion={0} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function OrderChangeHistoryPanel({ recordId, onRestore, disabled, onRestoringChange }: {
  recordId: string;
  onRestore: () => Promise<void>;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess('radni_nalozi', 'edit')
    ? <FuelChangeHistory key={`order:${recordId}`} vehicleId={recordId} orderHistory refreshVersion={0} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function OrderTeamChangeHistoryPanel({ recordId, onRestore, disabled, onRestoringChange }: {
  recordId: string;
  onRestore: () => Promise<void>;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess('radni_nalozi', 'edit')
    ? <FuelChangeHistory key={`order-team:${recordId}`} vehicleId={recordId} orderTeamHistory refreshVersion={0} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function TaskChangeHistoryPanel({ recordId, onRestore, disabled, onRestoringChange }: {
  recordId: string;
  onRestore: () => Promise<void>;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess('gradilista', 'edit')
    ? <FuelChangeHistory key={`task:${recordId}`} vehicleId={recordId} taskHistory refreshVersion={0} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function ContractedWorkChangeHistoryPanel({ recordId, onRestore, disabled, onRestoringChange }: {
  recordId: string;
  onRestore: () => Promise<void>;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess('gradilista', 'edit')
    ? <FuelChangeHistory key={`ugovoreni_radovi:${recordId}`} vehicleId={recordId} contractedWorkHistory refreshVersion={0} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function InvoiceChangeHistoryPanel({ recordId, onRestore, disabled, onRestoringChange }: {
  recordId: string;
  onRestore: () => Promise<void>;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess('fakture', 'edit')
    ? <FuelChangeHistory key={`fakture:${recordId}`} vehicleId={recordId} invoiceHistory refreshVersion={0} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function CostChangeHistoryPanel({ recordId, onRestore, disabled, onRestoringChange }: {
  recordId: string;
  onRestore: () => Promise<void>;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess('troskovi', 'edit')
    ? <FuelChangeHistory key={`troskovi:${recordId}`} vehicleId={recordId} costHistory refreshVersion={0} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function DeadlineChangeHistoryPanel({ recordId, onRestore, refreshVersion = 0, disabled, onRestoringChange }: {
  recordId: string;
  onRestore: () => Promise<void>;
  refreshVersion?: number;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess('gradilista', 'edit')
    ? <FuelChangeHistory key={`rokovi:${recordId}`} vehicleId={recordId} deadlineHistory refreshVersion={refreshVersion} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function DocumentChangeHistoryPanel({ table, parentId, module, onRestore, refreshVersion, disabled, onRestoringChange }: {
  table: DocumentHistoryTable;
  parentId: string;
  module: AppModule;
  onRestore: () => Promise<void>;
  refreshVersion: number;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess(module, 'edit')
    ? <FuelChangeHistory key={`${table}:${parentId}`} vehicleId={parentId} documentTable={table} refreshVersion={refreshVersion} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}

export function ResourceChangeHistoryPanel({ table, recordId, module, onRestore, disabled, onRestoringChange }: {
  table: ResourceHistoryTable;
  recordId: string;
  module: AppModule;
  onRestore: () => Promise<void>;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
}) {
  const { canAccess } = useAuth();
  return canAccess(module, 'edit')
    ? <FuelChangeHistory key={`${table}:${recordId}`} vehicleId={recordId} resourceTable={table} refreshVersion={0} onRestore={onRestore} disabled={disabled} onRestoringChange={onRestoringChange} />
    : null;
}
