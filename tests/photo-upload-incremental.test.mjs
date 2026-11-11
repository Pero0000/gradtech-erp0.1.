import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function execute(source, context = {}) {
  const module = { exports: {} };
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  vm.runInNewContext(outputText, { module, exports: module.exports, ...context });
  return module.exports;
}

function apiSetup({ insertError = false, thumbnailError = false, siteCopyError = false } = {}) {
  const calls = [];
  let sequence = 0;
  const api = execute(readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8'), {
    require: name => {
      if (name === './imageCompression') return {
        compressPhotoForUpload: async () => ({
          image: { type: 'image/webp', size: 20 },
          thumbnail: { type: 'image/webp', size: 5 },
        }),
      };
      if (name !== './supabase') return {};
      return { supabase: {
        storage: { from: () => ({
          upload: async path => {
            calls.push(['upload', path]);
            return { error: thumbnailError && path.includes('-thumbnail') ? new Error('thumbnail failed') : null };
          },
          remove: async paths => { calls.push(['remove', ...paths]); return { error: null }; },
          createSignedUrl: async path => {
            calls.push(['sign', path]);
            return { data: { signedUrl: `signed:${path}` }, error: null };
          },
        }) },
        from: table => ({
          insert: row => ({
            then: resolve => {
              calls.push(['site-copy', table, row]);
              resolve({ error: siteCopyError ? new Error('site copy failed') : null });
            },
            select: () => ({
              single: async () => {
                calls.push(['insert', table, row]);
                return { data: { ...row, id: `new-${++sequence}` }, error: insertError ? new Error('insert failed') : null };
              },
            }),
          }),
          select: () => {
            assert.equal(table, 'radni_nalozi', 'upload must not reload the gallery');
            return { eq: () => ({ single: async () => ({ data: { gradiliste_id: 'site' }, error: null }) }) };
          },
        }),
      } };
    },
  });
  return { api, calls };
}

test('upload returns only the new photo; signing uses cache and never touches existing paths', async () => {
  const { api, calls } = apiSetup();
  await api.getPrivateFileUrl('existing.webp');
  const result = await api.uploadNalogFoto('order', { name: 'new.jpg' }, false);
  assert.equal(result.foto.id, 'new-1');
  assert.equal(result.warning, null);
  assert.equal(calls.filter(([kind]) => kind === 'sign').length, 1);
  const photo = await api.withPrivateFileUrls(result.foto);
  assert.equal(photo.url, `signed:${photo.putanja}`);
  assert.equal(photo.thumbnailUrl, `signed:${photo.thumbnail_path}`);
  await api.withPrivateFileUrls(result.foto);
  await api.getPrivateFileUrl('existing.webp');
  assert.equal(calls.filter(([kind]) => kind === 'sign').length, 3);
  assert.equal(calls.filter(([kind]) => kind === 'upload').length, 2);
});

test('office upload preserves shared site paths and explicitly reports a site-copy warning', async () => {
  for (const siteCopyError of [false, true]) {
    const { api, calls } = apiSetup({ siteCopyError });
    const result = await api.uploadNalogFoto('order', { name: 'new.jpg' });
    const copy = calls.find(([kind]) => kind === 'site-copy')[2];
    assert.equal(copy.gradiliste_id, 'site');
    assert.equal(copy.putanja, result.foto.putanja);
    assert.equal(copy.thumbnail_path, result.foto.thumbnail_path);
    assert.equal(calls.filter(([kind]) => kind === 'upload').length, 2);
    if (siteCopyError) assert.match(result.warning, /site copy failed/);
    else assert.equal(result.warning, null);
  }
});

for (const vrsta of ['slika', 'dokument']) {
  test(`site upload returns new ${vrsta} without gallery SELECT or repeated signing`, async () => {
    const { api, calls } = apiSetup();
    const row = await api.uploadGradilisteDokument('site', { name: 'test.jpg', size: 30 }, vrsta);
    assert.equal(row.gradiliste_id, 'site');
    assert.equal(row.vrsta, vrsta);
    await api.withPrivateFileUrls(row);
    await api.withPrivateFileUrls(row);
    assert.equal(calls.filter(([kind]) => kind === 'sign').length, vrsta === 'slika' ? 2 : 1);
  });
}

for (const method of ['uploadNalogFoto', 'uploadGradilisteDokument']) {
  test(`${method} preserves cleanup on metadata and thumbnail failure`, async () => {
    for (const options of [{ insertError: true }, { thumbnailError: true }]) {
      const { api, calls } = apiSetup(options);
      await assert.rejects(api[method]('owner', { name: 'test.jpg' }, method === 'uploadNalogFoto' ? false : 'slika'));
      assert.equal(calls.filter(([kind]) => kind === 'remove').length, 1);
      assert.equal(calls.filter(([kind]) => kind === 'sign').length, 0);
    }
  });
}

function callback(file, componentName, callbackName, context) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === componentName);
  if (callbackName === 'photoQueueEffect') {
    const effect = component.body.statements.find(node => ts.isExpressionStatement(node)
      && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect'
      && node.expression.arguments[1]?.getText(ast).includes('photoQueue'));
    return execute(`export const callback = ${effect.expression.arguments[0].getText(ast)}`, context).callback;
  }
  const declaration = component.body.statements.filter(ts.isVariableStatement)
    .flatMap(node => [...node.declarationList.declarations])
    .find(node => node.name.getText(ast) === callbackName);
  return execute(`export const callback = ${declaration.initializer.getText(ast)}`, context).callback;
}

