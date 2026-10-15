import type { Vozilo, VoziloDokument } from '@/types';
import { todayISO } from '@/lib/rokovi';

export type ServisAlert = { level: 'overdue' | 'soon' | 'none-recorded'; text: string };

function addMonths(iso: string, months: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const days = (from: string, to: string) =>
  Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000);

// Idući servis: km (zadnji servis + interval) i/ili datum
export function nextServis(v: Vozilo, dokumenti: VoziloDokument[]): { km: number | null; datum: string | null } {
  const last = dokumenti
    .filter((d) => d.vozilo_id === v.id && d.vrsta === 'servis')
    .sort((a, b) => (b.datum_od ?? '').localeCompare(a.datum_od ?? ''))[0];
  if (!last) return { km: null, datum: null };
  const km = v.servis_interval_km && last.km != null ? last.km + v.servis_interval_km : null;
  const datum = last.datum_do ?? (last.datum_od && v.servis_interval_mjeseci ? addMonths(last.datum_od, v.servis_interval_mjeseci) : null);
  return { km, datum };
}

// Upozorenje po kilometrima i/ili vremenu od zadnjeg servisa (prema postavkama vozila)
export function servisAlert(v: Vozilo, dokumenti: VoziloDokument[]): ServisAlert | null {
  const intKm = v.servis_interval_km ?? null;
  const intMj = v.servis_interval_mjeseci ?? null;
  if (!intKm && !intMj) return null;

  const servisi = dokumenti
    .filter((d) => d.vozilo_id === v.id && d.vrsta === 'servis')
    .sort((a, b) => (b.datum_od ?? '').localeCompare(a.datum_od ?? ''));
  const last = servisi[0];
  if (!last) return { level: 'none-recorded', text: 'Nema upisanog servisa' };

  const today = todayISO();
  const warnKm = v.servis_upozorenje_km ?? 1000;
  const warnDays = v.servis_upozorenje_dana ?? 30;
  const parts: { overdue: boolean; text: string }[] = [];

  if (intKm && last.km != null) {
    const left = last.km + intKm - (v.kilometraza ?? 0);
    if (left <= 0) parts.push({ overdue: true, text: `servis kasni ${Math.abs(left).toLocaleString('hr-HR')} km` });
    else if (left <= warnKm) parts.push({ overdue: false, text: `servis za ${left.toLocaleString('hr-HR')} km` });
  }
  if (intMj || last.datum_do) {
    const nextDate = last.datum_do ?? (last.datum_od && intMj ? addMonths(last.datum_od, intMj) : null);
    if (nextDate) {
      const left = days(today, nextDate);
      if (left < 0) parts.push({ overdue: true, text: `servis kasni ${Math.abs(left)} d` });
      else if (left <= warnDays) parts.push({ overdue: false, text: `servis za ${left} d` });
    }
  }
  if (parts.length === 0) return null;
  const overdue = parts.some((p) => p.overdue);
  return { level: overdue ? 'overdue' : 'soon', text: parts.map((p) => p.text).join(' · ') };
}
