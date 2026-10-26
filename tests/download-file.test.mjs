import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/downloadFile.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function setup(fetch) {
  const calls = [];
  const link = {
    click() { calls.push(['click', this.href, this.download]); },
    remove() { calls.push(['remove']); },
  };
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, fetch,
    document: {
      createElement: (tag) => { assert.equal(tag, 'a'); return link; },
      body: { appendChild: (element) => { assert.equal(element, link); calls.push(['append']); } },
    },
    URL: {
      createObjectURL: (blob) => { calls.push(['blob', blob]); return 'blob:photo'; },
      revokeObjectURL: (url) => calls.push(['revoke', url]),
    },
    window: { setTimeout: (callback, delay) => { assert.equal(delay, 2000); callback(); } },
  });
  return { downloadFile: module.exports.downloadFile, calls };
}

test('downloads cross-origin photos using a blob, preserving the filename and releasing the URL', async () => {
  const blob = new Blob(['photo']);
  const { downloadFile, calls } = setup(async (url) => {
    assert.equal(url, 'https://storage.example/photo?token=signed');
    return { ok: true, blob: async () => blob };
  });
  await downloadFile('https://storage.example/photo?token=signed', 'gradilište/slika.jpg');
  assert.deepEqual(calls, [
    ['blob', blob], ['append'], ['click', 'blob:photo', 'gradilište_slika.jpg'], ['remove'], ['revoke', 'blob:photo'],
  ]);
});

test('HTTP errors are surfaced without triggering a download', async () => {
  const { downloadFile, calls } = setup(async () => ({ ok: false }));
  await assert.rejects(downloadFile('https://storage.example/photo', 'photo.jpg'), /Preuzimanje/);
  assert.deepEqual(calls, []);
});

test('network errors are propagated without triggering a download', async () => {
  const error = new Error('Network unavailable');
  const { downloadFile, calls } = setup(async () => { throw error; });
  await assert.rejects(downloadFile('https://storage.example/photo', 'photo.jpg'), (reason) => reason === error);
  assert.deepEqual(calls, []);
});
