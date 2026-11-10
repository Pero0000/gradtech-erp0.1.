import type { DnevniRasporedGradiliste, DnevniRasporedOstalo, DnevniRasporedRadnik } from '@/types';

function normalizeText(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase('hr-HR') ?? '';
}

export function countOstaloAssignments(
  entry: DnevniRasporedOstalo,
  siteAssignments: DnevniRasporedGradiliste[],
  workerAssignments: DnevniRasporedRadnik[],
) {
  if (entry.radnik_id) {
    return workerAssignments.filter((assignment) => assignment.radnik_id === entry.radnik_id).length;
  }

  const text = normalizeText(entry.tekst);
  if (!text) return 0;
  return siteAssignments.filter((assignment) =>
    assignment.iz_ostalo
    && !assignment.gradiliste_id
    && normalizeText(assignment.tekst) === text).length;
}

export function hasOstaloEntry(
  entries: DnevniRasporedOstalo[],
  entry: { tekst?: string | null; radnik_id?: string | null },
) {
  return entries.some((candidate) =>
    (entry.radnik_id
      ? candidate.radnik_id === entry.radnik_id
      : !candidate.radnik_id && normalizeText(candidate.tekst) === normalizeText(entry.tekst)));
}

export function workerReturnsToOstalo(assignment: Pick<DnevniRasporedRadnik, 'iz_ostalo'>) {
  return assignment.iz_ostalo === true;
}
