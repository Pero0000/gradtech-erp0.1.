import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function createStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function loadNavigation(storage) {
  const source = readFileSync(new URL('../src/lib/postavke.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.equal(name, './company');
      return { companyStorage: storage, requireCompany() {} };
    },
    window: { localStorage: storage },
    document: { documentElement: { dataset: {}, style: {} } },
    Event,
  });
  return module.exports;
}

test('sidebar icon preference persists separately for each user', () => {
  const storage = createStorage();
  const navigation = loadNavigation(storage);

  assert.deepEqual(
    JSON.parse(JSON.stringify(navigation.loadUserNavigation('ana'))),
    { prikaz: 'ikone_tekst' },
  );

  const saved = { prikaz: 'ikone' };
  navigation.saveUserNavigation('ana', saved);
  assert.deepEqual(
    JSON.parse(JSON.stringify(navigation.loadUserNavigation('ana'))),
    saved,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(navigation.loadUserNavigation('bo'))),
    { prikaz: 'ikone_tekst' },
  );
});

test('sidebar preference falls back to labels for an invalid saved value', () => {
  const storage = createStorage();
  storage.setItem('tm_navigacija_ana', JSON.stringify({
    prikaz: 'nepoznato',
  }));
  const navigation = loadNavigation(storage);

  assert.deepEqual(
    JSON.parse(JSON.stringify(navigation.loadUserNavigation('ana'))),
    { prikaz: 'ikone_tekst' },
  );
});
