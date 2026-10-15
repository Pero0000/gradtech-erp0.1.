import { useEffect, useState } from 'react';
import { Sidebar, type View } from '@/components/Sidebar';
import { Dashboard } from '@/components/views/Dashboard';
import { GradilistaView } from '@/components/views/GradilistaView';
import { InvestitoriView, ObjektiView } from '@/components/views/RegistryViews';
import { KooperantiView } from '@/components/views/KooperantiView';
import { RadniciView } from '@/components/views/RadniciView';
import { VozilaView } from '@/components/views/VozilaView';
import { RasporedView } from '@/components/views/RasporedView';
import { TroskoviView } from '@/components/views/TroskoviView';
import { FaktureView } from '@/components/views/FaktureView';
import { RadnoVrijemeView } from '@/components/views/RadnoVrijemeView';
import { RadniNaloziView } from '@/components/views/RadniNaloziView';
import { RekapitulacijaView } from '@/components/views/RekapitulacijaView';
import { ObavijestiView } from '@/components/views/ObavijestiView';
import { PostavkeView } from '@/components/views/PostavkeView';
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

function App() {
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
  }, [view]);

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
        setCounts((previous) => ({
          ...previous,
          gradilista: g.length,
          radnici: r.length,
          vozila: v.length,
          raspored: rasp.length,
          troskovi: t.length,
          radni_nalozi: n.length,
        }));
      } catch {
        // counts will remain 0 — individual views show their own errors
      }
    })();
  }, [view]);

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar current={view} onNavigate={(v) => { setFocusNalogId(null); setView(v); }} counts={counts} />
      <main className="flex-1 overflow-y-auto">
        <div className={`mx-auto px-6 py-8 ${view === 'raspored' || view === 'radni_nalozi' || view === 'gradilista' ? 'max-w-none' : 'max-w-7xl'}`}>
          {view === 'dashboard' && <Dashboard onNavigate={setView} />}
          {view === 'gradilista' && <GradilistaView onOpenNalog={(id) => { setFocusNalogId(id); setView('radni_nalozi'); }} />}
          {view === 'investitori' && <InvestitoriView />}
          {view === 'objekti' && <ObjektiView />}
          {view === 'kooperanti' && <KooperantiView />}
          {view === 'radnici' && <RadniciView />}
          {view === 'vozila' && <VozilaView />}
          {view === 'raspored' && <RasporedView />}
          {view === 'troskovi' && <TroskoviView />}
          {view === 'fakture' && <FaktureView />}
          {view === 'radno_vrijeme' && <RadnoVrijemeView />}
          {view === 'radni_nalozi' && <RadniNaloziView key={focusNalogId ?? 'none'} focusNalogId={focusNalogId} />}
          {view === 'rekapitulacija' && <RekapitulacijaView />}
          {view === 'obavijesti' && <ObavijestiView onNavigate={setView} />}
          {view === 'postavke' && <PostavkeView />}
        </div>
      </main>
    </div>
  );
}

export default App;
