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

export interface PonudaChangeHistory {
  id: string;
  sequence: string;
  before_ponuda: Record<string, unknown>;
  after_ponuda: Record<string, unknown>;
  before_stavke: PonudaStavka[];
  after_stavke: PonudaStavka[];
  actor_name: string;
  created_at: string;
  expires_at: string;
  reversed_at: string | null;
  reverses_id: string | null;
  can_restore: boolean;
  blocked_reason: string | null;
}

function fail(error: { message?: string } | null): never {
  throw new Error(`${error?.message ?? 'Greška'} — pokreni migraciju 20261015400000_ponude.sql u Supabaseu.`);
}

function offerHistoryError(error: { code?: string; message?: string }) {
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code ?? '')) {
    return new Error('Nedostaje migracija 20261110250000_ponude_povijest_izmjena.sql. Primijenite je prije spremanja i povrata izmjena ponuda.');
  }
  return error;
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

export async function createPonuda(p: PonudaInput, stavke: PonudaStavkaInput[] = []): Promise<Ponuda> {
  const { data, error } = await supabase.rpc('create_ponuda_with_stavke', {
    p_data: p, p_lines: stavke,
  });
  if (error) throw offerHistoryError(error);
  return data as Ponuda;
}

export async function savePonudaWithHistory(
  id: string,
  p: Partial<PonudaInput> & { gradiliste_id?: string | null },
  stavke?: PonudaStavkaInput[],
): Promise<void> {
  const { error } = await supabase.rpc('save_ponuda_with_history', {
    p_record_id: id, p_data: p, p_lines: stavke ?? null,
  });
  if (error) throw offerHistoryError(error);
}

export async function updatePonuda(id: string, p: Partial<PonudaInput> & { gradiliste_id?: string | null }) {
  await savePonudaWithHistory(id, p);
}

export async function deletePonuda(id: string) {
  const { error } = await supabase.rpc('delete_ponuda_with_history', { p_record_id: id });
  if (error && ['42883', 'PGRST202'].includes(error.code ?? '')) {
    throw new Error('Nedostaje migracija 20261110220000_ponude_povrat_brisanja.sql. Primijenite je prije brisanja i vraćanja ponuda.');
  }
  if (error) throw error;
}

// Stavke se spremaju zamjenom cijelog popisa; redoslijed prati redni broj u ponudi
export async function replacePonudaStavke(ponudaId: string, stavke: PonudaStavkaInput[]) {
  await savePonudaWithHistory(ponudaId, {}, stavke);
}

export async function fetchPonudaChangeHistory(offerId: string, beforeSequence?: string): Promise<PonudaChangeHistory[]> {
  const { data, error } = await supabase.rpc('get_ponuda_change_history', {
    p_record_id: offerId, p_before_sequence: beforeSequence ?? null,
  });
  if (error) throw offerHistoryError(error);
  return (data ?? []) as PonudaChangeHistory[];
}

export async function restorePonudaChange(historyId: string): Promise<void> {
  const { error } = await supabase.rpc('restore_ponuda_change', { p_history_id: historyId });
  if (error) throw offerHistoryError(error);
}
