import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module, exports: module.exports,
    require: name => { assert.ok(name in mocks, name); return mocks[name]; },
    ...globals,
  });
  return module.exports;
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('all six sidebar numbers use exact HEAD counts, no rows, joins, pagination or RPC', async () => {
  const calls = [];
  let fail = false;
  let missing = false;
  const api = load('../src/lib/api.ts', {
    './supabase': { supabase: {
      from(table) {
        return { select(columns, options) {
          calls.push({ table, columns, options });
          return Promise.resolve({ count: missing ? null : 1501, error: fail ? { message: 'Count denied' } : null });
        } };
      },
    } },
    './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {},
    './company': {}, './pagination': {}, './rokovi': {}, './imageCompression': {},
  });
  const result = await api.fetchOverviewCounts(api.overviewCountModules);
  assert.equal(calls.length, 6);
  assert.ok(Object.values(result).every(count => count === 1501), 'counts are not capped at API row limits');
  for (const call of calls) {
    assert.equal(call.columns, '*');
    assert.equal(call.options.head, true);
    assert.equal(call.options.count, 'exact');
  }
  calls.length = 0;
  await api.fetchOverviewCounts(['vozila']);
  assert.deepEqual(calls.map(call => call.table), ['vozila'], 'only permitted modules requested');
  fail = true;
  await assert.rejects(api.fetchOverviewCounts(['vozila']), { message: 'Count denied' });
  fail = false; missing = true;
  await assert.rejects(api.fetchOverviewCounts(['vozila']), /nije vraćen/);
});

function setup() {
  const calls = [];
  let pending = null;
  let failure = null;
  let settings = { visible: true };
  const source = {
    items: [{ id: 'one', voziloObavijestId: 'issue', level: 'today' }],
    voziloObavijesti: [{ id: 'issue' }], gorivoAnomalije: [],
  };
  const { createOverview } = load('../src/lib/overview.ts', {
    './api': { fetchOverviewCounts: async modules => {
      calls.push(['counts', ...modules]);
      if (pending) await pending.promise;
      if (failure) throw failure;
      return { vozila: 1501 };
    } },
    './obavijesti': {
      loadObavijestiSource: async () => {
        calls.push(['notifications']);
        if (pending) await pending.promise;
        if (failure) throw failure;
        return source;
      },
      buildObavijesti: (data, options) => options.visible ? data.items : [],
    },
    './postavke': { loadPostavke: () => settings },
  });
  return {
    createOverview, calls, source,
    hold: () => { pending = deferred(); return pending; },
    fail: () => { failure = new Error('Offline'); },
    setSettings: value => { settings = value; },
  };
}

test('shared loading deduplicates all consumers and retains cached results across remounts', async () => {
  const s = setup();
  const store = s.createOverview(['vozila'], true);
  const pending = s.hold();
  store.ensure(); store.ensure();
  const first = store.refresh();
  const second = store.refresh();
  assert.equal(s.calls.length, 2);
  pending.resolve();
  await Promise.all([first, second]);
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.source, s.source);
  assert.equal(snapshot.items, s.source.items);
  assert.equal(snapshot.counts.vozila, 1501);
  for (const page of ['dashboard', 'obavijesti', 'vozila', 'dashboard']) {
    assert.ok(page);
    const unsubscribe = store.subscribe(() => {});
    store.ensure();
    assert.equal(store.getSnapshot(), snapshot);
    unsubscribe();
  }
  assert.equal(s.calls.length, 2, 'zero new requests on navigation');
  s.setSettings({ visible: false });
  store.settingsChanged();
  assert.equal(store.getSnapshot().items.length, 0);
  assert.equal(s.calls.length, 2, 'changing display settings uses cached source');
  s.setSettings({ visible: true }); store.settingsChanged();
  store.resolve('issue');
  assert.equal(store.getSnapshot().items.length, 0, 'resolve updates all consumers immediately');
});

test('mutation during an in-flight load schedules one followup; errors are explicit and retryable', async () => {
  const s = setup();
  const store = s.createOverview(['vozila'], true);
  const pending = s.hold();
  store.ensure();
  store.invalidate(); store.invalidate();
  assert.equal(s.calls.length, 2);
  pending.resolve();
  await settle();
  assert.equal(s.calls.length, 4, 'one followup per data group, no parallel refresh storm');
  assert.equal(store.getSnapshot().notificationsLoading, false);
  s.fail();
  await store.refresh();
  assert.equal(store.getSnapshot().notificationsError, 'Offline');
  assert.equal(store.getSnapshot().countsError, 'Offline');
  assert.equal(store.getSnapshot().source, s.source, 'keep last known data with visible errors');
});

