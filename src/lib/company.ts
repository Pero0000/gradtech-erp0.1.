import { supabase } from './supabase';
import { fetchAllRows } from './pagination';

export interface Tvrtka {
  id: string;
  naziv: string;
  oib: string;
  adresa: string;
  aktivna: boolean;
  postavke: TvrtkaPostavke;
}

export type RabatSmjer = 'pribroji' | 'oduzmi';

export const DEFAULT_GRADILISTE_COLUMN_LABELS = ['dm gradilišta', 'dm intervencije', 'ostala gradilišta'] as const;

export interface TvrtkaPostavke {
  disabled_modules: string[];
  invoice_rebate_mode: RabatSmjer;
  gradiliste_column_labels: string[];
  [key: string]: unknown;
}

export function defaultTvrtkaPostavke(): TvrtkaPostavke {
  return {
    disabled_modules: [],
    invoice_rebate_mode: 'pribroji',
    gradiliste_column_labels: [...DEFAULT_GRADILISTE_COLUMN_LABELS],
  };
}

export function normalizeTvrtkaPostavke(value: unknown): TvrtkaPostavke {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultTvrtkaPostavke();
  const raw = value as Record<string, unknown>;
  const columnLabels = Array.isArray(raw.gradiliste_column_labels)
    && raw.gradiliste_column_labels.length === DEFAULT_GRADILISTE_COLUMN_LABELS.length
    && raw.gradiliste_column_labels.every((label) => typeof label === 'string' && label.trim().length > 0)
    ? raw.gradiliste_column_labels.map((label) => String(label).trim())
    : [...DEFAULT_GRADILISTE_COLUMN_LABELS];
  return {
    ...raw,
    disabled_modules: Array.isArray(raw.disabled_modules)
      ? raw.disabled_modules.filter((module): module is string => typeof module === 'string')
      : [],
    invoice_rebate_mode: raw.invoice_rebate_mode === 'oduzmi' ? 'oduzmi' : 'pribroji',
    gradiliste_column_labels: columnLabels,
  };
}

let currentCompany: Tvrtka | null = null;

export function setCurrentCompany(company: Tvrtka | null) {
  currentCompany = company;
  if (company) localStorage.removeItem(`gradtech:${company.id}:tm_gemini_key`);
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

export function getUniversalHourlyRate(): number {
  const saved = Number(companyStorage.getItem('tm_univerzalna_satnica'));
  return Number.isFinite(saved) && saved > 0 ? saved : 18;
}

export async function fetchTvrtke(): Promise<Tvrtka[]> {
  const rows = await fetchAllRows<Omit<Tvrtka, 'postavke'> & { postavke: unknown }>((from, to) => supabase.from('tvrtke')
    .select('id,naziv,oib,adresa,aktivna,postavke').order('naziv').order('id').range(from, to));
  return rows.map((row) => ({ ...row, postavke: normalizeTvrtkaPostavke(row.postavke) }));
}

type CompanyAction =
  | { action: 'create_company'; naziv: string; oib: string; adresa: string; admin_email: string }
  | { action: 'set_active'; company_id: string; aktivna: boolean }
  | { action: 'update_settings'; company_id: string; postavke: TvrtkaPostavke }
  | { action: 'update_board_labels'; company_id: string; labels: string[] }
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
