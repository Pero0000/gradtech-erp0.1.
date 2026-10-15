import { supabase } from './supabase';

export type PonudaStatus = 'nepotvrdena' | 'potvrdena' | 'odbijena';

export interface Ponuda {
  id: string;
  godina: number;
  redni_broj: number;
  naslov: string;
  investitor_id: string | null;
  objekt_id: string | null;
  adresa_radova: string | null;
  datum: string;
  status: PonudaStatus;
  popust: number;
  pdv: number;
  prikazi_popust: boolean;
  prijenos_porezne_obveze: boolean;
  napomene: string | null;
  gradiliste_id: string | null;
  created_at: string;
  investitori?: { id: string; naziv: string } | null;
}

export type PonudaInput = Omit<Ponuda, 'id' | 'created_at' | 'investitori' | 'gradiliste_id' | 'godina' | 'redni_broj'>;

export interface PonudaStavka {
  id: string;
  ponuda_id: string;
  stavka_id: string | null;
  redoslijed: number;
  opis: string;
  vrsta_posla: string | null;
  podgrupa: string | null;
  jedinica: string;
  kolicina: number;
  cijena: number;
  popust: number;
}

export type PonudaStavkaInput = Omit<PonudaStavka, 'id' | 'ponuda_id'>;

function fail(error: { message?: string } | null): never {
  throw new Error(`${error?.message ?? 'Greška'} — pokreni migraciju 20261015400000_ponude.sql u Supabaseu.`);
}

export const ponudaBroj = (p: Pick<Ponuda, 'redni_broj' | 'godina'>) => `${p.redni_broj}/${p.godina}`;

export interface PonudaUkupno {
  vrijednost: number;
  popust: number;
  neto: number;
  pdv: number;
  bruto: number;
}

// Popust retka (ako je upisan) ima prednost pred općim popustom ponude
export const stavkaPopust = (s: Pick<PonudaStavka, 'popust'>, opci: number) => (s.popust > 0 ? s.popust : opci);

export function ponudaUkupno(p: Pick<Ponuda, 'popust' | 'pdv'>, stavke: PonudaStavka[]): PonudaUkupno {
  let vrijednost = 0;
  let neto = 0;
  for (const s of stavke) {
    const v = s.kolicina * s.cijena;
    vrijednost += v;
    neto += v * (1 - stavkaPopust(s, p.popust) / 100);
  }
  const pdv = neto * (p.pdv / 100);
  return { vrijednost, popust: vrijednost - neto, neto, pdv, bruto: neto + pdv };
}

export async function fetchPonude(): Promise<Ponuda[]> {
  const { data, error } = await supabase
    .from('ponude')
    .select('*, investitori:investitor_id ( id, naziv )')
    .order('godina', { ascending: false })
    .order('redni_broj', { ascending: false });
  if (error) fail(error);
  return (data ?? []) as Ponuda[];
}

export async function fetchSvePonudeStavke(): Promise<PonudaStavka[]> {
  const { data, error } = await supabase.from('ponude_stavke').select('*').order('redoslijed');
  if (error) fail(error);
  return (data ?? []) as PonudaStavka[];
}

export async function createPonuda(p: PonudaInput): Promise<Ponuda> {
  const godina = new Date(p.datum).getFullYear();
  const { data: last, error: e1 } = await supabase.from('ponude').select('redni_broj').eq('godina', godina).order('redni_broj', { ascending: false }).limit(1);
  if (e1) fail(e1);
  const redni_broj = ((last?.[0] as { redni_broj: number } | undefined)?.redni_broj ?? 0) + 1;
  const { data, error } = await supabase.from('ponude').insert({ ...p, godina, redni_broj }).select().single();
  if (error) fail(error);
  return data as Ponuda;
}

export async function updatePonuda(id: string, p: Partial<PonudaInput> & { gradiliste_id?: string | null }) {
  const { error } = await supabase.from('ponude').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) fail(error);
}

export async function deletePonuda(id: string) {
  const { error } = await supabase.from('ponude').delete().eq('id', id);
  if (error) fail(error);
}

// Stavke se spremaju zamjenom cijelog popisa; redoslijed prati redni broj u ponudi
export async function replacePonudaStavke(ponudaId: string, stavke: PonudaStavkaInput[]) {
  const { error: delError } = await supabase.from('ponude_stavke').delete().eq('ponuda_id', ponudaId);
  if (delError) fail(delError);
  if (stavke.length === 0) return;
  const { error } = await supabase.from('ponude_stavke').insert(stavke.map((s, i) => ({ ...s, ponuda_id: ponudaId, redoslijed: i })));
  if (error) fail(error);
}
