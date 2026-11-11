import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module, exports: module.exports,
    window: { setTimeout: () => 1 },
    require: name => { assert.ok(name in mocks, name); return mocks[name]; },
  });
  return module.exports;
}

function setup({ delayed = false, failMachines = false } = {}) {
  const calls = [];
  let release;
  const gate = delayed ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  const api = {
    fetchNalogIzvrsenje: async id => {
      calls.push(['execution', id]); await gate;
      return { status: 'otvoren', poslovodja_id: null, napomena: 'Napomena', km_pocetak: 10, km_kraj: 20 };
    },
    fetchNalogRadnikVrijeme: async id => {
      calls.push(['team', id]); await gate;
      return [{ radnik_id: 'worker', vrijeme_od: null, vrijeme_do: '16:00', mobile_zero_hours: false }];
    },
    fetchNalogZadaci: async id => { calls.push(['tasks', id]); await gate; return [{ id: 'task' }]; },
    fetchNalogStavke: async id => { calls.push(['items', id]); await gate; return [{ id: 'material' }]; },
    fetchOprema: async category => {
      calls.push([category]); await gate;
      if (category === 'stroj' && failMachines) throw new Error('Nedostupni strojevi');
      return [{ id: category, status: 'slobodno' }, { id: 'service', status: 'servis' }];
    },
    saveNalogInitialValues: async (...args) => { calls.push(['initialize', ...args]); },
  };
  const { createNalogExecutionCache } = load('../src/lib/nalogExecution.ts', { './api': api });
  return { cache: createNalogExecutionCache(), calls, api, release, createNalogExecutionCache };
}

test('detail and edit reuse six read-only sources, including in-flight requests and empty arrays', async () => {
  const { cache, calls, release } = setup({ delayed: true });
  const detail = cache.get('order');
  const edit = cache.get('order');
  assert.equal(detail, edit);
  const first = detail.load();
  const second = edit.load();
  assert.equal(calls.length, 6);
  release();
  await Promise.all([first, second]);
  await edit.load();
  assert.equal(calls.length, 6, 'opening edit after detail sends zero extra requests');
  assert.equal(detail.getSnapshot().vremena[0].vrijeme_od, '06:00:00');
  assert.equal(detail.getSnapshot().poslovodja, 'worker');
  assert.equal(calls.filter(([kind]) => kind === 'initialize').length, 0, 'defaults are display-only on open');
  assert.equal(detail.getSnapshot().alati.length, 1);
  assert.equal(detail.getSnapshot().strojevi.length, 1);
  const empty = setup();
  empty.api.fetchNalogZadaci = async () => { empty.calls.push(['tasks']); return []; };
  await empty.cache.get('empty').load();
  await empty.cache.get('empty').load();
  assert.equal(empty.calls.length, 6, 'empty data is loaded data, not a cache miss');
});

test('edits, checklists, times and saving locks are shared immediately between subscribers', async () => {
  const { cache } = setup();
  const detail = cache.get('order');
  await detail.load();
  const edit = cache.get('order');
  let notifications = 0;
  const unsubscribe = detail.subscribe(() => notifications++);
  for (const [field, next] of [
    ['napomena', 'Nova napomena'], ['km', { pocetak: '15', kraj: '30' }],
    ['zadaci', [{ id: 'new-task' }]], ['stavke', [{ id: 'new-item' }]],
    ['vremena', [{ radnik_id: 'worker', vrijeme_od: '08:00' }]],
    ['savingTime', true], ['savingCompletion', true],
  ]) {
    edit.field(edit.getSnapshot(), field)[1](next);
    assert.equal(detail.getSnapshot()[field], next);
  }
  assert.equal(notifications, 7);
  unsubscribe();
  const setNote = edit.field(edit.getSnapshot(), 'napomena')[1];
  setNote(value => `${value}!`);
  setNote(value => `${value}!`);
  assert.equal(detail.getSnapshot().napomena, 'Nova napomena!!', 'functional updates use latest state');
});

test('opening edit preserves loaded data, but leaving and reselecting a detail refreshes its sources', async () => {
  const { cache, calls } = setup();
  const detail = cache.get('order');
  const closeDetail = detail.retain();
  await detail.load();
  const closeEdit = detail.retain();
  await detail.load();
  assert.equal(calls.length, 6);
  closeEdit();
  await detail.load();
  assert.equal(calls.length, 6);
  closeDetail();
  const closeReselected = detail.retain();
  await detail.load();
  assert.equal(calls.length, 12, 'reselection retains the previous fresh-read behavior');
  closeReselected();
});

