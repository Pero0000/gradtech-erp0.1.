import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup() {
  const slots = [];
  let index = 0;
  let effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], update => { slots[i] = typeof update === 'function' ? update(slots[i]) : update; }];
    },
    useRef(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useCallback(fn, deps) {
      const i = index++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn };
      return slots[i].value;
    },
    useEffect(effect, deps) {
      const i = index++;
      if (!same(slots[i]?.deps, deps)) {
        slots[i]?.cleanup?.();
        slots[i] = { deps };
        effects.push(() => { slots[i].cleanup = effect(); });
      }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(read('../src/lib/useDeferredFiles.ts')), {
    module, exports: module.exports,
    require: name => { assert.equal(name, 'react'); return react; },
  });
  return {
    render(key, enabled, load) {
      index = 0;
      const result = module.exports.useDeferredFiles(key, enabled, load);
      const next = effects;
      effects = [];
      next.forEach(effect => effect());
      return result;
    },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('unopened tab: zero file queries/signatures; opening loads once; rerenders do not refresh', async () => {
  const harness = setup();
  let calls = 0;
  const load = async () => { calls++; return [{ id: 'photo', url: 'signed-url' }]; };
  let files = harness.render('order', false, load);
  await files.refresh();
  await flush();
  assert.equal(calls, 0);
  harness.render('order', true, load);
  await flush();
  files = harness.render('order', true, load);
  assert.equal(calls, 1);
  assert.equal(files.data[0].url, 'signed-url');
  harness.render('order', true, load);
  await flush();
  assert.equal(calls, 1);
  files = harness.render('order', false, load);
  await files.refresh();
  assert.equal(calls, 1);
  harness.render('order', true, load);
  await flush();
  assert.equal(calls, 2);
});

test('mount, repeated clicks and timer ticks share one in-flight request', async () => {
  const harness = setup();
  let resolve;
  let calls = 0;
  const load = () => { calls++; return new Promise(done => { resolve = done; }); };
  const files = harness.render('site', true, load);
  const first = files.refresh();
  for (let i = 0; i < 10; i++) assert.equal(files.refresh(), first);
  await flush();
  assert.equal(calls, 1);
  assert.equal(harness.render('site', true, load).loading, true);
  resolve([{ id: 'new' }]);
  await first;
  const completed = harness.render('site', true, load);
  assert.equal(completed.loading, false);
  assert.equal(completed.data.length, 1);
});

test('failure is visible, old data stays available, retry is possible and deduplicated', async () => {
  const harness = setup();
  let failure = false;
  const load = async () => {
    if (failure) throw new Error('Storage unavailable');
    return [{ id: 'old', url: 'cached' }];
  };
  harness.render('site', true, load);
  await flush();
  let files = harness.render('site', true, load);
  const existing = files.data[0];
  failure = true;
  await files.refresh();
  files = harness.render('site', true, load);
  assert.equal(files.data[0], existing);
  assert.match(files.error.message, /Storage unavailable/);
  assert.equal(files.loading, false);
  failure = false;
  await files.refresh();
  files = harness.render('site', true, load);
  assert.equal(files.error, null);
});

test('late response and upload setter for a previous entity cannot overwrite current files', async () => {
  const harness = setup();
  let resolve;
  const loadOld = () => new Promise(done => { resolve = done; });
  const loadNew = async () => [{ id: 'new' }];
  const old = harness.render('old', true, loadOld);
  await flush();
  harness.render('new', false, loadNew);
  old.setData([{ id: 'late-upload' }]);
  resolve([{ id: 'old' }]);
  await flush();
  let files = harness.render('new', false, loadNew);
  assert.equal(files.data.length, 0);
  harness.render('new', true, loadNew);
  await flush();
  files = harness.render('new', true, loadNew);
  assert.equal(files.data[0].id, 'new');
});

test('adding uploaded photo preserves existing references and makes no refresh request', async () => {
  const harness = setup();
  let calls = 0;
  const load = async () => { calls++; return [{ id: 'old', url: 'keep' }]; };
  harness.render('order', true, load);
  await flush();
  let files = harness.render('order', true, load);
  const old = files.data[0];
  files.setData(current => [...current, { id: 'uploaded', url: 'new' }]);
  files = harness.render('order', true, load);
  await flush();
  assert.equal(files.data[0], old);
  assert.equal(files.data.length, 2);
  assert.equal(calls, 1);
});

test('unmount prevents updates from an already running request', async () => {
  const harness = setup();
  let resolve;
  const load = () => new Promise(done => { resolve = done; });
  const files = harness.render('site', true, load);
  const pending = files.refresh();
  await flush();
  harness.dispose();
  resolve([{ id: 'late' }]);
  await pending;
  assert.equal(harness.render('site', false, load).data.length, 0);
});

function initializer(file, name) {
  const source = read(file);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return found;
}

test('initial site, office and mobile loaders contain no attachment queries', () => {
  for (const [file, name] of [
    ['../src/components/views/NalogIzvrsenje.tsx', 'load'],
    ['../src/components/views/GradilisteMaterijalDokumenti.tsx', 'load'],
    ['../src/components/mobile/MobileWorkOrdersView.tsx', 'loadDetails'],
  ]) {
    assert.doesNotMatch(initializer(file, name), /fetchNalogFoto|fetchNalogDokumenti|fetchGradilisteDokumenti|fetchNalogGradilisteDokumentIds|getPrivateFileUrl/);
  }
});

test('photo/doc gates are separate and site polling is gated by document-tab visibility', () => {
  const site = read('../src/components/views/GradilisteDetailsPanel.tsx');
  assert.match(site, /filesVisible = activeDetailTab === 'dokumenti'/);
  assert.match(site, /useDeferredFiles\(gradiliste.id, filesVisible, fetchPhotos\)/);
  assert.match(site, /if \(!filesVisible\) return;[\s\S]*?setInterval/);
  assert.match(site, /filesVisible=\{filesVisible\}/);
  const office = read('../src/components/views/NalogIzvrsenje.tsx');
  assert.match(office, /useDeferredFiles\(nalog.id, filesTab === 'foto', fetchPhotos\)/);
  assert.match(office, /useDeferredFiles\(nalog.id, filesTab === 'dokumenti', fetchDocuments\)/);
  const portal = read('../src/components/mobile/MobileWorkOrdersView.tsx');
  assert.match(portal, /useDeferredFiles\(filesKey, photosOpen && Boolean\(detailsState\), fetchPhotos\)/);
  assert.match(portal, /useDeferredFiles\(filesKey, documentsOpen && Boolean\(detailsState\), fetchDocuments\)/);
  assert.match(portal, /onOpen=\{\(\) => openFiles\(true, false\)\}/);
  assert.match(portal, /onOpen=\{\(\) => openFiles\(true, true\)\}/);
});

test('lazy mobile documents preserve successful source and expose the other source error', async () => {
  for (const failedSource of ['order', 'site', 'links']) {
    const calls = [];
    const module = { exports: {} };
    vm.runInNewContext(compile(`export const callback = ${initializer('../src/components/mobile/MobileWorkOrdersView.tsx', 'fetchDocuments')};`), {
      module, exports: module.exports,
      useCallback: fn => fn,
      filesKey: 'order',
      detailsState: { gradilisteId: 'site' },
      errorMessage: reason => reason.message,
      fetchNalogDokumenti: async () => {
        calls.push('order');
        if (failedSource === 'order') throw new Error('order error');
        return [{ id: 'order-doc' }];
      },
      fetchNalogGradilisteDokumentIds: async () => {
        calls.push('links');
        if (failedSource === 'links') throw new Error('links error');
        return ['linked-doc'];
      },
      fetchGradilisteDokumenti: async (...args) => {
        calls.push(args);
        if (failedSource === 'site') throw new Error('site error');
        return [{ id: 'linked-doc' }];
      },
    });
    assert.equal(calls.length, 0);
    const [result] = await module.exports.callback();
    assert.match(result.error, new RegExp(`${failedSource} error`));
    assert.equal(result.documents.length, 1);
    assert.equal(result.documents[0].id, failedSource === 'order' ? 'linked-doc' : 'order-doc');
    if (failedSource !== 'links') assert.deepEqual(calls.at(-1), ['site', ['linked-doc']]);
  }
});
