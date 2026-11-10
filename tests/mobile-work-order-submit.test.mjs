import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const viewSource = readFileSync(new URL('../src/components/mobile/MobileWorkOrdersView.tsx', import.meta.url), 'utf8');
const viewAst = ts.createSourceFile('view.tsx', viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = viewAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'MobileWorkOrdersView');

function loadCallback(name, context) {
  const declaration = component.body.statements
    .filter(ts.isVariableStatement)
    .flatMap(node => [...node.declarationList.declarations])
    .find(node => node.name.getText(viewAst) === name);
  const source = `export const callback = ${declaration.initializer.getText(viewAst)};`;
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, ...context });
  return module.exports.callback;
}

function setupDetails({ documentFailure = false, siteFailure = false } = {}) {
  const state = {};
  const calls = [];
  const context = {
    useCallback: callback => callback,
    errorMessage: (reason, fallback) => reason?.message ?? fallback,
    DEFAULT_POCETAK_RADA: '06:00',
    DEFAULT_KRAJ_RADA: '16:00',
    supabase: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({
      data: { gradiliste_id: 'site', mobile_potvrde: [], mobile_km_na: true },
      error: null,
    }) }) }) }) },
    fetchNalogFoto: async () => [],
    fetchNalogZadaci: async () => [],
    fetchNalogStavke: async () => [],
    fetchNalogDokumenti: async () => {
      if (documentFailure) throw new Error('Object not found');
      return [{ id: 'order-doc' }];
    },
    fetchNalogGradilisteDokumentIds: async () => ['linked-doc'],
    fetchMobileNalogTeam: async () => [{ radnik_id: 'worker', dodatne_dionice: [] }],
    fetchMobileNalogVoznje: async () => [],
    fetchOprema: async () => [],
    fetchGradilisteDokumenti: async (...args) => {
      calls.push(args);
      if (siteFailure) throw new Error('Object not found');
      return [{ id: 'linked-doc' }];
    },
  };
  for (const name of ['Loading', 'Error', 'Notice', 'PhotoLoadError', 'DocumentLoadError', 'RouteLoadError', 'EquipmentLoadError', 'ExtraTimeRows', 'BezSatiRadnici', 'Prep', 'Details', 'TeamTimeDrafts', 'Potvrde', 'Report']) {
    context[`set${name}`] = value => { state[name] = typeof value === 'function' ? value(state[name] ?? {}) : value; };
  }
  return { callback: loadCallback('loadDetails', context), state, calls };
}

for (const options of [{ documentFailure: true }, { siteFailure: true }, { documentFailure: true, siteFailure: true }]) {
  test(`missing attachments do not block mobile order details: ${JSON.stringify(options)}`, async () => {
    const { callback, state, calls } = setupDetails(options);
    await callback({ id: 'order-138' });
    assert.equal(state.Error, null);
    assert.equal(state.Details.ekipa[0].radnik_id, 'worker');
    assert.match(state.DocumentLoadError, /Object not found/);
    assert.match(state.DocumentLoadError, /ne sprječava predaju naloga/);
    assert.equal(state.Loading, false);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['site', ['linked-doc']]]);
    assert.equal(state.Details.dokumenti.length, Number(!options.documentFailure) + Number(!options.siteFailure));
  });
}

test('attachment retry clears the previous warning after recovery', async () => {
  const { callback, state } = setupDetails();
  state.DocumentLoadError = 'Previous error';
  await callback({ id: 'order-138' }, false);
  assert.equal(state.DocumentLoadError, null);
  assert.equal(state.Details.dokumenti.length, 2);
});

function setupAction({ refreshFailure = false } = {}) {
  const state = {};
  const context = {
    selectedId: 'order-138',
    errorMessage: (reason, fallback) => reason?.message ?? fallback,
    visibleMobileOrders: orders => orders,
    fetchMobileRadniNalozi: async () => {
      if (refreshFailure) throw new Error('Network error');
      return [{ id: 'order-138', mobile_status: 'predan' }];
    },
    loadDetails: async order => { state.LoadedStatus = order.mobile_status; },
  };
  for (const name of ['Working', 'Error', 'Notice', 'Orders']) {
    context[`set${name}`] = value => { state[name] = value; };
  }
  return { callback: loadCallback('runAction', context), state };
}

test('successful worker submission refreshes the submitted status', async () => {
  const { callback, state } = setupAction();
  let submissions = 0;
  await callback(async () => { submissions++; }, 'Nalog je predan.');
  assert.equal(submissions, 1);
  assert.equal(state.Notice, 'Nalog je predan.');
  assert.equal(state.Error, null);
  assert.equal(state.LoadedStatus, 'predan');
  assert.equal(state.Working, false);
});

test('refresh failure after successful submission explicitly reports that the change was saved', async () => {
  const { callback, state } = setupAction({ refreshFailure: true });
  await callback(async () => {}, 'Nalog je predan.');
  assert.equal(state.Notice, 'Nalog je predan.');
  assert.match(state.Error, /Promjena je spremljena, ali prikaz nije osvježen/);
  assert.equal(state.Working, false);
});

test('failed submission is not presented as a success', async () => {
  const { callback, state } = setupAction();
  await callback(async () => { throw new Error('Potvrdi radno vrijeme cijele ekipe.'); }, 'Nalog je predan.');
  assert.equal(state.Notice, null);
  assert.equal(state.Error, 'Potvrdi radno vrijeme cijele ekipe.');
  assert.equal(state.Orders, undefined);
  assert.equal(state.Working, false);
});

const apiSource = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const { outputText: apiJs } = ts.transpileModule(apiSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

test('site document query filters linked IDs before requesting any Storage URLs', async () => {
  const calls = [];
  const query = {
    select() { return this; },
    eq(...args) { calls.push(['eq', ...args]); return this; },
    in(...args) { calls.push(['in', ...args]); return this; },
    async order() { return { data: [{ id: 'linked-doc', putanja: 'linked.pdf', thumbnail_path: null }], error: null }; },
  };
  const module = { exports: {} };
  vm.runInNewContext(apiJs, {
    module, exports: module.exports,
    require: name => name === './supabase'
      ? { supabase: {
        from() { calls.push(['from']); return query; },
        storage: { from: () => ({ createSignedUrl: async path => {
          calls.push(['sign', path]);
          return { data: { signedUrl: `signed:${path}` }, error: null };
        } }) },
      } }
      : {},
  });
  const empty = await module.exports.fetchGradilisteDokumenti('site', []);
  assert.equal(empty.length, 0);
  assert.equal(calls.length, 0);
  const docs = await module.exports.fetchGradilisteDokumenti('site', ['linked-doc']);
  assert.equal(docs[0].url, 'signed:linked.pdf');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['from'], ['eq', 'gradiliste_id', 'site'], ['in', 'id', ['linked-doc']], ['sign', 'linked.pdf'],
  ]);
});
