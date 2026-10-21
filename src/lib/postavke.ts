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
}

const KEY = 'tm_postavke';

export function defaultPostavke(): Postavke {
  return {
    danOd: '06:00',
    nocOd: '22:00',
    push: false,
    obavijesti: Object.fromEntries(obavijestTipovi.map((t) => [t.tip, { on: true, dana: t.defaultDana }])) as Postavke['obavijesti'],
  };
}

export function loadPostavke(): Postavke {
  requireCompany();
  const base = defaultPostavke();
  try {
    const saved = JSON.parse(companyStorage.getItem(KEY) ?? 'null') as Partial<Postavke> | null;
    if (!saved) return base;
    return { ...base, ...saved, obavijesti: { ...base.obavijesti, ...(saved.obavijesti ?? {}) } };
  } catch {
    return base;
  }
}

export function savePostavke(p: Postavke) {
  companyStorage.setItem(KEY, JSON.stringify(p));
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
