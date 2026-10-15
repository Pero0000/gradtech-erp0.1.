import { supabase } from './supabase';
import type {
  Gradiliste,
  Investitor,
  InvestitorInput,
  Objekt,
  Radnik,
  Vozilo,
  Raspored,
  Trosak,
  RadnoVrijeme,
  RadniNalog,
  NalogStatus,
  NalogPrioritet,
  TrosakKategorija,
  Rok,
  RokStatus,
  Faktura,
  FakturaStatus,
  UgovoreniRad,
  UgovoreniRadStatus,
} from '@/types';

function throwActionableDbError(error: any, entityName: string) {
  const message = String(error?.message ?? '').toLowerCase();

  if (error?.code === '23503' && entityName === 'investitori') {
    throw new Error('Investitora nije moguće izbrisati dok ima povezane objekte. Prvo uklonite ili premjestite njegove objekte.');
  }

  if (message.includes('no unique or exclusion constraint matching the on conflict specification')) {
    throw new Error('Nedostaje jedinstveni indeks na objektima za investitora i naziv. Pokreni migraciju za indeks objekata u Supabaseu.');
  }

  if (message.includes('does not exist') || message.includes('relation') && message.includes('investitori')) {
    throw new Error(`Tabela "${entityName}" ne postoji u bazi. Pokreni migraciju za ${entityName} u Supabase SQL editoru.`);
  }

  if (message.includes('column') && message.includes('investitori')) {
    throw new Error('Nedostaju proširena polja investitora. Pokreni najnoviju migraciju za investitore u Supabase SQL editoru.');
  }

  throw error;
}

export async function fetchInvestitori(): Promise<Investitor[]> {
  const { data, error } = await supabase
    .from('investitori')
    .select('*')
    .order('naziv', { ascending: true });
  if (error) throwActionableDbError(error, 'investitori');
  return data ?? [];
}

export async function createInvestitor(investitor: InvestitorInput) {
  const { data, error } = await supabase.from('investitori').insert(investitor).select().single();
  if (error) throwActionableDbError(error, 'investitori');
  return data as Investitor;
}

