export const OVERVIEW_CHANGED = 'tm-overview-changed';

const overviewTables = new Set([
  'gradilista', 'radnici', 'vozila', 'raspored', 'troskovi', 'radni_nalozi',
  'radnici_dokumenti', 'vozila_dokumenti', 'rokovi', 'fakture',
  'vozila_gorivo', 'vozila_gorivo_anomalije', 'vozila_obavijesti',
  'radno_vrijeme', 'radni_nalozi_radnici', 'dnevni_raspored_gradilista',
  'dnevni_raspored_radnici',
]);
const overviewMutation = /^(add_|cancel_|confirm_|create_|delete_|mobile_|recalculate_|record_|replace_|report_|resolve_|restore_|save_|set_|sync_)/;

export async function overviewFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (!response.ok || !['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return response;
  const url = new URL(input instanceof Request ? input.url : String(input));
  const parts = url.pathname.split('/');
  const rest = parts.indexOf('rest');
  if (rest < 0 || parts[rest + 1] !== 'v1') return response;
  const resource = parts[rest + 2];
  if (overviewTables.has(resource)
    || resource === 'rpc' && overviewMutation.test(parts[rest + 3] ?? '')) {
    window.dispatchEvent(new Event(OVERVIEW_CHANGED));
  }
  return response;
}
