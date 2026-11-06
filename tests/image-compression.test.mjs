import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/imageCompression.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

class TestFile extends Blob {
  constructor(parts, name, options) {
    super(parts, options);
    this.name = name;
    this.lastModified = options.lastModified;
  }
}

function setup(webpSupported) {
  const requestedFormats = [];
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    File: TestFile,
    Blob,
    createImageBitmap: async () => ({ width: 1200, height: 900, close() {} }),
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} }),
        toBlob: (callback, type) => {
          requestedFormats.push(type);
          const outputType = type === 'image/webp' && !webpSupported ? 'image/png' : type;
          callback(new Blob(['image'], { type: outputType }));
        },
      }),
    },
  });
  return { compress: module.exports.compressPhotoForUpload, requestedFormats };
}

test('photo compression falls back to JPEG when mobile browser cannot encode WebP', async () => {
  const { compress, requestedFormats } = setup(false);
  const result = await compress({ type: 'image/jpeg', name: 'teren.jpg', lastModified: 123 });

  assert.equal(result.image.type, 'image/jpeg');
  assert.equal(result.image.name, 'teren.jpg');
  assert.equal(result.thumbnail.type, 'image/jpeg');
  assert.equal(result.thumbnail.name, 'teren-thumbnail.jpg');
  assert.deepEqual([...requestedFormats].sort(), ['image/jpeg', 'image/jpeg', 'image/webp', 'image/webp']);
});

test('photo compression keeps WebP when supported', async () => {
  const { compress, requestedFormats } = setup(true);
  const result = await compress({ type: 'image/jpeg', name: 'teren.jpg', lastModified: 123 });

  assert.equal(result.image.type, 'image/webp');
  assert.equal(result.image.name, 'teren.webp');
  assert.equal(result.thumbnail.type, 'image/webp');
  assert.equal(result.thumbnail.name, 'teren-thumbnail.webp');
  assert.deepEqual(requestedFormats, ['image/webp', 'image/webp']);
});
