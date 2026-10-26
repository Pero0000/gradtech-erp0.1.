import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function setup(rows) {
  const supabase = {
    from: () => {
      let payload;
      let operation = 'select';
      const filters = [];
      const query = {
        select: () => query,
        order: () => query,
        update: (value) => { operation = 'update'; payload = value; return query; },
        insert: () => { assert.fail('Completed items must not be copied'); },
        delete: () => { assert.fail('Completed items must not be deleted'); },
        eq: (key, value) => { filters.push((row) => row[key] === value); return query; },
        is: (key, value) => { filters.push((row) => row[key] === value); return query; },
        not: (key, operator, value) => {
          assert.equal(operator, 'is');
          filters.push((row) => row[key] !== value);
          return query;
        },
        in: (key, values) => { filters.push((row) => values.includes(row[key])); return query; },
        then: (resolve, reject) => {
          const selected = rows.filter((row) => filters.every((filter) => filter(row)));
          if (operation === 'update') selected.forEach((row) => Object.assign(row, payload));
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
