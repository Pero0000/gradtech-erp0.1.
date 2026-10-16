import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Sidebar, type View } from '@/components/Sidebar';
import { Dashboard } from '@/components/views/Dashboard';
import { GradilistaView } from '@/components/views/GradilistaView';
import { InvestitoriView, ObjektiView } from '@/components/views/RegistryViews';
import { KooperantiView } from '@/components/views/KooperantiView';
import { StavkeView } from '@/components/views/StavkeView';
import { PonudeView } from '@/components/views/PonudeView';
import { RadniciView } from '@/components/views/RadniciView';
import { VozilaView } from '@/components/views/VozilaView';
import { OpremaView } from '@/components/views/OpremaView';
import { RasporedView } from '@/components/views/RasporedView';
import { TroskoviView } from '@/components/views/TroskoviView';
import { FaktureView } from '@/components/views/FaktureView';
import { RadnoVrijemeView } from '@/components/views/RadnoVrijemeView';
import { RadniNaloziView } from '@/components/views/RadniNaloziView';
import { RekapitulacijaView } from '@/components/views/RekapitulacijaView';
import { ObavijestiView } from '@/components/views/ObavijestiView';
import { PostavkeView } from '@/components/views/PostavkeView';
import { AsistentView } from '@/components/views/AsistentView';
import { KorisniciView } from '@/components/views/KorisniciView';
import { loadObavijesti, sendPushNotifications } from '@/lib/obavijesti';
import { loadPostavke } from '@/lib/postavke';
import {
  fetchGradilista,
  fetchRadnici,
  fetchVozila,
  fetchRasporedi,
  fetchTroskovi,
  fetchRadniNalozi,
} from '@/lib/api';
import { useAuth } from '@/auth/useAuth';
import { MODULES, moduleForView } from '@/auth/permissions';
import { MobileWorkOrdersView } from '@/components/mobile/MobileWorkOrdersView';

