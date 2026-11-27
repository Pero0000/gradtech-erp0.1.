import { AlertTriangle } from 'lucide-react';
import { isLargeMileageDifference, mileageDifference } from '@/lib/mileage';

export function LargeMileageWarning({ start, end }: { start: number | string; end: number | string }) {
  if (!isLargeMileageDifference(start, end)) return null;
  const difference = mileageDifference(start, end);
  return (
    <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-medium text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      Uneseno je {difference?.toLocaleString('hr-HR')} km. Provjeri početno i završno očitanje prije spremanja.
    </p>
  );
}
