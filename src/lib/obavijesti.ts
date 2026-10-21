import type { Faktura, Gradiliste, Radnik, Rok, Vozilo, VoziloDokument, RadnikDokument } from '@/types';
import { companyStorage } from './company';
import {
  fetchFakture,
  fetchGradilista,
  fetchRadnici,
  fetchRokovi,
  fetchSviRadnikDokumenti,
  fetchSviVoziloDokumenti,
  fetchVozila,
  iznosFakture,
} from '@/lib/api';
import { servisAlert } from '@/lib/servis';
import { todayISO } from '@/lib/rokovi';
import { obavijestTipovi, type ObavijestGrupa, type ObavijestTip, type Postavke } from '@/lib/postavke';

export type ObavijestLevel = 'overdue' | 'today' | 'soon' | 'upcoming';

export interface Obavijest {
  id: string;
  tip: ObavijestTip;
  grupa: ObavijestGrupa;
  tipLabel: string;
  title: string;
  detail: string;
  datum: string | null;
  days: number | null;
  level: ObavijestLevel;
  view: 'radnici' | 'vozila' | 'gradilista' | 'fakture';
}

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000);

const levelOf = (days: number): ObavijestLevel => (days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 3 ? 'soon' : 'upcoming');

export function relativeLabel(days: number | null) {
  if (days === null) return '';
  if (days < 0) return `kasni ${Math.abs(days)} d`;
  if (days === 0) return 'danas';
  return `za ${days} d`;
}

const radnikTip = (vrsta: RadnikDokument['vrsta']): ObavijestTip => ({
  lijecnicki: 'radnik_lijecnicki',
  zastita_na_radu: 'radnik_zastita',
  osposobljavanje: 'radnik_osposobljavanje',
  atest: 'radnik_atest',
  ostalo: 'radnik_ostalo',
} as const)[vrsta];

const voziloTip = (vrsta: VoziloDokument['vrsta']): ObavijestTip | null => {
  switch (vrsta) {
    case 'registracija':
    case 'tehnicki':
      return 'vozilo_registracija';
    case 'osiguranje':
    case 'kasko':
      return 'vozilo_osiguranje';
    case 'enc':
      return 'vozilo_enc';
    case 'tahograf':
      return 'vozilo_tahograf';
    case 'ostalo':
      return 'vozilo_ostalo';
    default:
      return null;
  }
};

interface Source {
  gradilista: Gradiliste[];
  radnici: Radnik[];
  vozila: Vozilo[];
  rokovi: Rok[];
  fakture: Faktura[];
  radnikDok: RadnikDokument[];
  voziloDok: VoziloDokument[];
}

export async function loadObavijestiSource(): Promise<Source> {
  const [gradilista, radnici, vozila, rokovi, fakture, radnikDok, voziloDok] = await Promise.all([
    fetchGradilista(),
    fetchRadnici(),
    fetchVozila(),
    fetchRokovi(),
    fetchFakture(),
    fetchSviRadnikDokumenti().catch(() => [] as RadnikDokument[]),
    fetchSviVoziloDokumenti().catch(() => [] as VoziloDokument[]),
  ]);
  return { gradilista, radnici, vozila, rokovi, fakture, radnikDok, voziloDok };
}

