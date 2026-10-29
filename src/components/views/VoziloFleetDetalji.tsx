import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  Gauge,
  History,
  Pencil,
  Truck,
  Wrench,
} from 'lucide-react';
import type { Vozilo, VoziloDokument } from '@/types';
import {
  fetchVoziloDokumenti,
  fetchVoziloKoristenje,
  fetchVoziloMjesecniObracun,
  type VoziloKoristenje,
  type VoziloMjesecniObracun,
} from '@/lib/api';
import { nextServis, servisAlert } from '@/lib/servis';
import { todayISO } from '@/lib/rokovi';
import { Modal } from '@/components/ui/Modal';
import { VoziloDokumenti } from '@/components/views/VoziloDokumenti';

type Tab = 'pregled' | 'servisi' | 'koristenje';
type RokVrsta = 'registracija' | 'tehnicki' | 'kasko' | 'osiguranje';

const rokLabels: Record<RokVrsta, string> = {
  registracija: 'Registracija',
  tehnicki: 'Tehnički pregled',
  kasko: 'Kasko osiguranje',
  osiguranje: 'Obavezno osiguranje',
};

const statusLabels = {
  slobodno: 'Slobodno',
  zauzeto: 'Na gradilištu',
  servis: 'Servis',
  neispravno: 'Neispravno',
} as const;

const eur = (amount: number) => `${amount.toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dateLabel = (value: string | null | undefined) => value
  ? new Date(`${value}T00:00:00`).toLocaleDateString('hr-HR')
  : 'Nije evidentirano';
const daysUntil = (value: string) => Math.ceil(
  (new Date(`${value}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime()) / 86400000,
);

function documentFor(dokumenti: VoziloDokument[], vrsta: RokVrsta) {
  return dokumenti
    .filter((document) => document.vrsta === vrsta && document.datum_do)
    .sort((a, b) => (b.datum_do ?? '').localeCompare(a.datum_do ?? ''))[0] ?? null;
}