for (const [file, component, name, setter, args] of [
  ['../src/components/views/NalogIzvrsenje.tsx', 'NalogIzvrsenje', 'onFiles', 'setFoto', [[{ name: '1' }, { name: '2' }]]],
  ['../src/components/views/GradilisteMaterijalDokumenti.tsx', 'GradilisteMaterijalDokumenti', 'upload', 'setDokumenti', [[{ name: '1' }, { name: '2' }], 'slika']],
]) {
  test(`${component}: batch appends each new item and preserves existing object references and URLs`, async () => {
    const existing = { id: 'existing', url: 'old-url', thumbnailUrl: 'old-thumb' };
    let gallery = [existing];
    let count = 0;
    const context = {
      nalog: { id: 'order' }, gradilisteId: 'site',
      fileRef: { current: {} }, docRef: { current: {} }, imgRef: { current: {} },
      setUploading() {}, setError() {},
      guard: action => action(),
      withPrivateFileUrls: async row => ({ ...row, url: 'new-url', thumbnailUrl: 'new-thumb' }),
      uploadNalogFoto: async () => ({ foto: { id: `new-${++count}` }, warning: null }),
      uploadGradilisteDokument: async () => ({ id: `new-${++count}` }),
      [setter]: update => { gallery = update(gallery); },
    };
    await callback(file, component, name, context)(...args);
    assert.equal(gallery.length, 3);
    assert.equal(gallery[0], existing);
    assert.equal(gallery[0].url, 'old-url');
    assert.deepEqual(Array.from(gallery, item => item.id), ['existing', 'new-1', 'new-2']);
  });
}

for (const scenario of ['success', 'left-before-upload', 'left-during-sign', 'sign-error', 'upload-error']) {
  test(`mobile upload: ${scenario}, no gallery fetch or force refresh`, async () => {
    const existing = { id: 'existing', url: 'unchanged' };
    let details = { foto: [existing] };
    let queue = [{ id: 'queued', nalogId: 'order', status: 'ceka', file: {} }];
    let signed = 0;
    let removed = 0;
    let error = null;
    const selectedIdRef = { current: 'order' };
    const context = {
      photoQueue: queue, selectedIdRef,
      setPhotoQueue: update => { queue = update(queue); },
      uploadNalogFoto: async (...args) => {
        assert.equal(args[2], false);
        if (scenario === 'upload-error') throw new Error('upload failed');
        if (scenario === 'left-before-upload') selectedIdRef.current = 'other';
        return { foto: { id: 'new' }, warning: null };
      },
      withPrivateFileUrls: async row => {
        signed++;
        if (scenario === 'sign-error') throw new Error('sign failed');
        if (scenario === 'left-during-sign') selectedIdRef.current = 'other';
        return { ...row, url: 'new-url' };
      },
      removeQueuedPhoto: () => { removed++; queue = []; },
      setUploadedPhotos: update => { details = { foto: update(details.foto) }; },
      setPhotoLoadError: value => { error = value; },
      errorMessage: reason => reason.message,
    };
    callback('../src/components/mobile/MobileWorkOrdersView.tsx', 'MobileWorkOrdersView', 'photoQueueEffect', context)();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(details.foto[0], existing);
    assert.equal(details.foto.length, scenario === 'success' ? 2 : 1);
    assert.equal(signed, ['left-before-upload', 'upload-error'].includes(scenario) ? 0 : 1);
    assert.equal(removed, scenario === 'upload-error' ? 0 : 1);
    assert.equal(error, scenario === 'sign-error' ? 'sign failed' : null);
    if (scenario === 'upload-error') assert.equal(queue[0].status, 'greska');
  });
}

test('mobile manual retry forces only a failed path; ordinary reload never forces the gallery', async () => {
  for (const failed of [[], ['broken-thumbnail']]) {
    const calls = [];
    const context = {
      filesKey: 'order', useCallback: fn => fn,
      failedPhotoPaths: { current: new Set(failed) },
      getPrivateFileUrl: async (...args) => { calls.push(['sign', ...args]); },
      fetchNalogFoto: async (...args) => { calls.push(['fetch', ...args]); return []; },
      setRefreshingPhotos() {}, setDetails() {}, setPhotoLoadError() {},
    };
    await callback('../src/components/mobile/MobileWorkOrdersView.tsx', 'MobileWorkOrdersView', 'fetchPhotos', context)();
    assert.deepEqual(calls, [
      ...failed.map(path => ['sign', path, 3600, true]),
      ['fetch', 'order'],
    ]);
    assert.equal(context.failedPhotoPaths.current.size, 0);
  }
});

test('mobile queue remains busy until signing finishes, so the next upload cannot overlap', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let queue = [{ id: 'first', nalogId: 'order', status: 'ceka', file: {} }, {
    id: 'second', nalogId: 'order', status: 'ceka', file: {},
  }];
  const context = {
    photoQueue: queue, selectedIdRef: { current: 'order' },
    setPhotoQueue: update => { queue = update(queue); },
    uploadNalogFoto: async () => ({ foto: { id: 'new' } }),
    withPrivateFileUrls: () => pending,
    setUploadedPhotos() {}, setPhotoLoadError() {},
    removeQueuedPhoto: id => { queue = queue.filter(item => item.id !== id); },
  };
  callback('../src/components/mobile/MobileWorkOrdersView.tsx', 'MobileWorkOrdersView', 'photoQueueEffect', context)();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue[0].status, 'salje');
  context.photoQueue = queue;
  callback('../src/components/mobile/MobileWorkOrdersView.tsx', 'MobileWorkOrdersView', 'photoQueueEffect', context)();
  assert.equal(queue[1].status, 'ceka');
  release({ id: 'new', url: 'new' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, 'second');
});
