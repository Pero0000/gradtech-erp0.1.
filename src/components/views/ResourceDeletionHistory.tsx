import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { fetchContractedWorkDeletions, fetchAbsenceDeletions, fetchDeadlineDeletions, fetchTaskDeletions, fetchResourceDeletions,
  fetchKooperantInvoiceDeletions, fetchWorkOrderSettlementDeletions,
  fetchDailyVehicleKmSettlements,
  restoreResourceDeletion, restoreKooperantInvoiceDeletion, restoreWorkOrderSettlement,
  restoreDailyVehicleKmSettlement,
  type ResourceDeletion, type ResourceDeletionModule } from '@/lib/api';
import { formatHrDate, formatHrDateTime } from '@/lib/localization';
import { useRequestScope } from '@/lib/useRequestScope';
import { HistoryButton, HistoryDialog } from './HistoryDialog';

const tableLabels: Record<string, string> = {
  radnici: 'Djelatnici', vozila: 'Vozila', oprema: 'Alat i strojevi',
  radnici_dokumenti: 'Dokumenti djelatnika', vozila_dokumenti: 'Dokumenti vozila', oprema_dokumenti: 'Dokumenti opreme',
  radnici_odsustva: 'Odsustva', radnici_povijest: 'Povijest cijena djelatnika', radno_vrijeme: 'Radno vrijeme',
  raspored_radnici: 'Dodjele djelatnika', raspored_vozila: 'Dodjele vozila',
  dnevni_raspored_radnici: 'Dnevni raspored djelatnika', dnevni_raspored_gradilista: 'Dnevni raspored gradilišta',
  dnevni_raspored_ostalo: 'Ostali rasporedi', radni_nalozi: 'Radni nalozi',
  radni_nalozi_radnici: 'Ekipa naloga', radni_nalozi_stavke: 'Stavke naloga',
  vozila_gorivo: 'Točenja goriva', vozila_gorivo_anomalije: 'Provjere goriva',
  vozila_obavijesti: 'Prijave kvarova', mobile_work_order_audit: 'Evidencija aktivnosti naloga',
  app_profiles: 'Povezanost korisničkog računa', troskovi: 'Troškovi',
  gradilista: 'Gradilišta', gradiliste_zadaci: 'Zadaci gradilišta', gradiliste_dokumenti: 'Dokumenti i fotografije gradilišta',
  gradiliste_stavke: 'Troškovničke stavke gradilišta', rokovi: 'Rokovi', ugovoreni_radovi: 'Ugovoreni i VTR radovi',
  fakture: 'Fakture', ponude: 'Ponude', ponude_stavke: 'Stavke ponude', kooperant_angazmani: 'Angažmani kooperanata',
  raspored: 'Rasporedi', nalog_gradiliste_dokumenti: 'Veze dokumenata s nalogom',
  gradiliste_board_layout: 'Položaj gradilišta na ploči',
  radni_nalozi_foto: 'Fotografije naloga', radni_nalozi_dokumenti: 'Dokumenti naloga',
  kooperant_dokumenti: 'Prilog kooperantskog računa',
};

const errorText = (error: unknown) => error && typeof error === 'object' && 'message' in error
  ? String(error.message) : 'Povrat brisanja nije dostupan.';

