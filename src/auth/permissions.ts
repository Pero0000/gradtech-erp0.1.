import type { View } from '@/components/Sidebar';

export const MODULES = [
  { id: 'dashboard', label: 'Nadzorna ploča' },
  { id: 'gradilista', label: 'Gradilišta' },
  { id: 'radnici', label: 'Radnici' },
  { id: 'vozila', label: 'Vozila' },
  { id: 'alat', label: 'Alat' },
  { id: 'strojevi', label: 'Strojevi' },
  { id: 'investitori', label: 'Investitori' },
  { id: 'objekti', label: 'Objekti' },
  { id: 'kooperanti', label: 'Kooperanti' },
  { id: 'stavke', label: 'Stavke' },
  { id: 'ponude', label: 'Ponude' },
  { id: 'raspored', label: 'Dnevni raspored' },
  { id: 'radni_nalozi', label: 'Radni nalozi' },
  { id: 'troskovi', label: 'Troškovi' },
  { id: 'fakture', label: 'Fakture' },
  { id: 'radno_vrijeme', label: 'Radno vrijeme' },
  { id: 'rekapitulacija', label: 'Rekapitulacija' },
  { id: 'obavijesti', label: 'Obavijesti' },
  { id: 'asistent', label: 'AI asistent' },
  { id: 'postavke', label: 'Postavke' },
] as const;

export type AppModule = (typeof MODULES)[number]['id'];
export type ModuleAction = 'view' | 'edit';
export type ModulePermissions = Partial<Record<AppModule, { can_view: boolean; can_edit: boolean }>>;

const viewModules: Partial<Record<View, AppModule>> = {
  dashboard: 'dashboard',
  gradilista: 'gradilista',
  investitori: 'investitori',
  objekti: 'objekti',
  kooperanti: 'kooperanti',
  stavke: 'stavke',
  ponude: 'ponude',
  radnici: 'radnici',
  vozila: 'vozila',
  alat: 'alat',
  strojevi: 'strojevi',
  raspored: 'raspored',
  troskovi: 'troskovi',
  radno_vrijeme: 'radno_vrijeme',
  fakture: 'fakture',
  radni_nalozi: 'radni_nalozi',
  rekapitulacija: 'rekapitulacija',
  obavijesti: 'obavijesti',
  asistent: 'asistent',
  postavke: 'postavke',
};

export function moduleForView(view: View): AppModule | null {
  return viewModules[view] ?? null;
}
