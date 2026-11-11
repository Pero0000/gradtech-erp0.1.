import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
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
import { TerminskiPlanView } from '@/components/views/TerminskiPlanView';
import { TroskoviView } from '@/components/views/TroskoviView';
import { FaktureView } from '@/components/views/FaktureView';
import { RadnoVrijemeView } from '@/components/views/RadnoVrijemeView';
import { RadniNaloziView } from '@/components/views/RadniNaloziView';
import { RekapitulacijaView } from '@/components/views/RekapitulacijaView';
import { ObavijestiView } from '@/components/views/ObavijestiView';
import { PostavkeView } from '@/components/views/PostavkeView';
import { AsistentView } from '@/components/views/AsistentView';
import { KorisniciView } from '@/components/views/KorisniciView';
import { TvrtkeView } from '@/components/views/TvrtkeView';
import { applyTheme, applyUserLayout, loadUserLayout, loadUserTheme } from '@/lib/postavke';
import { useOverview } from '@/lib/useOverview';
import { useAuth } from '@/auth/useAuth';
import { MODULES, moduleForView } from '@/auth/permissions';
import { MobileWorkOrdersView } from '@/components/mobile/MobileWorkOrdersView';
import { HistoryToolbarAction, HistoryToolbarProvider } from '@/components/views/HistoryDialog';