export function buildObavijesti(src: Source, postavke: Postavke): Obavijest[] {
  const today = todayISO();
  const out: Obavijest[] = [];
  const meta = (tip: ObavijestTip) => obavijestTipovi.find((t) => t.tip === tip)!;

  const push = (tip: ObavijestTip, id: string, title: string, detail: string, datum: string, view: Obavijest['view']) => {
    const cfg = postavke.obavijesti[tip];
    if (!cfg?.on) return;
    const days = daysBetween(today, datum);
    if (days > cfg.dana) return;
    const m = meta(tip);
    out.push({ id, tip, grupa: m.grupa, tipLabel: m.label, title, detail, datum, days, level: levelOf(days), view });
  };

  // Samo najnoviji dokument po osobi/vozilu i vrsti (obnovljeni dokument zamjenjuje stari)
  const latest = <T extends { datum_do: string | null }>(items: T[], keyOf: (item: T) => string) => {
    const map = new Map<string, T>();
    items.forEach((item) => {
      if (!item.datum_do) return;
      const key = keyOf(item);
      const current = map.get(key);
      if (!current || (current.datum_do ?? '') < item.datum_do) map.set(key, item);
    });
    return [...map.values()];
  };

  const radnikById = new Map(src.radnici.map((r) => [r.id, r]));
  latest(src.radnikDok, (d) => `${d.radnik_id}|${radnikTip(d.vrsta)}`).forEach((d) => {
    const r = radnikById.get(d.radnik_id);
    if (!r || r.status === 'neaktivan') return;
    push(radnikTip(d.vrsta), `rd-${d.id}`, `${r.ime} ${r.prezime}`, d.naziv, d.datum_do as string, 'radnici');
  });

  const voziloById = new Map(src.vozila.map((v) => [v.id, v]));
  latest(src.voziloDok.filter((d) => voziloTip(d.vrsta)), (d) => `${d.vozilo_id}|${voziloTip(d.vrsta)}`).forEach((d) => {
    const v = voziloById.get(d.vozilo_id);
    const tip = voziloTip(d.vrsta);
    if (!v || !tip) return;
    push(tip, `vd-${d.id}`, v.registracija, d.naziv, d.datum_do as string, 'vozila');
  });

  if (postavke.obavijesti.vozilo_servis.on) {
    src.vozila.forEach((v) => {
      const alert = servisAlert(v, src.voziloDok);
      if (!alert || alert.level === 'none-recorded') return;
      const m = meta('vozilo_servis');
      out.push({
        id: `vs-${v.id}`,
        tip: 'vozilo_servis',
        grupa: m.grupa,
        tipLabel: m.label,
        title: v.registracija,
        detail: alert.text,
        datum: null,
        days: null,
        level: alert.level === 'overdue' ? 'overdue' : 'soon',
        view: 'vozila',
      });
    });
  }

  src.gradilista.filter((g) => g.status !== 'zavrseno').forEach((g) => {
    if (g.datum_zavrsetka) push('projekt_rok', `gk-${g.id}`, g.naziv, 'Kraj gradilišta', g.datum_zavrsetka, 'gradilista');
    if (g.datum_pocetka && g.datum_pocetka >= today && g.status !== 'aktivno') push('projekt_rok', `gp-${g.id}`, g.naziv, 'Početak gradilišta', g.datum_pocetka, 'gradilista');
  });
  const gradNaziv = new Map(src.gradilista.map((g) => [g.id, g]));
  src.rokovi.filter((r) => r.status !== 'zavrsen').forEach((r) => {
    const g = gradNaziv.get(r.gradiliste_id);
    if (!g || g.status === 'zavrseno') return;
    push('projekt_rok', `rk-${r.id}`, g.naziv, r.naziv, r.datum, 'gradilista');
  });

  src.fakture.filter((f) => f.status !== 'placena' && f.datum_dospjecja).forEach((f) => {
    push('faktura_naplata', `fk-${f.id}`, `Faktura ${f.broj}`, `${f.kupac ?? ''} · ${iznosFakture(f).toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })}`.replace(/^ · /, ''), f.datum_dospjecja as string, 'fakture');
  });

  const order: Record<ObavijestLevel, number> = { overdue: 0, today: 1, soon: 2, upcoming: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level] || (a.days ?? -999) - (b.days ?? -999));
}

export async function loadObavijesti(postavke: Postavke) {
  return buildObavijesti(await loadObavijestiSource(), postavke);
}

const SENT_KEY = 'tm_push_sent';

// Browser push: jedna obavijest po stavci dnevno za kasni/danas/uskoro
export function sendPushNotifications(list: Obavijest[]) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const today = todayISO();
  let sent: Record<string, string> = {};
  try {
    sent = JSON.parse(companyStorage.getItem(SENT_KEY) ?? '{}') as Record<string, string>;
  } catch {
    sent = {};
  }
  const fresh = list.filter((o) => o.level !== 'upcoming' && sent[o.id] !== today);
  fresh.slice(0, 5).forEach((o) => {
    new Notification(`${o.tipLabel}: ${o.title}`, { body: `${o.detail} · ${o.days === null ? 'potrebna radnja' : relativeLabel(o.days)}`, tag: o.id });
  });
  if (fresh.length > 5) new Notification('Još obavijesti', { body: `Ukupno ${fresh.length} novih obavijesti.`, tag: 'tm-more' });
  const next: Record<string, string> = {};
  list.forEach((o) => { next[o.id] = sent[o.id] === today || fresh.includes(o) ? today : sent[o.id]; });
  companyStorage.setItem(SENT_KEY, JSON.stringify(Object.fromEntries(Object.entries(next).filter(([, v]) => v))));
}
