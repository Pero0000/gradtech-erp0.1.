import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, Building2, CalendarDays, ClipboardList, Receipt, Truck, Wallet } from 'lucide-react';
import type { Faktura, Gradiliste, Radnik, RadniNalog, Trosak, Vozilo } from '@/types';
import {
  fetchDnevniRaspored,
  fetchFakture,
  fetchGradilista,
  fetchRadnici,
  fetchRadniNalozi,
  fetchTroskovi,
  fetchVozila,
  iznosFakture,
} from '@/lib/api';
import { loadObavijesti, relativeLabel, type Obavijest, type ObavijestLevel } from '@/lib/obavijesti';
import { loadPostavke } from '@/lib/postavke';
import { todayISO } from '@/lib/rokovi';
import { Badge } from '@/components/ui/Badge';
import type { View } from '@/components/Sidebar';

interface DashboardProps {
  onNavigate: (view: View) => void;
}

type Raspored = Awaited<ReturnType<typeof fetchDnevniRaspored>>;

const eur = (value: number) => value.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const dm = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('hr-HR', { day: '2-digit', month: '2-digit' });

const levelBadge: Record<ObavijestLevel, string> = {
  overdue: 'bg-red-600 text-white',
  today: 'bg-red-200 text-red-900',
  soon: 'bg-red-50 text-red-700',
  upcoming: 'bg-slate-100 text-slate-600',
};

