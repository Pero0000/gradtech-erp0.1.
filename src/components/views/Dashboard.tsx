import { useEffect, useState } from 'react';
import {
  Building2,
  Users,
  Truck,
  CalendarDays,
  TrendingUp,
  Activity,
  Receipt,
  ClipboardList,
} from 'lucide-react';
import type { Gradiliste, Radnik, Vozilo, Raspored, Trosak, RadniNalog } from '@/types';
import {
  fetchGradilista,
  fetchRadnici,
  fetchVozila,
  fetchRasporedi,
  fetchTroskovi,
  fetchRadniNalozi,
} from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import type { View } from '@/components/Sidebar';

interface DashboardProps {
  onNavigate: (view: View) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [radnici, setRadnici] = useState<Radnik[]>([]);
  const [vozila, setVozila] = useState<Vozilo[]>([]);
  const [rasporedi, setRasporedi] = useState<Raspored[]>([]);
  const [troskovi, setTroskovi] = useState<Trosak[]>([]);
  const [nalozi, setNalozi] = useState<RadniNalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [g, r, v, rasp, t, n] = await Promise.all([
          fetchGradilista(),
          fetchRadnici(),
          fetchVozila(),
          fetchRasporedi(),
          fetchTroskovi(),
          fetchRadniNalozi(),
        ]);
        setGradilista(g);
        setRadnici(r);
        setVozila(v);
        setRasporedi(rasp);
        setTroskovi(t);
        setNalozi(n);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Greška pri učitavanju');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  const aktivnaGradilista = gradilista.filter((g) => g.status === 'aktivno' || g.status === 'pauzirano').length;
  const aktivniRadnici = radnici.filter((r) => r.status === 'aktivan').length;
  const slobodnaVozila = vozila.filter((v) => v.status === 'slobodno').length;
  const danas = new Date().toISOString().split('T')[0];
  const danasnjiRasporedi = rasporedi.filter((r) => r.datum === danas);
  const otvoreniNalozi = nalozi.filter((n) => n.status === 'otvoren' || n.status === 'u_tijeku');

  const ukupniProracun = gradilista.reduce((sum, g) => sum + (g.proracun ?? 0), 0);
  const ukupniTroskovi = troskovi.reduce((sum, t) => sum + t.iznos, 0);

  const stats = [
    {
      label: 'Gradilišta',
      value: gradilista.length,
      sub: `${aktivnaGradilista} aktivnih`,
      icon: Building2,
      color: 'sky',
      onClick: () => onNavigate('gradilista'),
    },
    {
      label: 'Radnici',
      value: radnici.length,
      sub: `${aktivniRadnici} aktivnih`,
      icon: Users,
      color: 'emerald',
      onClick: () => onNavigate('radnici'),
    },
    {
      label: 'Vozila',
      value: vozila.length,
      sub: `${slobodnaVozila} slobodnih`,
      icon: Truck,
      color: 'amber',
      onClick: () => onNavigate('vozila'),
    },
    {
      label: 'Današnji raspored',
      value: danasnjiRasporedi.length,
      sub: 'rasporeda danas',
      icon: CalendarDays,
      color: 'violet',
      onClick: () => onNavigate('raspored'),
    },
    {
      label: 'Troškovi',
      value: troskovi.length,
      sub: ukupniTroskovi.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' }),
      icon: Receipt,
      color: 'rose',
      onClick: () => onNavigate('troskovi'),
    },
    {
      label: 'Radni nalozi',
      value: nalozi.length,
      sub: `${otvoreniNalozi.length} otvorenih`,
      icon: ClipboardList,
      color: 'indigo',
      onClick: () => onNavigate('radni_nalozi'),
    },
  ];

  const colorMap: Record<string, { bg: string; text: string }> = {
    sky: { bg: 'bg-sky-50', text: 'text-sky-600' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-600' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-600' },
    rose: { bg: 'bg-rose-50', text: 'text-rose-600' },
    indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600' },
  };