function App() {
  const { canAccess, isAdmin, isPlatformOwner, isWorker, hasWorkerPortal, company, profile, signOut } = useAuth();
  const [view, setView] = useState<View>('dashboard');
  const [portalMode, setPortalMode] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [hoverSidebarVisible, setHoverSidebarVisible] = useState(false);
  const [hasHoverPointer, setHasHoverPointer] = useState(false);
  const sidebarCloseTimer = useRef<number | null>(null);
  const [focusNalogId, setFocusNalogId] = useState<string | null>(null);
  const [focusGradilisteId, setFocusGradilisteId] = useState<string | null>(null);
  const overview = useOverview();
  const counts = { ...overview.counts, obavijesti: overview.items.filter((item) => item.level !== 'upcoming').length };

  useEffect(() => {
    const hoverQuery = window.matchMedia('(hover: hover)');
    const updateHoverPointer = () => setHasHoverPointer(hoverQuery.matches);
    updateHoverPointer();
    hoverQuery.addEventListener('change', updateHoverPointer);
    return () => hoverQuery.removeEventListener('change', updateHoverPointer);
  }, []);

  useEffect(() => {
    setPortalMode(false);
  }, [profile?.id]);

  useEffect(() => {
    if (!company?.id || !profile?.approved) {
      applyTheme('light');
      applyUserLayout('standardni');
      return;
    }
    applyTheme(loadUserTheme(profile.id));
    applyUserLayout(loadUserLayout(profile.id));
  }, [company?.id, profile?.approved, profile?.id]);

  useEffect(() => {
    if (view !== 'raspored' && view !== 'gradilista') setHoverSidebarVisible(false);
    if (view === 'korisnici' && !isAdmin) setView('dashboard');
    if (view === 'tvrtke' && !isPlatformOwner) setView('dashboard');
    const module = moduleForView(view);
    if (module && !canAccess(module)) {
      const firstAvailable = MODULES.find((item) => canAccess(item.id));
      if (firstAvailable) setView(firstAvailable.id);
      else if (isPlatformOwner) setView('tvrtke');
    }
  }, [view, isAdmin, isPlatformOwner, canAccess]);

  const openHoverSidebar = () => {
    if (sidebarCloseTimer.current !== null) {
      window.clearTimeout(sidebarCloseTimer.current);
      sidebarCloseTimer.current = null;
    }
    setHoverSidebarVisible(true);
  };

  const closeHoverSidebarSoon = () => {
    if (sidebarCloseTimer.current !== null) window.clearTimeout(sidebarCloseTimer.current);
    sidebarCloseTimer.current = window.setTimeout(() => {
      setHoverSidebarVisible(false);
      sidebarCloseTimer.current = null;
    }, 180);
  };

  if (isWorker || (hasWorkerPortal && portalMode)) {
    return <MobileWorkOrdersView onOpenERP={isWorker ? undefined : () => setPortalMode(false)} />;
  }

  const navigate = (nextView: View) => {
    if (nextView === 'tvrtke' ? isPlatformOwner : nextView === 'korisnici' ? isAdmin : (() => {
      const module = moduleForView(nextView);
      return module !== null && canAccess(module);
    })()) {
      setFocusNalogId(null);
      setFocusGradilisteId(null);
      setView(nextView);
      setMobileNavOpen(false);
    }
  };

  const module = moduleForView(view);
  const viewAuthorized = view === 'tvrtke' ? isPlatformOwner : view === 'korisnici' ? isAdmin : module !== null && canAccess(module);
  const autoHideSidebar = view === 'raspored' || view === 'gradilista';

  if (!isPlatformOwner && !MODULES.some((module) => canAccess(module.id))) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-lg rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Nema dostupnih modula</h1>
          <p className="mt-2 text-sm text-slate-600">Nijedan modul nije uključen za vašu tvrtku ili vam administrator još nije dodijelio prava za prikaz.</p>
          <button onClick={() => void signOut().catch(() => undefined)} className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Odjavi se</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell ${view === 'terminski_plan' ? 'app-shell-print-terminski' : ''} flex h-dvh min-w-0 bg-slate-50`}>
      <Sidebar
        current={view}
        onNavigate={navigate}
        mobileOpen={mobileNavOpen}
        desktopHidden={autoHideSidebar && !hoverSidebarVisible}
        desktopOverlay={autoHideSidebar}
        onDesktopEnter={openHoverSidebar}
        onDesktopLeave={closeHoverSidebarSoon}
        onMobileClose={() => setMobileNavOpen(false)}
        counts={counts}
      />
      {autoHideSidebar && hasHoverPointer && (
        <button
          type="button"
          aria-label="Otvori izbornik"
          onMouseEnter={openHoverSidebar}
          onMouseLeave={closeHoverSidebarSoon}
          onFocus={openHoverSidebar}
          className="fixed inset-y-0 left-0 z-[60] w-3 cursor-pointer"
        />
      )}
      <HistoryToolbarProvider>
      <main className={`app-main min-h-0 min-w-0 max-w-full flex-1 ${view === 'dashboard' ? 'overflow-y-auto xl:overflow-hidden' : 'overflow-y-auto'}`}>
        <header className="app-topbar sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-4">
          <div className="min-w-0 break-words">
            <p className="text-sm font-bold text-slate-900">GradTech · {company?.naziv}</p>
            <p className="text-xs text-slate-500">{view === 'terminski_plan' ? 'Terminski plan' : MODULES.find((module) => module.id === view)?.label ?? 'Aplikacija'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <HistoryToolbarAction />
            {hasWorkerPortal && (
              <button
                type="button"
                onClick={() => { setPortalMode(true); setMobileNavOpen(false); }}
                className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800"
              >
                Portal djelatnika
              </button>
            )}
            <button type="button" onClick={() => setMobileNavOpen((open) => !open)} aria-label={mobileNavOpen ? 'Zatvori navigaciju' : 'Otvori navigaciju'} aria-expanded={mobileNavOpen} className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 xl:hidden">
              {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </header>
        <div className={`app-content mx-auto min-w-0 w-full max-w-[2560px] px-3 py-4 sm:px-4 sm:py-6 xl:px-8 2xl:px-12 xl:py-8 ${view === 'dashboard' ? 'xl:h-full xl:min-h-0' : ''}`}>
          {(overview.countsError || overview.notificationsError) && (
            <div role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {overview.countsError && <p>Brojače nije moguće osvježiti: {overview.countsError}</p>}
              {overview.notificationsError && <p>Obavijesti nije moguće osvježiti: {overview.notificationsError}</p>}
              <button type="button" className="underline" onClick={() => void overview.refresh()}>Pokušaj ponovno</button>
            </div>
          )}
          {!viewAuthorized && <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">Provjera prava pristupa…</p>}
          {viewAuthorized && module && !canAccess(module, 'edit') && (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Ovaj modul je dostupan samo za pregled. Promjene nisu dopuštene za vaš račun.
            </p>
          )}
          {viewAuthorized && view === 'dashboard' && <Dashboard onNavigate={navigate} overview={overview} />}
          {viewAuthorized && view === 'tvrtke' && <TvrtkeView />}
          {viewAuthorized && view === 'gradilista' && <GradilistaView focusGradilisteId={focusGradilisteId} onOpenNalog={(id) => { setFocusNalogId(id); setView('radni_nalozi'); }} />}
          {viewAuthorized && view === 'investitori' && <InvestitoriView />}
          {viewAuthorized && view === 'objekti' && <ObjektiView onOpenGradiliste={canAccess('gradilista') ? (id) => {
            setFocusGradilisteId(id);
            setView('gradilista');
          } : undefined} />}
          {viewAuthorized && view === 'kooperanti' && <KooperantiView />}
          {viewAuthorized && view === 'stavke' && <StavkeView />}
          {viewAuthorized && view === 'ponude' && <PonudeView />}
          {viewAuthorized && view === 'radnici' && <RadniciView />}
          {viewAuthorized && view === 'vozila' && <VozilaView />}
          {viewAuthorized && view === 'alat' && <OpremaView kategorija="alat" />}
          {viewAuthorized && view === 'strojevi' && <OpremaView kategorija="stroj" />}
          {viewAuthorized && view === 'raspored' && (
            <RasporedView />
          )}
          {viewAuthorized && view === 'terminski_plan' && <TerminskiPlanView onOpenGradiliste={(id) => {
            setFocusGradilisteId(id);
            setView('gradilista');
          }} />}
          {viewAuthorized && view === 'troskovi' && <TroskoviView onOpenGradiliste={canAccess('gradilista') ? (id) => {
            setFocusGradilisteId(id);
            setView('gradilista');
          } : undefined} />}
          {viewAuthorized && view === 'fakture' && <FaktureView />}
          {viewAuthorized && view === 'radno_vrijeme' && <RadnoVrijemeView />}
          {viewAuthorized && view === 'radni_nalozi' && <RadniNaloziView key={focusNalogId ?? 'none'} focusNalogId={focusNalogId} />}
          {viewAuthorized && view === 'rekapitulacija' && <RekapitulacijaView />}
          {viewAuthorized && view === 'obavijesti' && <ObavijestiView onNavigate={navigate} canResolveVozila={canAccess('vozila', 'edit')} overview={overview} />}
          {viewAuthorized && view === 'postavke' && <PostavkeView />}
          {viewAuthorized && view === 'asistent' && <AsistentView />}
          {viewAuthorized && view === 'korisnici' && <KorisniciView />}
        </div>
      </main>
      </HistoryToolbarProvider>
    </div>
  );
}

export default App;
