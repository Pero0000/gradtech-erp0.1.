import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/rasporedOstalo.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
vm.runInNewContext(outputText, {
  module,
  exports: module.exports,
  require: () => ({}),
});

const { countOstaloAssignments, hasOstaloEntry, workerReturnsToOstalo } = module.exports;

test('other text remains assignable and counts matching vehicle/order assignments', () => {
  const entry = { id: 'other', datum: '2026-11-05', tekst: ' Odvesti otpad ', radnik_id: null };
  const siteAssignments = [
    { id: 'a', iz_ostalo: true, tekst: 'Odvesti otpad', gradiliste_id: null, nalog_id: 'order-1' },
    { id: 'b', iz_ostalo: true, tekst: 'odvesti otpad', gradiliste_id: null, nalog_id: null },
    { id: 'c', iz_ostalo: false, tekst: 'Odvesti otpad', gradiliste_id: null },
    { id: 'd', iz_ostalo: true, tekst: 'Odvesti otpad', gradiliste_id: 'site' },
  ];

  assert.equal(countOstaloAssignments(entry, siteAssignments, []), 2);
  assert.equal(hasOstaloEntry([entry], { tekst: 'Odvesti otpad', radnik_id: null }), true);
});

test('other worker count follows their assignments and keeps worker identity distinct from text', () => {
  const entry = { id: 'worker-other', datum: '2026-11-05', tekst: null, radnik_id: 'worker-1' };
  const workerAssignments = [
    { id: 'a', radnik_id: 'worker-1' },
    { id: 'b', radnik_id: 'worker-1' },
    { id: 'c', radnik_id: 'worker-2' },
  ];

  assert.equal(countOstaloAssignments(entry, [], workerAssignments), 2);
  assert.equal(hasOstaloEntry([entry], { tekst: null, radnik_id: 'worker-1' }), true);
  assert.equal(hasOstaloEntry([entry], { tekst: null, radnik_id: 'worker-2' }), false);
});

test('shared other entries remain available regardless of their original date and worker return preserves their source', () => {
  const entries = [
    { id: 'today', datum: '2026-11-05', tekst: null, radnik_id: 'worker-1' },
    { id: 'yesterday', datum: '2026-11-04', tekst: null, radnik_id: 'worker-2' },
  ];

  assert.equal(hasOstaloEntry(entries, { radnik_id: 'worker-1' }), true);
  assert.equal(hasOstaloEntry(entries, { radnik_id: 'worker-2' }), true);
  assert.equal(hasOstaloEntry([
    { id: 'delivery', datum: '2026-10-01', tekst: 'Dostava', radnik_id: null },
  ], { tekst: ' dostava ' }), true);
  assert.equal(workerReturnsToOstalo({ iz_ostalo: true }), true);
  assert.equal(workerReturnsToOstalo({ iz_ostalo: false }), false);
  assert.equal(workerReturnsToOstalo({}), false);
});

const apiSource = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const paginationSource = readFileSync(new URL('../src/lib/pagination.ts', import.meta.url), 'utf8');
const viewSource = readFileSync(new URL('../src/components/views/RasporedView.tsx', import.meta.url), 'utf8');

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

test('shared Ostalo loads every database page and fresh clients receive the same historical entries', async () => {
  const rows = Array.from({ length: 1101 }, (_, index) => ({
    id: `entry-${index}`, datum: '2026-10-01', tekst: `Dostava ${index}`, radnik_id: null,
  }));
  const paginationModule = { exports: {} };
  vm.runInNewContext(transpile(paginationSource), { module: paginationModule, exports: paginationModule.exports });
  const requests = [];
  function client() {
    const apiModule = { exports: {} };
    vm.runInNewContext(transpile(apiSource), {
      module: apiModule, exports: apiModule.exports,
      require(name) {
        if (name === './pagination') return paginationModule.exports;
        if (name !== './supabase') return {};
        return { supabase: { from(table) {
          assert.equal(table, 'dnevni_raspored_ostalo');
          const query = {
            select() { return this; },
            order() { return this; },
            async range(from, to) {
              requests.push([from, to]);
              return { data: rows.slice(from, to + 1), error: null };
            },
          };
          return query;
        } } };
      },
    });
    return apiModule.exports;
  }
  const first = await client().fetchRasporedOstalo();
  const second = await client().fetchRasporedOstalo();
  assert.equal(first.length, 1101);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  assert.deepEqual(requests.slice(0, 3), [[0, 499], [500, 999], [1000, 1499]]);
});

test('shared Ostalo load failures preserve previously displayed data and show an explicit error', async () => {
  const ast = ts.createSourceFile('view.tsx', viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'RasporedView');
  const declaration = component.body.statements.filter(ts.isVariableStatement)
    .flatMap(node => [...node.declarationList.declarations])
    .find(node => node.name.getText(ast) === 'loadOstalo');
  const state = { entries: [{ id: 'delivery', tekst: 'Dostava' }] };
  const exported = { exports: {} };
  vm.runInNewContext(transpile(`export const load = ${declaration.initializer.getText(ast)}`), {
    module: exported, exports: exported.exports,
    useCallback: callback => callback,
    fetchRasporedOstalo: async () => { throw new Error('Connection failed'); },
    setOstalo: value => { state.entries = value; },
    setOstaloError: value => { state.error = value; },
    errMsg: error => error.message,
  });
  assert.equal(await exported.exports.load(), false);
  assert.equal(state.entries[0].tekst, 'Dostava');
  assert.equal(state.error, 'Connection failed');
});

test('shared list rendering and drag lookup do not filter by date and refresh on returning to the app', () => {
  assert.doesNotMatch(viewSource, /(?:entry|item|o)\.datum === selectedDate|entriesForRosterDate/);
  assert.match(viewSource, /const sharedOstalo = ostalo/);
  assert.match(viewSource, /setInterval\(refresh, 15_000\)/);
  assert.match(viewSource, /addEventListener\('visibilitychange', refresh\)/);
  assert.match(viewSource, /addEventListener\('focus', refresh\)/);
  assert.match(viewSource, /assignRasporedRadnik\(selectedDate, voziloId, entry\.radnik_id, true\)/);
  assert.match(viewSource, /addRasporedTekst\(selectedDate, voziloId, entry\.tekst, true\)/);
});
