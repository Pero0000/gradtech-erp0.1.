import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  ClipboardList,
  Wallet,
} from 'lucide-react';
import type { Faktura, Gradiliste, RadniNalog, Rok, Trosak } from '@/types';
import {
  fetchFakture,
  fetchFinancijskaRekapitulacija,
  fetchGradilista,
  fetchRadniNalozi,
  fetchRokovi,
  fetchTroskovi,
  iznosFakture,
  type FinancijskaRekapitulacija,
} from '@/lib/api';
import { izracunajFinancijskeRedove, prazniFinancijskiFilteri } from '@/lib/financijskaRekapitulacija';
import { loadObavijesti, relativeLabel, type Obavijest, type ObavijestLevel } from '@/lib/obavijesti';
import { companyStorage } from '@/lib/company';
import { loadPostavke } from '@/lib/postavke';
import { todayISO } from '@/lib/rokovi';
import { Badge } from '@/components/ui/Badge';
import type { View } from '@/components/Sidebar';

interface DashboardProps {
  onNavigate: (view: View) => void;
}

interface DashboardData {
  gradilista: Gradiliste[];
  troskovi: Trosak[];
  nalozi: RadniNalog[];
  fakture: Faktura[];
  rokovi: Rok[];
  obavijesti: Obavijest[];
  financije: FinancijskaRekapitulacija;
}

interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  badge: string;
  days: number;
  level: ObavijestLevel;
  view: View;
}

const CRITICAL_MARGIN_THRESHOLD = -5;
const COST_MISMATCH_PERCENT_THRESHOLD = 1;
const COST_MISMATCH_MIN_EUR = 10_000;
const UNINVOICED_AFTER_COMPLETION_DAYS = 20;
const siteStatusLabels: Record<Gradiliste['status'], string> = {
  ponuda: 'Ponuda',
  planirano: 'Planirano',
  aktivno: 'U tijeku',
  pauzirano: 'Pauzirano',
  neplaceno: 'Neplaćeno',
  zavrseno: 'Gotovo',
};
const siteStatusTones: Record<Gradiliste['status'], string> = {
  ponuda: 'bg-slate-100 text-slate-600',
  planirano: 'bg-sky-50 text-sky-700',
  aktivno: 'bg-emerald-50 text-emerald-700',
  pauzirano: 'bg-amber-50 text-amber-700',
  neplaceno: 'bg-red-50 text-red-700',
  zavrseno: 'bg-slate-100 text-slate-600',
};

const eur = (value: number) => value.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const dateKey = (value: string | null | undefined) => value?.slice(0, 10) ?? '';
const dm = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const parsed = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('hr-HR', { day: '2-digit', month: '2-digit' });
};

const levelBadge: Record<ObavijestLevel, string> = {
  overdue: 'bg-red-600 text-white',
  today: 'bg-red-200 text-red-900',
  soon: 'bg-orange-100 text-orange-800',
  upcoming: 'bg-slate-100 text-slate-600',
};

