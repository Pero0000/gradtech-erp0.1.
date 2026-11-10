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

const { countOstaloAssignments, entriesForRosterDate, hasOstaloEntry, workerReturnsToOstalo } = module.exports;

test('other text remains assignable and counts matching vehicle/order assignments', () => {
  const entry = { id: 'other', datum: '2026-11-05', tekst: ' Odvesti otpad ', radnik_id: null };
  const siteAssignments = [
    { id: 'a', iz_ostalo: true, tekst: 'Odvesti otpad', gradiliste_id: null, nalog_id: 'order-1' },
    { id: 'b', iz_ostalo: true, tekst: 'odvesti otpad', gradiliste_id: null, nalog_id: null },
    { id: 'c', iz_ostalo: false, tekst: 'Odvesti otpad', gradiliste_id: null },
    { id: 'd', iz_ostalo: true, tekst: 'Odvesti otpad', gradiliste_id: 'site' },
  ];

  assert.equal(countOstaloAssignments(entry, siteAssignments, []), 2);
  assert.equal(hasOstaloEntry([entry], { tekst: 'Odvesti otpad', radnik_id: null }, entry.datum), true);
  assert.equal(hasOstaloEntry([entry], { tekst: 'Odvesti otpad', radnik_id: null }, '2026-11-06'), false);
});

test('other worker count follows their assignments and keeps worker identity distinct from text', () => {
  const entry = { id: 'worker-other', datum: '2026-11-05', tekst: null, radnik_id: 'worker-1' };
  const workerAssignments = [
    { id: 'a', radnik_id: 'worker-1' },
    { id: 'b', radnik_id: 'worker-1' },
    { id: 'c', radnik_id: 'worker-2' },
  ];

  assert.equal(countOstaloAssignments(entry, [], workerAssignments), 2);
  assert.equal(hasOstaloEntry([entry], { tekst: null, radnik_id: 'worker-1' }, entry.datum), true);
  assert.equal(hasOstaloEntry([entry], { tekst: null, radnik_id: 'worker-2' }, entry.datum), false);
});

test('other entries are scoped to the selected day and worker return preserves their source panel', () => {
  const entries = [
    { id: 'today', datum: '2026-11-05', tekst: null, radnik_id: 'worker-1' },
    { id: 'yesterday', datum: '2026-11-04', tekst: null, radnik_id: 'worker-2' },
  ];

  assert.deepEqual(
    entriesForRosterDate(entries, '2026-11-05').map((entry) => entry.id),
    ['today'],
  );
  assert.equal(workerReturnsToOstalo({ iz_ostalo: true }), true);
  assert.equal(workerReturnsToOstalo({ iz_ostalo: false }), false);
  assert.equal(workerReturnsToOstalo({}), false);
});