test('scopes never share data across user/company/permission changes and notifications can be disabled', async () => {
  const s = setup();
  const old = s.createOverview(['vozila'], true);
  const pending = s.hold(); old.ensure();
  const next = s.createOverview([], false);
  next.ensure();
  assert.equal(next.getSnapshot().source, null);
  assert.equal(next.getSnapshot().items.length, 0);
  pending.resolve(); await settle();
  assert.equal(next.getSnapshot().source, null, 'old in-flight completion cannot populate new scope');
  assert.equal(s.calls.filter(call => call[0] === 'notifications').length, 1);
});

test('successful relevant mutations invalidate; SELECT, HEAD, read RPC, failed writes and Storage do not', async () => {
  const events = [];
  let ok = true;
  const { overviewFetch } = load('../src/lib/overviewEvents.ts', {}, {
    Request, URL, Event,
    fetch: async () => ({ ok }),
    window: { dispatchEvent: event => events.push(event.type) },
  });
  const request = (path, method) => overviewFetch(`https://example.test${path}`, { method });
  await request('/rest/v1/gradilista', 'GET');
  await request('/rest/v1/radnici', 'HEAD');
  await request('/rest/v1/rpc/get_work_order_team_change_history', 'POST');
  await request('/rest/v1/rpc/has_my_personal_car', 'POST');
  await request('/storage/v1/object/sign/nalozi-foto/photo', 'POST');
  await request('/auth/v1/token', 'POST');
  assert.equal(events.length, 0);
  await request('/rest/v1/gradilista', 'POST');
  await request('/rest/v1/vozila', 'PATCH');
  await request('/rest/v1/troskovi', 'DELETE');
  await request('/rest/v1/rpc/restore_resource_deletion', 'POST');
  await request('/rest/v1/rpc/mobile_submit_nalog', 'POST');
  assert.equal(events.length, 5);
  ok = false;
  await request('/rest/v1/gradilista', 'DELETE');
  assert.equal(events.length, 5);
});

test('real dashboard and notification consumers do not start their own notification/source loads', async () => {
  const effects = [];
  const calls = [];
  const react = {
    useState: initial => [initial, () => {}],
    useEffect: effect => effects.push(effect),
    useMemo: fn => fn(),
  };
  const overview = {
    source: { gradilista: [], rokovi: [], fakture: [] }, items: [],
    notificationsLoading: false, notificationsError: null,
    refresh() {}, resolve() {},
  };
  const { Dashboard } = load('../src/components/views/Dashboard.tsx', {
    react, 'react/jsx-runtime': jsxRuntime, 'lucide-react': {},
    '@/lib/api': {
      fetchTroskovi: async () => { calls.push('costs'); return []; },
      fetchRadniNalozi: async () => { calls.push('orders'); return []; },
      fetchFinancijskaRekapitulacija: async () => {
        calls.push('finance-costs', 'finance-time', 'finance-invoices');
        return { troskovi: [], radnoVrijeme: [], fakture: [] };
      },
    },
    '@/lib/financijskaRekapitulacija': {},
    '@/lib/obavijesti': {}, '@/lib/company': {}, '@/lib/localization': {},
    '@/lib/rokovi': { todayISO: () => '2026-11-11' }, '@/components/ui/Badge': {},
  });
  Dashboard({ onNavigate() {}, overview });
  effects.forEach(effect => effect());
  await settle();
  assert.deepEqual(calls, ['costs', 'orders', 'finance-costs', 'finance-time', 'finance-invoices']);
  effects.length = 0;
  const { ObavijestiView } = load('../src/components/views/ObavijestiView.tsx', {
    react, 'react/jsx-runtime': jsxRuntime,
    'lucide-react': { Bell: 'span', BellRing: 'span', CheckCircle2: 'span', Search: 'span' },
    '@/lib/obavijesti': {}, '@/lib/api': {}, '@/lib/localization': {},
    '@/lib/postavke': { obavijestTipovi: [] },
  });
  ObavijestiView({ onNavigate() {}, canResolveVozila: true, overview });
  assert.equal(effects.length, 0, 'notification page has no data-loading effect');
  assert.equal(calls.length, 5);
  const app = read('../src/App.tsx');
  assert.match(app, /<Dashboard[^>]+overview=\{overview\}/);
  assert.match(app, /<ObavijestiView[^>]+overview=\{overview\}/);
  assert.doesNotMatch(app, /fetchGradilista|fetchRadnici|loadObavijesti/);
});
