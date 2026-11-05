export function formatHrDate(value: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const date = typeof value === 'string'
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
    : value;
  if (Number.isNaN(date.getTime())) return '—';
  const formatted = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}.`;
  return options?.weekday
    ? `${date.toLocaleDateString('hr-HR', { weekday: options.weekday })}, ${formatted}`
    : formatted;
}

export function formatHrDateTime(value: Date, options?: Intl.DateTimeFormatOptions): string {
  if (Number.isNaN(value.getTime())) return '—';
  const time = value.toLocaleTimeString('hr-HR', {
    hour: '2-digit',
    minute: '2-digit',
    second: options ? options.second : '2-digit',
  });
  return `${formatHrDate(value, options)} ${time}`;
}

export function parseDecimalInput(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(normalized)) return NaN;
  return Number(normalized.replace(',', '.'));
}