function Card({ title, icon, action, onAction, children, className = '' }: {
  title: string;
  icon: React.ReactNode;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm ${className}`}>
      <div className="mb-1.5 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">{icon}{title}</h2>
        {action && <button type="button" onClick={onAction} className="text-[11px] font-medium text-sky-700 hover:underline">{action}</button>}
      </div>
      {children}
    </section>
  );
}

function AttentionRow({ item, onClick }: { item: AttentionItem; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full min-w-0 items-center gap-2 py-1.5 text-left hover:bg-slate-50">
        <span title={item.badge} className={`w-[4.5rem] shrink-0 truncate rounded px-1 py-0.5 text-center text-[9px] font-semibold ${levelBadge[item.level]}`}>
          {item.badge}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-slate-800">{item.title}</span>
          <span className="block truncate text-[10px] text-slate-500">{item.detail}</span>
        </span>
      </button>
    </li>
  );
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const danas = todayISO();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchGradilista(),
      fetchTroskovi(),
      fetchRadniNalozi(),
      fetchFakture(),
      fetchRokovi(),
      loadObavijesti(loadPostavke()),
      fetchFinancijskaRekapitulacija(),
    ]).then(([gradilista, troskovi, nalozi, fakture, rokovi, obavijesti, financije]) => {
      if (cancelled) return;
      setData({ gradilista, troskovi, nalozi, fakture, rokovi, obavijesti, financije });
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Greška pri učitavanju nadzorne ploče.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const financijskiRedovi = useMemo(() => {
    if (!data) return [];
    const savedRate = Number(companyStorage.getItem('tm_univerzalna_satnica'));
    const satnica = Number.isFinite(savedRate) && savedRate > 0 ? savedRate : 0;
    const nettoPoRadnicima = companyStorage.getItem('tm_netto_po_radnicima') === '1';
    return izracunajFinancijskeRedove(data.gradilista, data.financije, prazniFinancijskiFilteri, satnica, nettoPoRadnicima);
  }, [data]);

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-slate-400">Učitavanje…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const { gradilista, troskovi, nalozi, fakture, rokovi, obavijesti, financije } = data;
  const aktivna = gradilista.filter((g) => g.status === 'aktivno').length;
  const otvoreni = nalozi.filter((n) => n.status === 'otvoren' || n.status === 'u_tijeku');
  const hitno = obavijesti.filter((o) => o.level === 'overdue' || o.level === 'today');
  const mjesec = danas.slice(0, 7);
  const faktureMjesec = fakture.filter((f) => dateKey(f.datum_izdavanja).startsWith(mjesec));
  const fakturiranoMjesec = faktureMjesec.reduce((sum, f) => sum + iznosFakture(f), 0);
  const naplacenoMjesec = faktureMjesec.filter((f) => f.status === 'placena').reduce((sum, f) => sum + iznosFakture(f), 0);
  const troskoviMjesec = troskovi.filter((t) => dateKey(t.datum).startsWith(mjesec)).reduce((sum, t) => sum + t.iznos, 0)
    + financije.radnoVrijeme.filter((rv) => dateKey(rv.datum).startsWith(mjesec)).reduce((sum, rv) => {
      const savedRate = Number(companyStorage.getItem('tm_univerzalna_satnica'));
      const satnica = Number.isFinite(savedRate) && savedRate > 0 ? savedRate : 0;
      const netto = companyStorage.getItem('tm_netto_po_radnicima') === '1';
      return sum + rv.sati * (netto ? rv.radnici?.cijena_sata ?? satnica : satnica);
    }, 0);
  const dobitMjesec = fakturiranoMjesec - troskoviMjesec;
  const marzaMjesec = fakturiranoMjesec ? dobitMjesec / fakturiranoMjesec * 100 : null;
  const dospjele = fakture.filter((f) => f.status !== 'placena' && f.datum_dospjecja && dateKey(f.datum_dospjecja) < danas);
  const dospjeliIznos = dospjele.reduce((sum, f) => sum + iznosFakture(f), 0);
  const siteFinancialPreview = [...financijskiRedovi]
    .filter((row) => row.brojZapisa > 0)
    .sort((a, b) => Number(b.gradiliste.status === 'aktivno') - Number(a.gradiliste.status === 'aktivno')
      || (b.trosak + b.prihod) - (a.trosak + a.prihod)
      || a.gradiliste.naziv.localeCompare(b.gradiliste.naziv, 'hr'))
    .slice(0, 10);

  const projectAlerts = obavijesti.filter((o) => o.tip === 'projekt_rok');
  const criticalSites: AttentionItem[] = financijskiRedovi.flatMap((row) => {
    const site = row.gradiliste;
    const lateMilestone = rokovi
      .filter((rok) => rok.gradiliste_id === site.id && rok.status !== 'zavrsen'
        && site.status !== 'zavrseno' && site.status !== 'neplaceno' && rok.datum < danas)
      .sort((a, b) => a.datum.localeCompare(b.datum))[0];
    const lateEndDate = site.datum_zavrsetka && site.datum_zavrsetka < danas
      && site.status !== 'zavrseno' && site.status !== 'neplaceno' ? site.datum_zavrsetka : null;
    const daysLate = (date: string) => Math.floor((new Date(`${danas}T00:00:00`).getTime() - new Date(`${date}T00:00:00`).getTime()) / 86400000);
    const contractValue = site.ugovorena_vrijednost ?? 0;
    const overBudgetPercent = contractValue > 0 ? (row.trosak - contractValue) / contractValue * 100 : 0;
    const unpaidDifference = row.trosak - row.prihod;
    const significantMismatch = unpaidDifference >= COST_MISMATCH_MIN_EUR
      && (row.prihod <= 0 || unpaidDifference / row.prihod * 100 >= COST_MISMATCH_PERCENT_THRESHOLD);
    const latestInvoiceDate = fakture
      .filter((invoice) => invoice.gradiliste_id === site.id)
      .reduce((latest, invoice) => dateKey(invoice.datum_izdavanja) > latest ? dateKey(invoice.datum_izdavanja) : latest, '');
    const completed = site.status === 'zavrseno' || site.status === 'neplaceno';
    const daysSinceCompletion = site.datum_zavrsetka ? daysLate(site.datum_zavrsetka) : 0;
    const overdueUninvoiced = completed && Boolean(site.datum_zavrsetka)
      && daysSinceCompletion >= UNINVOICED_AFTER_COMPLETION_DAYS
      && latestInvoiceDate <= dateKey(site.datum_zavrsetka);

    let detail: string | null = null;
    let badge = 'Kritično';
    let days = -1;
    const level: ObavijestLevel = 'overdue';
    if (lateMilestone) {
      days = -daysLate(lateMilestone.datum);
      detail = `${lateMilestone.naziv} kasni ${daysLate(lateMilestone.datum)} dana`;
      badge = 'Rok';
    } else if (lateEndDate) {
      days = -daysLate(lateEndDate);
      detail = `Kasni ${daysLate(lateEndDate)} dana`;
      badge = 'Rok';
    } else if (contractValue > 0 && overBudgetPercent > 0) {
      detail = `Budžet prekoračen ${Math.round(overBudgetPercent)} %`;
      badge = 'Budžet';
    } else if (row.prihod > 0 && row.marza !== null && row.marza <= CRITICAL_MARGIN_THRESHOLD) {
      detail = `Marža ${row.marza.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} %`;
      badge = 'Marža';
    } else if (significantMismatch) {
      detail = `Trošak je ${eur(unpaidDifference)} veći od fakturiranog`;
      badge = 'Nesrazmjer';
    } else if (overdueUninvoiced) {
      detail = `Nije fakturirano ${daysSinceCompletion} dana nakon završetka`;
      badge = 'Fakturiranje';
    }

    return detail ? [{
      id: `site-${site.id}`,
      title: site.naziv,
      detail,
      badge,
      days,
      level,
      view: 'gradilista' as View,
    }] : [];
  });

  const vehicleAlerts = obavijesti.filter((o) => o.grupa === 'Vozila');
  const employeeAlerts = obavijesti.filter((o) => o.grupa === 'Zaposlenici');
  const attentionItems: AttentionItem[] = [
    ...criticalSites,
    ...vehicleAlerts.map((item) => ({
      id: item.id,
      title: item.title,
      detail: item.days === null ? item.detail : `${item.detail} · ${relativeLabel(item.days)}`,
      badge: item.tipLabel,
      days: item.days ?? (item.level === 'overdue' ? -1 : 0),
      level: item.level,
      view: item.view as View,
    })),
    ...employeeAlerts.map((item) => ({
      id: item.id,
      title: item.title,
      detail: `${item.detail} · ${relativeLabel(item.days)}`,
      badge: item.tipLabel,
      days: item.days ?? 0,
      level: item.level,
      view: item.view as View,
    })),
    ...obavijesti.filter((item) => item.tip === 'faktura_naplata').map((item) => ({
      id: item.id,
      title: item.title,
      detail: `${item.detail}${item.days !== null ? ` · ${item.days < 0 ? `kasni ${Math.abs(item.days)} d` : `dospijeće ${relativeLabel(item.days)}`}` : ''}`,
      badge: 'Faktura',
      days: item.days ?? 0,
      level: item.level,
      view: 'fakture' as View,
    })),
  ].sort((a, b) => a.days - b.days).slice(0, 6);
  const deadlineAlerts = projectAlerts.slice(0, 5);
  const openOrders = [...otvoreni].sort((a, b) => dateKey(b.datum_kreiranja).localeCompare(dateKey(a.datum_kreiranja))).slice(0, 5);

  const kpis = [
    { label: 'Aktivna gradilišta', value: String(aktivna), detail: `${gradilista.length} ukupno`, icon: Building2, tone: 'text-sky-700 bg-sky-50', view: 'gradilista' as View },
    { label: 'Otvoreni nalozi', value: String(otvoreni.length), detail: 'za rješavanje', icon: ClipboardList, tone: 'text-slate-700 bg-slate-100', view: 'radni_nalozi' as View },
    { label: 'Hitna upozorenja', value: String(hitno.length), detail: 'kasne ili istječu danas', icon: AlertTriangle, tone: hitno.length ? 'text-red-700 bg-red-50' : 'text-slate-500 bg-slate-100', view: 'obavijesti' as View },
    { label: 'Dospjele fakture', value: String(dospjele.length), detail: eur(dospjeliIznos), icon: Wallet, tone: dospjele.length ? 'text-red-700 bg-red-50' : 'text-slate-500 bg-slate-100', view: 'fakture' as View },
    { label: 'Dobit mjeseca', value: eur(dobitMjesec), detail: `Fakturirano ${eur(fakturiranoMjesec)}`, icon: dobitMjesec < 0 ? ArrowDownRight : ArrowUpRight, tone: dobitMjesec < 0 ? 'text-red-700 bg-red-50' : 'text-emerald-700 bg-emerald-50', view: 'rekapitulacija' as View },
  ];

  return (
    <div className="dashboard-view grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1.15fr)_minmax(0,0.8fr)] gap-2 overflow-hidden">
      <header className="flex min-w-0 items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight text-slate-900">Nadzorna ploča</h1>
          <p className="truncate text-xs text-slate-500">
            {new Date().toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · Stanje koje traži pažnju
          </p>
        </div>
      </header>

      <div className="grid min-w-0 grid-cols-5 gap-2">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <button key={k.label} type="button" onClick={() => onNavigate(k.view)} className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-sky-300">
              <span className="flex min-w-0 items-center gap-2">
                <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${k.tone}`}><Icon className="h-4 w-4" /></span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-medium text-slate-600">{k.label}</span>
                  <span className="block truncate text-base font-bold leading-tight text-slate-900">{k.value}</span>
                  <span className="block truncate text-[10px] text-slate-400">{k.detail}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid min-h-0 min-w-0 grid-cols-2 gap-2">
        <Card title="Zahtijeva pažnju" icon={<AlertTriangle className="h-4 w-4 text-red-600" />} action="Detalji upozorenja" onAction={() => onNavigate('obavijesti')}>
          {attentionItems.length === 0 ? (
            <p className="py-2 text-xs text-slate-400">Nema stavki koje traže pažnju.</p>
          ) : (
            <ul className="min-h-0 divide-y divide-slate-100 overflow-hidden">
              {attentionItems.map((item) => (
                <AttentionRow key={item.id} item={item} onClick={() => onNavigate(item.view)} />
              ))}
            </ul>
          )}
        </Card>

        <Card title="Financijski pregled · ovaj mjesec" icon={<Wallet className="h-4 w-4 text-slate-600" />} action="Financije" onAction={() => onNavigate('rekapitulacija')}>
          <div className="grid shrink-0 grid-cols-5 gap-2">
            {[
              { label: 'Fakturirano', value: eur(fakturiranoMjesec), tone: 'text-slate-900' },
              { label: 'Naplaćeno*', value: eur(naplacenoMjesec), tone: 'text-emerald-700' },
              { label: 'Troškovi', value: eur(troskoviMjesec), tone: 'text-slate-900' },
              { label: 'Dobit', value: eur(dobitMjesec), tone: dobitMjesec < 0 ? 'text-red-700' : 'text-emerald-700' },
              { label: 'Marža', value: marzaMjesec === null ? '—' : `${marzaMjesec.toLocaleString('hr-HR', { maximumFractionDigits: 1 })} %`, tone: marzaMjesec !== null && marzaMjesec < 0 ? 'text-red-700' : 'text-slate-900' },
            ].map((item) => (
              <div key={item.label} className="min-w-0 border-r border-slate-100 px-2 last:border-0">
                <p className="truncate text-[10px] font-medium uppercase text-slate-500">{item.label}</p>
                <p className={`truncate text-base font-bold tabular-nums ${item.tone}`} title={item.value}>{item.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 flex min-h-0 flex-1 flex-col">
            <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Gradilišta · ukupno</h3>
              <span className="text-[10px] text-slate-400">Trošak · prihod · status</span>
            </div>
            {siteFinancialPreview.length === 0 ? (
              <p className="py-2 text-xs text-slate-400">Nema evidentiranih troškova ni faktura za gradilišta.</p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <table className="w-full table-fixed text-[10px]" aria-label="Trošak, prihod i status gradilišta">
                  <thead className="sticky top-0 z-10 bg-white text-slate-500">
                    <tr className="border-b border-slate-100">
                      <th scope="col" className="w-[36%] py-1 text-left font-medium">Gradilište</th>
                      <th scope="col" className="w-[21%] py-1 text-right font-medium">Trošak</th>
                      <th scope="col" className="w-[21%] py-1 text-right font-medium">Prihod</th>
                      <th scope="col" className="w-[22%] py-1 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {siteFinancialPreview.map((row) => (
                      <tr key={row.gradiliste.id}>
                        <th scope="row" title={row.gradiliste.naziv} className="truncate py-1 text-left font-medium text-slate-700">{row.gradiliste.naziv}</th>
                        <td className="truncate whitespace-nowrap py-1 text-right tabular-nums text-slate-600" title={eur(row.trosak)}>{eur(row.trosak)}</td>
                        <td className="truncate whitespace-nowrap py-1 text-right tabular-nums text-slate-600" title={eur(row.prihod)}>{eur(row.prihod)}</td>
                        <td className="py-1 text-right">
                          <span className={`inline-block max-w-full truncate rounded px-1.5 py-0.5 font-medium ${siteStatusTones[row.gradiliste.status]}`}>
                            {siteStatusLabels[row.gradiliste.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="mt-1 shrink-0 text-[9px] text-slate-400">* Plaćene fakture izdane ovaj mjesec; datum uplate se ne vodi.</p>
        </Card>
      </div>

      <div className="grid min-h-0 min-w-0 grid-cols-2 gap-2">
        <Card title="Rokovi gradilišta" icon={<CalendarDays className="h-4 w-4 text-orange-600" />} action="Gradilišta" onAction={() => onNavigate('gradilista')}>
          {deadlineAlerts.length === 0 ? (
            <p className="py-1 text-xs text-slate-400">Nema rokova koji traže pažnju.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {deadlineAlerts.map((o) => (
                <li key={o.id}>
                  <AttentionRow
                    item={{ id: o.id, title: o.title, detail: o.detail, badge: o.days !== null && o.days < 0 ? `Kasni ${Math.abs(o.days)} d` : relativeLabel(o.days), level: o.level, days: o.days ?? 0, view: 'gradilista' }}
                    onClick={() => onNavigate('gradilista')}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Otvoreni nalozi" icon={<ClipboardList className="h-4 w-4 text-slate-600" />} action="Svi nalozi" onAction={() => onNavigate('radni_nalozi')}>
          {openOrders.length === 0 ? (
            <p className="py-1 text-xs text-slate-400">Nema otvorenih naloga.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {openOrders.map((n) => (
                <li key={n.id} className="flex min-w-0 items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-slate-800">{n.broj} · {n.gradilista?.naziv ?? n.naslov}</span>
                    <span className="block truncate text-[10px] text-slate-500">
                      {dateKey(n.datum_kreiranja) === danas ? 'danas' : dm(n.datum_kreiranja)}{n.rok ? ` · rok ${dm(n.rok)}` : ''}
                    </span>
                  </span>
                  <Badge variant={n.status === 'u_tijeku' ? 'blue' : 'gray'}>{n.status === 'u_tijeku' ? 'U tijeku' : 'Otvoren'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