function App() {
  const { canAccess, isAdmin, profile, signOut } = useAuth();
  const [view, setView] = useState<View>('dashboard');
  const [focusNalogId, setFocusNalogId] = useState<string | null>(null);
  const [counts, setCounts] = useState({
    gradilista: 0,
    radnici: 0,
    vozila: 0,
    raspored: 0,
    troskovi: 0,
    radni_nalozi: 0,
    obavijesti: 0,
  });

  useEffect(() => {
    if (!profile?.approved || !canAccess('obavijesti')) return;
    const refresh = async () => {
      try {
        const postavke = loadPostavke();
        const list = await loadObavijesti(postavke);
        setCounts((previous) => ({ ...previous, obavijesti: list.filter((o) => o.level !== 'upcoming').length }));
        if (postavke.push) sendPushNotifications(list);
      } catch {
        // obavijesti view shows its own errors
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [view, profile?.approved, canAccess]);

  useEffect(() => {
    if (!profile?.approved) return;
    (async () => {
      const requests: Promise<void>[] = [];
      if (canAccess('gradilista')) requests.push(fetchGradilista().then((items) => setCounts((previous) => ({ ...previous, gradilista: items.length }))));
      if (canAccess('radnici')) requests.push(fetchRadnici().then((items) => setCounts((previous) => ({ ...previous, radnici: items.length }))));
      if (canAccess('vozila')) requests.push(fetchVozila().then((items) => setCounts((previous) => ({ ...previous, vozila: items.length }))));
      if (canAccess('raspored')) requests.push(fetchRasporedi().then((items) => setCounts((previous) => ({ ...previous, raspored: items.length }))));
      if (canAccess('troskovi')) requests.push(fetchTroskovi().then((items) => setCounts((previous) => ({ ...previous, troskovi: items.length }))));
      if (canAccess('radni_nalozi')) requests.push(fetchRadniNalozi().then((items) => setCounts((previous) => ({ ...previous, radni_nalozi: items.length }))));
      await Promise.allSettled(requests);
    })();
  }, [view, profile?.approved, canAccess]);

  useEffect(() => {
    if (view === 'korisnici' && !isAdmin) setView('dashboard');
    const module = moduleForView(view);
    if (module && !canAccess(module)) {
      const firstAvailable = MODULES.find((item) => canAccess(item.id));
      if (firstAvailable) setView(firstAvailable.id);
    }
  }, [view, isAdmin, canAccess]);

  if (Capacitor.isNativePlatform() && profile?.radnik_id && !isAdmin) {
    return <MobileWorkOrdersView />;
  }

  const navigate = (nextView: View) => {
    if (nextView === 'korisnici' ? isAdmin : (() => {
      const module = moduleForView(nextView);
      return module !== null && canAccess(module);
    })()) {
      setFocusNalogId(null);
      setView(nextView);
    }
  };

  const module = moduleForView(view);
  const viewAuthorized = view === 'korisnici' ? isAdmin : module !== null && canAccess(module);

  if (!isAdmin && !MODULES.some((module) => canAccess(module.id))) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Nema dodijeljenih prava</h1>
          <p className="mt-2 text-sm text-slate-600">Vaš račun je odobren, ali još nema prava za prikaz modula. Obratite se administratoru.</p>
          <button onClick={() => void signOut().catch(() => undefined)} className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Odjavi se</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar current={view} onNavigate={navigate} counts={counts} />
      <main className="flex-1 overflow-y-auto">
        <div className={`mx-auto px-6 py-8 ${view === 'raspored' || view === 'radni_nalozi' || view === 'gradilista' ? 'max-w-none' : 'max-w-7xl'}`}>
          {!viewAuthorized && <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">Provjera prava pristupa…</p>}
          {viewAuthorized && module && !canAccess(module, 'edit') && (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Ovaj modul je dostupan samo za pregled. Promjene nisu dopuštene za vaš račun.
            </p>
          )}
          {viewAuthorized && view === 'dashboard' && <Dashboard onNavigate={navigate} />}
          {viewAuthorized && view === 'gradilista' && <GradilistaView onOpenNalog={(id) => { setFocusNalogId(id); setView('radni_nalozi'); }} />}
          {viewAuthorized && view === 'investitori' && <InvestitoriView />}
          {viewAuthorized && view === 'objekti' && <ObjektiView />}
          {viewAuthorized && view === 'kooperanti' && <KooperantiView />}
          {viewAuthorized && view === 'stavke' && <StavkeView />}
          {viewAuthorized && view === 'ponude' && <PonudeView />}
          {viewAuthorized && view === 'radnici' && <RadniciView />}
          {viewAuthorized && view === 'vozila' && <VozilaView />}
          {viewAuthorized && view === 'alat' && <OpremaView kategorija="alat" />}
          {viewAuthorized && view === 'strojevi' && <OpremaView kategorija="stroj" />}
          {viewAuthorized && view === 'raspored' && <RasporedView />}
          {viewAuthorized && view === 'troskovi' && <TroskoviView />}
          {viewAuthorized && view === 'fakture' && <FaktureView />}
          {viewAuthorized && view === 'radno_vrijeme' && <RadnoVrijemeView />}
          {viewAuthorized && view === 'radni_nalozi' && <RadniNaloziView key={focusNalogId ?? 'none'} focusNalogId={focusNalogId} />}
          {viewAuthorized && view === 'rekapitulacija' && <RekapitulacijaView />}
          {viewAuthorized && view === 'obavijesti' && <ObavijestiView onNavigate={navigate} />}
          {viewAuthorized && view === 'postavke' && <PostavkeView />}
          {viewAuthorized && view === 'asistent' && <AsistentView onNavigate={navigate} />}
          {viewAuthorized && view === 'korisnici' && <KorisniciView />}
        </div>
      </main>
    </div>
  );
}

export default App;
