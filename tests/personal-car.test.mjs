import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

const source = readFileSync(new URL('../src/components/mobile/PersonalCarTab.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const stateNames = [...source.matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map((match) => match[1]);
const options = {
  zadnje_vozilo_id: 'car', vozila: [{ id: 'car', naziv: 'Pilot auto', kilometraza: 1000, cijena_km: 0.333 }],
  gradilista: [{ id: 'site', naziv: 'Gradilište' }],
};
const history = [{
  id: 'trip', vozilo_id: 'car', vozilo_naziv: 'Pilot auto', datum: '2026-01-01',
  km_pocetak: 900, km_kraj: 925, kilometri: 25, gradiliste_id: 'site', gradiliste_naziv: 'Gradilište',
  cijena_km: 0.333, iznos: 8.33, trosak_id: 'expense', created_at: '2026-01-01T10:00:00Z',
  stornirano_at: null, razlog_storna: null, vrijeme_od: null, vrijeme_do: null, napomena: '',
}];
const flush = () => new Promise((resolve) => setImmediate(resolve));
function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  return node?.props ? [node, ...elements(node.props.children)] : [];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  return node?.props ? text(node.props.children) : (typeof node === 'string' || typeof node === 'number' ? String(node) : '');
}
function setup(config = {}) {
  const states = {};
  const refs = [];
  const calls = [];
  let stateCursor = 0;
  let refCursor = 0;
  let effect;
  let optionsCalls = 0;
  let failReport = config.failReport;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Error, Map, crypto: { randomUUID: () => `uuid-${calls.length}` },
    require(name) {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'react') return {
        useState(initial) {
          const key = stateNames[stateCursor++];
          if (!(key in states)) states[key] = initial;
          return [states[key], (next) => { states[key] = typeof next === 'function' ? next(states[key]) : next; }];
        },
        useRef(initial) {
          const index = refCursor++;
          refs[index] ??= { current: initial };
          return refs[index];
        },
        useEffect(callback) { effect = callback; },
      };
      if (name === 'lucide-react') return { Car() {}, Plus() {}, RefreshCw() {} };
      if (name === '@/lib/rokovi') return { todayISO: () => '2026-01-01' };
      if (name === '@/lib/localization') return { formatHrDate: () => '1. 1. 2026.' };
      if (name === '@/lib/personalCar') return {
        fetchPersonalCarOptions: async () => {
          optionsCalls++;
          if (config.loadError || (config.refreshError && optionsCalls > 1)) throw new Error('Učitavanje nije uspjelo.');
          return options;
        },
        fetchPersonalCarTrips: async (cursor) => { calls.push(['history', cursor]); return cursor ? [] : (config.history ?? history); },
        rememberPersonalCarVehicle: async (id) => { calls.push(['remember', id]); },
        reportPersonalCarTrip: async (input) => {
          calls.push(['report', input]);
          if (failReport) { failReport = false; throw new Error('Mreža nije dostupna.'); }
          return input.id;
        },
        cancelPersonalCarTrip: async (...args) => {
          calls.push(['cancel', ...args]);
          if (config.cancelError) throw new Error('Trošak je već plaćen.');
        },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => { stateCursor = 0; refCursor = 0; return module.exports.PersonalCarTab(); };
  const submit = async () => {
    const form = elements(render()).find((node) => node.type === 'form');
    form.props.onSubmit({ preventDefault() {} });
    await flush();
  };
  return {
    states, calls, render, submit,
    async start() { render(); const cleanup = effect(); await flush(); return cleanup; },
    button(label) { return elements(render()).find((node) => node.type === 'button' && text(node) === label); },
  };
}

test('pilot tab visibility and content both require the server capability, not a name comparison', () => {
  const portal = readFileSync(new URL('../src/components/mobile/MobileWorkOrdersView.tsx', import.meta.url), 'utf8');
  assert.match(portal, /fetchPersonalCarAccess\(\)/);
  assert.match(portal, /tab.id !== 'osobni_auto' \|\| personalCarAccess/);
  assert.match(portal, /portalTab === 'osobni_auto' && personalCarAccess && <PersonalCarTab/);
  assert.doesNotMatch(portal, /Perićak/);
  assert.match(portal, /setPersonalCarAccess\(false\)/);
  assert.match(portal, /Ponovi provjeru pristupa/);
});

test('trip form selects remembered car, derives km/cost, and explains work-time recording', async () => {
  const ui = setup();
  await ui.start();
  assert.equal(ui.states.vehicleId, 'car');
  assert.equal(ui.states.startKm, '1000');
  ui.states.endKm = '1025';
  ui.states.destination = 'site';
  const rendered = text(ui.render());
  assert.match(rendered, /8,33/);
  assert.match(rendered, /Početak rada/);
  assert.match(rendered, /evidenciju radnog vremena i obračun/);
  assert.match(rendered, /radno vrijeme koji se već obračunavaju preko radnog naloga/);
  assert.match(rendered, /Razlog puta/);
  assert.doesNotMatch(rendered, /Vrijeme vožnje|Polazak|Dolazak/);
  const selects = elements(ui.render()).filter((node) => node.type === 'select');
  selects[0].props.onChange({ target: { value: 'car' } });
  await flush();
  assert.deepEqual(ui.calls.at(-1), ['remember', 'car']);
  assert.equal(ui.states.endKm, '');
});

test('private and business submissions use only raw trip input; unchanged retries keep UUID', async () => {
  const ui = setup({ failReport: true });
  await ui.start();
  Object.assign(ui.states, { destination: 'site', endKm: '1025', workStart: '08:00', workEnd: '16:00', note: 'Sastanak na gradilištu' });
  await ui.submit();
  assert.match(ui.states.error, /Mreža/);
  assert.equal(ui.states.notice, null);
  const first = ui.calls.find((call) => call[0] === 'report')[1];
  assert.equal(first.gradiliste_id, 'site');
  assert.equal(first.km_kraj, 1025);
  assert.equal(first.radno_vrijeme_od, '08:00');
  assert.equal(first.radno_vrijeme_do, '16:00');
  assert.equal(Object.keys(first).sort().join(','), 'datum,gradiliste_id,id,km_kraj,km_pocetak,napomena,radno_vrijeme_do,radno_vrijeme_od,vozilo_id,vrijeme_do,vrijeme_od');
  assert.equal(first.vrijeme_od, null);
  assert.equal(first.vrijeme_do, null);
  await ui.submit();
  assert.equal(ui.calls.filter((call) => call[0] === 'report')[1][1].id, first.id);
  assert.match(ui.states.notice, /radno vrijeme i trošak/);
  assert.equal(ui.states.endKm, '');
  Object.assign(ui.states, { destination: 'privatno', endKm: '1030' });
  await ui.submit();
  const last = ui.calls.filter((call) => call[0] === 'report').at(-1)[1];
  assert.notEqual(last.id, first.id);
  assert.equal(last.gradiliste_id, null);
  assert.equal(last.radno_vrijeme_od, null);
  assert.equal(last.radno_vrijeme_do, null);
  assert.match(ui.states.notice, /bez troška/);
});

test('client rejects missing destination, invalid km and business zero rate before RPC', async () => {
  for (const changes of [
    { destination: '' }, { endKm: '1000' }, { startKm: '-1' }, { endKm: '1025.5' },
    { workStart: '08:00' }, { workStart: '08:00', workEnd: '08:00' },
    { options: { ...options, vozila: [{ ...options.vozila[0], cijena_km: 0 }] } },
  ]) {
    const ui = setup();
    await ui.start();
    Object.assign(ui.states, { destination: 'site', endKm: '1025' }, changes);
    await ui.submit();
    assert.ok(ui.states.error);
    assert.equal(ui.calls.filter((call) => call[0] === 'report').length, 0);
  }
});

test('load failures do not show empty success-shaped history; successful save and failed refresh are distinguished', async () => {
  const broken = setup({ loadError: true });
  await broken.start();
  assert.match(text(broken.render()), /Učitavanje nije uspjelo/);
  assert.doesNotMatch(text(broken.render()), /Još nema prijavljenih|Prijavi vožnju/);
  const ui = setup({ refreshError: true });
  await ui.start();
  Object.assign(ui.states, { destination: 'site', endKm: '1025', workStart: '08:00', workEnd: '16:00' });
  await ui.submit();
  assert.match(ui.states.notice, /spremljeni/);
  assert.match(ui.states.error, /spremljena, ali prikaz nije osvježen/);
});

test('cancellation needs an inline reason, shows errors and preserves history; pagination sends actual cursor', async () => {
  const ui = setup({ cancelError: true });
  await ui.start();
  ui.button('Pogrešan unos? Storniraj').props.onClick();
  Object.assign(ui.states, { cancelReason: 'Pogrešan unos' });
  ui.button('Potvrdi storno').props.onClick();
  await flush();
  assert.deepEqual(ui.calls.find((call) => call[0] === 'cancel'), ['cancel', 'trip', 'Pogrešan unos']);
  assert.match(ui.states.error, /već plaćen/);
  assert.equal(ui.states.cancelId, 'trip');
  assert.equal(ui.states.notice, null);
  ui.states.hasMore = true;
  ui.button('Učitaj starije vožnje').props.onClick();
  await flush();
  assert.equal(ui.calls.filter((call) => call[0] === 'history').at(-1)[1].id, 'trip');
  assert.equal(ui.states.hasMore, false);
  assert.equal(ui.states.trips.length, 1);
});

function apiWith(rpc) {
  const apiSource = readFileSync(new URL('../src/lib/personalCar.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(apiSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, Error,
    require(name) {
      if (name === './supabase') return { supabase: { rpc } };
      if (name === './obracunSati') return { minuteSmjene: () => ({ ukupno: 480, nocne: 60 }) };
      if (name === './postavke') return { nocniInterval: () => ({ nocOd: 1320, danOd: 360 }) };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return module.exports;
}

test('API propagates migration errors, rejects unconfirmed saves and sends no financial or worker identity values', async () => {
  const calls = [];
  const api = apiWith(async (...args) => { calls.push(args); return { data: args[0] === 'has_my_personal_car' ? true : 'request', error: null }; });
  assert.equal(await api.fetchPersonalCarAccess(), true);
  await api.reportPersonalCarTrip({
    id: 'request', vozilo_id: 'car', datum: '2026-01-01', km_pocetak: 1000, km_kraj: 1025,
    gradiliste_id: 'site', vrijeme_od: null, vrijeme_do: null, radno_vrijeme_od: '08:00',
    radno_vrijeme_do: '16:00', napomena: '',
  });
  assert.equal(calls[1][0], 'report_my_personal_car_trip');
  assert.equal(calls[1][1].p_id, 'request');
  assert.equal(Object.keys(calls[1][1]).length, 12);
  assert.equal(calls[1][1].p_radno_vrijeme_od, '08:00');
  assert.equal(calls[1][1].p_radno_vrijeme_do, '16:00');
  assert.equal(calls[1][1].p_nocni_sati, 1);
  await assert.rejects(apiWith(async () => ({ error: { code: 'PGRST202', message: 'missing' } })).fetchPersonalCarAccess(), /20261110420000/);
  await assert.rejects(apiWith(async () => ({ data: null, error: null })).fetchPersonalCarAccess(), /nije potvrđena/);
  await assert.rejects(apiWith(async () => ({ data: 'wrong', error: null })).reportPersonalCarTrip({ id: 'request' }), /nije potvrđeno/);
});
