import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function load(file, context) {
  const module = { exports: {} };
  const result = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  vm.runInNewContext(result.outputText, { module, exports: module.exports, ...context });
  return module.exports;
}

for (const method of ['fetchNalogFoto', 'fetchGradilisteRadniNalogFoto', 'fetchGradilisteDokumenti']) {
  test(`${method}: metadata + thumbnails only; originals require explicit request`, async () => {
    const calls = [];
    const photos = Array.from({ length: 10 }, (_, i) => ({
      id: `${i}`, nalog_id: 'order', vrsta: 'slika', putanja: `original-${i}`, thumbnail_path: `thumb-${i}`,
    }));
    const api = load('../src/lib/api.ts', {
      require: name => name === './supabase' ? { supabase: {
        from: table => {
          const query = {
            select() { return this; }, eq() { return this; }, in() { return this; },
            order: async () => ({ data: photos, error: null }),
            then: resolve => resolve({ data: table === 'radni_nalozi' ? [{ id: 'order', broj: '1' }] : photos, error: null }),
          };
          return query;
        },
        storage: { from: () => ({ createSignedUrl: async path => {
          calls.push(path);
          return { data: { signedUrl: `signed:${path}` }, error: null };
        } }) },
      } } : {},
    });
    const result = await api[method]('owner');
    assert.equal(result.length, 10);
    assert.deepEqual(calls, photos.map(photo => photo.thumbnail_path));
    result.forEach(photo => { assert.equal(photo.url, null); assert.equal(photo.thumbnailUrl, `signed:${photo.thumbnail_path}`); });
    await api[method]('owner');
    assert.equal(calls.length, 10, 'thumbnail cache remains effective');
    await api.getPrivateFileUrl(result[2].putanja);
    assert.equal(calls.length, 11);
    assert.equal(calls.at(-1), 'original-2');
  });
}

test('legacy photos with missing/identical thumbnail never sign an original just to render a gallery', async () => {
  const calls = [];
  const api = load('../src/lib/api.ts', {
    require: name => name === './supabase' ? { supabase: { storage: { from: () => ({
      createSignedUrl: async path => { calls.push(path); return { data: { signedUrl: path }, error: null }; },
    }) } } } : {},
  });
  for (const thumbnail_path of [null, 'original']) {
    const preview = await api.withPrivateFileUrls({ putanja: 'original', thumbnail_path });
    assert.equal(preview.url, null);
    assert.match(preview.thumbnailUrl, /^data:image\/svg/);
  }
  assert.equal(calls.length, 0);
  const document = await api.withPrivateFileUrls({ vrsta: 'dokument', putanja: 'pdf', thumbnail_path: null });
  assert.equal(document.url, 'pdf');
  assert.deepEqual(calls, ['pdf']);
});

function uiSetup() {
  const slots = [];
  let index = 0;
  let effects = [];
  const calls = [];
  let rejectSigning = false;
  let blocked = false;
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
    useCallback: fn => fn,
    useEffect(effect, deps) {
      const i = index++;
      if (!slots[i] || deps.some((value, j) => value !== slots[i].deps[j])) {
        slots[i]?.cleanup?.();
        slots[i] = { deps };
        effects.push(() => { slots[i].cleanup = effect(); });
      }
    },
  };
  const components = load('../src/components/ui/PrivateImage.tsx', {
    Error,
    window: { open: () => {
      calls.push(['open']);
      return blocked ? null : {
        opener: {}, location: { replace: url => calls.push(['navigate', url]) },
        close: () => calls.push(['close']),
      };
    } },
    require: name => ({
      react, 'react/jsx-runtime': jsx,
      '@/lib/api': { getPrivateFileUrl: async (...args) => {
        calls.push(['sign', ...args]);
        if (rejectSigning) throw new Error('Storage unavailable');
        return `signed:${args[0]}`;
      } },
      '@/lib/downloadFile': { downloadFile: async (...args) => calls.push(['download', ...args]) },
    })[name],
  });
  return {
    calls,
    failure(value) { rejectSigning = value; },
    block() { blocked = true; },
    render(name, props) {
      index = 0;
      const tree = components[name](props);
      const pending = effects;
      effects = [];
      pending.forEach(effect => effect());
      return tree;
    },
  };
}