function Card({ title, icon, action, onAction, children }: { title: string; icon: React.ReactNode; action?: string; onAction?: () => void; children: React.ReactNode }) {
  return (
    <section className="min-w-0 break-words rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-col items-start justify-between gap-2 xl:flex-row xl:items-center">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">{icon}{title}</h2>
        {action && <button type="button" onClick={onAction} className="text-xs font-medium text-sky-700 hover:underline">{action}</button>}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="py-4 text-center text-xs text-slate-400">{text}</p>;

function ObavijestRow({ o, onClick }: { o: Obavijest; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50">
      <span className={`w-20 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${levelBadge[o.level]}`}>
        {o.days === null ? 'Pozor' : relativeLabel(o.days)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-800">{o.title}</span>
        <span className="block truncate text-xs text-slate-500">{o.detail}</span>
      </span>
      {o.datum && <span className="text-xs text-slate-400">{dm(o.datum)}</span>}
    </button>
  );
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [radnici, setRadnici] = useState<Radnik[]>([]);
  const [vozila, setVozila] = useState<Vozilo[]>([]);
  const [troskovi, setTroskovi] = useState<Trosak[]>([]);
  const [nalozi, setNalozi] = useState<RadniNalog[]>([]);
  const [fakture, setFakture] = useState<Faktura[]>([]);
  const [obavijesti, setObavijesti] = useState<Obavijest[]>([]);
  const [raspored, setRaspored] = useState<Raspored>({ gradilista: [], radnici: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const danas = todayISO();

  useEffect(() => {
    (async () => {
      try {
        const [g, r, v, t, n, f, o, rasp] = await Promise.all([
          fetchGradilista(),
          fetchRadnici(),
          fetchVozila(),
          fetchTroskovi(),
          fetchRadniNalozi(),
          fetchFakture(),
          loadObavijesti(loadPostavke()).catch(() => [] as Obavijest[]),
          fetchDnevniRaspored(danas).catch(() => ({ gradilista: [], radnici: [] }) as Raspored),
        ]);
        setGradilista(g);
        setRadnici(r);
        setVozila(v);
        setTroskovi(t);
        setNalozi(n);
        setFakture(f);
        setObavijesti(o);
        setRaspored(rasp);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Greška pri učitavanju');
      } finally {
        setLoading(false);
      }
    })();
  }, [danas]);

  if (loading) return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;

  const gradById = new Map(gradilista.map((g) => [g.id, g]));
  const radnikById = new Map(radnici.map((r) => [r.id, r]));
  const aktivna = gradilista.filter((g) => g.status === 'aktivno').length;
  const otvoreni = nalozi.filter((n) => n.status === 'otvoren' || n.status === 'u_tijeku');
  const otvoreniSorted = [...otvoreni].sort((a, b) => Number(b.datum_kreiranja === danas) - Number(a.datum_kreiranja === danas) || b.datum_kreiranja.localeCompare(a.datum_kreiranja));
  const hitno = obavijesti.filter((o) => o.level === 'overdue' || o.level === 'today');

  const mjesec = danas.slice(0, 7);
  const troskoviMjesec = troskovi.filter((t) => t.datum.startsWith(mjesec)).reduce((s, t) => s + t.iznos, 0);
  const noviTroskovi = [...troskovi].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')).slice(0, 6);

  const neplacene = fakture.filter((f) => f.status !== 'placena');
  const dospjele = neplacene.filter((f) => f.datum_dospjecja && f.datum_dospjecja < danas);
  const dospjeloIznos = dospjele.reduce((s, f) => s + iznosFakture(f), 0);
  const neplacenoIznos = neplacene.reduce((s, f) => s + iznosFakture(f), 0);

  const rokGradilista = obavijesti.filter((o) => o.tip === 'projekt_rok').slice(0, 7);
  const ostaliRokovi = obavijesti.filter((o) => o.tip !== 'projekt_rok' && o.tip !== 'faktura_naplata').slice(0, 7);

  const rasporedPoVozilu = vozila
    .filter((v) => v.u_rasporedu !== false)
    .map((v) => ({
      vozilo: v,
      stavke: raspored.gradilista.filter((s) => s.vozilo_id === v.id),
      ljudi: raspored.radnici.filter((s) => s.vozilo_id === v.id),
    }))
    .filter((x) => x.stavke.length > 0 || x.ljudi.length > 0);

  const kpis = [
    { label: 'Aktivna gradilišta', value: aktivna, sub: `${gradilista.length} ukupno`, icon: Building2, tone: 'text-sky-600 bg-sky-50', view: 'gradilista' as View },
    { label: 'Otvoreni nalozi', value: otvoreni.length, sub: `${otvoreni.filter((n) => n.datum_kreiranja === danas).length} kreirano danas`, icon: ClipboardList, tone: 'text-emerald-600 bg-emerald-50', view: 'radni_nalozi' as View },
    { label: 'Hitne obavijesti', value: hitno.length, sub: 'kasne ili ističu danas', icon: AlertTriangle, tone: hitno.length ? 'text-red-600 bg-red-50' : 'text-slate-500 bg-slate-100', view: 'obavijesti' as View },
    { label: 'Troškovi ovaj mjesec', value: eur(troskoviMjesec), sub: `${troskovi.filter((t) => t.datum.startsWith(mjesec)).length} stavki`, icon: Receipt, tone: 'text-rose-600 bg-rose-50', view: 'troskovi' as View },
    { label: 'Neplaćene fakture', value: eur(neplacenoIznos), sub: dospjele.length ? `${dospjele.length} dospjelih · ${eur(dospjeloIznos)}` : 'nema dospjelih', icon: Wallet, tone: dospjele.length ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-100', view: 'fakture' as View },
  ];

  return (
    <div className="min-w-0 max-w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Nadzorna ploča</h1>
        <p className="mt-1 text-sm text-slate-500">
          {new Date().toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      <div className="mb-5 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-5">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <button key={k.label} type="button" onClick={() => onNavigate(k.view)} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-sky-300">
              <span className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg ${k.tone}`}><Icon className="h-5 w-5" /></span>
              <p className="text-xl font-bold text-slate-900">{k.value}</p>
              <p className="text-xs font-medium text-slate-600">{k.label}</p>
              <p className="truncate text-[11px] text-slate-400">{k.sub}</p>
            </button>
          );
        })}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        <Card title="Rokovi gradilišta" icon={<Building2 className="h-4 w-4 text-sky-600" />} action="Sve obavijesti" onAction={() => onNavigate('obavijesti')}>
          {rokGradilista.length === 0 ? <Empty text="Nema nadolazećih rokova ✅" /> : rokGradilista.map((o) => <ObavijestRow key={o.id} o={o} onClick={() => onNavigate('gradilista')} />)}
        </Card>

        <Card title="Ostali rokovi" icon={<Bell className="h-4 w-4 text-amber-600" />} action="Sve obavijesti" onAction={() => onNavigate('obavijesti')}>
          {ostaliRokovi.length === 0 ? <Empty text="Nema rokova za radnike i vozila ✅" /> : ostaliRokovi.map((o) => <ObavijestRow key={o.id} o={o} onClick={() => onNavigate(o.view)} />)}
        </Card>

        <Card title="Današnji raspored" icon={<CalendarDays className="h-4 w-4 text-violet-600" />} action="Otvori" onAction={() => onNavigate('raspored')}>
          {rasporedPoVozilu.length === 0 ? <Empty text="Danas nema rasporeda" /> : (
            <div className="space-y-2">
              {rasporedPoVozilu.map(({ vozilo, stavke, ljudi }) => (
                <div key={vozilo.id} className="rounded-lg bg-slate-50 p-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800"><Truck className="h-3.5 w-3.5 text-slate-400" />{[vozilo.marka, vozilo.model].filter(Boolean).join(' ')}</p>
                  <p className="mt-0.5 text-xs text-slate-600">🏗️ {stavke.map((s) => (s.gradiliste_id ? gradById.get(s.gradiliste_id)?.naziv : s.tekst) ?? '—').join(', ') || '—'}</p>
                  <p className="text-xs text-slate-500">👷 {ljudi.map((l) => { const r = radnikById.get(l.radnik_id); return r ? `${r.ime} ${r.prezime[0]}.` : '?'; }).join(', ') || 'bez radnika'}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Otvoreni radni nalozi" icon={<ClipboardList className="h-4 w-4 text-emerald-600" />} action="Svi nalozi" onAction={() => onNavigate('radni_nalozi')}>
          {otvoreniSorted.length === 0 ? <Empty text="Nema otvorenih naloga ✅" /> : (
            <ul className="space-y-1">
              {otvoreniSorted.slice(0, 7).map((n) => (
                <li key={n.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{n.broj} · {n.gradilista?.naziv ?? n.naslov}</span>
                    <span className="block text-xs text-slate-500">{n.datum_kreiranja === danas ? 'danas' : dm(n.datum_kreiranja)}{n.rok ? ` · rok ${dm(n.rok)}` : ''}</span>
                  </span>
                  <Badge variant={n.status === 'u_tijeku' ? 'blue' : 'gray'}>{n.status === 'u_tijeku' ? 'U tijeku' : 'Otvoren'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Novi troškovi" icon={<Receipt className="h-4 w-4 text-rose-600" />} action="Svi troškovi" onAction={() => onNavigate('troskovi')}>
          {noviTroskovi.length === 0 ? <Empty text="Još nema troškova" /> : (
            <ul className="space-y-1">
              {noviTroskovi.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-800">{t.opis}</span>
                    <span className="block truncate text-xs text-slate-500">{t.gradilista?.naziv ?? '—'} · {dm(t.datum)}</span>
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{eur(t.iznos)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Dospjele fakture" icon={<Wallet className="h-4 w-4 text-amber-600" />} action="Fakture" onAction={() => onNavigate('fakture')}>
          {dospjele.length === 0 ? <Empty text="Nema dospjelih neplaćenih faktura ✅" /> : (
            <ul className="space-y-1">
              {dospjele.sort((a, b) => (a.datum_dospjecja ?? '').localeCompare(b.datum_dospjecja ?? '')).slice(0, 6).map((f) => (
                <li key={f.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-800">{f.broj} · {f.kupac ?? f.gradilista?.naziv ?? '—'}</span>
                    <span className="block text-xs text-red-600">dospjelo {f.datum_dospjecja ? dm(f.datum_dospjecja) : ''}</span>
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{eur(iznosFakture(f))}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