function resourceName(item: ResourceDeletion, workerNames?: Readonly<Record<string, string>>): string {
  const data = item.snapshot;
  if (data.__history_type === 'daily_vehicle_km_settlement' && typeof data.settlement_date === 'string') {
    return `Kilometarski obračun · ${formatHrDate(data.settlement_date)}`;
  }
  if (data.vrsta === 'racun' && typeof data.naziv === 'string') return `Račun · ${data.naziv}`;
  if (typeof data.ugovoreni_iznos === 'number' && typeof data.naziv === 'string') {
    const eur = (value: number) => value.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
    return `${data.vrsta === 'vtr' ? 'VTR' : 'Ugovoreni rad'} · ${data.naziv} · Ugovoreno: ${eur(data.ugovoreni_iznos)} · Ostvareno: ${eur(typeof data.ostvareni_iznos === 'number' ? data.ostvareni_iznos : 0)}${data.dokument_naziv ? ` · Prilog: ${data.dokument_naziv}` : ''}`;
  }
  if (typeof data.broj === 'string' && typeof data.datum_izdavanja === 'string' && typeof data.iznos === 'number') {
    const eur = (value: number) => value.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
    const statuses: Record<string, string> = { izdana: 'Izdana', placena: 'Plaćena', 'nep placena': 'Neplaćena' };
    return `${data.broj} · ${data.kupac || 'Bez kupca'} · ${formatHrDate(data.datum_izdavanja)} · Osnovni iznos: ${eur(data.iznos)} · Rabat (${data.rabat_smjer === 'oduzmi' ? 'oduzima se' : 'pribraja se'}): ${eur(typeof data.rabat === 'number' ? data.rabat : 0)} · ${statuses[String(data.status)] ?? data.status}${typeof data.datum_naplate === 'string' ? ` · Naplaćeno: ${formatHrDate(data.datum_naplate)}` : ''}`;
  }
  if (typeof data.godina === 'number' && typeof data.redni_broj === 'number' && typeof data.naslov === 'string') {
    const statuses: Record<string, string> = { nepotvrdena: 'Nepotvrđena', potvrdena: 'Potvrđena', odbijena: 'Odbijena' };
    return `${data.redni_broj}/${data.godina} · ${data.naslov} · ${formatHrDate(String(data.datum))} · ${statuses[String(data.status)] ?? data.status}`;
  }
  if (typeof data.iznos === 'number' && typeof data.opis === 'string' && typeof data.datum === 'string') {
    return `${data.opis} · ${formatHrDate(data.datum)} · ${data.iznos.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}`;
  }
  if (typeof data.datum_od === 'string' && typeof data.datum_do === 'string' && typeof data.radnik_id === 'string') {
    const kinds: Record<string, string> = { godisnji: 'Godišnji odmor', bolovanje: 'Bolovanje', praznik: 'Praznik' };
    return `${workerNames?.[data.radnik_id] ?? `Djelatnik ${data.radnik_id}`} · ${kinds[String(data.vrsta)] ?? data.vrsta} · ${formatHrDate(data.datum_od)} – ${formatHrDate(data.datum_do)}`;
  }
  if (typeof data.sati === 'number' && typeof data.datum === 'string') {
    return `${workerNames?.[String(data.radnik_id)] ?? `Djelatnik ${data.radnik_id}`} · ${formatHrDate(data.datum)} · ${data.sati.toLocaleString('hr-HR')} h`;
  }
  return [data.ime, data.prezime].filter(Boolean).join(' ')
    || [data.broj, data.naslov].filter(Boolean).join(' · ')
    || String(data.registracija || data.naziv || 'Resurs');
}

function deadlinePeriod(item: ResourceDeletion): string {
  const start = item.snapshot.datum_pocetka ?? item.snapshot.datum;
  const end = item.snapshot.datum_zavrsetka ?? item.snapshot.datum;
  return [start, end].filter((value): value is string => typeof value === 'string').map((value) => formatHrDate(value)).join(' – ');
}

