import { supabase } from './supabase';

export interface PonudaPostavke {
  izvodac: string;
  adresa: string;
  oib: string;
  mjesto: string;
  kontaktOsoba: string;
  telefon: string;
  email: string;
  izradio: string;
  pdv: number;
  popust: number;
  napomene: string;
  prijenosPoreza: string;
  potpis: string;
  logo: string;
}

export const defaultPonudaPostavke: PonudaPostavke = {
  izvodac: 'Tm-color d.o.o.',
  adresa: '',
  oib: '',
  mjesto: '',
  kontaktOsoba: '',
  telefon: '',
  email: '',
  izradio: '',
  pdv: 25,
  popust: 0,
  napomene: [
    'Prema dogovoru sa obilaska sve dodatne radove kao npr. potrebna zidanja, demontažu klupica, dobavu klupica, limarske radove, elektro radove i slično izvodi investitor.',
    'Obračun troška izvršit će se prema stvarno izvedenim količinama i prethodno ponuđenim jediničnim cijenama.',
    'Troškovi koji nisu mogli biti predviđeni ovom ponudom, odnosno koji procesno uvjetovano nastanu ili se dodatno dogovore sa investitorom bit će posebno obračunati i uz dodatnu suglasnost naručitelja fakturirani na trošak naručitelja.',
    'Termin za izvođenje radova dogovorit će se naknadno po prihvaćanju ponude od strane naručitelja.',
  ].join('\n'),
  prijenosPoreza: 'Prijenos porezne obveze: obračun PDV-a vrši primatelj usluge prema čl. 75. st. 3. Zakona o porezu na dodanu vrijednost.',
  potpis: '',
  logo: '',
};

const KEY = 'tm_ponude_postavke';

export function loadPonudaPostavke(): PonudaPostavke {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaultPonudaPostavke, ...(JSON.parse(raw) as Partial<PonudaPostavke>) } : defaultPonudaPostavke;
  } catch {
    return defaultPonudaPostavke;
  }
}

export function savePonudaPostavke(p: PonudaPostavke) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

// Povlači postavke iz baze u lokalnu kopiju; ako ih u bazi nema, postojeće lokalne se prenose u bazu
export async function syncPonudaPostavke(): Promise<PonudaPostavke> {
  const { data, error } = await supabase.from('ponude_postavke').select('podaci').eq('id', 1).maybeSingle();
  if (error) throw new Error(`${error.message} — pokreni migraciju 20261015420000_ponude_postavke.sql u Supabaseu.`);
  const remote = data?.podaci as Partial<PonudaPostavke> | undefined;
  if (remote && Object.keys(remote).length > 0) {
    const merged = { ...defaultPonudaPostavke, ...remote };
    localStorage.setItem(KEY, JSON.stringify(merged));
    return merged;
  }
  const local = loadPonudaPostavke();
  if (localStorage.getItem(KEY)) await saveRemote(local);
  return local;
}

async function saveRemote(p: PonudaPostavke) {
  const { error } = await supabase.from('ponude_postavke').upsert({ id: 1, podaci: p, updated_at: new Date().toISOString() });
  if (error) throw new Error(`${error.message} — pokreni migraciju 20261015420000_ponude_postavke.sql u Supabaseu.`);
}

export async function savePonudaPostavkeRemote(p: PonudaPostavke) {
  savePonudaPostavke(p);
  await saveRemote(p);
}
