import { supabase } from './supabase';

export interface Stavka {
  id: string;
  sifra: string | null;
  naziv: string;
  vrsta_posla: string | null;
  podgrupa: string | null;
  jedinica: string;
  cijena: number;
  opis: string | null;
  cijena_promijenjena_at: string | null;
  created_at: string;
}

export type StavkaInput = Omit<Stavka, 'id' | 'created_at' | 'cijena_promijenjena_at'>;

export interface StavkaCijenaLog {
  id: string;
  stavka_id: string;
  stara_cijena: number | null;
  nova_cijena: number;
  created_at: string;
}

export interface GradilisteStavka {
  id: string;
  gradiliste_id: string;
  stavka_id: string;
  kolicina: number;
  cijena: number;
  napomena: string | null;
  created_at: string;
  gradilista?: { id: string; naziv: string } | null;
}

function fail(error: { message?: string } | null): never {
  const msg = error?.message ?? 'Greška';
  throw new Error(`${msg} — pokreni migraciju 20261015390000_stavke.sql u Supabaseu.`);
}

export async function fetchStavke(): Promise<Stavka[]> {
  const { data, error } = await supabase.from('stavke').select('*').order('vrsta_posla').order('naziv');
  if (error) fail(error);
  return (data ?? []) as Stavka[];
}

export async function createStavka(s: StavkaInput) {
  const { data, error } = await supabase.from('stavke').insert(s).select().single();
  if (error) fail(error);
  // početna cijena je prvi zapis u povijesti
  await supabase.from('stavke_cijene_log').insert({ stavka_id: (data as Stavka).id, stara_cijena: null, nova_cijena: s.cijena });
  return data as Stavka;
}

// Pri promjeni cijene zapisuje se log stare i nove cijene
export async function updateStavka(id: string, s: StavkaInput, staraCijena: number) {
  const cijenaPromijenjena = Number(staraCijena) !== Number(s.cijena);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('stavke')
    .update({ ...s, updated_at: now, ...(cijenaPromijenjena ? { cijena_promijenjena_at: now } : {}) })
    .eq('id', id);
  if (error) fail(error);
  if (cijenaPromijenjena) {
    const { error: logError } = await supabase.from('stavke_cijene_log').insert({ stavka_id: id, stara_cijena: staraCijena, nova_cijena: s.cijena });
    if (logError) fail(logError);
  }
}

export async function deleteStavka(id: string) {
  const { error } = await supabase.from('stavke').delete().eq('id', id);
  if (error) fail(error);
}

export async function fetchStavkaLog(stavkaId: string): Promise<StavkaCijenaLog[]> {
  const { data, error } = await supabase.from('stavke_cijene_log').select('*').eq('stavka_id', stavkaId).order('created_at', { ascending: false });
  if (error) fail(error);
  return (data ?? []) as StavkaCijenaLog[];
}

export async function fetchStavkaKoristenje(stavkaId: string): Promise<GradilisteStavka[]> {
  const { data, error } = await supabase
    .from('gradiliste_stavke')
    .select('*, gradilista:gradiliste_id ( id, naziv )')
    .eq('stavka_id', stavkaId)
    .order('created_at', { ascending: false });
  if (error) fail(error);
  return (data ?? []) as GradilisteStavka[];
}

export async function addStavkaNaGradiliste(g: { gradiliste_id: string; stavka_id: string; kolicina: number; cijena: number; napomena: string | null }) {
  const { error } = await supabase.from('gradiliste_stavke').insert(g);
  if (error) fail(error);
}

export async function removeStavkaSGradilista(id: string) {
  const { error } = await supabase.from('gradiliste_stavke').delete().eq('id', id);
  if (error) fail(error);
}

export async function fetchStavkeBrojKoristenja(stavke: Stavka[]): Promise<Map<string, number>> {
  const [g, p] = await Promise.all([
    supabase.from('gradiliste_stavke').select('stavka_id'),
    supabase.from('ponude_stavke').select('stavka_id, opis'),
  ]);
  if (g.error) fail(g.error);
  const map = new Map<string, number>();
  const inc = (id: string) => map.set(id, (map.get(id) ?? 0) + 1);
  (g.data ?? []).forEach((r: { stavka_id: string }) => inc(r.stavka_id));
  // ponude su snimka stavki: povezuje se po stavka_id, a ručno upisani retci po nazivu
  if (!p.error) {
    const byNaziv = new Map(stavke.map((s) => [s.naziv.trim().toLowerCase(), s.id]));
    (p.data ?? []).forEach((r: { stavka_id: string | null; opis: string }) => {
      const id = r.stavka_id ?? byNaziv.get(r.opis.trim().toLowerCase());
      if (id) inc(id);
    });
  }
  return map;
}

export interface StavkaPonudaUse {
  id: string;
  kolicina: number;
  cijena: number;
  popust: number;
  jedinica: string;
  ponude?: { id: string; godina: number; redni_broj: number; naslov: string; datum: string; status: string } | null;
}

export async function fetchStavkaPonude(stavka: Stavka): Promise<StavkaPonudaUse[]> {
  const sel = '*, ponude:ponuda_id ( id, godina, redni_broj, naslov, datum, status )';
  const esc = stavka.naziv.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  const [a, b] = await Promise.all([
    supabase.from('ponude_stavke').select(sel).eq('stavka_id', stavka.id),
    supabase.from('ponude_stavke').select(sel).is('stavka_id', null).ilike('opis', esc),
  ]);
  if (a.error) fail(a.error);
  const all = [...(a.data ?? []), ...(b.data ?? [])] as StavkaPonudaUse[];
  return all.sort((x, y) => (y.ponude?.datum ?? '').localeCompare(x.ponude?.datum ?? ''));
}