  const statusBadge: Record<string, { variant: 'green' | 'yellow' | 'red' | 'blue' | 'gray'; label: string }> = {
    ponuda: { variant: 'yellow', label: 'Ponuda' },
    planirano: { variant: 'blue', label: 'Planirano' },
    aktivno: { variant: 'green', label: 'Aktivno' },
    pauzirano: { variant: 'yellow', label: 'Pauzirano' },
    zavrseno: { variant: 'gray', label: 'Završeno' },
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Nadzorna ploča</h1>
        <p className="text-sm text-slate-500 mt-1">Pregled svih ključnih informacija firme</p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 mb-8">
        {stats.map((s) => {
          const Icon = s.icon;
          const c = colorMap[s.color];
          return (
            <button
              key={s.label}
              onClick={s.onClick}
              className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${c.bg} ${c.text}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-3xl font-bold text-slate-900">{s.value}</span>
              </div>
              <p className="text-sm font-medium text-slate-700">{s.label}</p>
              <p className="text-xs text-slate-400 mt-0.5">{s.sub}</p>
            </button>
          );
        })}
      </div>

      {/* Financijski banner */}
      {(ukupniProracun > 0 || ukupniTroskovi > 0) && (
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-slate-800 to-slate-900 p-6 text-white">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
              <TrendingUp className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-slate-300">Proračun projekata</p>
              <p className="text-xl font-bold">
                {ukupniProracun.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-700 p-6 text-white">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
              <Receipt className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-rose-200">Ostvareni troškovi</p>
              <p className="text-xl font-bold">
                {ukupniTroskovi.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
              </p>
            </div>
          </div>
          <div
            className={`flex items-center gap-4 rounded-2xl p-6 text-white ${
              ukupniProracun - ukupniTroskovi >= 0
                ? 'bg-gradient-to-r from-emerald-600 to-emerald-700'
                : 'bg-gradient-to-r from-red-600 to-red-700'
            }`}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
              <TrendingUp className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-white/80">Preostali proračun</p>
              <p className="text-xl font-bold">
                {(ukupniProracun - ukupniTroskovi).toLocaleString('hr-HR', {
                  style: 'currency',
                  currency: 'EUR',
                })}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Današnji raspored */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-sky-600" />
              Današnji raspored
            </h2>
            <button
              onClick={() => onNavigate('raspored')}
              className="text-xs text-sky-600 hover:text-sky-700 font-medium"
            >
              Vidi sve →
            </button>
          </div>

          {danasnjiRasporedi.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Nema rasporeda za danas</p>
          ) : (
            <div className="space-y-3">
              {danasnjiRasporedi.map((r) => (
                <div key={r.id} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                    <Activity className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {r.gradilista?.naziv ?? 'Bez gradilišta'}
                    </p>
                    <span className="text-xs text-slate-500">
                      {(r.radnici ?? []).length} radnika · {(r.vozila ?? []).length} vozila
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Otvoreni nalozi */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-sky-600" />
              Otvoreni nalozi
            </h2>
            <button
              onClick={() => onNavigate('radni_nalozi')}
              className="text-xs text-sky-600 hover:text-sky-700 font-medium"
            >
              Vidi sve →
            </button>
          </div>

          {otvoreniNalozi.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Nema otvorenih naloga</p>
          ) : (
            <div className="space-y-3">
              {otvoreniNalozi.slice(0, 5).map((n) => (
                <div key={n.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      <span className="font-mono text-xs text-slate-400 mr-1.5">{n.broj}</span>
                      {n.naslov}
                    </p>
                    {n.gradilista?.naziv && (
                      <p className="text-xs text-slate-400 truncate">{n.gradilista.naziv}</p>
                    )}
                  </div>
                  <Badge variant={n.status === 'u_tijeku' ? 'yellow' : 'blue'}>
                    {n.status === 'u_tijeku' ? 'U tijeku' : 'Otvoren'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Aktivna gradilišta */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-sky-600" />
              Gradilišta
            </h2>
            <button
              onClick={() => onNavigate('gradilista')}
              className="text-xs text-sky-600 hover:text-sky-700 font-medium"
            >
              Vidi sve →
            </button>
          </div>

          {gradilista.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Nema gradilišta</p>
          ) : (
            <div className="space-y-3">
              {gradilista.slice(0, 5).map((g) => {
                const sb = statusBadge[g.status] ?? statusBadge.zavrseno;
                return (
                  <div key={g.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{g.naziv}</p>
                      {g.adresa && <p className="text-xs text-slate-400 truncate">{g.adresa}</p>}
                    </div>
                    <Badge variant={sb.variant}>{sb.label}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Najnoviji troškovi */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Receipt className="h-5 w-5 text-sky-600" />
              Najnoviji troškovi
            </h2>
            <button
              onClick={() => onNavigate('troskovi')}
              className="text-xs text-sky-600 hover:text-sky-700 font-medium"
            >
              Vidi sve →
            </button>
          </div>

          {troskovi.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Nema troškova</p>
          ) : (
            <div className="space-y-3">
              {troskovi.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{t.opis}</p>
                    <span className="text-xs text-slate-400">
                      {t.gradilista?.naziv ?? 'Bez gradilišta'} ·{' '}
                      {new Date(t.datum + 'T00:00:00').toLocaleDateString('hr-HR')}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">
                    {t.iznos.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
