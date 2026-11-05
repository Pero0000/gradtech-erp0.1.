import { companyStorage, requireCompany } from './company';

export type ObavijestTip =
  | 'radnik_lijecnicki'
  | 'radnik_zastita'
  | 'radnik_osposobljavanje'
  | 'radnik_atest'
  | 'radnik_ostalo'
  | 'vozilo_registracija'
  | 'vozilo_servis'
  | 'vozilo_osiguranje'
  | 'vozilo_enc'
  | 'vozilo_tahograf'
  | 'vozilo_ostalo'
  | 'projekt_rok'
  | 'faktura_naplata';

export type ObavijestGrupa = 'Zaposlenici' | 'Vozila' | 'Projekti' | 'Financije';

export const obavijestTipovi: { tip: ObavijestTip; grupa: ObavijestGrupa; label: string; defaultDana: number }[] = [
  { tip: 'radnik_lijecnicki', grupa: 'Zaposlenici', label: 'Liječnički pregled', defaultDana: 30 },
  { tip: 'radnik_zastita', grupa: 'Zaposlenici', label: 'Zaštita na radu', defaultDana: 30 },
  { tip: 'radnik_osposobljavanje', grupa: 'Zaposlenici', label: 'Osposobljavanje', defaultDana: 30 },
  { tip: 'radnik_atest', grupa: 'Zaposlenici', label: 'Atesti', defaultDana: 30 },
  { tip: 'radnik_ostalo', grupa: 'Zaposlenici', label: 'Ostali rokovi zaposlenika', defaultDana: 30 },
  { tip: 'vozilo_registracija', grupa: 'Vozila', label: 'Registracija i tehnički pregled', defaultDana: 30 },
  { tip: 'vozilo_servis', grupa: 'Vozila', label: 'Redovni servis (po postavkama vozila)', defaultDana: 30 },
  { tip: 'vozilo_osiguranje', grupa: 'Vozila', label: 'Osiguranje i kasko', defaultDana: 30 },
  { tip: 'vozilo_enc', grupa: 'Vozila', label: 'ENC uređaj', defaultDana: 30 },
  { tip: 'vozilo_tahograf', grupa: 'Vozila', label: 'Tahograf', defaultDana: 30 },
  { tip: 'vozilo_ostalo', grupa: 'Vozila', label: 'Ostali rokovi vozila', defaultDana: 30 },
  { tip: 'projekt_rok', grupa: 'Projekti', label: 'Rokovi projekata i gradilišta', defaultDana: 14 },
  { tip: 'faktura_naplata', grupa: 'Financije', label: 'Naplata faktura (dospijeće)', defaultDana: 5 },
];

export interface Postavke {
  danOd: string;
  nocOd: string;
  obavijesti: Record<ObavijestTip, { on: boolean; dana: number }>;
  push: boolean;
  theme: 'light' | 'dark';
}

export type RasporedSučelja = 'standardni' | 'pregledni';

const KEY = 'tm_postavke';
const RASPORED_KEY_PREFIX = 'tm_raspored_sucelja_';
const TEMA_KEY_PREFIX = 'tm_tema_';
const NAVIGACIJA_KEY_PREFIX = 'tm_navigacija_';

export interface KorisnickaNavigacija {
  prikaz: 'ikone' | 'ikone_tekst';
}

export function defaultPostavke(): Postavke {
  return {
    danOd: '06:00',
    nocOd: '22:00',
    push: false,
    theme: 'light',
    obavijesti: Object.fromEntries(obavijestTipovi.map((t) => [t.tip, { on: true, dana: t.defaultDana }])) as Postavke['obavijesti'],
  };
}

export function loadPostavke(): Postavke {
  requireCompany();
  const base = defaultPostavke();
  try {
    const saved = JSON.parse(companyStorage.getItem(KEY) ?? 'null') as Partial<Postavke> | null;
    if (!saved) return base;
    return {
      ...base,
      ...saved,
      theme: saved.theme === 'dark' ? 'dark' : 'light',
      obavijesti: { ...base.obavijesti, ...(saved.obavijesti ?? {}) },
    };
  } catch {
    return base;
  }
}

export function savePostavke(p: Postavke) {
  const companySettings: Omit<Postavke, 'theme'> = {
    danOd: p.danOd,
    nocOd: p.nocOd,
    obavijesti: p.obavijesti,
    push: p.push,
  };
  companyStorage.setItem(KEY, JSON.stringify(companySettings));
}

export function applyTheme(theme: Postavke['theme']) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.dispatchEvent(new Event('tm-theme-change'));
}

export function loadUserTheme(userId: string | null | undefined): Postavke['theme'] {
  if (!userId) return 'light';
  const key = `${TEMA_KEY_PREFIX}${userId}`;
  const saved = window.localStorage.getItem(key);
  if (saved === 'light' || saved === 'dark') return saved;

  const legacyTheme = loadPostavke().theme;
  saveUserTheme(userId, legacyTheme);
  return legacyTheme;
}

export function saveUserTheme(userId: string, theme: Postavke['theme']) {
  window.localStorage.setItem(`${TEMA_KEY_PREFIX}${userId}`, theme);
  applyTheme(theme);
}

export function loadUserLayout(userId: string | null | undefined): RasporedSučelja {
  if (!userId) return 'standardni';
  return window.localStorage.getItem(`${RASPORED_KEY_PREFIX}${userId}`) === 'pregledni'
    ? 'pregledni'
    : 'standardni';
}

export function saveUserLayout(userId: string, layout: RasporedSučelja) {
  window.localStorage.setItem(`${RASPORED_KEY_PREFIX}${userId}`, layout);
  applyUserLayout(layout);
}

export function applyUserLayout(layout: RasporedSučelja) {
  document.documentElement.dataset.layout = layout;
  window.dispatchEvent(new Event('tm-layout-change'));
}

export function loadUserNavigation(userId: string | null | undefined): KorisnickaNavigacija {
  const defaults: KorisnickaNavigacija = { prikaz: 'ikone_tekst' };
  if (!userId) return defaults;

  const saved = window.localStorage.getItem(`${NAVIGACIJA_KEY_PREFIX}${userId}`);
  if (!saved) return defaults;

  try {
    const parsed = JSON.parse(saved) as Partial<KorisnickaNavigacija>;
    return { prikaz: parsed.prikaz === 'ikone' ? 'ikone' : 'ikone_tekst' };
  } catch {
    return defaults;
  }
}

export function saveUserNavigation(userId: string, navigation: KorisnickaNavigacija) {
  window.localStorage.setItem(`${NAVIGACIJA_KEY_PREFIX}${userId}`, JSON.stringify(navigation));
}

// Početak noćnog rada i dnevnog rada u minutama od ponoći (koristi se u obračunu noćnih sati)
export function nocniInterval() {
  const p = loadPostavke();
  const toMin = (v: string) => {
    const [h, m] = v.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  return { nocOd: toMin(p.nocOd), danOd: toMin(p.danOd) };
}
