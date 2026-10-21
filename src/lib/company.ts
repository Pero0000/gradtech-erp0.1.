import { supabase } from './supabase';
import { fetchAllRows } from './pagination';

export interface Tvrtka {
  id: string;
  naziv: string;
  oib: string;
  adresa: string;
  aktivna: boolean;
}

let currentCompany: Tvrtka | null = null;

export function setCurrentCompany(company: Tvrtka | null) {
  currentCompany = company;
  if (company?.oib === '29191529726' && localStorage.getItem(`gradtech:${company.id}:legacy-migrated`) !== '1') {
    for (const key of ['tm_ponude_postavke', 'tm_postavke', 'tm_univerzalna_satnica', 'tm_netto_po_radnicima', 'tm_prikaz_teren', 'tm_prikaz_nocna']) {
      const scopedKey = `gradtech:${company.id}:${key}`;
      const previous = localStorage.getItem(key);
      if (previous !== null && localStorage.getItem(scopedKey) === null) localStorage.setItem(scopedKey, previous);
    }
    localStorage.setItem(`gradtech:${company.id}:legacy-migrated`, '1');
  }
}

export function requireCompany(): Tvrtka {
  if (!currentCompany) throw new Error('Tvrtka korisnika nije učitana. Ponovno se prijavite.');
  return currentCompany;
}

export function companyStorageKey(key: string): string {
  return `gradtech:${requireCompany().id}:${key}`;
}

export const companyStorage = {
  getItem: (key: string) => localStorage.getItem(companyStorageKey(key)),
  setItem: (key: string, value: string) => localStorage.setItem(companyStorageKey(key), value),
  removeItem: (key: string) => localStorage.removeItem(companyStorageKey(key)),
};

export async function fetchTvrtke(): Promise<Tvrtka[]> {
  return fetchAllRows<Tvrtka>((from, to) => supabase.from('tvrtke')
    .select('id,naziv,oib,adresa,aktivna').order('naziv').order('id').range(from, to));
}

type CompanyAction =
  | { action: 'create_company'; naziv: string; oib: string; adresa: string; admin_email: string }
  | { action: 'set_active'; company_id: string; aktivna: boolean }
  | { action: 'invite'; company_id: string; email: string; is_admin: boolean };

export async function manageCompany(action: CompanyAction): Promise<void> {
  const { data, error } = await supabase.functions.invoke('manage-companies', { body: action });
  if (error) {
    if (error.context instanceof Response) {
      const body: { error?: string } = await error.context.json();
      throw new Error(body.error ?? error.message);
    }
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
}