test('link render does not sign; click opens one original, repeated click shares pending action', async () => {
  const ui = uiSetup();
  const tree = ui.render('PrivateFileLink', { path: 'original', children: 'Photo' });
  assert.equal(ui.calls.length, 0);
  tree.props.children[0].props.onClick();
  tree.props.children[0].props.onClick();
  await flush();
  assert.deepEqual(ui.calls, [['open'], ['sign', 'original'], ['navigate', 'signed:original']]);
});

test('explicit download signs only the selected original without a popup', async () => {
  const ui = uiSetup();
  ui.render('PrivateFileLink', { path: 'original', filename: 'photo.jpg' }).props.children[0].props.onClick();
  await flush();
  assert.deepEqual(ui.calls, [['sign', 'original'], ['download', 'signed:original', 'photo.jpg']]);
});

test('blocked popup and signing errors are explicit, not empty successful tabs', async () => {
  for (const scenario of ['blocked', 'sign-error']) {
    const ui = uiSetup();
    if (scenario === 'blocked') ui.block();
    else ui.failure(true);
    const props = { path: 'original' };
    ui.render('PrivateFileLink', props).props.children[0].props.onClick();
    await flush();
    const error = ui.render('PrivateFileLink', props).props.children[1];
    assert.equal(error.props.role, 'alert');
    if (scenario === 'blocked') assert.equal(ui.calls.length, 1);
    else assert.deepEqual(ui.calls.at(-1), ['close']);
  }
});

test('modal signs only selected path, navigation discards previous URL, broken image has explicit forced retry', async () => {
  const ui = uiSetup();
  ui.render('PrivateImage', { path: 'first', alt: 'Photo' });
  await flush();
  let tree = ui.render('PrivateImage', { path: 'first', alt: 'Photo' });
  assert.equal(tree.props.src, 'signed:first');
  tree = ui.render('PrivateImage', { path: 'second', alt: 'Photo' });
  assert.equal(tree.props.src, undefined, 'old original must not flash under the next photo');
  await flush();
  tree = ui.render('PrivateImage', { path: 'second', alt: 'Photo' });
  tree.props.onError();
  tree = ui.render('PrivateImage', { path: 'second', alt: 'Photo' });
  assert.equal(tree.props.role, 'alert');
  tree.props.children[1].props.onClick();
  ui.render('PrivateImage', { path: 'second', alt: 'Photo' });
  await flush();
  assert.deepEqual(ui.calls, [
    ['sign', 'first', 3600, false], ['sign', 'second', 3600, false], ['sign', 'second', 3600, true],
  ]);
});

test('gallery original consumers are on-demand, including ZIP and individual downloads', () => {
  const site = read('../src/components/views/GradilisteDetailsPanel.tsx');
  const docs = read('../src/components/views/GradilisteMaterijalDokumenti.tsx');
  const office = read('../src/components/views/NalogIzvrsenje.tsx');
  const mobile = read('../src/components/mobile/MobileWorkOrdersView.tsx');
  assert.doesNotMatch([site, docs, office, mobile].join('\n'), /src=\{(?:selectedFoto|activePhoto|sortedRadniNalogFoto\[[^\]]+\])\.url\}|href=\{photo.url\}|fetch\(foto.url\)/);
  assert.match(site, /fetch\(await getPrivateFileUrl\(foto.putanja\)\)/);
  assert.match(site, /downloadFile\(await getPrivateFileUrl\(foto.putanja\)/);
  assert.match(docs, /downloadFile\(await getPrivateFileUrl\(photo.putanja\)/);
});
