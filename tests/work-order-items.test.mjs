import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function setup(rows, mutations = [], orders = []) {
  const supabase = {
    from: (table) => {
      let payload;
      let options;
      let operation = 'select';
      const filters = [];
      const query = {
        select: () => query,
        order: () => query,
        update: (value) => { operation = 'update'; payload = value; return query; },
        insert: (value) => { operation = 'insert'; payload = value; return query; },
        upsert: (value, valueOptions) => {
          operation = 'upsert';
          payload = value;
          options = valueOptions;
          return query;
        },
        delete: () => { operation = 'delete'; return query; },
        eq: (key, value) => { filters.push((row) => row[key] === value); return query; },
        is: (key, value) => { filters.push((row) => row[key] === value); return query; },
        not: (key, operator, value) => {
          assert.equal(operator, 'is');
          filters.push((row) => row[key] !== value);
          return query;
        },
        in: (key, values) => { filters.push((row) => values.includes(row[key])); return query; },
        neq: (key, value) => { filters.push((row) => row[key] !== value); return query; },
        then: (resolve, reject) => {
          const selected = (table === 'radni_nalozi' ? orders : rows)
            .filter((row) => filters.every((filter) => filter(row)));
          if (operation === 'update') selected.forEach((row) => Object.assign(row, payload));
          if (operation === 'insert' || operation === 'upsert' || operation === 'delete') {
            mutations.push({ operation, payload, options });
          }
          return Promise.resolve({ data: selected, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const mocks = {
    './supabase': { supabase },
    './postavke': {},
    './obracunSati': {},
    './company': {},
    './pagination': {},
    './vehicleKmCosts': {},
    './rokovi': {},
    './imageCompression': {},
  };
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import: ${name}`);
      return mocks[name];
    },
  });
  return module.exports;
}

test('saving task selection preserves completed tasks and only assigns unfinished tasks from the site', async () => {
  const rows = [
    { id: 'done-current', nalog_id: 'current', gradiliste_id: 'site', gotovo: true },
    { id: 'done-other', nalog_id: 'other', gradiliste_id: 'site', gotovo: true },
    { id: 'open-selected', nalog_id: 'other', gradiliste_id: 'site', gotovo: false },
    { id: 'open-unselected', nalog_id: 'current', gradiliste_id: 'site', gotovo: false },
    { id: 'foreign', nalog_id: 'other', gradiliste_id: 'foreign-site', gotovo: false },
  ];
  await setup(rows).setNalogZadaci('current', 'site', rows.map((row) => row.id).filter((id) => id !== 'open-unselected'));
  assert.deepEqual(rows.map((row) => row.nalog_id), ['current', 'other', 'current', null, 'other']);
});

test('saving an empty task selection keeps completed and site-less task history', async () => {
  const rows = [
    { id: 'done', nalog_id: 'current', gradiliste_id: 'site', gotovo: true },
    { id: 'site-less', nalog_id: 'current', gradiliste_id: null, gotovo: true },
    { id: 'open', nalog_id: 'current', gradiliste_id: 'site', gotovo: false },
  ];
  await setup(rows).setNalogZadaci('current', 'site', []);
  assert.deepEqual(rows.map((row) => row.nalog_id), ['current', 'current', null]);
});

for (const tip of ['materijal', 'alat']) {
  test(`saving ${tip} selection keeps completed records without copying or deleting them`, async () => {
    const rows = [
      { id: 'done-current', tip, nalog_id: 'current', gradiliste_id: 'site', gotovo: true, preneseno: false },
      { id: 'done-other', tip, nalog_id: 'other', gradiliste_id: 'site', gotovo: true, preneseno: false },
      { id: 'open', tip, nalog_id: null, gradiliste_id: 'site', gotovo: false, preneseno: false },
    ];
    const before = structuredClone(rows.slice(0, 2));
    await setup(rows).setNalogStavke('current', 'site', rows.map((row) => row.id));
    assert.deepEqual(rows.slice(0, 2), before);
    assert.equal(rows[2].nalog_id, 'current');
  });
}

test('saving an open tool from another order copies it without transferring the source', async () => {
  const rows = [{
    id: 'source-tool',
    tip: 'alat',
    nalog_id: 'source-order',
    gradiliste_id: 'site',
    naziv: 'Bušilica',
    gotovo: false,
    uzeto: false,
    preneseno: false,
    oprema_id: 'equipment',
  }];
  const before = structuredClone(rows);
  const mutations = [];
  await setup(rows, mutations).setNalogStavke('target-order', 'site', ['source-tool']);
  assert.deepEqual(rows, before);
  assert.deepEqual(JSON.parse(JSON.stringify(mutations)), [{
    operation: 'upsert',
    payload: {
      nalog_id: 'target-order',
      gradiliste_id: 'site',
      tip: 'alat',
      naziv: 'Bušilica',
      oprema_id: 'equipment',
      izvor_alat_id: 'source-tool',
    },
    options: { onConflict: 'nalog_id,izvor_alat_id', ignoreDuplicates: true },
  }]);
});

for (const sourceField of ['izvor_zadatak_id', 'izvor_materijal_id', 'izvor_alat_id', 'izvor_id']) {
  test(`source selection groups originals, copies and chained copies by ${sourceField}, not by name`, () => {
    const api = setup([]);
    const rows = [
      { id: 'original', naziv: 'Isti naziv', nalog_id: 'old' },
      { id: 'copy', naziv: 'Isti naziv', nalog_id: 'second', [sourceField]: 'original' },
      { id: 'chain', naziv: 'Promijenjen naziv', nalog_id: 'third', [sourceField]: 'copy' },
      { id: 'different', naziv: 'Isti naziv', nalog_id: null },
    ];
    assert.deepEqual([...api.uniqueNalogSourceRows(rows)].map(row => row.id), ['original', 'different']);
    assert.deepEqual([...api.uniqueNalogSourceRows(rows, 'third')].map(row => row.id), ['chain', 'different']);
    assert.deepEqual([...api.uniqueNalogSourceRows(rows, 'third', ['original', 'copy'])].map(row => row.id), ['chain']);
    assert.deepEqual([...api.uniqueNalogSourceRows(rows.slice(1, 3))].map(row => row.id), ['copy']);
  });
}

for (const [tip, sourceField] of [['materijal', 'izvor_materijal_id'], ['alat', 'izvor_alat_id']]) {
  test(`saving ${tip} original and copy only creates one target entry`, async () => {
    const rows = [
      { id: 'source', tip, nalog_id: 'old', gradiliste_id: 'site', naziv: 'Stavka', gotovo: false, preneseno: false },
      { id: 'copy', tip, nalog_id: 'second', gradiliste_id: 'site', naziv: 'Stavka', gotovo: false, preneseno: false, [sourceField]: 'source' },
    ];
    const mutations = [];
    await setup(rows, mutations).setNalogStavke('target', 'site', ['source', 'copy']);
    assert.equal(mutations.length, 1);
    assert.equal(mutations[0].payload[sourceField], 'source');
  });

  test(`saving ${tip} keeps an existing target copy instead of copying its original again`, async () => {
    const rows = [
      { id: 'source', tip, nalog_id: 'old', gradiliste_id: 'site', naziv: 'Stavka', gotovo: false, preneseno: false },
      { id: 'copy', tip, nalog_id: 'target', gradiliste_id: 'site', naziv: 'Stavka', gotovo: false, preneseno: false, [sourceField]: 'source' },
    ];
    const mutations = [];
    await setup(rows, mutations).setNalogStavke('target', 'site', ['source']);
    assert.deepEqual(mutations, []);
  });
}

for (const vrsta of ['zadatak', 'dodatni']) {
  test(`copying ${vrsta} from source and older copies creates only one entry and keeps unrelated names`, async () => {
    const mutations = [];
    const common = { gradiliste_id: 'site', naziv: 'Isti naziv', gotovo: false, vrsta };
    await setup([], mutations).copyOpenNalogZadaci('target', 'site', [
      { ...common, id: 'source', nalog_id: 'old' },
      { ...common, id: 'copy', nalog_id: 'second', izvor_zadatak_id: 'source' },
      { ...common, id: 'independent', nalog_id: 'old' },
    ]);
    assert.equal(mutations.length, 1);
    assert.deepEqual([...mutations[0].payload].map(row => row.izvor_zadatak_id), ['source', 'independent']);
  });
}

test('automatic transfer offers one source per material/tool chain and skips copies already on the target', async () => {
  const rows = [
    { id: 'source', tip: 'materijal', nalog_id: 'old', gradiliste_id: 'site', naziv: 'Materijal', gotovo: false, preneseno: false },
    { id: 'copy', tip: 'materijal', nalog_id: 'second', gradiliste_id: 'site', naziv: 'Materijal', gotovo: false, preneseno: false, izvor_materijal_id: 'source' },
    { id: 'tool', tip: 'alat', nalog_id: 'old', gradiliste_id: 'site', naziv: 'Alat', gotovo: false, preneseno: false },
    { id: 'target-tool', tip: 'alat', nalog_id: 'target', gradiliste_id: 'site', naziv: 'Alat', gotovo: false, preneseno: false, izvor_alat_id: 'tool' },
  ];
  const mutations = [];
  await setup(rows, mutations, [
    { id: 'old', gradiliste_id: 'site', status: 'otvoren' },
    { id: 'second', gradiliste_id: 'site', status: 'otvoren' },
  ]).prenesiOtvoreneStavke('target', 'site');
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].payload.length, 1);
  assert.equal(mutations[0].payload[0].izvor_materijal_id, 'source');
});