function DeletionHistory({ module, table, refreshVersion, onRestore, disabled = false, onRestoringChange, workerNames, buttonLabel }: {
  module: ResourceDeletionModule;
  table?: 'gradiliste_zadaci' | 'rokovi' | 'radnici_odsustva' | 'ugovoreni_radovi' | 'kooperant_racuni' | 'obracun_naloga' | 'kilometarski_obracun';
  refreshVersion: number;
  onRestore: () => Promise<void>;
  disabled?: boolean;
  onRestoringChange?: (restoring: boolean) => void;
  workerNames?: Readonly<Record<string, string>>;
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ResourceDeletion[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestScope = useRequestScope();
  const restoreScope = useRequestScope();

  const load = useCallback(async (before?: ResourceDeletion) => {
    const isCurrent = requestScope.start();
    if (!isCurrent()) return;
    setLoading(true);
    setError(null);
    try {
      const page = table === 'ugovoreni_radovi' ? await fetchContractedWorkDeletions(before)
        : table === 'kooperant_racuni' ? await fetchKooperantInvoiceDeletions(before)
        : table === 'obracun_naloga' ? await fetchWorkOrderSettlementDeletions(before)
        : table === 'kilometarski_obracun' ? await fetchDailyVehicleKmSettlements(before)
        : table === 'radnici_odsustva' ? await fetchAbsenceDeletions(before)
        : table === 'rokovi' ? await fetchDeadlineDeletions(before)
        : table ? await fetchTaskDeletions(before) : await fetchResourceDeletions(module, before);
      if (!isCurrent()) return;
      setItems((current) => before ? [...current, ...page] : page);
      setHasMore(page.length === 50);
    } catch (reason) {
      if (isCurrent()) setError(errorText(reason));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [module, table, requestScope]);

  useEffect(() => {
    if (open) void load();
    return () => requestScope.invalidate();
  }, [open, refreshVersion, load, requestScope]);

  const restore = async (item: ResourceDeletion) => {
    if (disabled || !item.can_restore || restoring) return;
    const details = Object.entries(item.affected_rows).map(([table, count]) => `${tableLabels[table] ?? table}: ${count}`);
    if (!window.confirm([
      `Vratiti ${table === 'kooperant_racuni' ? 'obrisani račun kooperanta' : table === 'ugovoreni_radovi' ? 'obrisani ugovoreni/VTR rad' : table === 'obracun_naloga' ? 'prethodni obračun naloga' : table === 'kilometarski_obracun' ? 'prethodni dnevni kilometarski obračun' : module === 'ponude' ? 'obrisanu ponudu' : module === 'fakture' ? 'obrisanu fakturu' : module === 'troskovi' ? 'obrisani trošak' : table === 'radnici_odsustva' ? 'obrisano odsustvo' : table === 'rokovi' ? 'obrisani rok' : table ? 'obrisani zadatak' : module === 'radno_vrijeme' ? 'obrisani zapis radnog vremena' : module === 'gradilista' ? 'obrisano gradilište' : module === 'radni_nalozi' ? 'obrisani radni nalog' : 'obrisani resurs'} "${resourceName(item, workerNames)}" i sve povezane zapise?`,
      ...details,
      ...(table === 'rokovi' ? [`Razdoblje: ${deadlinePeriod(item)}`] : []),
      'Otvoreni obrasci bit će zatvoreni; nespremljene izmjene neće se sačuvati.',
      'Vraćaju se izvorne vrijednosti i dodjele, uključujući povijesne iznose. Odobrenja računa, uloge, prava i lozinke ne mijenjaju se.',
      'Ako je bilo koji zapis naknadno promijenjen, povrat se odbija u cijelosti.',
      ...(table === 'kooperant_racuni' ? ['Vraćaju se sve stavke troška i zapis priloga. Izvorna datoteka ostaje sačuvana; ne šalje se plaćanje.'] : []),
    ].join('\n'))) return;
    const isCurrent = restoreScope.start();
    if (!isCurrent()) return;
    setRestoring(true);
    onRestoringChange?.(true);
    setError(null);
    setNotice(null);
    try {
      if (table === 'kooperant_racuni') await restoreKooperantInvoiceDeletion(item.id);
      else if (table === 'obracun_naloga') await restoreWorkOrderSettlement(item.id);
      else if (table === 'kilometarski_obracun') await restoreDailyVehicleKmSettlement(item.id);
      else await restoreResourceDeletion(item.id);
      if (!isCurrent()) return;
      setNotice(table === 'kooperant_racuni' ? 'Račun, stavke troška i prilog su vraćeni.'
        : table === 'obracun_naloga' ? 'Prethodni obračun sati i troškova rada/opreme je vraćen.'
          : table === 'kilometarski_obracun' ? 'Prethodni dnevni kilometarski obračun je vraćen.'
          : module === 'ponude' ? 'Ponuda i stavke su vraćene.' : 'Resurs i povezani podaci su vraćeni.');
      await load();
      if (!isCurrent()) return;
      try {
        await onRestore();
      } catch (reason) {
        if (isCurrent()) setError(`Podaci su vraćeni, ali prikaz nije osvježen: ${errorText(reason)}`);
      }
    } catch (reason) {
      if (isCurrent()) setError(errorText(reason));
    } finally {
      if (isCurrent()) setRestoring(false);
      onRestoringChange?.(false);
    }
  };

  const title = table === 'ugovoreni_radovi' ? 'Pojedinačno obrisani ugovoreni i VTR radovi (30 dana)' : table === 'obracun_naloga' ? 'Prethodni obračuni sati i troškova naloga (30 dana)' : table === 'kilometarski_obracun' ? 'Prethodni dnevni kilometarski obračuni (30 dana)' : module === 'ponude' ? 'Obrisane ponude i stavke (30 dana)' : module === 'fakture' ? 'Pojedinačno obrisane fakture (30 dana)' : module === 'troskovi' ? 'Pojedinačno obrisani troškovi (30 dana)' : table === 'radnici_odsustva' ? 'Obrisana odsustva (30 dana)' : table === 'rokovi' ? 'Pojedinačno obrisani rokovi (30 dana)' : table ? 'Obrisani zadaci i dodatni radovi (30 dana)' : module === 'radno_vrijeme' ? 'Pojedinačno obrisano radno vrijeme (30 dana)' : module === 'gradilista' ? 'Obrisana gradilišta i povezani podaci (30 dana)' : module === 'radni_nalozi' ? 'Obrisani radni nalozi i povezani podaci (30 dana)' : 'Obrisani resursi i povezani podaci (30 dana)';
  return <>
    <HistoryButton onClick={() => setOpen(true)} disabled={restoring} ariaLabel={title} label={buttonLabel} />
    <HistoryDialog open={open} onClose={() => setOpen(false)} title={title}>
      <p className="text-xs text-slate-500">Povrat obuhvaća cijelu radnju zaštićenog brisanja. Potrebna su trenutačna prava svih zahvaćenih modula; povezivanje korisničkog računa zahtijeva administratora. Ranija nezaštićena brisanja nisu obnovljiva.</p>
      {table === 'kooperant_racuni' && <p className="text-xs text-slate-500">Brisanje uklanja račun i sve njegove stavke troška u jednoj transakciji, ali zadržava izvornu datoteku u privatnom Storageu. Vraćanje je moguće 30 dana i traži prava za kooperante i zahvaćene troškove.</p>}
      {table === 'gradiliste_zadaci' && <p className="text-xs text-slate-500">Zadatak ili dodatni rad vraća se zajedno sa svim svojim obrisanim rokovima. Ovo nije povijest pojedinačnih izmjena zadataka.</p>}
      {table === 'rokovi' && <p className="text-xs text-slate-500">Rok vezan uz zadatak može se vratiti samo ako zadatak i njegovi rokovi nisu naknadno mijenjani. Automatsko uklanjanje roka pri izmjeni zadatka nije pojedinačno brisanje.</p>}
      {table === 'ugovoreni_radovi' && <p className="text-xs text-slate-500">Vraćaju se izvorni iznosi, status, veza s ponudom i sačuvani prilog rada. Gradilište i ponuda moraju postojati u istoj tvrtki; njihovi podaci i statusi se ne mijenjaju. Nedostali prilog ili novija zamjena blokiraju povrat. Prije povrata provjerite ponovno unesene radove.</p>}
      {table === 'obracun_naloga' && <p className="text-xs text-slate-500">Vraćaju se prethodni sati i troškovi rada/opreme kao jedna transakcija. Kilometarski troškovi po vozilu obračunavaju se zasebno. Povrat se blokira ako je nalog, ekipa, sati ili obračunska stavka naknadno promijenjena.</p>}
      {table === 'kilometarski_obracun' && <p className="text-xs text-slate-500">Vraćaju se svi kilometarski troškovi vozila za taj dan u jednoj transakciji. Povrat se blokira ako se neki od njih naknadno promijeni ili ako se dnevni obračun ponovno pokrene.</p>}
      {module === 'ponude' && <p className="text-xs text-slate-500">Vraćaju se ponuda i njezine obrisane stavke. Gradilište nastalo iz ponude ostaje nepromijenjeno; ranija nezaštićena brisanja nisu obnovljiva.</p>}
      {module === 'troskovi' && <p className="text-xs text-slate-500">Vraćaju se pojedinačno obrisani ručni troškovi bez veze s nalogom ili grupnim računom kooperanta, s izvornim iznosom i oznakom plaćanja. Povezane stavke naloga i računa zahtijevaju zajednički povrat obračuna; njihov samostalni povrat nije podržan. Automatsko čišćenje i brisanje cijelog računa nisu ovaj popis.</p>}
      {module === 'fakture' && <p className="text-xs text-slate-500">Vraća se izvorna faktura s iznosom, rabatom i njegovim smjerom, datumima te statusom naplate. Izvorno gradilište i investitor moraju biti dostupni u istoj tvrtki. Ovo nije storno ni povijest izmjena fakture; ne šalje se novi račun i ne provodi se bankovna naplata. Prije povrata provjerite zamjenske unose.</p>}
      {table === 'radnici_odsustva' && <p className="text-xs text-slate-500">Vraća se izvorna vrsta, razdoblje, djelatnik i napomena odsustva. Naknadni unos, izmjena ili brisanje bilo kojeg odsustva istog djelatnika blokira stari povrat radi zaštite od dvostrukog obračuna. Satnice i prava ne mijenjaju se. Za odsustvo izvan odabranog mjeseca promijenite mjesec obračuna.</p>}
      {module === 'radno_vrijeme' && <p className="text-xs text-slate-500">Vraća se pojedinačno obrisana evidencija sati, uključujući noćne sate. Za sate naloga povrat se odbija ako su nalog, ekipa ili sati naknadno promijenjeni ili ponovno obračunati. Automatsko čišćenje pri obračunu nije zasebno obnovljivo.</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{notice}</p>}
      <button type="button" disabled={loading || restoring} onClick={() => void load()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50">Osvježi</button>
      {loading && <p role="status" className="text-sm text-slate-500">Učitavanje…</p>}
      {!loading && !error && items.length === 0 && <p className="text-sm text-slate-500">Nema zaštićenih brisanja u zadnjih 30 dana.</p>}
      {items.map((item) => <article key={item.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
        <p className="font-semibold text-slate-800">{resourceName(item, workerNames)}</p>
        {table === 'rokovi' && <p className="text-xs text-slate-600">Razdoblje: {deadlinePeriod(item)}</p>}
        <p className="text-xs text-slate-500">{formatHrDateTime(new Date(item.created_at))} · {item.actor_name}</p>
        <ul className="text-xs text-slate-600">{Object.entries(item.affected_rows).map(([table, count]) =>
          <li key={table}>{tableLabels[table] ?? table}: {count}</li>)}</ul>
        {item.reversed_at ? <p className="text-xs text-emerald-700">Vraćeno {formatHrDateTime(new Date(item.reversed_at))}</p> : <>
          <p className="text-xs text-slate-500">Moguće vratiti do {formatHrDateTime(new Date(item.expires_at))}.</p>
          <button type="button" disabled={disabled || !item.can_restore || loading || restoring} onClick={() => void restore(item)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-sky-700 disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" /> {table === 'kooperant_racuni' ? 'Vrati račun, troškove i prilog' : table === 'kilometarski_obracun' ? 'Vrati dnevni kilometarski obračun' : 'Vrati resurs i povezane podatke'}
          </button>
          {!item.can_restore && <p className="text-xs text-amber-800">{table === 'kooperant_racuni' ? 'Nedostaju prava za kooperante/troškove ili izvorna datoteka računa nije dostupna.' : table === 'kilometarski_obracun' ? 'Nedostaju prava za naloge/troškove ili je dnevni kilometarski obračun naknadno promijenjen.' : module === 'troskovi' ? 'Nedostaju potrebna prava ili trošak pripada nalogu/grupnom računu koji još nema zajednički povrat.' : table === 'radnici_odsustva' ? 'Nedostaju potrebna prava ili su odsustva djelatnika naknadno promijenjena.' : module === 'radno_vrijeme' ? 'Nedostaju potrebna prava ili su nalog, ekipa ili sati naloga naknadno promijenjeni.' : 'Nedostaju prava nekog povezanog modula ili administratorska prava.'}</p>}
        </>}
      </article>)}
      {hasMore && <button type="button" disabled={loading || restoring} onClick={() => void load(items[items.length - 1])} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Starija brisanja</button>}
    </HistoryDialog>
  </>;
}

export function ResourceDeletionHistory(props: { module: ResourceDeletionModule; table?: 'gradiliste_zadaci' | 'rokovi' | 'radnici_odsustva' | 'ugovoreni_radovi' | 'kooperant_racuni' | 'obracun_naloga' | 'kilometarski_obracun'; refreshVersion: number; onRestore: () => Promise<void>; disabled?: boolean; onRestoringChange?: (restoring: boolean) => void; workerNames?: Readonly<Record<string, string>>; buttonLabel?: string }) {
  const { canAccess } = useAuth();
  const module = props.table === 'radnici_odsustva' ? 'radnici'
    : props.table === 'kooperant_racuni' ? 'kooperanti'
      : props.table === 'obracun_naloga' || props.table === 'kilometarski_obracun' ? 'radni_nalozi' : props.table ? 'gradilista' : props.module;
  const canEditHistory = canAccess(module, 'edit')
    && (props.table !== 'kilometarski_obracun' || canAccess('troskovi', 'edit'));
  return canEditHistory ? <DeletionHistory key={props.table ?? props.module} {...props} /> : null;
}
