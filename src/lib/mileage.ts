export const LARGE_MILEAGE_THRESHOLD = 1000;

export function mileageDifference(start: number | string, end: number | string): number | null {
  if (String(start).trim() === '' || String(end).trim() === '') return null;
  const startValue = Number(start);
  const endValue = Number(end);
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || endValue < startValue) return null;
  return endValue - startValue;
}

export function isLargeMileageDifference(start: number | string, end: number | string) {
  const difference = mileageDifference(start, end);
  return difference !== null && difference > LARGE_MILEAGE_THRESHOLD;
}

export function confirmLargeMileage(start: number | string, end: number | string) {
  const difference = mileageDifference(start, end);
  if (difference === null || difference <= LARGE_MILEAGE_THRESHOLD) return true;
  return window.confirm(
    `Razlika kilometara je ${difference.toLocaleString('hr-HR')} km. Potvrdi je li unos očitanja ispravan.`,
  );
}
