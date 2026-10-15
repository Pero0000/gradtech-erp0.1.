import type { Gradiliste, Rok } from '@/types';

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Prvi idući datum (od danas): početak, krajnji rok ili dodatni nezavršeni rok
export function nextDeadline(g: Gradiliste, rokovi: Rok[]): { datum: string; label: string } | null {
  const today = todayISO();
  const candidates: { datum: string; label: string }[] = [];
  if (g.datum_pocetka) candidates.push({ datum: g.datum_pocetka, label: 'Početak gradilišta' });
  if (g.datum_zavrsetka) candidates.push({ datum: g.datum_zavrsetka, label: 'Kraj gradilišta' });
  rokovi
    .filter((r) => r.gradiliste_id === g.id && r.status !== 'zavrsen')
    .forEach((r) => candidates.push({ datum: r.datum, label: r.naziv }));
  return candidates
    .filter((c) => c.datum >= today)
    .sort((a, b) => a.datum.localeCompare(b.datum))[0] ?? null;
}
