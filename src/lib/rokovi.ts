import type { Gradiliste, Rok } from '@/types';

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Upozorenje: kasni (prošao krajnji rok ili otvoreni rok), danas, ili uskoro (do 3 dana)
export type DeadlineAlert = { level: 'overdue' | 'today' | 'soon'; label: string; datum: string; days: number };

function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000);
}

export function deadlineAlert(g: Gradiliste, rokovi: Rok[]): DeadlineAlert | null {
  if (g.status === 'zavrseno' || g.status === 'neplaceno') return null;
  const today = todayISO();
  const items: { datum: string; label: string }[] = [];
  if (g.datum_pocetka && g.status !== 'aktivno') items.push({ datum: g.datum_pocetka, label: 'Početak gradilišta' });
  if (g.datum_zavrsetka) items.push({ datum: g.datum_zavrsetka, label: 'Kraj gradilišta' });
  rokovi.filter((r) => r.gradiliste_id === g.id && r.status !== 'zavrsen').forEach((r) => items.push({ datum: r.datum, label: r.naziv }));
  const withDays = items.map((i) => ({ ...i, days: daysBetween(today, i.datum) }));
  const overdue = withDays.filter((i) => i.days < 0 && i.label !== 'Početak gradilišta').sort((a, b) => a.days - b.days)[0];
  if (overdue) return { level: 'overdue', ...overdue };
  const upcoming = withDays.filter((i) => i.days >= 0 && i.days <= 3).sort((a, b) => a.days - b.days)[0];
  if (!upcoming) return null;
  return { level: upcoming.days === 0 ? 'today' : 'soon', ...upcoming };
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
