import { supabase } from './supabase';
import type {
  VoziloDokument,
  VoziloDokumentVrsta,
  RadnikDokument,
  RadnikDokumentVrsta,
  DnevniRasporedGradiliste,
  GradilisteZadatak,
  DnevniRasporedOstalo,
  DnevniRasporedRadnik,
  Gradiliste,
  Investitor,
  InvestitorInput,
  Objekt,
  ObjektInput,
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

export async function saveObjekt(id: string | null, objekt: ObjektInput) {
  const query = id
    ? supabase.from('objekti').update({ ...objekt, updated_at: new Date().toISOString() }).eq('id', id)
    : supabase.from('objekti').insert(objekt);
  const { data, error } = await query.select('*, investitori(id, naziv)').single();
  if (error) {
    if (error.code === '23505') throw new Error('Objekt s tim nazivom već postoji kod odabranog investitora.');
    if (String(error.message).toLowerCase().includes('column')) {
      throw new Error('Nedostaju proširena polja objekata. Pokreni najnoviju migraciju za objekte u Supabase SQL editoru.');
    }
    throwActionableDbError(error, 'objekti');
  }
  return data as Objekt;
}

export async function deleteObjekt(id: string) {
  const { data: sites, error: sitesError } = await supabase.from('gradilista').select('id').eq('objekt_id', id).limit(1);
  if (sitesError) throwActionableDbError(sitesError, 'gradilista');
  if (sites?.length) {
    throw new Error('Objekt nije moguće izbrisati dok ima povezana gradilišta.');
  }
  const { error } = await supabase.from('objekti').delete().eq('id', id);
  if (error) throwActionableDbError(error, 'objekti');
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

export async function fetchRadnikDokumenti(radnikId: string): Promise<RadnikDokument[]> {
  const { data, error } = await supabase.from('radnici_dokumenti').select('*').eq('radnik_id', radnikId).order('datum_do', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((d: any) => ({
    ...d,
    url: d.putanja ? supabase.storage.from('nalozi-foto').getPublicUrl(d.putanja).data.publicUrl : null,
  }));
}

export async function addRadnikDokument(
  radnikId: string,
  input: { vrsta: RadnikDokumentVrsta; naziv: string; datum_od: string | null; datum_do: string | null; napomena: string | null },
  file: File | null,
) {
  let putanja: string | null = null;
  if (file) {
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    putanja = `radnici/${radnikId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const { error: upError } = await supabase.storage.from('nalozi-foto').upload(putanja, file, { contentType: file.type || undefined });
    if (upError) throw upError;
  }
  const { error } = await supabase.from('radnici_dokumenti').insert({ radnik_id: radnikId, ...input, putanja });
  if (error) {
    if (putanja) await supabase.storage.from('nalozi-foto').remove([putanja]);
    throw error;
  }
}

export async function updateRadnikDokumentRok(id: string, u: { datum_od: string | null; datum_do: string | null }) {
  const { error } = await supabase.from('radnici_dokumenti').update(u).eq('id', id);
  if (error) throw error;
}

export async function deleteRadnikDokument(d: RadnikDokument) {
  const { error } = await supabase.from('radnici_dokumenti').delete().eq('id', d.id);
  if (error) throw error;
  if (d.putanja) await supabase.storage.from('nalozi-foto').remove([d.putanja]);
}

export async function fetchVoziloDokumenti(voziloId: string): Promise<VoziloDokument[]> {
  const { data, error } = await supabase.from('vozila_dokumenti').select('*').eq('vozilo_id', voziloId).order('datum_do', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((d: any) => ({
    ...d,
    url: d.putanja ? supabase.storage.from('nalozi-foto').getPublicUrl(d.putanja).data.publicUrl : null,
  }));
}

export async function addVoziloDokument(
  voziloId: string,
  input: { vrsta: VoziloDokumentVrsta; naziv: string; datum_od: string | null; datum_do: string | null; iznos: number | null; km: number | null; napomena: string | null },
  file: File | null,
) {
  let putanja: string | null = null;
  if (file) {
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    putanja = `vozila/${voziloId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const { error: upError } = await supabase.storage.from('nalozi-foto').upload(putanja, file, { contentType: file.type || undefined });
    if (upError) throw upError;
  }
  const { error } = await supabase.from('vozila_dokumenti').insert({ vozilo_id: voziloId, ...input, putanja });
  if (error) {
    if (putanja) await supabase.storage.from('nalozi-foto').remove([putanja]);
    throw error;
  }
}

export async function deleteVoziloDokument(d: VoziloDokument) {
  const { error } = await supabase.from('vozila_dokumenti').delete().eq('id', d.id);
  if (error) throw error;
  if (d.putanja) await supabase.storage.from('nalozi-foto').remove([d.putanja]);
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

// ===== DNEVNI RASPORED (po vozilima) =====

export async function fetchDnevniRaspored(datum: string) {
  const [sites, workers] = await Promise.all([
    supabase.from('dnevni_raspored_gradilista').select('*').eq('datum', datum).order('created_at'),
    supabase.from('dnevni_raspored_radnici').select('*').eq('datum', datum).order('created_at'),
  ]);
  if (sites.error) throw dnevniRasporedError(sites.error);
  if (workers.error) throw dnevniRasporedError(workers.error);
  return {
    gradilista: (sites.data ?? []) as DnevniRasporedGradiliste[],
    radnici: (workers.data ?? []) as DnevniRasporedRadnik[],
  };
}

function dnevniRasporedError(error: any) {
  if (String(error?.message ?? '').toLowerCase().includes('dnevni_raspored')) {
    return new Error('Tablice dnevnog rasporeda ne postoje. Pokreni najnoviju migraciju (dnevni raspored) u Supabase SQL editoru.');
  }
  return error;
}

export async function assignRasporedGradiliste(datum: string, voziloId: string, gradilisteId: string) {
  const { error } = await supabase
    .from('dnevni_raspored_gradilista')
    .upsert({ datum, vozilo_id: voziloId, gradiliste_id: gradilisteId }, { onConflict: 'datum,vozilo_id,gradiliste_id', ignoreDuplicates: true });
  if (error) throw dnevniRasporedError(error);
}

export async function addRasporedTekst(datum: string, voziloId: string, tekst: string) {
  const { error } = await supabase.from('dnevni_raspored_gradilista').insert({ datum, vozilo_id: voziloId, tekst });
  if (error) throw dnevniRasporedError(error);
}

export async function updateRasporedTekst(id: string, tekst: string) {
  const { error } = await supabase.from('dnevni_raspored_gradilista').update({ tekst }).eq('id', id);
  if (error) throw dnevniRasporedError(error);
}

export async function moveRasporedGradiliste(id: string, voziloId: string) {
  const { error } = await supabase.from('dnevni_raspored_gradilista').update({ vozilo_id: voziloId }).eq('id', id);
  if (error) throw dnevniRasporedError(error);
}

export async function updateRasporedVrijemeVozila(datum: string, voziloId: string, vrijeme: string) {
  const { error } = await supabase.from('dnevni_raspored_gradilista').update({ vrijeme }).eq('datum', datum).eq('vozilo_id', voziloId);
  if (error) throw dnevniRasporedError(error);
}

export async function removeRasporedGradiliste(id: string) {
  const { error } = await supabase.from('dnevni_raspored_gradilista').delete().eq('id', id);
  if (error) throw dnevniRasporedError(error);
}

export async function fetchRasporedOstalo(datum: string) {
  const { data, error } = await supabase.from('dnevni_raspored_ostalo').select('*').eq('datum', datum).order('created_at');
  if (error) throw ostaloError(error);
  return (data ?? []) as DnevniRasporedOstalo[];
}

function ostaloError(error: { message?: string }) {
  if (String(error?.message ?? '').toLowerCase().includes('dnevni_raspored_ostalo')) {
    return new Error('Tablica OSTALO ne postoji. Pokreni migraciju 20261015150000_create_dnevni_raspored_ostalo.sql u Supabase SQL editoru.');
  }
  return error;
}

export async function addRasporedOstalo(datum: string, entry: { tekst?: string; radnikId?: string }) {
  const { error } = await supabase
    .from('dnevni_raspored_ostalo')
    .insert({ datum, tekst: entry.tekst ?? null, radnik_id: entry.radnikId ?? null });
  if (error) throw ostaloError(error);
}

export async function updateRasporedOstaloTekst(id: string, tekst: string) {
  const { error } = await supabase.from('dnevni_raspored_ostalo').update({ tekst }).eq('id', id);
  if (error) throw ostaloError(error);
}

export async function removeRasporedOstalo(id: string) {
  const { error } = await supabase.from('dnevni_raspored_ostalo').delete().eq('id', id);
  if (error) throw ostaloError(error);
}

export async function assignRasporedRadnik(datum: string, voziloId: string, radnikId: string) {
  const { error } = await supabase
    .from('dnevni_raspored_radnici')
    .upsert({ datum, vozilo_id: voziloId, radnik_id: radnikId }, { onConflict: 'datum,vozilo_id,radnik_id', ignoreDuplicates: true });
  if (error) throw dnevniRasporedError(error);
}

export async function moveRasporedRadnik(id: string, voziloId: string) {
  const { error } = await supabase.from('dnevni_raspored_radnici').update({ vozilo_id: voziloId }).eq('id', id);
  if (error?.code === '23505') {
    await removeRasporedRadnik(id);
    return;
  }
  if (error) throw dnevniRasporedError(error);
}

export async function removeRasporedRadnik(id: string) {
  const { error } = await supabase.from('dnevni_raspored_radnici').delete().eq('id', id);
  if (error) throw dnevniRasporedError(error);
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
  zakljucen?: boolean;
}) {
  const { data, error } = await supabase
    .from('radni_nalozi')
    .insert({
      zakljucen_at: input.zakljucen ? new Date().toISOString() : null,
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

  // Materijal i alat upisan na gradilištu ulazi u prvi idući nalog tog gradilišta.
  if (input.gradiliste_id) {
    await supabase
      .from('radni_nalozi_stavke')
      .update({ nalog_id: data.id })
      .eq('gradiliste_id', input.gradiliste_id)
      .is('nalog_id', null);
  }
  await prenesiOtvoreneStavke(data.id, input.gradiliste_id);
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
    zakljucen?: boolean;
  },
) {
  const { error } = await supabase
    .from('radni_nalozi')
    .update({
      ...(input.zakljucen === undefined ? {} : { zakljucen_at: input.zakljucen ? new Date().toISOString() : null }),
      gradiliste_id: input.gradiliste_id,
      naslov: input.naslov,
      opis: input.opis,
      status: input.status,
      prioritet: input.prioritet,
      rok: input.rok,
    })
    .eq('id', id);
  if (error) throw error;

  const { data: existing, error: selError } = await supabase.from('radni_nalozi_radnici').select('radnik_id').eq('nalog_id', id);
  if (selError) throw selError;
  const existingIds = (existing ?? []).map((r: { radnik_id: string }) => r.radnik_id);

  const toRemove = existingIds.filter((rid) => !input.radnik_ids.includes(rid));
  for (const rid of toRemove) {
    const { error: delError } = await supabase.from('radni_nalozi_radnici').delete().eq('nalog_id', id).eq('radnik_id', rid);
    if (delError) throw delError;
  }

  const toAdd = input.radnik_ids.filter((rid) => !existingIds.includes(rid));
  if (toAdd.length > 0) {
    const rows = toAdd.map((rid) => ({ nalog_id: id, radnik_id: rid }));
    const { error: e2 } = await supabase.from('radni_nalozi_radnici').insert(rows);
    if (e2) throw e2;
  }

  await syncNalogTroskovi(id);
}

const toMinutes = (t: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

// Završen nalog upisuje sate radnika i kilometre vozila u troškove gradilišta; inače se upisi uklanjaju.
export async function syncNalogTroskovi(nalogId: string) {
  const { data: nalog, error } = await supabase
    .from('radni_nalozi')
    .select('id, broj, status, teren, gradiliste_id, rok, datum_kreiranja, km_pocetak, km_kraj')
    .eq('id', nalogId)
    .single();
  if (error) throw error;

  const { data: dan } = await supabase
    .from('dnevni_raspored_gradilista')
    .select('datum, vozilo_id')
    .eq('nalog_id', nalogId)
    .limit(1);
  const datum = (dan?.[0]?.datum ?? nalog.rok ?? String(nalog.datum_kreiranja).slice(0, 10)) as string;

  const clean = async () => {
    await supabase.from('radno_vrijeme').delete().eq('nalog_id', nalogId);
    await supabase.from('troskovi').delete().eq('nalog_id', nalogId);
  };

  if (nalog.status !== 'zavrsen') {
    await clean().catch(() => undefined);
    await syncKmGrupa(datum, dan?.[0]?.vozilo_id as string | undefined, nalogId).catch(() => undefined);
    return;
  }

  // Zadaci označeni kao riješeni na nalogu ostaju riješeni i u pregledu gradilišta (uključujući rokove).
  try {
    const { data: gotovi } = await supabase.from('gradiliste_zadaci').select('*').eq('nalog_id', nalogId).eq('gotovo', true);
    for (const z of (gotovi ?? []) as GradilisteZadatak[]) {
      if (!z.gotovo_at) await supabase.from('gradiliste_zadaci').update({ gotovo_at: new Date().toISOString() }).eq('id', z.id);
      await syncZadatakRok(z);
    }
  } catch {
    // greška u rokovima ne smije spriječiti obračun troška
  }

  // Nezavršeni zadaci vraćaju se gradilištu pa se pojavljuju na idućem nalogu.
  await supabase.from('gradiliste_zadaci').update({ nalog_id: null }).eq('nalog_id', nalogId).eq('gotovo', false);

  await clean();

  const { data: radnici, error: rError } = await supabase
    .from('radni_nalozi_radnici')
    .select('radnik_id, vrijeme_od, vrijeme_do, radnik:radnik_id ( ime, prezime, cijena_sata, nocni_dodatak, teren_dnevnica )')
    .eq('nalog_id', nalogId);
  if (rError) throw rError;

  type RR = {
    radnik_id: string;
    vrijeme_od: string | null;
    vrijeme_do: string | null;
    radnik: { ime: string; prezime: string; cijena_sata: number; nocni_dodatak: number | null; teren_dnevnica: number | null } | null;
  };
  const sati: { radnik_id: string; gradiliste_id: string | null; datum: string; sati: number; napomena: string; nalog_id: string }[] = [];
  const dodatni: { gradiliste_id: string | null; kategorija: 'place'; opis: string; iznos: number; datum: string; nalog_id: string }[] = [];
  const round2 = (n: number) => Math.round(n * 100) / 100;

  for (const r of (radnici ?? []) as unknown as RR[]) {
    const ime = r.radnik ? `${r.radnik.ime} ${r.radnik.prezime}` : 'Radnik';
    const od = toMinutes(r.vrijeme_od);
    const doo = toMinutes(r.vrijeme_do);
    if (od !== null && doo !== null) {
      const diff = doo >= od ? doo - od : doo + 1440 - od;
      let nocne = 0;
      for (let m = od; m < od + diff; m++) {
        const t = m % 1440;
        if (t >= 1320 || t < 360) nocne++;
      }
      if (diff > 0) {
        sati.push({
          radnik_id: r.radnik_id,
          gradiliste_id: nalog.gradiliste_id,
          datum,
          sati: round2(diff / 60),
          napomena: nocne > 0 ? `Noćni rad ${round2(nocne / 60)} h` : null,
          nalog_id: nalogId,
        });
        const dodatak = Number(r.radnik?.nocni_dodatak ?? 0);
        const satnica = Number(r.radnik?.cijena_sata ?? 0);
        if (nocne > 0 && dodatak > 0 && satnica > 0) {
          dodatni.push({
            gradiliste_id: nalog.gradiliste_id,
            kategorija: 'place',
            opis: `Noćni rad: ${ime} ${round2(nocne / 60)} h × ${dodatak}%`,
            iznos: round2((nocne / 60) * satnica * (dodatak / 100)),
            datum,
            nalog_id: nalogId,
          });
        }
      }
    }
    const dnevnica = Number(r.radnik?.teren_dnevnica ?? 0);
    if (nalog.teren && dnevnica > 0) {
      dodatni.push({
        gradiliste_id: nalog.gradiliste_id,
        kategorija: 'place',
        opis: `Teren: ${ime}`,
        iznos: round2(dnevnica),
        datum,
        nalog_id: nalogId,
      });
    }
  }
  if (sati.length > 0) {
    const { error: e } = await supabase.from('radno_vrijeme').insert(sati);
    if (e) throw e;
  }
  if (dodatni.length > 0) {
    const { error: e } = await supabase.from('troskovi').insert(dodatni);
    if (e) throw e;
  }

  await syncKmGrupa(datum, dan?.[0]?.vozilo_id as string | undefined, nalogId);
}

// Kilometri jednog auta u danu: ostala gradilišta obračunavaju se za sebe (kraj − početak svog naloga),
// a cijela preostala razlika (ukupno prijeđeno − km ostalih) pripada prvom nalogu, tj. gradilištu 1.
async function syncKmGrupa(datum: string, voziloId: string | undefined, nalogId: string) {
  if (!voziloId) return;
  const { data: veze } = await supabase
    .from('dnevni_raspored_gradilista')
    .select('nalog_id')
    .eq('datum', datum)
    .eq('vozilo_id', voziloId)
    .not('nalog_id', 'is', null);
  const ids = [...new Set([nalogId, ...(veze ?? []).map((v: { nalog_id: string }) => v.nalog_id)])];
  if (ids.length === 0) return;

  await supabase.from('troskovi').delete().in('nalog_id', ids).eq('kategorija', 'put');

  const { data: nalozi } = await supabase
    .from('radni_nalozi')
    .select('id, broj, gradiliste_id, km_pocetak, km_kraj')
    .in('id', ids)
    .eq('status', 'zavrsen')
    .not('km_pocetak', 'is', null)
    .not('km_kraj', 'is', null)
    .order('broj');
  type N = { id: string; broj: string; gradiliste_id: string | null; km_pocetak: number; km_kraj: number };
  const lista = (nalozi ?? []) as N[];
  if (lista.length === 0) return;

  const { data: v } = await supabase.from('vozila').select('registracija, cijena_km').eq('id', voziloId).single();
  const cijena = Number(v?.cijena_km ?? 0);
  if (cijena <= 0) return;

  const ukupno = Math.max(...lista.map((n) => n.km_kraj)) - Math.min(...lista.map((n) => n.km_pocetak));
  const [glavni, ...ostali] = lista;
  const kmOstali = ostali.map((n) => Math.max(0, n.km_kraj - n.km_pocetak));
  const kmGlavni = Math.max(0, ukupno - kmOstali.reduce((s, k) => s + k, 0));

  const rows = [
    { n: glavni, km: kmGlavni },
    ...ostali.map((n, i) => ({ n, km: kmOstali[i] })),
  ]
    .filter((r) => r.km > 0)
    .map((r) => ({
      gradiliste_id: r.n.gradiliste_id,
      kategorija: 'put' as const,
      opis: `Kilometri: ${v?.registracija ?? ''} ${r.km} km × ${cijena} €/km`,
      iznos: Math.round(r.km * cijena * 100) / 100,
      datum,
      nalog_id: r.n.id,
    }));
  if (rows.length > 0) {
    const { error } = await supabase.from('troskovi').insert(rows);
    if (error) throw error;
  }
}

// Neriješen materijal i alat s ranijih naloga (otvorenih ili završenih) istog gradilišta prenosi se na novi nalog.
export async function prenesiOtvoreneStavke(nalogId: string, gradilisteId: string | null) {
  if (!gradilisteId) return;
  const { data: stari } = await supabase
    .from('radni_nalozi')
    .select('id')
    .eq('gradiliste_id', gradilisteId)
    .neq('status', 'otkazan')
    .neq('id', nalogId);
  const ids = (stari ?? []).map((n: { id: string }) => n.id);
  if (ids.length === 0) return;
  const { data: stavke, error } = await supabase
    .from('radni_nalozi_stavke')
    .select('id, tip, naziv')
    .in('nalog_id', ids)
    .eq('gotovo', false)
    .eq('preneseno', false);
  if (error || !stavke || stavke.length === 0) return;
  const { error: insError } = await supabase
    .from('radni_nalozi_stavke')
    .insert(stavke.map((s: { id: string; tip: string; naziv: string }) => ({ nalog_id: nalogId, tip: s.tip, naziv: s.naziv, izvor_id: s.id })));
  if (insError) return;
  await supabase.from('radni_nalozi_stavke').update({ preneseno: true }).in('id', stavke.map((s: { id: string }) => s.id));
}

async function vratiPrenesenoStavke(nalogId: string) {
  // Neriješene stavke koje nisu preneseno s drugog naloga vraćaju se gradilištu umjesto da se brišu s nalogom.
  await supabase
    .from('radni_nalozi_stavke')
    .update({ nalog_id: null })
    .eq('nalog_id', nalogId)
    .eq('gotovo', false)
    .is('izvor_id', null)
    .not('gradiliste_id', 'is', null);
  const { data } = await supabase.from('radni_nalozi_stavke').select('izvor_id').eq('nalog_id', nalogId).not('izvor_id', 'is', null);
  const izvori = (data ?? []).map((s: { izvor_id: string }) => s.izvor_id);
  if (izvori.length > 0) await supabase.from('radni_nalozi_stavke').update({ preneseno: false }).in('id', izvori);
}

export async function fetchNalogIzvrsenje(nalogId: string) {
  const { data, error } = await supabase
    .from('radni_nalozi')
    .select('km_pocetak, km_kraj, napomena, status, teren, poslovodja_id')
    .eq('id', nalogId)
    .single();
  if (error) throw error;
  return data as { km_pocetak: number | null; km_kraj: number | null; napomena: string | null; status: NalogStatus; teren: boolean | null; poslovodja_id: string | null };
}

export async function setNalogPoslovodja(nalogId: string, radnikId: string | null) {
  const { error } = await supabase.from('radni_nalozi').update({ poslovodja_id: radnikId }).eq('id', nalogId);
  if (error) throw error;
}

export async function setNalogTeren(nalogId: string, teren: boolean) {
  const { error } = await supabase.from('radni_nalozi').update({ teren }).eq('id', nalogId);
  if (error) throw error;
  await syncNalogTroskovi(nalogId);
}

export async function setNalogZavrsen(nalogId: string, zavrsen: boolean) {
  const { error } = await supabase.from('radni_nalozi').update({ status: zavrsen ? 'zavrsen' : 'u_tijeku' }).eq('id', nalogId);
  if (error) throw error;
  await syncNalogTroskovi(nalogId);
}

export async function saveNalogIzvrsenje(
  nalogId: string,
  u: { km_pocetak: number | null; km_kraj: number | null; napomena: string | null },
) {
  const { error } = await supabase.from('radni_nalozi').update(u).eq('id', nalogId);
  if (error) throw error;
  await syncNalogTroskovi(nalogId);
}

export interface NalogRadnikVrijeme {
  radnik_id: string;
  vrijeme_od: string | null;
  vrijeme_do: string | null;
  radnik: Pick<Radnik, 'id' | 'ime' | 'prezime'> | null;
}

export async function fetchNalogRadnikVrijeme(nalogId: string): Promise<NalogRadnikVrijeme[]> {
  const { data, error } = await supabase
    .from('radni_nalozi_radnici')
    .select('radnik_id, vrijeme_od, vrijeme_do, radnik:radnik_id ( id, ime, prezime )')
    .eq('nalog_id', nalogId);
  if (error) throw error;
  return (data ?? []) as unknown as NalogRadnikVrijeme[];
}

export async function saveNalogRadnikVrijeme(nalogId: string, radnikId: string, od: string | null, doo: string | null) {
  const { error } = await supabase
    .from('radni_nalozi_radnici')
    .update({ vrijeme_od: od || null, vrijeme_do: doo || null })
    .eq('nalog_id', nalogId)
    .eq('radnik_id', radnikId);
  if (error) throw error;
  await syncNalogTroskovi(nalogId);
}

export async function fetchNalogZadaci(nalogId: string): Promise<GradilisteZadatak[]> {
  const { data, error } = await supabase.from('gradiliste_zadaci').select('*').eq('nalog_id', nalogId).order('created_at');
  if (error) throw error;
  return (data ?? []) as GradilisteZadatak[];
}

export async function addNalogZadatak(nalogId: string, gradilisteId: string, naziv: string) {
  const created = await createGradilisteZadatak(gradilisteId, naziv);
  const { error } = await supabase.from('gradiliste_zadaci').update({ nalog_id: nalogId }).eq('id', created.id);
  if (error) throw error;
}

export interface NalogFoto {
  id: string;
  nalog_id: string;
  putanja: string;
  naziv: string | null;
  url: string;
}

export async function fetchNalogFoto(nalogId: string): Promise<NalogFoto[]> {
  const { data, error } = await supabase.from('radni_nalozi_foto').select('*').eq('nalog_id', nalogId).order('created_at');
  if (error) throw error;
  return (data ?? []).map((f: any) => ({
    ...f,
    url: supabase.storage.from('nalozi-foto').getPublicUrl(f.putanja).data.publicUrl,
  }));
}

async function spremiNaGradiliste(nalogId: string, putanja: string, naziv: string, velicina: number | null, vrsta: 'dokument' | 'slika') {
  try {
    const { data } = await supabase.from('radni_nalozi').select('gradiliste_id').eq('id', nalogId).single();
    if (!data?.gradiliste_id) return;
    await supabase.from('gradiliste_dokumenti').insert({ gradiliste_id: data.gradiliste_id, vrsta, putanja, naziv, velicina });
  } catch {
    // kopiranje na gradilište ne smije srušiti upload na nalog
  }
}

async function datotekaJosKoristena(putanja: string) {
  const [g, d, f] = await Promise.all([
    supabase.from('gradiliste_dokumenti').select('id', { count: 'exact', head: true }).eq('putanja', putanja),
    supabase.from('radni_nalozi_dokumenti').select('id', { count: 'exact', head: true }).eq('putanja', putanja),
    supabase.from('radni_nalozi_foto').select('id', { count: 'exact', head: true }).eq('putanja', putanja),
  ]);
  return (g.count ?? 0) + (d.count ?? 0) + (f.count ?? 0) > 0;
}

export async function uploadNalogFoto(nalogId: string, file: File) {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
  const putanja = `${nalogId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upError } = await supabase.storage.from('nalozi-foto').upload(putanja, file, { contentType: file.type });
  if (upError) throw upError;
  const { error } = await supabase.from('radni_nalozi_foto').insert({ nalog_id: nalogId, putanja, naziv: file.name });
  if (error) {
    await supabase.storage.from('nalozi-foto').remove([putanja]);
    throw error;
  }
  await spremiNaGradiliste(nalogId, putanja, file.name, file.size, 'slika');
}

export async function deleteNalogFoto(foto: NalogFoto) {
  const { error } = await supabase.from('radni_nalozi_foto').delete().eq('id', foto.id);
  if (error) throw error;
  if (!(await datotekaJosKoristena(foto.putanja))) await supabase.storage.from('nalozi-foto').remove([foto.putanja]);
}

export interface NalogStavka {
  id: string;
  nalog_id: string;
  tip: 'materijal' | 'alat';
  naziv: string;
  gotovo: boolean;
}

export async function fetchNalogStavke(nalogId: string): Promise<NalogStavka[]> {
  const { data, error } = await supabase.from('radni_nalozi_stavke').select('*').eq('nalog_id', nalogId).eq('preneseno', false).order('created_at');
  if (error) throw error;
  return (data ?? []) as NalogStavka[];
}

export async function addNalogStavka(nalogId: string, tip: 'materijal' | 'alat', naziv: string) {
  const { error } = await supabase.from('radni_nalozi_stavke').insert({ nalog_id: nalogId, tip, naziv });
  if (error) throw error;
}

export async function updateNalogStavka(id: string, u: { gotovo?: boolean; naziv?: string }) {
  const { error } = await supabase.from('radni_nalozi_stavke').update(u).eq('id', id);
  if (error) throw error;
}

export async function deleteNalogStavka(id: string) {
  const { error } = await supabase.from('radni_nalozi_stavke').delete().eq('id', id);
  if (error) throw error;
}

export interface NalogDokument {
  id: string;
  nalog_id: string;
  putanja: string;
  naziv: string;
  velicina: number | null;
  url: string;
}

export async function fetchNalogDokumenti(nalogId: string): Promise<NalogDokument[]> {
  const { data, error } = await supabase.from('radni_nalozi_dokumenti').select('*').eq('nalog_id', nalogId).order('created_at');
  if (error) throw error;
  return (data ?? []).map((d: any) => ({
    ...d,
    url: supabase.storage.from('nalozi-foto').getPublicUrl(d.putanja).data.publicUrl,
  }));
}

export async function uploadNalogDokument(nalogId: string, file: File) {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
  const putanja = `${nalogId}/dokumenti/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
  const { error: upError } = await supabase.storage.from('nalozi-foto').upload(putanja, file, { contentType: file.type || undefined });
  if (upError) throw upError;
  const { error } = await supabase.from('radni_nalozi_dokumenti').insert({ nalog_id: nalogId, putanja, naziv: file.name, velicina: file.size });
  if (error) {
    await supabase.storage.from('nalozi-foto').remove([putanja]);
    throw error;
  }
  await spremiNaGradiliste(nalogId, putanja, file.name, file.size, 'dokument');
}

export async function deleteNalogDokument(d: NalogDokument) {
  const { error } = await supabase.from('radni_nalozi_dokumenti').delete().eq('id', d.id);
  if (error) throw error;
  if (!(await datotekaJosKoristena(d.putanja))) await supabase.storage.from('nalozi-foto').remove([d.putanja]);
}

export async function fetchNalogGradilisteDokumentIds(nalogId: string): Promise<string[]> {
  const { data, error } = await supabase.from('nalog_gradiliste_dokumenti').select('dokument_id').eq('nalog_id', nalogId);
  if (error) throw error;
  return (data ?? []).map((r: { dokument_id: string }) => r.dokument_id);
}

export async function setNalogGradilisteDokument(nalogId: string, dokumentId: string, on: boolean) {
  const { error } = on
    ? await supabase.from('nalog_gradiliste_dokumenti').upsert({ nalog_id: nalogId, dokument_id: dokumentId })
    : await supabase.from('nalog_gradiliste_dokumenti').delete().eq('nalog_id', nalogId).eq('dokument_id', dokumentId);
  if (error) throw error;
}

// ===== MATERIJAL, ALAT I DOKUMENTI GRADILIŠTA =====

export interface GradilisteStavka {
  id: string;
  nalog_id: string | null;
  gradiliste_id: string;
  tip: 'materijal' | 'alat';
  naziv: string;
  gotovo: boolean;
}

export async function fetchGradilisteStavke(gradilisteId: string): Promise<GradilisteStavka[]> {
  const { data, error } = await supabase.from('radni_nalozi_stavke').select('*').eq('gradiliste_id', gradilisteId).eq('preneseno', false).order('created_at');
  if (error) throw error;
  return (data ?? []) as GradilisteStavka[];
}

export async function addGradilisteStavka(gradilisteId: string, tip: 'materijal' | 'alat', naziv: string) {
  const { error } = await supabase.from('radni_nalozi_stavke').insert({ gradiliste_id: gradilisteId, nalog_id: null, tip, naziv });
  if (error) throw error;
}

export interface GradilisteDokument {
  id: string;
  gradiliste_id: string;
  vrsta: 'dokument' | 'slika';
  putanja: string;
  naziv: string;
  velicina: number | null;
  url: string;
}

export async function fetchGradilisteDokumenti(gradilisteId: string): Promise<GradilisteDokument[]> {
  const { data, error } = await supabase.from('gradiliste_dokumenti').select('*').eq('gradiliste_id', gradilisteId).order('created_at');
  if (error) throw error;
  return (data ?? []).map((d: any) => ({
    ...d,
    url: supabase.storage.from('nalozi-foto').getPublicUrl(d.putanja).data.publicUrl,
  }));
}

export async function uploadGradilisteDokument(gradilisteId: string, file: File, vrsta: 'dokument' | 'slika') {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
  const putanja = `gradiliste/${gradilisteId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
  const { error: upError } = await supabase.storage.from('nalozi-foto').upload(putanja, file, { contentType: file.type || undefined });
  if (upError) throw upError;
  const { error } = await supabase.from('gradiliste_dokumenti').insert({ gradiliste_id: gradilisteId, vrsta, putanja, naziv: file.name, velicina: file.size });
  if (error) {
    await supabase.storage.from('nalozi-foto').remove([putanja]);
    throw error;
  }
}

export async function deleteGradilisteDokument(d: GradilisteDokument) {
  const { error } = await supabase.from('gradiliste_dokumenti').delete().eq('id', d.id);
  if (error) throw error;
  if (!(await datotekaJosKoristena(d.putanja))) await supabase.storage.from('nalozi-foto').remove([d.putanja]);
}

export async function fetchZakljuceniNalozi(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from('radni_nalozi').select('id').in('id', ids).not('zakljucen_at', 'is', null);
  if (error) throw error;
  return (data ?? []).map((n) => n.id as string);
}

export async function discardRasporedNalog(nalogId: string) {
  await vratiPrenesenoStavke(nalogId);
  const { error } = await supabase.from('dnevni_raspored_gradilista').update({ nalog_id: null }).eq('nalog_id', nalogId);
  if (error) throw new Error(`Brisanje veze: ${error.message}`);
  const { error: linkError } = await supabase.from('radni_nalozi_radnici').delete().eq('nalog_id', nalogId);
  if (linkError) throw new Error(`Brisanje radnika naloga: ${linkError.message}`);
  const { error: delError } = await supabase.from('radni_nalozi').delete().eq('id', nalogId);
  if (delError) throw new Error(`Brisanje naloga: ${delError.message}`);
}

export async function createNalogFromRaspored(
  assignmentId: string,
  input: {
    broj: string;
    gradiliste_id: string | null;
    naslov: string;
    opis: string | null;
    status: NalogStatus;
    prioritet: NalogPrioritet;
    rok: string | null;
    radnik_ids: string[];
    zakljucen?: boolean;
  },
) {
  const nalog = await createRadniNalog(input);
  const { error } = await supabase.from('dnevni_raspored_gradilista').update({ nalog_id: nalog.id }).eq('id', assignmentId);
  if (error) {
    await supabase.from('radni_nalozi').delete().eq('id', nalog.id);
    if (String(error.message ?? '').includes('nalog_id')) {
      throw new Error('Pokreni migraciju 20261015160000_raspored_nalog_veza.sql u Supabase SQL editoru.');
    }
    throw error;
  }
  return nalog;
}

export async function deleteRadniNalog(id: string) {
  await vratiPrenesenoStavke(id);
  await supabase.from('radni_nalozi_radnici').delete().eq('nalog_id', id);
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

// ===== ZADACI GRADILIŠTA =====

export async function fetchGradilisteZadaci(gradilisteId: string): Promise<GradilisteZadatak[]> {
  const { data, error } = await supabase
    .from('gradiliste_zadaci')
    .select('*')
    .eq('gradiliste_id', gradilisteId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as GradilisteZadatak[];
}

export async function setNalogZadaci(nalogId: string, gradilisteId: string | null, zadatakIds: string[]) {
  const { error: clearError } = await supabase.from('gradiliste_zadaci').update({ nalog_id: null }).eq('nalog_id', nalogId);
  if (clearError) throw clearError;
  if (!gradilisteId || zadatakIds.length === 0) return;
  const { error } = await supabase.from('gradiliste_zadaci').update({ nalog_id: nalogId }).in('id', zadatakIds);
  if (error) throw error;
}

async function syncZadatakRok(z: GradilisteZadatak) {
  if (!z.rok) {
    const { error } = await supabase.from('rokovi').delete().eq('zadatak_id', z.id);
    if (error) throw error;
    return;
  }
  const payload = { naziv: z.naziv, datum: z.rok, status: z.gotovo ? 'zavrsen' : 'otvoren' };
  const { data, error } = await supabase.from('rokovi').update(payload).eq('zadatak_id', z.id).select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) {
    const { error: insertError } = await supabase
      .from('rokovi')
      .insert({ ...payload, gradiliste_id: z.gradiliste_id, zadatak_id: z.id, opis: 'Radni zadatak' });
    if (insertError) throw insertError;
  }
}

export async function createGradilisteZadatak(gradilisteId: string, naziv: string, rok?: string | null) {
  const { data, error } = await supabase
    .from('gradiliste_zadaci')
    .insert({ gradiliste_id: gradilisteId, naziv, rok: rok || null })
    .select()
    .single();
  if (error) throw error;
  await syncZadatakRok(data as GradilisteZadatak);
  return data as GradilisteZadatak;
}

export async function updateGradilisteZadatak(id: string, u: { naziv?: string; gotovo?: boolean; rok?: string | null }) {
  const payload = u.gotovo === undefined ? u : { ...u, gotovo_at: u.gotovo ? new Date().toISOString() : null };
  const { data, error } = await supabase.from('gradiliste_zadaci').update(payload).eq('id', id).select().single();
  if (error) throw error;
  await syncZadatakRok(data as GradilisteZadatak);
}

export async function deleteGradilisteZadatak(id: string) {
  const { error } = await supabase.from('gradiliste_zadaci').delete().eq('id', id);
  if (error) throw error;
}

// ===== ROKOVI =====

export async function fetchRokovi(gradilisteId?: string): Promise<Rok[]> {
  let q = supabase.from('rokovi').select('*').order('datum', { ascending: true });
  if (gradilisteId) q = q.eq('gradiliste_id', gradilisteId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Rok[];
}

export async function fetchRokoviNaloga(): Promise<Rok[]> {
  const { data, error } = await supabase
    .from('rokovi')
    .select('*')
    .not('nalog_id', 'is', null)
    .order('datum', { ascending: true });
  if (error) {
    if (String(error.message ?? '').includes('nalog_id')) {
      throw new Error('Pokreni migraciju 20261015180000_rokovi_nalog_veza.sql u Supabase SQL editoru.');
    }
    throw error;
  }
  return (data ?? []) as Rok[];
}

export async function createRok(r: {
  gradiliste_id: string | null;
  nalog_id?: string | null;
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
