import {
  Building2,
  Users,
  Truck,
  CalendarDays,
  LayoutDashboard,
  Receipt,
  Clock,
  ClipboardList,
  FileBarChart,
  FileText,
  Handshake,
  ListChecks,
  FileSignature,
  Bell,
  Sparkles,
  Settings,
} from 'lucide-react';

export type View =
  | 'dashboard'
  | 'gradilista'
  | 'investitori'
  | 'objekti'
  | 'kooperanti'
  | 'stavke'
  | 'ponude'
  | 'radnici'
  | 'vozila'
  | 'raspored'
  | 'troskovi'
  | 'radno_vrijeme'
  | 'fakture'
  | 'radni_nalozi'
  | 'rekapitulacija'
  | 'obavijesti'
  | 'asistent'
  | 'postavke';

interface SidebarProps {
  current: View;
  onNavigate: (view: View) => void;
  counts: {
    gradilista: number;
    radnici: number;
    vozila: number;
    raspored: number;
    troskovi: number;
    radni_nalozi: number;
    obavijesti?: number;
  };
}

const navSections: {
  title: string;
  items: { view: View; label: string; icon: typeof Building2 }[];
}[] = [
  {
    title: 'Pregled',
    items: [{ view: 'dashboard', label: 'Nadzorna ploča', icon: LayoutDashboard }, { view: 'obavijesti', label: 'Obavijesti', icon: Bell }, { view: 'asistent', label: 'AI asistent', icon: Sparkles }],
  },
  {
    title: 'Resursi',
    items: [
      { view: 'gradilista', label: 'Gradilišta', icon: Building2 },
      { view: 'radnici', label: 'Radnici', icon: Users },
      { view: 'vozila', label: 'Vozila', icon: Truck },
    ],
  },
  {
    title: 'Baze',
    items: [
      { view: 'investitori', label: 'Investitori', icon: Users },
      { view: 'objekti', label: 'Objekti', icon: Building2 },
      { view: 'kooperanti', label: 'Kooperanti', icon: Handshake },
      { view: 'stavke', label: 'Stavke', icon: ListChecks },
    ],
  },
  {
    title: 'Operacije',
    items: [
      { view: 'ponude', label: 'Ponude', icon: FileSignature },
      { view: 'raspored', label: 'Dnevni raspored', icon: CalendarDays },
      { view: 'radni_nalozi', label: 'Radni nalozi', icon: ClipboardList },
    ],
  },
  {
    title: 'Financije',
    items: [
      { view: 'troskovi', label: 'Troškovi', icon: Receipt },
      { view: 'fakture', label: 'Fakture', icon: FileText },
      { view: 'radno_vrijeme', label: 'Radno vrijeme', icon: Clock },
      { view: 'rekapitulacija', label: 'Rekapitulacija', icon: FileBarChart },
    ],
  },
  {
    title: 'Sustav',
    items: [{ view: 'postavke', label: 'Postavke', icon: Settings }],
  },
];

const countMap: Partial<Record<View, keyof SidebarProps['counts']>> = {
  gradilista: 'gradilista',
  radnici: 'radnici',
  vozila: 'vozila',
  raspored: 'raspored',
  troskovi: 'troskovi',
  radni_nalozi: 'radni_nalozi',
  obavijesti: 'obavijesti',
};

export function Sidebar({ current, onNavigate, counts }: SidebarProps) {
  return (
    <aside className="flex h-screen w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-200">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-600 text-white">
          <Building2 className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900 leading-tight">GradTech</p>
          <p className="text-xs text-slate-500">Upravljanje firmom</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {navSections.map((section) => (
          <div key={section.title} className="mb-5">
            <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {section.title}
            </p>
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = current === item.view;
                const countKey = countMap[item.view];
                const count = countKey ? counts[countKey] : undefined;

                return (
                  <button
                    key={item.view}
                    onClick={() => onNavigate(item.view)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-sky-50 text-sky-700'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <Icon className={`h-[18px] w-[18px] ${active ? 'text-sky-600' : 'text-slate-400'}`} />
                    <span className="flex-1 text-left">{item.label}</span>
                    {count !== undefined && count > 0 && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          active ? 'bg-sky-100 text-sky-700' : item.view === 'obavijesti' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 px-6 py-3">
        <p className="text-xs text-slate-400">© 2026 GradTech</p>
      </div>
    </aside>
  );
}
