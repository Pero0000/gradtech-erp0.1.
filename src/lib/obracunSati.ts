import type { OdsustvoVrsta } from '@/types';

export type ObracunKategorija = 'nocni' | 'teren' | 'praznik' | 'godisnji' | 'bolovanje';
export type ObracunPrava = Record<ObracunKategorija, boolean>;

export const OBRACUN_KATEGORIJE: { key: ObracunKategorija; label: string; jedinica: 'h' | 'dan' }[] = [
  { key: 'nocni', label: 'Noćni rad', jedinica: 'h' },
  { key: 'teren', label: 'Teren', jedinica: 'dan' },
  { key: 'praznik', label: 'Praznik', jedinica: 'dan' },
  { key: 'godisnji', label: 'Godišnji', jedinica: 'dan' },
  { key: 'bolovanje', label: 'Bolovanje', jedinica: 'dan' },
];

export const PRAVO_POLJA: Record<ObracunKategorija, 'pravo_nocni' | 'pravo_teren' | 'pravo_praznik' | 'pravo_godisnji' | 'pravo_bolovanje'> = {
  nocni: 'pravo_nocni',
  teren: 'pravo_teren',
  praznik: 'pravo_praznik',
  godisnji: 'pravo_godisnji',
  bolovanje: 'pravo_bolovanje',
};

export interface ObracunUnos {
  datum: string;
  sati: number;
  nocni_sati: number;
  teren: boolean;
}

export interface ObracunOdsustvo {
  vrsta: OdsustvoVrsta;
  datum_od: string;
  datum_do: string;
}

export interface ObracunCijene {
  cijena_sata?: number | null;
  nocni_dodatak?: number | null;
  teren_dnevnica?: number | null;
  cijena_praznik?: number | null;
  cijena_godisnji?: number | null;
  cijena_bolovanje?: number | null;
}

export interface ObracunRezultat {
  redovniSati: number;
  kolicine: Record<ObracunKategorija, number>;
  iznosi: Record<ObracunKategorija | 'redovni', number> & { ukupno: number };
}

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function minuteSmjene(
  vrijemeOd: string,
  vrijemeDo: string,
  { nocOd, danOd }: { nocOd: number; danOd: number },
) {
  const toMinutes = (vrijeme: string) => {
    const [h, m] = vrijeme.split(':').map(Number);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      throw new Error('Neispravno vrijeme smjene.');
    }
    return h * 60 + m;
  };
  const od = toMinutes(vrijemeOd);
  const doo = toMinutes(vrijemeDo);
  const ukupno = (doo - od + 1440) % 1440;
  let nocne = 0;
  for (let m = od; m < od + ukupno; m++) {
    const t = m % 1440;
    if (nocOd > danOd ? t >= nocOd || t < danOd : t >= nocOd && t < danOd) nocne++;
  }
  return { ukupno, nocne };
}

const toUtc = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

/** Državni praznici i blagdani u Republici Hrvatskoj (Zakon iz 2019.). */
export function hrPraznici(year: number): Map<string, string> {
  const fixed: [string, string][] = [
    ['01-01', 'Nova godina'],
    ['01-06', 'Bogojavljenje'],
    ['05-01', 'Praznik rada'],
    ['05-30', 'Dan državnosti'],
    ['06-22', 'Dan antifašističke borbe'],
    ['08-05', 'Dan pobjede i domovinske zahvalnosti'],
    ['08-15', 'Velika Gospa'],
    ['11-01', 'Svi sveti'],
    ['11-18', 'Dan sjećanja na žrtve Domovinskog rata'],
    ['12-25', 'Božić'],
    ['12-26', 'Sveti Stjepan'],
  ];
  const result = new Map(fixed.map(([md, naziv]) => [`${year}-${md}`, naziv]));
  const easter = easterSunday(year);
  result.set(toIso(easter), 'Uskrs');
  result.set(toIso(easter + DAY_MS), 'Uskrsni ponedjeljak');
  result.set(toIso(easter + 60 * DAY_MS), 'Tijelovo');
  return result;
}

export function mjesecRaspon(mjesec: string) {
  const [y, m] = mjesec.split('-').map(Number);
  return { od: toIso(Date.UTC(y, m - 1, 1)), do: toIso(Date.UTC(y, m, 0)) };
}

const jePraznik = (iso: string, cache: Map<number, Map<string, string>>) => {
  const year = Number(iso.slice(0, 4));
  if (!cache.has(year)) cache.set(year, hrPraznici(year));
  return cache.get(year)!.has(iso);
};

/** Radni dani (pon–pet) između dva datuma, uključivo. */
function radniDani(od: string, doo: string) {
  const days: string[] = [];
  for (let t = toUtc(od); t <= toUtc(doo); t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(toIso(t));
  }
  return days;
}