test('only missing sources retry; explicit refresh reloads all; errors stay explicit', async () => {
  const { cache, api, calls } = setup({ failMachines: true });
  const detail = cache.get('order');
  await assert.rejects(detail.load(), /Popis strojeva: Nedostupni strojevi/);
  assert.equal(calls.length, 6);
  assert.equal(detail.getSnapshot().zadaci.length, 1);
  await assert.rejects(cache.get('order').load(), /Nedostupni strojevi/);
  assert.equal(calls.length, 7);
  api.fetchOprema = async category => { calls.push([category]); return []; };
  await detail.load();
  assert.equal(calls.length, 8);
  await detail.load();
  assert.equal(calls.length, 8);
  await detail.load(true);
  assert.equal(calls.length, 14);
});

test('cache is isolated by order and lifetime; old pending requests cannot populate an invalidated entry', async () => {
  const { cache, createNalogExecutionCache, release } = setup({ delayed: true });
  const old = cache.get('order');
  const pending = old.load();
  assert.notEqual(cache.get('other-order'), old);
  assert.notEqual(createNalogExecutionCache().get('order'), old);
  cache.invalidate();
  const fresh = cache.get('order');
  assert.notEqual(fresh, old);
  release();
  await pending;
  assert.equal(fresh.getSnapshot().vremena.length, 0);
  await fresh.load();
  assert.equal(fresh.getSnapshot().vremena.length, 1);
});

test('defaults persist only at explicit save, once for both instances, with visible failures and retry', async () => {
  const { cache, calls, api } = setup();
  const detail = cache.get('order');
  await detail.load();
  let release;
  api.saveNalogInitialValues = (...args) => {
    calls.push(['initialize', ...args]);
    return new Promise(resolve => { release = resolve; });
  };
  const first = detail.persistDefaults();
  assert.equal(cache.get('order').persistDefaults(), first);
  assert.equal(calls.length, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[6])), ['initialize', 'order', ['worker'], 'worker']);
  release();
  await first;
  await detail.persistDefaults();
  assert.equal(calls.length, 7);
  const failed = setup();
  const entry = failed.cache.get('order');
  await entry.load();
  failed.api.saveNalogInitialValues = async () => { throw new Error('Spremanje nije dopušteno'); };
  await assert.rejects(entry.persistDefaults(), /Spremanje nije dopušteno/);
  failed.api.saveNalogInitialValues = async (...args) => { failed.calls.push(['retry', ...args]); };
  await entry.persistDefaults();
  assert.equal(failed.calls.at(-1)[0], 'retry');
});

test('saved starts, zero hours, leaders and user-modified defaults are not reset', async () => {
  const { cache, api, calls } = setup();
  api.fetchNalogRadnikVrijeme = async () => [
    { radnik_id: 'saved', vrijeme_od: '08:00', mobile_zero_hours: false },
    { radnik_id: 'zero', vrijeme_od: null, mobile_zero_hours: true },
    { radnik_id: 'missing', vrijeme_od: null, mobile_zero_hours: false },
  ];
  api.fetchNalogIzvrsenje = async () => ({ status: 'zavrsen', poslovodja_id: 'saved' });
  const entry = cache.get('order');
  await entry.load();
  assert.equal(entry.getSnapshot().vremena[0].vrijeme_od, '08:00');
  assert.equal(entry.getSnapshot().vremena[1].vrijeme_od, null);
  entry.field(entry.getSnapshot(), 'vremena')[1](rows => rows.map(row =>
    row.radnik_id === 'missing' ? { ...row, vrijeme_od: '09:00' } : row));
  await entry.persistDefaults();
  assert.equal(calls.filter(([kind]) => kind === 'initialize').length, 0);
  assert.equal(entry.getSnapshot().poslovodja, 'saved');
});

