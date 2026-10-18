import type { FinancijskaRekapitulacija } from './api';
import { iznosFakture } from './api';
import type { FakturaStatus, Gradiliste, GradilisteStatus, TrosakKategorija } from '@/types';

export interface FinancijskiFilteri {
  search: string;
  gradilista: string[];
  status: GradilisteStatus | '';
  regija: string;
  investitor: string;
  objekt: string;
  voditelj: string;
  od: string;
  do: string;
  kategorija: TrosakKategorija | '';
  fakturaStatus: FakturaStatus | '';
  rezultat: '' | 'plus' | 'minus' | 'nula';
  aktivnost: '' | 's_podacima' | 'bez_podataka';
  trosakMin: string;
  trosakMax: string;
  prihodMin: string;
  prihodMax: string;
  saldoMin: string;
  saldoMax: string;
}

export const prazniFinancijskiFilteri: FinancijskiFilteri = {
  search: '', gradilista: [], status: '', regija: '', investitor: '', objekt: '', voditelj: '',
  od: '', do: '', kategorija: '', fakturaStatus: '', rezultat: '', aktivnost: '',
  trosakMin: '', trosakMax: '', prihodMin: '', prihodMax: '', saldoMin: '', saldoMax: '',
};

export interface FinancijskiRed {
  gradiliste: Gradiliste;
  direktni: number;
  rad: number;
  sati: number;
  trosak: number;
  prihod: number;
  placeno: number;
  neplaceno: number;
  saldo: number;
  marza: number | null;
  brojFaktura: number;
  brojZapisa: number;
}

export type FinancijskiSort = 'naziv' | 'trosak' | 'prihod' | 'placeno' | 'neplaceno' | 'saldo' | 'marza' | 'sati';

export function financijskiFilterError(f: FinancijskiFilteri): string | null {
  if (f.od && f.do && f.od > f.do) return 'Početni datum mora biti prije završnog datuma.';
  for (const [min, max, label] of [
    [f.trosakMin, f.trosakMax, 'trošak'],
    [f.prihodMin, f.prihodMax, 'prihod'],
    [f.saldoMin, f.saldoMax, 'saldo'],
  ]) {
    if ([min, max].some((v) => v !== '' && !Number.isFinite(Number(v)))) return `Unesi ispravan iznos za ${label}.`;
    if (min !== '' && max !== '' && Number(min) > Number(max)) return `Najmanji iznos za ${label} ne smije biti veći od najvećeg.`;
  }
  return null;
}

export function izracunajFinancijskeRedove(
  gradilista: Gradiliste[],
  data: FinancijskaRekapitulacija,
  f: FinancijskiFilteri,
  satnica: number,
  nettoPoRadnicima: boolean,
): FinancijskiRed[] {
  const inPeriod = (datum: string) => (!f.od || datum >= f.od) && (!f.do || datum <= f.do);
  const rows = new Map<string, FinancijskiRed>(gradilista.map((gradiliste) => [gradiliste.id, {
    gradiliste, direktni: 0, rad: 0, sati: 0, trosak: 0, prihod: 0, placeno: 0, neplaceno: 0,
    saldo: 0, marza: null, brojFaktura: 0, brojZapisa: 0,
  }]));
  for (const t of data.troskovi) {
    const row = t.gradiliste_id ? rows.get(t.gradiliste_id) : undefined;
    if (!row || !inPeriod(t.datum) || (f.kategorija && t.kategorija !== f.kategorija)) continue;
    row.direktni += t.iznos;
    row.brojZapisa++;
  }
  if (!f.kategorija || f.kategorija === 'place') {
    for (const rv of data.radnoVrijeme) {
      const row = rv.gradiliste_id ? rows.get(rv.gradiliste_id) : undefined;
      if (!row || !inPeriod(rv.datum)) continue;
      row.sati += rv.sati;
      row.rad += rv.sati * (nettoPoRadnicima ? rv.radnici?.cijena_sata ?? satnica : satnica);
      row.brojZapisa++;
    }
  }
  for (const faktura of data.fakture) {
    const row = faktura.gradiliste_id ? rows.get(faktura.gradiliste_id) : undefined;
    if (!row || !inPeriod(faktura.datum_izdavanja) || (f.fakturaStatus && faktura.status !== f.fakturaStatus)) continue;
    const iznos = iznosFakture(faktura);
    row.prihod += iznos;
    if (faktura.status === 'placena') row.placeno += iznos;
    else row.neplaceno += iznos;
    row.brojFaktura++;
    row.brojZapisa++;
  }
  const inRange = (v: number, min: string, max: string) =>
    (min === '' || v >= Number(min)) && (max === '' || v <= Number(max));
  const search = f.search.trim().toLocaleLowerCase('hr');
  const round2 = (value: number) => Math.round(value * 100) / 100;
  return [...rows.values()].map((row) => {
    const direktni = round2(row.direktni);
    const rad = round2(row.rad);
    const trosak = round2(direktni + rad);
    const prihod = round2(row.prihod);
    const saldo = round2(prihod - trosak);
    return {
      ...row, direktni, rad, trosak, prihod, saldo,
      placeno: round2(row.placeno), neplaceno: round2(row.neplaceno),
      marza: prihod !== 0 ? saldo / prihod * 100 : null,
    };
  }).filter((row) => {
    const g = row.gradiliste;
    const text = [g.naziv, g.adresa, g.opis, g.voditelj_gradilista, g.objekti?.naziv, g.objekti?.investitori?.naziv]
      .filter(Boolean).join(' ').toLocaleLowerCase('hr');
    return (!search || text.includes(search))
      && (!f.gradilista.length || f.gradilista.includes(g.id))
      && (!f.status || g.status === f.status)
      && (!f.regija || (g.regija ?? 'bez') === f.regija)
      && (!f.investitor || (g.objekti?.investitor_id ?? 'bez') === f.investitor)
      && (!f.objekt || (g.objekt_id ?? 'bez') === f.objekt)
      && (!f.voditelj || (g.voditelj_gradilista ?? 'bez') === f.voditelj)
      && (!f.rezultat || (f.rezultat === 'plus' ? row.saldo > 0 : f.rezultat === 'minus' ? row.saldo < 0 : row.saldo === 0))
      && (!f.aktivnost || (f.aktivnost === 's_podacima' ? row.brojZapisa > 0 : row.brojZapisa === 0))
      && inRange(row.trosak, f.trosakMin, f.trosakMax)
      && inRange(row.prihod, f.prihodMin, f.prihodMax)
      && inRange(row.saldo, f.saldoMin, f.saldoMax);
  });
}