/**
 * Obračun za jednog radnika u razdoblju [od, do].
 * - Bolovanje: radni dani u rasponu bolovanja (i kad je praznik).
 * - Godišnji: radni dani u rasponu godišnjeg, bez praznika.
 * - Praznik: praznici na radni dan kad radnik nije radio ni bio na bolovanju, te ručno upisani dani praznika.
 * - Teren: različiti dani s nalogom označenim kao teren.
 * Iznosi se računaju samo za kategorije na koje radnik ima pravo.
 */
export function computeObracun(input: {
  od: string;
  do: string;
  unosi: ObracunUnos[];
  odsustva: ObracunOdsustvo[];
  prava: ObracunPrava;
  cijene?: ObracunCijene;
}): ObracunRezultat {
  const { od, do: doo, unosi, odsustva, prava, cijene = {} } = input;
  const inRange = (d: string) => d >= od && d <= doo;
  const cache = new Map<number, Map<string, string>>();

  const uRasponu = unosi.filter((u) => inRange(u.datum));
  const redovniSati = round2(uRasponu.reduce((s, u) => s + (Number(u.sati) || 0), 0));
  const nocniSati = round2(uRasponu.reduce((s, u) => s + (Number(u.nocni_sati) || 0), 0));
  const radio = new Set(uRasponu.filter((u) => Number(u.sati) > 0).map((u) => u.datum));
  const terenDani = new Set(uRasponu.filter((u) => u.teren).map((u) => u.datum));

  const daniPoVrsti = (vrsta: OdsustvoVrsta) => {
    const set = new Set<string>();
    for (const o of odsustva.filter((x) => x.vrsta === vrsta)) {
      const start = o.datum_od > od ? o.datum_od : od;
      const end = o.datum_do < doo ? o.datum_do : doo;
      if (start > end) continue;
      for (const d of radniDani(start, end)) set.add(d);
    }
    return set;
  };

  const bolovanje = daniPoVrsti('bolovanje');
  const godisnji = new Set([...daniPoVrsti('godisnji')].filter((d) => !bolovanje.has(d) && !jePraznik(d, cache)));
  const praznik = new Set([...daniPoVrsti('praznik')].filter((d) => !bolovanje.has(d)));
  for (const d of radniDani(od, doo)) {
    if (jePraznik(d, cache) && !radio.has(d) && !bolovanje.has(d)) praznik.add(d);
  }

  const kolicine: Record<ObracunKategorija, number> = {
    nocni: nocniSati,
    teren: terenDani.size,
    praznik: praznik.size,
    godisnji: godisnji.size,
    bolovanje: bolovanje.size,
  };

  const satnica = Number(cijene.cijena_sata) || 0;
  const iznosi = {
    redovni: round2(redovniSati * satnica),
    nocni: prava.nocni ? round2(nocniSati * satnica * ((Number(cijene.nocni_dodatak) || 0) / 100)) : 0,
    teren: prava.teren ? round2(kolicine.teren * (Number(cijene.teren_dnevnica) || 0)) : 0,
    praznik: prava.praznik ? round2(kolicine.praznik * (Number(cijene.cijena_praznik) || 0)) : 0,
    godisnji: prava.godisnji ? round2(kolicine.godisnji * (Number(cijene.cijena_godisnji) || 0)) : 0,
    bolovanje: prava.bolovanje ? round2(kolicine.bolovanje * (Number(cijene.cijena_bolovanje) || 0)) : 0,
    ukupno: 0,
  };
  iznosi.ukupno = round2(iznosi.redovni + iznosi.nocni + iznosi.teren + iznosi.praznik + iznosi.godisnji + iznosi.bolovanje);

  return { redovniSati, kolicine, iznosi };
}

/** Prava radnika; prije migracije (polja ne postoje) vrijedi staro ponašanje: pravo ima tko ima cijenu. */
export function pravaRadnika(r: ObracunCijene & Partial<Record<(typeof PRAVO_POLJA)[ObracunKategorija], boolean | null>>): ObracunPrava {
  const pick = (polje: boolean | null | undefined, cijena: number | null | undefined) =>
    typeof polje === 'boolean' ? polje : (Number(cijena) || 0) > 0;
  return {
    nocni: pick(r.pravo_nocni, r.nocni_dodatak),
    teren: pick(r.pravo_teren, r.teren_dnevnica),
    praznik: pick(r.pravo_praznik, r.cijena_praznik),
    godisnji: pick(r.pravo_godisnji, r.cijena_godisnji),
    bolovanje: pick(r.pravo_bolovanje, r.cijena_bolovanje),
  };
}

/** Noćni sati iz stare napomene ("Noćni rad 2.5 h") kad stupac nocni_sati još ne postoji. */
export function nocniIzNapomene(napomena: string | null | undefined) {
  const match = napomena?.match(/Noćni rad ([0-9]+(?:\.[0-9]+)?) h/);
  return match ? Number(match[1]) : 0;
}