test('real detail and edit mount read-only; save initializes before action and shares the loaded state', async () => {
  const { cache, api, calls } = setup();
  const stateNames = [...read('../src/components/views/NalogIzvrsenje.tsx')
    .slice(read('../src/components/views/NalogIzvrsenje.tsx').indexOf('export function NalogIzvrsenje'))
    .matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map(match => match[1]);
  let effects = [];
  let cursor = 0;
  let local = {};
  const react = {
    useState(initial) {
      const key = stateNames[cursor++];
      if (!(key in local)) local[key] = initial;
      return [local[key], next => { local[key] = typeof next === 'function' ? next(local[key]) : next; }];
    },
    useCallback: fn => fn, useRef: value => ({ current: value }), useEffect: effect => effects.push(effect),
  };
  const view = load('../src/components/views/NalogIzvrsenje.tsx', {
    react, 'react/jsx-runtime': jsxRuntime, 'react-dom': { createPortal: node => node },
    'lucide-react': Object.fromEntries('Camera Check ChevronLeft ChevronRight Clock FileText Gauge Hammer Package Plus Trash2 X ListChecks Wrench'
      .split(' ').map(name => [name, () => null])),
    '@/auth/useAuth': { useAuth: () => ({ canAccess: () => true }) },
    '@/lib/localization': {}, '@/types': { zadatakVrsta: item => item.vrsta ?? 'zadatak' },
    '@/lib/api': {
      ...api, saveNalogIzvrsenje: async (...args) => { calls.push(['save', ...args]); },
      setNalogPoslovodja: () => assert.fail('opening must not save a leader'),
      saveNalogRadnikVrijeme: () => assert.fail('opening must not save 06:00 or recalculate'),
    },
    '@/lib/useNalogExecution': {
      useNalogExecution: (id, shared) => {
        assert.equal(shared, cache);
        const execution = shared.get(id);
        return { execution, snapshot: execution.getSnapshot() };
      },
    },
    '@/lib/useDeferredFiles': { useDeferredFiles: () => ({ data: [], setData() {} }) },
    '@/components/ui/PrivateImage': { PrivateImage: () => null, PrivateFileLink: () => null },
    '@/components/views/WorkOrderItemChangeHistory': { WorkOrderItemChangeHistory: () => null },
    '@/components/views/HistoryDialog': { HistoryButton: () => null, HistoryDialog: () => null },
  });
  function render() {
    cursor = 0;
    effects = [];
    return view.NalogIzvrsenje({ nalog: { id: 'order', status: 'otvoren' }, executionCache: cache });
  }
  render();
  effects.forEach(effect => effect());
  await flush();
  assert.equal(calls.length, 6);
  local = {};
  render();
  effects.forEach(effect => effect());
  await flush();
  assert.equal(calls.length, 6);
  const nodes = node => Array.isArray(node) ? node.flatMap(nodes)
    : node?.props ? [node, ...nodes(node.props.children)] : [];
  const tree = render();
  assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, 'Napomena');
  nodes(tree).find(node => node.type === 'button' && node.props.children === 'Spremi kilometre i napomenu').props.onClick();
  await flush();
  assert.equal(calls[6][0], 'initialize');
  assert.equal(calls[7][0], 'save');
});

test('initial-value API uses conditional batch updates, does not overwrite existing values and never calculates', async () => {
  const calls = [];
  let failure;
  const supabase = {
    from(table) {
      const query = { table, filters: [] };
      calls.push(query);
      const builder = {
        update(values) { query.values = values; return builder; },
        eq(...filter) { query.filters.push(['eq', ...filter]); return builder; },
        in(...filter) { query.filters.push(['in', ...filter]); return builder; },
        is(...filter) { query.filters.push(['is', ...filter]); return builder; },
        then(resolve) { return Promise.resolve({ error: failure }).then(resolve); },
      };
      return builder;
    },
    rpc: () => assert.fail('initial values must not calculate'),
  };
  const api = load('../src/lib/api.ts', Object.fromEntries([
    ['./supabase', { supabase }], ...['./postavke', './obracunSati', './vehicleKmCosts',
      './company', './pagination', './rokovi', './imageCompression'].map(name => [name, {}]),
  ]));
  await api.saveNalogInitialValues('order', [], null);
  assert.equal(calls.length, 0);
  await api.saveNalogInitialValues('order', ['one', 'two'], 'one');
  assert.equal(calls.length, 2, 'one update for all missing starts, not one settlement per worker');
  assert.ok(calls[0].filters.some(filter => filter[0] === 'is' && filter[1] === 'vrijeme_od' && filter[2] === null));
  assert.ok(calls[0].filters.some(filter => filter[1] === 'mobile_zero_hours' && filter[2] === false));
  assert.ok(calls[1].filters.some(filter => filter[0] === 'is' && filter[1] === 'poslovodja_id'));
  failure = { message: 'Zabranjeno' };
  await assert.rejects(api.saveNalogInitialValues('order', ['one'], 'one'), reason => reason.message === 'Zabranjeno');
});