function StatCard({ title, value, detail, tone = 'normal', icon }: {
  title: string;
  value: string;
  detail?: string;
  tone?: 'normal' | 'soon' | 'expired';
  icon: ReactNode;
}) {
  const toneClass = tone === 'expired'
    ? 'border-red-200 text-red-700'
    : tone === 'soon'
      ? 'border-amber-200 text-amber-700'
      : 'border-slate-200 text-slate-900';
  return (
    <div className={`min-w-0 rounded-xl border bg-white p-4 shadow-sm ${toneClass}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        <span className="text-slate-400">{icon}</span>
      </div>
      <p className="mt-3 break-words text-lg font-bold">{value}</p>
      {detail && <p className="mt-1 break-words text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

export function VoziloFleetDetalji({
  vozilo,
  onClose,
  onEdit,
  onDataChange,
}: {
  vozilo: Vozilo;
  onClose: () => void;
  onEdit: () => void;
  onDataChange?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('pregled');
  const [dokumenti, setDokumenti] = useState<VoziloDokument[]>([]);
  const [koristenje, setKoristenje] = useState<VoziloKoristenje[]>([]);
  const [mjesecniObracun, setMjesecniObracun] = useState<VoziloMjesecniObracun>({ kilometri: 0, trosak: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [vehicleDocs, vehicleHistory, monthlySummary] = await Promise.all([
        fetchVoziloDokumenti(vozilo.id),
        fetchVoziloKoristenje(vozilo.id),
        fetchVoziloMjesecniObracun(vozilo),
      ]);
      setDokumenti(vehicleDocs);
      setKoristenje(vehicleHistory);
      setMjesecniObracun(monthlySummary);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Greška pri učitavanju podataka vozila.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Load once per selected vehicle; changes are refreshed through the explicit callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vozilo.id]);

  const servisi = useMemo(
    () => dokumenti.filter((document) => document.vrsta === 'servis'),
    [dokumenti],
  );
  const servisniAlert = servisAlert(vozilo, servisi);
  const next = nextServis(vozilo, servisi);
  const maintenanceThisYear = servisi
    .filter((service) => service.datum_od?.startsWith(String(new Date().getFullYear())))
    .reduce((sum, service) => sum + Number(service.iznos ?? 0), 0);
  const totalServiceCost = servisi.reduce((sum, service) => sum + Number(service.iznos ?? 0), 0);
  const warnings = (Object.keys(rokLabels) as RokVrsta[]).flatMap((vrsta) => {
    const document = documentFor(dokumenti, vrsta);
    if (!document?.datum_do) return [];
    const remaining = daysUntil(document.datum_do);
    if (remaining > 30) return [];
    return [{
      label: remaining < 0
        ? `${rokLabels[vrsta]} je istekla prije ${Math.abs(remaining)} dana`
        : `${rokLabels[vrsta]} ističe za ${remaining} dana`,
      expired: remaining < 0,
    }];
  });
  if (servisniAlert) {
    warnings.push({ label: servisniAlert.text, expired: servisniAlert.level === 'overdue' });
  }
  const kmToNextService = next.km === null ? null : next.km - vozilo.kilometraza;
  const daysToNextService = next.datum ? daysUntil(next.datum) : null;

  const tabs: Array<{ id: Tab; label: string; icon: ReactNode }> = [
    { id: 'pregled', label: 'Pregled', icon: <Truck className="h-4 w-4" /> },
    { id: 'servisi', label: 'Servisi i održavanje', icon: <Wrench className="h-4 w-4" /> },
    { id: 'koristenje', label: 'Povijest korištenja', icon: <History className="h-4 w-4" /> },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={`${vozilo.marka} ${vozilo.model ?? ''}`.trim()}
      wide="screen"
      footer={(
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" /> Uredi vozilo
        </button>
      )}
    >
      <div className="min-w-0 space-y-5">
        <header className="grid min-w-0 grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.5fr)] xl:items-center">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Truck className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h3 className="break-words text-xl font-bold text-slate-900">{vozilo.marka} {vozilo.model}</h3>
              <p className="mt-0.5 font-semibold tracking-wider text-slate-600">{vozilo.registracija}</p>
            </div>
          </div>
          <span className={`w-fit rounded-full border px-3 py-1 text-sm font-semibold ${
            vozilo.status === 'neispravno' ? 'border-red-200 bg-red-50 text-red-700'
              : vozilo.status === 'servis' ? 'border-amber-200 bg-amber-50 text-amber-700'
                : vozilo.status === 'zauzeto' ? 'border-sky-200 bg-sky-50 text-sky-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}>{statusLabels[vozilo.status]}</span>
          <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-sm text-slate-600 sm:grid-cols-3 xl:grid-cols-5">
            <span>Godina <strong className="text-slate-900">{vozilo.godina_proizvodnje ?? '—'}</strong></span>
            <span>Kilometraža <strong className="text-slate-900">{vozilo.kilometraza.toLocaleString('hr-HR')} km</strong></span>
            <span>Broj mjesta <strong className="text-slate-900">{vozilo.broj_mjesta}</strong></span>
            <span>Nosivost <strong className="text-slate-900">{vozilo.nosivost_kg ? `${vozilo.nosivost_kg.toLocaleString('hr-HR')} kg` : '—'}</strong></span>
            <span>Cijena po km <strong className="text-slate-900">{eur(vozilo.cijena_km ?? 0)}</strong></span>
          </div>
        </header>

        <nav className="flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="Sekcije vozila">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                tab === item.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
              }`}
            >
              {item.icon}{item.label}
            </button>
          ))}
        </nav>

        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {loading && <p className="py-12 text-center text-sm text-slate-500">Učitavanje podataka vozila…</p>}

        {!loading && tab === 'pregled' && (
          <div className="space-y-5">
            <section className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 shadow-sm sm:p-5">
              <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-900">
                <Gauge className="h-4 w-4 text-sky-700" /> TROŠAK VOZILA
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-medium text-slate-500">Cijena po km</p>
                  <p className="mt-1 text-lg font-bold text-slate-900">{eur(vozilo.cijena_km ?? 0)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Kilometri ovaj mjesec</p>
                  <p className="mt-1 text-lg font-bold text-slate-900">{mjesecniObracun.kilometri.toLocaleString('hr-HR')} km</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Trošak obračunat ovaj mjesec</p>
                  <p className="mt-1 text-lg font-bold text-slate-900">{eur(mjesecniObracun.trosak)}</p>
                </div>
              </div>
            </section>
            <section className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(Object.keys(rokLabels) as RokVrsta[]).map((vrsta) => {
                const doc = documentFor(dokumenti, vrsta);
                const days = doc?.datum_do ? daysUntil(doc.datum_do) : null;
                const tone = days === null ? 'normal' : days < 0 ? 'expired' : days <= 30 ? 'soon' : 'normal';
                return (
                  <StatCard
                    key={vrsta}
                    title={rokLabels[vrsta]}
                    value={dateLabel(doc?.datum_do)}
                    detail={days === null ? 'Rok nije upisan' : days < 0 ? `Isteklo prije ${Math.abs(days)} dana` : `Još ${days} dana`}
                    tone={tone}
                    icon={<CalendarDays className="h-4 w-4" />}
                  />
                );
              })}
              <StatCard
                title="Sljedeći servis"
                value={kmToNextService !== null
                  ? kmToNextService < 0 ? `Kasni ${Math.abs(kmToNextService).toLocaleString('hr-HR')} km` : `Za ${kmToNextService.toLocaleString('hr-HR')} km`
                  : daysToNextService !== null ? daysToNextService < 0 ? `Kasni ${Math.abs(daysToNextService)} dana` : `Za ${daysToNextService} dana`
                    : 'Nije određen'}
                detail={next.datum && kmToNextService !== null
                  ? `Rok: ${daysToNextService} dana · ${dateLabel(next.datum)}`
                  : next.km ? `Na ${next.km.toLocaleString('hr-HR')} km` : vozilo.sljedeci_servis_napomena ?? 'Nije zabilježen servisni interval'}
                tone={servisniAlert?.level === 'overdue' ? 'expired' : servisniAlert ? 'soon' : 'normal'}
                icon={<Wrench className="h-4 w-4" />}
              />
              <StatCard title="Održavanje ove godine" value={eur(maintenanceThisYear)} detail="Zbroj evidentiranih servisa" icon={<Gauge className="h-4 w-4" />} />
              <StatCard title="Trošak servisa ukupno" value={eur(totalServiceCost)} detail="Samo servisni unosi evidentirani u sustavu" icon={<FileText className="h-4 w-4" />} />
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                {warnings.length ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                <h3 className="font-semibold text-slate-900">Aktivna upozorenja</h3>
              </div>
              {warnings.length ? (
                <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {warnings.map((warning, index) => (
                    <li key={`${warning.label}-${index}`} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                      warning.expired ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}>
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{warning.label}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-slate-600">Nema aktivnih upozorenja.</p>}
            </section>

            {vozilo.sljedeci_servis_napomena && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="mb-2 flex items-center gap-2 font-semibold text-slate-900"><ClipboardList className="h-4 w-4 text-slate-500" />Za sljedeći servis</h3>
                <p className="whitespace-pre-wrap text-sm text-slate-600">{vozilo.sljedeci_servis_napomena}</p>
              </section>
            )}
          </div>
        )}

        {!loading && tab === 'servisi' && (
          <VoziloDokumenti
            voziloId={vozilo.id}
            onChange={() => {
              void load();
              onDataChange?.();
            }}
          />
        )}

        {!loading && tab === 'koristenje' && (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-900"><History className="h-4 w-4 text-slate-500" />Povijest korištenja <span className="text-xs font-normal text-slate-400">(zadnjih 100 rasporeda)</span></h3>
            {koristenje.length ? (
              <ol className="relative space-y-0 border-l border-slate-200 pl-5">
                {koristenje.map((entry) => (
                  <li key={entry.id} className="relative border-b border-slate-100 py-3 last:border-0">
                    <span className="absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full border-2 border-white bg-sky-600 ring-1 ring-sky-200" />
                    <div className="flex min-w-0 flex-col justify-between gap-1 sm:flex-row sm:items-start">
                      <div className="min-w-0">
                        <p className="break-words font-medium text-slate-900">{entry.gradiliste ?? 'Bez gradilišta'}</p>
                        <p className="mt-0.5 text-sm text-slate-500">
                          {entry.brojNaloga ? `Nalog ${entry.brojNaloga}` : 'Bez povezanog radnog naloga'}
                          {entry.naslovNaloga ? ` · ${entry.naslovNaloga}` : ''}
                        </p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 text-sm text-slate-500"><Clock3 className="h-3.5 w-3.5" />{dateLabel(entry.datum)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="py-8 text-center text-sm text-slate-500">Nema zabilježenih rasporeda za ovo vozilo.</p>}
          </section>
        )}
      </div>
    </Modal>
  );
}
