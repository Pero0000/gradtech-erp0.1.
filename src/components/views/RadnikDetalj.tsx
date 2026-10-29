import { useEffect, useMemo, useState } from 'react';
import { Activity, BadgeCheck, FileText, Wallet } from 'lucide-react';
import type { OdsustvoVrsta, Radnik, RadnikDokument, RadnikDokumentVrsta, RadnikOdsustvo, RadniNalog, RadnikPovijest } from '@/types';
import {
  fetchDnevniRaspored,
  fetchGradilista,
  fetchObracunRadnoVrijeme,
  fetchOdsustvaRaspon,
  fetchRadnikDokumenti,
  fetchRadnikPovijest,
  fetchRadniNalozi,
  type ObracunRadnoVrijemeRow,
} from '@/lib/api';
import { computeObracun, hrPraznici, mjesecRaspon, pravaRadnika } from '@/lib/obracunSati';
import { todayISO } from '@/lib/rokovi';
import { Modal } from '@/components/ui/Modal';
import { RadnikDokumenti } from '@/components/views/RadnikDokumenti';
import { Badge } from '@/components/ui/Badge';

type Tab = 'pregled' | 'place' | 'dokumenti' | 'aktivnost';
const tabs: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: 'pregled', label: 'Pregled', icon: BadgeCheck },
  { key: 'place', label: 'Plaće i cijene', icon: Wallet },
  { key: 'dokumenti', label: 'Dokumenti', icon: FileText },
  { key: 'aktivnost', label: 'Aktivnost', icon: Activity },
];
const euro = (value: number) => value.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const dateLabel = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('hr-HR');
const monthRange = (today: string) => mjesecRaspon(today.slice(0, 7));
const mandatoryDocs: { type: RadnikDokumentVrsta; label: string }[] = [
  { type: 'lijecnicki', label: 'Liječnički pregled' },
  { type: 'zastita_na_radu', label: 'Zaštita na radu' },
  { type: 'atest', label: 'Atest' },
];

function daysLeft(datum: string, today: string) {
  return Math.round((new Date(`${datum.slice(0, 10)}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
}

function documentState(document: RadnikDokument | undefined, today: string) {
  if (!document) return { label: 'Nedostaje', tone: 'red' as const };
  if (!document.datum_do) return { label: 'Evidentiran bez isteka', tone: 'green' as const };
  const left = daysLeft(document.datum_do, today);
  if (left < 0) return { label: `Istekao prije ${Math.abs(left)} d`, tone: 'red' as const };
  if (left <= 30) return { label: left === 0 ? 'Istječe danas' : `Istječe za ${left} d`, tone: 'orange' as const };
  return { label: `Vrijedi do ${dateLabel(document.datum_do)}`, tone: 'green' as const };
}

function workDaysUsed(odsustva: RadnikOdsustvo[], year: number) {
  const holidays = hrPraznici(year);
  const used = new Set<string>();
  for (const absence of odsustva.filter((item) => item.vrsta === 'godisnji')) {
    const from = absence.datum_od < `${year}-01-01` ? `${year}-01-01` : absence.datum_od;
    const to = absence.datum_do > `${year}-12-31` ? `${year}-12-31` : absence.datum_do;
    for (let time = new Date(`${from}T00:00:00Z`).getTime(); time <= new Date(`${to}T00:00:00Z`).getTime(); time += 86_400_000) {
      const day = new Date(time);
      const iso = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`;
      if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6 && !holidays.has(iso)) used.add(iso);
    }
  }
  return used.size;
}

function toneClass(tone: 'green' | 'orange' | 'red') {
  return tone === 'green' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'orange' ? 'border-orange-200 bg-orange-50 text-orange-800'
      : 'border-red-200 bg-red-50 text-red-800';
}

function Metric({ label, value, detail, tone = 'slate' }: { label: string; value: string; detail?: string; tone?: 'slate' | 'green' | 'orange' | 'red' }) {
  const text = tone === 'green' ? 'text-emerald-700' : tone === 'orange' ? 'text-orange-700' : tone === 'red' ? 'text-red-700' : 'text-slate-900';
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-medium text-slate-500">{label}</p>
    <p className={`mt-1 truncate text-xl font-bold tabular-nums ${text}`} title={value}>{value}</p>
    {detail && <p className="mt-1 truncate text-xs text-slate-500">{detail}</p>}
  </div>;
}