test('real list wires the same scoped cache into detail and edit, then initializes on explicit form save', async () => {
  const { cache, calls } = setup();
  await cache.get('order').load();
  const order = {
    id: 'order', broj: 'RN-1', naslov: 'Nalog', status: 'otvoren', prioritet: 'srednji',
    radnici: [{ id: 'worker' }], gradiliste_id: 'site',
  };
  const source = read('../src/components/views/RadniNaloziView.tsx');
  const stateNames = [...source.slice(source.indexOf('export function RadniNaloziView'))
    .matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map(match => match[1]);
  const states = {
    items: [order], gradilista: [], radnici: [], loading: false, editing: order,
    modalOpen: true, period: 'svi', rokovi: [],
    form: { ...order, radnik_ids: ['worker'], opis: '', rok: '' },
  };
  let cursor = 0;
  const NalogIzvrsenje = () => null;
  const noop = () => null;
  const mocks = {
    react: {
      useState(initial) {
        const key = stateNames[cursor++];
        if (!(key in states)) states[key] = initial;
        return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value; }];
      },
      useEffect() {}, useCallback: fn => fn,
    },
    'react/jsx-runtime': jsxRuntime,
    'lucide-react': new Proxy({}, { get: () => noop }),
    '@/lib/localization': {},
    '@/lib/useNalogExecution': { useNalogExecutionCache: () => cache },
    '@/lib/useRequestScope': { useRequestScope: () => ({ start: () => () => true }) },
    '@/lib/api': {
      updateRadniNalog: async (...args) => { calls.push(['save-order', ...args]); },
      fetchRadniNalozi: async () => [order], fetchGradilista: async () => [],
      fetchRadnici: async () => [], fetchRokoviNaloga: async () => [],
    },
    './NalogIzvrsenje': { NalogIzvrsenje },
    '@/components/ui/Badge': { Badge: noop }, '@/components/ui/Modal': { Modal: noop },
    '@/components/ui/Field': { Field: noop, TextInput: noop, Select: noop, Textarea: noop },
    '@/components/ui/ConfirmDialog': { ConfirmDialog: noop }, '@/components/ui/EmptyState': { EmptyState: noop },
    '@/components/ui/ExportMenu': { ExportMenu: noop }, '@/lib/nalogPdf': {},
    '@/components/views/ResourceDeletionHistory': { ResourceDeletionHistory: noop },
    '@/components/views/FuelChangeHistory': { DeadlineChangeHistoryPanel: noop },
    '@/components/views/ContractedWorkHistory': { OrderHistory: noop, OrderTeamHistory: noop },
    '@/components/views/HistoryDialog': { HistoryMenu: noop },
  };
  const view = load('../src/components/views/RadniNaloziView.tsx', mocks);
  const tree = view.RadniNaloziView();
  const nodes = node => Array.isArray(node) ? node.flatMap(nodes)
    : node?.props ? [node, ...nodes(node.props.children), ...nodes(node.props.footer)] : [];
  const executions = nodes(tree).filter(node => node.type === NalogIzvrsenje);
  assert.equal(executions.length, 2);
  assert.equal(executions[0].props.executionCache, cache);
  assert.equal(executions[1].props.executionCache, cache);
  const button = nodes(tree).find(node => node.type === 'button' && node.props.children === 'Spremi');
  await button.props.onClick();
  assert.equal(calls[6][0], 'initialize');
  assert.equal(calls[7][0], 'save-order');
  assert.equal(states.error, null);
});

test('hook resets cache on user/company/permission changes and sees invalidation without unmount', async () => {
  const { createNalogExecutionCache } = setup();
  const canAccess = () => true;
  let auth = { profile: { id: 'user' }, company: { id: 'company' }, canAccess };
  const slots = [];
  let index = 0;
  const hooks = load('../src/lib/useNalogExecution.ts', {
    react: {
      useEffect() {},
      useMemo(create, deps) {
        const slot = index++;
        if (!slots[slot] || !deps.every((dep, i) => Object.is(dep, slots[slot].deps[i]))) {
          slots[slot] = { deps, value: create() };
        }
        return slots[slot].value;
      },
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    },
    '@/auth/useAuth': { useAuth: () => auth },
    './nalogExecution': { createNalogExecutionCache },
  });
  const render = () => { index = 0; return hooks.useNalogExecution('order'); };
  const initial = render();
  assert.equal(render().execution, initial.execution);
  auth = { ...auth, company: { id: 'other-company' } };
  const otherCompany = render();
  assert.notEqual(otherCompany.execution, initial.execution);
  auth = { ...auth, profile: { id: 'other-user' } };
  const otherUser = render();
  assert.notEqual(otherUser.execution, otherCompany.execution);
  auth = { ...auth, canAccess: () => false };
  assert.notEqual(render().execution, otherUser.execution);
  const shared = createNalogExecutionCache();
  index = 0;
  const old = hooks.useNalogExecution('order', shared);
  shared.invalidate();
  index = 0;
  assert.notEqual(hooks.useNalogExecution('order', shared).execution, old.execution);
});