export async function updateInvestitor(id: string, investitor: Partial<InvestitorInput>) {
  const { data, error } = await supabase
    .from('investitori')
    .update({ ...investitor, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throwActionableDbError(error, 'investitori');
  return data as Investitor;
}

export async function deleteInvestitor(id: string) {
  const { data: objekti, error: objektiError } = await supabase
    .from('objekti')
    .select('id')
    .eq('investitor_id', id)
    .limit(1);
  if (objektiError) throwActionableDbError(objektiError, 'objekti');
  if (objekti?.length) {
    throw new Error('Investitora nije moguće izbrisati dok ima povezane objekte. Prvo uklonite ili premjestite njegove objekte.');
  }

  const { error } = await supabase.from('investitori').delete().eq('id', id);
  if (error) throwActionableDbError(error, 'investitori');
}

export async function fetchObjekti(investitorId: string): Promise<Objekt[]> {
  const { data, error } = await supabase
    .from('objekti')
    .select('*')
    .eq('investitor_id', investitorId)
    .order('naziv', { ascending: true });
  if (error) throwActionableDbError(error, 'objekti');
  return data ?? [];
}

export async function fetchAllObjekti(): Promise<Objekt[]> {
  const { data, error } = await supabase
    .from('objekti')
    .select('*, investitori(id, naziv)')
    .order('naziv', { ascending: true });
  if (error) throwActionableDbError(error, 'objekti');
  return data ?? [];
}

export async function createObjekt(objekt: { naziv: string; investitor_id: string }) {
  const { data, error } = await supabase
    .from('objekti')
    .upsert(objekt, { onConflict: 'investitor_id,naziv' })
    .select()
    .single();
  if (error) throwActionableDbError(error, 'objekti');
  return data as Objekt;
}

export async function fetchGradilista(): Promise<Gradiliste[]> {
  const { data, error } = await supabase
    .from('gradilista')
    .select('*, objekti(*, investitori(id, naziv))')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createGradiliste(g: Omit<Gradiliste, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase.from('gradilista').insert(g).select().single();
  if (error) throw error;
  return data;
}

export async function updateGradiliste(id: string, g: Partial<Gradiliste>) {
  const { data, error } = await supabase
    .from('gradilista')
    .update({ ...g, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteGradiliste(id: string) {
  const { error } = await supabase.from('gradilista').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchRadnici(): Promise<Radnik[]> {
  const { data, error } = await supabase
    .from('radnici')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createRadnik(r: Omit<Radnik, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase.from('radnici').insert(r).select().single();
  if (error) throw error;
  return data;
}

export async function updateRadnik(id: string, r: Partial<Radnik>) {
  const { data, error } = await supabase
    .from('radnici')
    .update({ ...r, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRadnik(id: string) {
  const { error } = await supabase.from('radnici').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchVozila(): Promise<Vozilo[]> {
  const { data, error } = await supabase
    .from('vozila')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createVozilo(v: Omit<Vozilo, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase.from('vozila').insert(v).select().single();
  if (error) throw error;
  return data;
}

export async function updateVozilo(id: string, v: Partial<Vozilo>) {
  const { data, error } = await supabase
    .from('vozila')
    .update({ ...v, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteVozilo(id: string) {
  const { error } = await supabase.from('vozila').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchRasporedi(): Promise<Raspored[]> {
  const { data, error } = await supabase
    .from('raspored')
    .select(
      `
      *,
      gradilista:gradiliste_id ( id, naziv, adresa ),
      radnici:raspored_radnici ( radnik:radnik_id ( * ) ),
      vozila:raspored_vozila ( vozilo:vozilo_id ( * ) )
    `,
    )
    .order('datum', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    ...r,
    radnici: (r.radnici ?? []).map((rr: any) => rr.radnik).filter(Boolean),
    vozila: (r.vozila ?? []).map((rv: any) => rv.vozilo).filter(Boolean),
  }));
}

export async function createRaspored(input: {
  datum: string;
  gradiliste_id: string | null;
  napomena: string | null;
  radnik_ids: string[];
  vozilo_ids: string[];
}) {
  const { data, error } = await supabase
    .from('raspored')
    .insert({ datum: input.datum, gradiliste_id: input.gradiliste_id, napomena: input.napomena })
    .select()
    .single();
  if (error) throw error;

  const rasporedId = data.id;

  if (input.radnik_ids.length > 0) {
    const rows = input.radnik_ids.map((rid) => ({ raspored_id: rasporedId, radnik_id: rid }));
    const { error: e2 } = await supabase.from('raspored_radnici').insert(rows);
    if (e2) throw e2;
  }

  if (input.vozilo_ids.length > 0) {
    const rows = input.vozilo_ids.map((vid) => ({ raspored_id: rasporedId, vozilo_id: vid }));
    const { error: e3 } = await supabase.from('raspored_vozila').insert(rows);
    if (e3) throw e3;
  }

  return data;
}

export async function updateRaspored(
  id: string,
  input: {
    datum: string;
    gradiliste_id: string | null;
    napomena: string | null;
    radnik_ids: string[];
    vozilo_ids: string[];
  },
) {
  const { error } = await supabase
    .from('raspored')
    .update({ datum: input.datum, gradiliste_id: input.gradiliste_id, napomena: input.napomena })
    .eq('id', id);
  if (error) throw error;

  await supabase.from('raspored_radnici').delete().eq('raspored_id', id);
  await supabase.from('raspored_vozila').delete().eq('raspored_id', id);

  if (input.radnik_ids.length > 0) {
    const rows = input.radnik_ids.map((rid) => ({ raspored_id: id, radnik_id: rid }));
    const { error: e2 } = await supabase.from('raspored_radnici').insert(rows);
    if (e2) throw e2;
  }

  if (input.vozilo_ids.length > 0) {
    const rows = input.vozilo_ids.map((vid) => ({ raspored_id: id, vozilo_id: vid }));
    const { error: e3 } = await supabase.from('raspored_vozila').insert(rows);
    if (e3) throw e3;
  }
}

export async function deleteRaspored(id: string) {
  const { error } = await supabase.from('raspored').delete().eq('id', id);
  if (error) throw error;
}

// ===== TROŠKOVI =====

export async function fetchTroskovi(): Promise<Trosak[]> {
  const { data, error } = await supabase
    .from('troskovi')
    .select('*, gradilista:gradiliste_id ( id, naziv )')
    .order('datum', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Trosak[];
}

export async function createTrosak(t: {
  gradiliste_id: string | null;
  kategorija: TrosakKategorija;
  opis: string;
  iznos: number;
  datum: string;
}) {
  const { data, error } = await supabase.from('troskovi').insert(t).select().single();
  if (error) throw error;
  return data;
}

export async function updateTrosak(id: string, t: Partial<Trosak>) {
  const { data, error } = await supabase.from('troskovi').update(t).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTrosak(id: string) {
  const { error } = await supabase.from('troskovi').delete().eq('id', id);
  if (error) throw error;
}

// ===== RADNO VRIJEME =====

export async function fetchRadnoVrijeme(): Promise<RadnoVrijeme[]> {
  const { data, error } = await supabase
    .from('radno_vrijeme')
    .select(
      '*, radnici:radnik_id ( id, ime, prezime, uloga, cijena_sata ), gradilista:gradiliste_id ( id, naziv )',
    )
    .order('datum', { ascending: false });
  if (error) throw error;
  return (data ?? []) as RadnoVrijeme[];
}

export async function createRadnoVrijeme(rv: {
  radnik_id: string;
  gradiliste_id: string | null;
  datum: string;
  sati: number;
  napomena: string | null;
}) {
  const { data, error } = await supabase.from('radno_vrijeme').insert(rv).select().single();
  if (error) throw error;
  return data;
}

export async function updateRadnoVrijeme(id: string, rv: Partial<RadnoVrijeme>) {
  const { data, error } = await supabase
    .from('radno_vrijeme')
    .update(rv)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRadnoVrijeme(id: string) {
  const { error } = await supabase.from('radno_vrijeme').delete().eq('id', id);
  if (error) throw error;
}

// ===== RADNI NALOZI =====

export async function fetchRadniNalozi(): Promise<RadniNalog[]> {
  const { data, error } = await supabase
    .from('radni_nalozi')
    .select(
      `
      *,
      gradilista:gradiliste_id ( id, naziv ),
      radnici:radni_nalozi_radnici ( radnik:radnik_id ( * ) )
    `,
    )
    .order('datum_kreiranja', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((n: any) => ({
    ...n,
    radnici: (n.radnici ?? []).map((rr: any) => rr.radnik).filter(Boolean),
  }));
}

export async function generateNalogBroj(): Promise<string> {
  const { data, error } = await supabase
    .from('radni_nalozi')
    .select('broj')
    .order('broj', { ascending: false })
    .limit(1);
  if (error) throw error;

  const year = new Date().getFullYear();
  if (!data || data.length === 0) return `RN-${year}-001`;

  const last = data[0].broj as string;
  const parts = last.split('-');
  const num = parseInt(parts[parts.length - 1]) || 0;
  return `RN-${year}-${String(num + 1).padStart(3, '0')}`;
}

export async function createRadniNalog(input: {
  broj: string;
  gradiliste_id: string | null;
  naslov: string;
  opis: string | null;
  status: NalogStatus;
  prioritet: NalogPrioritet;
  rok: string | null;
  radnik_ids: string[];
}) {
  const { data, error } = await supabase
    .from('radni_nalozi')
    .insert({
      broj: input.broj,
      gradiliste_id: input.gradiliste_id,
      naslov: input.naslov,
      opis: input.opis,
      status: input.status,
      prioritet: input.prioritet,
      rok: input.rok,
    })
    .select()
    .single();
  if (error) throw error;

  if (input.radnik_ids.length > 0) {
    const rows = input.radnik_ids.map((rid) => ({ nalog_id: data.id, radnik_id: rid }));
    const { error: e2 } = await supabase.from('radni_nalozi_radnici').insert(rows);
    if (e2) throw e2;
  }

  return data;
}

export async function updateRadniNalog(
  id: string,
  input: {
    gradiliste_id: string | null;
    naslov: string;
    opis: string | null;
    status: NalogStatus;
    prioritet: NalogPrioritet;
    rok: string | null;
    radnik_ids: string[];
  },
) {
  const { error } = await supabase
    .from('radni_nalozi')
    .update({
      gradiliste_id: input.gradiliste_id,
      naslov: input.naslov,
      opis: input.opis,
      status: input.status,
      prioritet: input.prioritet,
      rok: input.rok,
    })
    .eq('id', id);
  if (error) throw error;

  await supabase.from('radni_nalozi_radnici').delete().eq('nalog_id', id);

  if (input.radnik_ids.length > 0) {
    const rows = input.radnik_ids.map((rid) => ({ nalog_id: id, radnik_id: rid }));
    const { error: e2 } = await supabase.from('radni_nalozi_radnici').insert(rows);
    if (e2) throw e2;
  }
}

export async function deleteRadniNalog(id: string) {
  const { error } = await supabase.from('radni_nalozi').delete().eq('id', id);
  if (error) throw error;
}

// ===== REKAPITULACIJA =====

export async function fetchRekapitulacija(gradilisteId: string) {
  const [troskovi, radnoVrijeme, nalozi] = await Promise.all([
    supabase
      .from('troskovi')
      .select('*')
      .eq('gradiliste_id', gradilisteId)
      .order('datum', { ascending: false }),
    supabase
      .from('radno_vrijeme')
      .select('*, radnici:radnik_id ( id, ime, prezime, uloga, cijena_sata )')
      .eq('gradiliste_id', gradilisteId)
      .order('datum', { ascending: false }),
    supabase
      .from('radni_nalozi')
      .select('id, broj, naslov, status, prioritet, datum_kreiranja, rok')
      .eq('gradiliste_id', gradilisteId)
      .order('datum_kreiranja', { ascending: false }),
  ]);

  if (troskovi.error) throw troskovi.error;
  if (radnoVrijeme.error) throw radnoVrijeme.error;
  if (nalozi.error) throw nalozi.error;

  return {
    troskovi: troskovi.data ?? [],
    radnoVrijeme: radnoVrijeme.data ?? [],
    nalozi: nalozi.data ?? [],
  };
}

// ===== ROKOVI =====

export async function fetchRokovi(gradilisteId?: string): Promise<Rok[]> {
  let q = supabase.from('rokovi').select('*').order('datum', { ascending: true });
  if (gradilisteId) q = q.eq('gradiliste_id', gradilisteId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Rok[];
}

export async function createRok(r: {
  gradiliste_id: string;
  naziv: string;
  datum: string;
  status: RokStatus;
  opis: string | null;
}) {
  const { data, error } = await supabase.from('rokovi').insert(r).select().single();
  if (error) throw error;
  return data;
}

export async function updateRok(id: string, r: Partial<Rok>) {
  const { data, error } = await supabase.from('rokovi').update(r).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteRok(id: string) {
  const { error } = await supabase.from('rokovi').delete().eq('id', id);
  if (error) throw error;
}

// ===== FAKTURE =====

export async function fetchFakture(gradilisteId?: string): Promise<Faktura[]> {
  let q = supabase
    .from('fakture')
    .select('*, gradilista:gradiliste_id ( id, naziv )')
    .order('datum_izdavanja', { ascending: false });
  if (gradilisteId) q = q.eq('gradiliste_id', gradilisteId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Faktura[];
}

export async function createFaktura(f: {
  gradiliste_id: string | null;
  broj: string;
  kupac: string | null;
  iznos: number;
  datum_izdavanja: string;
  datum_dospjecja: string | null;
  status: FakturaStatus;
  opis: string | null;
}) {
  const { data, error } = await supabase.from('fakture').insert(f).select().single();
  if (error) throw error;
  return data;
}

export async function updateFaktura(id: string, f: Partial<Faktura>) {
  const { data, error } = await supabase.from('fakture').update(f).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteFaktura(id: string) {
  const { error } = await supabase.from('fakture').delete().eq('id', id);
  if (error) throw error;
}

// ===== UGOVORENI RADOVI =====

export async function fetchUgovoreniRadovi(gradilisteId?: string): Promise<UgovoreniRad[]> {
  let q = supabase
    .from('ugovoreni_radovi')
    .select('*, gradilista:gradiliste_id ( id, naziv )')
    .order('created_at', { ascending: false });
  if (gradilisteId) q = q.eq('gradiliste_id', gradilisteId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as UgovoreniRad[];
}

export async function createUgovoreniRad(u: {
  gradiliste_id: string | null;
  naziv: string;
  opis: string | null;
  ugovoreni_iznos: number;
  ostvareni_iznos: number;
  status: UgovoreniRadStatus;
}) {
  const { data, error } = await supabase.from('ugovoreni_radovi').insert(u).select().single();
  if (error) throw error;
  return data;
}

export async function updateUgovoreniRad(id: string, u: Partial<UgovoreniRad>) {
  const { data, error } = await supabase.from('ugovoreni_radovi').update(u).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteUgovoreniRad(id: string) {
  const { error } = await supabase.from('ugovoreni_radovi').delete().eq('id', id);
  if (error) throw error;
}

// ===== REKAPITULACIJA (proširena) =====

export async function fetchFullRekapitulacija(gradilisteId: string) {
  const [troskovi, radnoVrijeme, nalozi, rokovi, fakture, ugovoreniRadovi] = await Promise.all([
    supabase
      .from('troskovi')
      .select('*')
      .eq('gradiliste_id', gradilisteId)
      .order('datum', { ascending: false }),
    supabase
      .from('radno_vrijeme')
      .select('*, radnici:radnik_id ( id, ime, prezime, uloga, cijena_sata )')
      .eq('gradiliste_id', gradilisteId)
      .order('datum', { ascending: false }),
    supabase
      .from('radni_nalozi')
      .select('id, broj, naslov, status, prioritet, datum_kreiranja, rok')
      .eq('gradiliste_id', gradilisteId)
      .order('datum_kreiranja', { ascending: false }),
    supabase
      .from('rokovi')
      .select('*')
      .eq('gradiliste_id', gradilisteId)
      .order('datum', { ascending: true }),
    supabase
      .from('fakture')
      .select('*')
      .eq('gradiliste_id', gradilisteId)
      .order('datum_izdavanja', { ascending: false }),
    supabase
      .from('ugovoreni_radovi')
      .select('*')
      .eq('gradiliste_id', gradilisteId)
      .order('created_at', { ascending: false }),
  ]);

  if (troskovi.error) throw troskovi.error;
  if (radnoVrijeme.error) throw radnoVrijeme.error;
  if (nalozi.error) throw nalozi.error;
  if (rokovi.error) throw rokovi.error;
  if (fakture.error) throw fakture.error;
  if (ugovoreniRadovi.error) throw ugovoreniRadovi.error;

  return {
    troskovi: troskovi.data ?? [],
    radnoVrijeme: radnoVrijeme.data ?? [],
    nalozi: nalozi.data ?? [],
    rokovi: rokovi.data ?? [],
    fakture: fakture.data ?? [],
    ugovoreniRadovi: ugovoreniRadovi.data ?? [],
  };
}