function ActivityPanel({ radnik, today }: { radnik: Radnik; today: string }) {
  const [hours, setHours] = useState<ObracunRadnoVrijemeRow[]>([]);
  const [absences, setAbsences] = useState<RadnikOdsustvo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const range = monthRange(today);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void Promise.all([
      fetchObracunRadnoVrijeme(range.od, range.do),
      fetchOdsustvaRaspon(`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`),
    ]).then(([entries, leave]) => {
      if (!active) return;
      setHours(entries.filter((entry) => entry.radnik_id === radnik.id));
      setAbsences(leave.filter((entry) => entry.radnik_id === radnik.id));
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Aktivnost radnika nije učitana.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [radnik.id, range.od, range.do, today]);

  const cost = useMemo(() => computeObracun({
    od: range.od,
    do: range.do,
    unosi: hours.map((entry) => ({ datum: entry.datum, sati: entry.sati, nocni_sati: entry.nocni_sati, teren: entry.teren })),
    odsustva: absences,
    prava: pravaRadnika(radnik),
    cijene: radnik,
  }).iznosi.ukupno, [absences, hours, radnik, range.do, range.od]);
  const totalHours = hours.reduce((sum, entry) => sum + entry.sati, 0);

  if (loading) return <p className="py-10 text-center text-sm text-slate-500">Učitavanje aktivnosti…</p>;
  if (error) return <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2">
      <Metric label="Sati ovaj mjesec" value={`${totalHours.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} h`} />
      <Metric label="Trošak radnika ovaj mjesec" value={euro(cost)} />
    </div>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Evidencija radnog vremena · {range.od.slice(0, 7)}</h3>
      {hours.length === 0 ? <p className="p-4 text-sm text-slate-500">Nema evidentiranih sati ovaj mjesec.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              <th className="px-4 py-2 text-left">Datum</th><th className="px-4 py-2 text-left">Gradilište</th><th className="px-4 py-2 text-left">Radni nalog</th><th className="px-4 py-2 text-right">Sati</th><th className="px-4 py-2 text-left">Napomena</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">{hours.map((entry, index) => (
              <tr key={entry.id ?? `${entry.datum}-${index}`}>
                <td className="whitespace-nowrap px-4 py-2">{dateLabel(entry.datum)}</td>
                <td className="px-4 py-2">{entry.gradiliste_naziv ?? '—'}</td>
                <td className="px-4 py-2">{entry.nalog_broj ? `${entry.nalog_broj} · ${entry.nalog_naslov ?? ''}` : '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{entry.sati}</td>
                <td className="px-4 py-2">{entry.napomena ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Odsustva ove godine</h3>
      {absences.length === 0 ? <p className="p-4 text-sm text-slate-500">Nema evidentiranih odsustava.</p> : (
        <ul className="divide-y divide-slate-100">{absences.map((absence) => (
          <li key={absence.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span className="font-medium">{absenceLabel[absence.vrsta]}</span>
            <span className="text-slate-600">{dateLabel(absence.datum_od)} – {dateLabel(absence.datum_do)}</span>
            {absence.napomena && <span className="basis-full text-xs text-slate-500">{absence.napomena}</span>}
          </li>
        ))}</ul>
      )}
    </section>
  </div>;
}

const absenceLabel: Record<OdsustvoVrsta, string> = { godisnji: 'Godišnji odmor', bolovanje: 'Bolovanje', praznik: 'Praznik' };

export function RadnikDetalj({ radnik, open, onClose, onEdit }: {
  radnik: Radnik | null;
  open: boolean;
  onClose: () => void;
  onEdit: (radnik: Radnik) => void;
}) {
  const [tab, setTab] = useState<Tab>('pregled');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [documents, setDocuments] = useState<RadnikDokument[]>([]);
  const [history, setHistory] = useState<RadnikPovijest[]>([]);
  const [absences, setAbsences] = useState<RadnikOdsustvo[]>([]);
  const [monthHours, setMonthHours] = useState<ObracunRadnoVrijemeRow[]>([]);
  const [orders, setOrders] = useState<RadniNalog[]>([]);
  const [currentSite, setCurrentSite] = useState<string | null>(null);
  const [currentOrder, setCurrentOrder] = useState<RadniNalog | null>(null);
  const today = todayISO();
  const month = monthRange(today);

  useEffect(() => {
    if (!open || !radnik) return;
    let active = true;
    setLoading(true);
    setError('');
    void Promise.all([
      fetchRadnikDokumenti(radnik.id),
      fetchRadnikPovijest(radnik.id),
      fetchOdsustvaRaspon(`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`),
      fetchObracunRadnoVrijeme(month.od, month.do),
      fetchDnevniRaspored(today),
      fetchRadniNalozi(),
      fetchGradilista(),
    ]).then(([docs, payHistory, leave, hours, schedule, workOrders, siteRows]) => {
      if (!active) return;
      setDocuments(docs);
      setHistory(payHistory);
      setAbsences(leave.filter((item) => item.radnik_id === radnik.id));
      setMonthHours(hours.filter((item) => item.radnik_id === radnik.id));
      const assignedVehicles = new Set(schedule.radnici.filter((item) => item.radnik_id === radnik.id).map((item) => item.vozilo_id));
      const siteAssignment = schedule.gradilista.find((item) => assignedVehicles.has(item.vozilo_id) && item.gradiliste_id);
      const linkedOrders = workOrders.filter((item) => item.radnici?.some((worker) => worker.id === radnik.id)
        && (item.status === 'otvoren' || item.status === 'u_tijeku'));
      const scheduledOrder = siteAssignment?.nalog_id
        ? workOrders.find((item) => item.id === siteAssignment.nalog_id && (item.status === 'otvoren' || item.status === 'u_tijeku'))
        : undefined;
      setCurrentSite((siteAssignment?.gradiliste_id
        ? siteRows.find((site) => site.id === siteAssignment.gradiliste_id)?.naziv
        : null) ?? linkedOrders[0]?.gradilista?.naziv ?? null);
      setCurrentOrder(scheduledOrder ?? linkedOrders[0] ?? null);
      setOrders(linkedOrders);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Detalji radnika nisu učitani.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, radnik, today, month.do, month.od]);

  const latestDocuments = useMemo(() => {
    if (!radnik) return new Map<RadnikDokumentVrsta, RadnikDokument>();
    const result = new Map<RadnikDokumentVrsta, RadnikDokument>();
    for (const document of documents) {
      if (document.radnik_id !== radnik.id) continue;
      const existing = result.get(document.vrsta);
      if (!existing || (document.datum_do ?? '') > (existing.datum_do ?? '')) result.set(document.vrsta, document);
    }
    return result;
  }, [documents, radnik]);

  if (!radnik) return null;
  const sickLeave = absences.find((absence) => absence.vrsta === 'bolovanje' && absence.datum_od <= today && absence.datum_do >= today);
  const usedVacation = workDaysUsed(absences, Number(today.slice(0, 4)));
  const remainingVacation = Math.max(0, (radnik.godisnji_dani_pravo ?? 20) - usedVacation);
  const monthlyHours = monthHours.reduce((sum, entry) => sum + entry.sati, 0);
  const documentStatuses = mandatoryDocs.map(({ type, label }) => {
    const document = latestDocuments.get(type);
    return {
      typeLabel: label,
      state: documentState(document, today),
      valid: Boolean(document && (!document.datum_do || daysLeft(document.datum_do, today) >= 0)),
    };
  });
  const invalidDocuments = documentStatuses.filter((document) => !document.valid);
  const isReadyForWork = radnik.status === 'aktivan' && invalidDocuments.length === 0;
  const readinessLabel = radnik.status === 'bolovanje'
    ? 'Na bolovanju'
    : radnik.status !== 'aktivan'
      ? 'Neaktivan'
      : isReadyForWork
        ? 'Spreman za rad'
        : 'Nije spreman za rad';
  const readinessTone = isReadyForWork ? 'green' : radnik.status === 'bolovanje' ? 'orange' : 'red';
  const readinessDetail = radnik.status !== 'aktivan'
    ? 'Radnik nije aktivan za rad'
    : invalidDocuments.length > 0
      ? invalidDocuments.map((document) => `${document.typeLabel}: ${document.state.label.toLocaleLowerCase('hr-HR')}`).join(' · ')
      : 'Svi obavezni dokumenti su važeći';
  const monthCost = computeObracun({
    od: month.od,
    do: month.do,
    unosi: monthHours.map((entry) => ({ datum: entry.datum, sati: entry.sati, nocni_sati: entry.nocni_sati, teren: entry.teren })),
    odsustva: absences,
    prava: pravaRadnika(radnik),
    cijene: radnik,
  }).iznosi.ukupno;

  return <Modal
    open={open}
    onClose={onClose}
    title={`${radnik.ime} ${radnik.prezime}`}
    wide="full"
    footer={<div className="flex w-full flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-slate-500">{radnik.uloga}{radnik.telefon ? ` · ${radnik.telefon}` : ''}{radnik.email ? ` · ${radnik.email}` : ''}</span>
      <button type="button" onClick={() => onEdit(radnik)} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">Uredi radnika</button>
    </div>}
  >
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div><p className="text-sm font-semibold text-slate-900">{radnik.ime} {radnik.prezime}</p><p className="text-xs text-slate-500">{radnik.uloga}</p></div>
        <Badge variant={isReadyForWork ? 'green' : radnik.status === 'bolovanje' ? 'orange' : 'red'}>{readinessLabel}</Badge>
      </div>
      <nav className="flex min-w-0 gap-1 overflow-x-auto border-b border-slate-200" aria-label="Kartice radnika">
        {tabs.map(({ key, label, icon: Icon }) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium ${tab === key ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><Icon className="h-4 w-4" />{label}</button>)}
      </nav>
      {loading ? <p className="py-10 text-center text-sm text-slate-500">Učitavanje podataka radnika…</p>
        : error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
          : <>
            {tab === 'pregled' && <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {mandatoryDocs.map(({ type, label }) => {
                  const state = documentState(latestDocuments.get(type), today);
                  return <div key={type} className={`rounded-xl border p-4 ${toneClass(state.tone)}`}><p className="text-xs font-medium">{label}</p><p className="mt-1 text-sm font-bold">{state.label}</p></div>;
                })}
                <div className={`rounded-xl border p-4 ${toneClass(readinessTone)}`}>
                  <p className="text-xs font-medium">Spremnost za rad</p><p className="mt-1 text-sm font-bold">{readinessLabel}</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Trenutno gradilište" value={currentSite ?? 'Nije raspoređen danas'} />
                <Metric label="Aktivni radni nalog" value={currentOrder ? `${currentOrder.broj} · ${currentOrder.naslov}` : 'Nema aktivnog naloga'} />
                <Metric label="Sati ovaj mjesec" value={`${monthlyHours.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} h`} />
                <Metric label="Trošak radnika ovaj mjesec" value={euro(monthCost)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Metric label="Preostali godišnji odmor" value={`${remainingVacation} dana`} detail={`${usedVacation} iskorišteno od ${radnik.godisnji_dani_pravo ?? 20} dana · pravo se uređuje u profilu`} tone={remainingVacation === 0 ? 'orange' : 'green'} />
                <Metric label="Status bolovanja" value={sickLeave ? `Aktivno do ${dateLabel(sickLeave.datum_do)}` : radnik.status === 'bolovanje' ? 'Bolovanje (bez evidentiranog razdoblja)' : 'Nije na bolovanju'} tone={sickLeave || radnik.status === 'bolovanje' ? 'orange' : 'green'} />
                <Metric label="Spremnost za rad" value={readinessLabel} detail={readinessDetail} tone={readinessTone} />
              </div>
              {currentOrder && <p className="text-xs text-slate-500">Aktivni nalozi: {orders.map((order) => `${order.broj} · ${order.gradilista?.naziv ?? order.naslov}`).join(' · ')}</p>}
            </div>}
            {tab === 'place' && <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Osnovna satnica" value={euro(radnik.cijena_sata)} detail="po satu" />
                <Metric label="Noćni dodatak" value={`${radnik.nocni_dodatak ?? 0} %`} />
                <Metric label="Teren dnevnica" value={euro(radnik.teren_dnevnica ?? 0)} />
                <Metric label="Plaćeni put" value={`${euro(radnik.cijena_put_sat ?? 0)}/h`} />
                <Metric label="Praznik" value={`${euro(radnik.cijena_praznik ?? 0)}/dan`} />
                <Metric label="Godišnji" value={`${euro(radnik.cijena_godisnji ?? 0)}/dan`} />
                <Metric label="Bolovanje" value={`${euro(radnik.cijena_bolovanje ?? 0)}/dan`} />
                <Metric label="Trošak ovaj mjesec" value={euro(monthCost)} />
              </div>
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold">Bonusi i dodaci</h3>
                {(radnik.bonusi ?? []).filter((bonus) => bonus.naziv || bonus.iznos).length === 0
                  ? <p className="text-sm text-slate-500">Nema upisanih bonusa.</p>
                  : <ul className="divide-y divide-slate-100">{(radnik.bonusi ?? []).filter((bonus) => bonus.naziv || bonus.iznos).map((bonus, index) => <li key={`${bonus.naziv}-${index}`} className="flex justify-between gap-3 py-2 text-sm"><span>{bonus.naziv} · {bonusTipLabel[bonus.tip]}</span><strong>{euro(bonus.iznos)}</strong></li>)}</ul>}
              </section>
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold">Povijest promjena cijena</h3>
                {history.length === 0 ? <p className="text-sm text-slate-500">Nema spremljenih promjena cijena.</p> : <ul className="divide-y divide-slate-100">{history.map((item) => <li key={item.id} className="flex flex-wrap gap-x-3 py-2 text-sm"><span className="text-slate-500">{dateLabel(item.created_at)}</span><strong>{item.polje}</strong><span>{item.stara_vrijednost ?? '—'} → {item.nova_vrijednost ?? '—'}</span></li>)}</ul>}
              </section>
            </div>}
            {tab === 'dokumenti' && <RadnikDokumenti radnikId={radnik.id} />}
            {tab === 'aktivnost' && <ActivityPanel radnik={radnik} today={today} />}
          </>}
    </div>
  </Modal>;
}

const bonusTipLabel = { pausalno: 'paušalno', komad: 'po komadu', dan: 'po danu', sat: 'po satu' };
