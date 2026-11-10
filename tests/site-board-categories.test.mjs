import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const [file, name] of [
  ['GradilistaView', 'reconcileGradilisteColumns'],
  ['RasporedView', 'reconcileColumns'],
]) {
  test(`${file} preserves all saved categories and puts only unknown sites in Other`, () => {
    const source = read(`../src/components/views/${file}.tsx`);
    const ast = ts.createSourceFile(`${file}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    const context = {
      emptyGradilisteColumns: () => [[], [], []],
      module: { exports: {} },
    };
    vm.runInNewContext(compile(`${fn.getText(ast)}\nmodule.exports = ${name};`), context);
    const saved = [['dm-site'], ['intervention', 'not-loaded'], ['other']];
    const reconcile = context.module.exports;
    for (const items of [
      [{ id: 'new' }, { id: 'dm-site' }, { id: 'other' }, { id: 'intervention' }],
      [{ id: 'intervention' }, { id: 'new' }],
    ]) {
      assert.deepEqual(JSON.parse(JSON.stringify(reconcile(items, saved))), [
        ['dm-site'], ['intervention', 'not-loaded'], ['other', 'new'],
      ]);
    }
    assert.deepEqual(saved, [['dm-site'], ['intervention', 'not-loaded'], ['other']]);
  });
}

test('database revision rejects stale clients and advances even for legacy updates', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE public.gradiliste_board_layout (
      id boolean DEFAULT true, company_id text, columns jsonb, sort_modes jsonb,
      updated_at timestamptz DEFAULT now(), PRIMARY KEY(company_id, id)
    );
    INSERT INTO public.gradiliste_board_layout(company_id, columns)
      VALUES ('a', '[["site"],[],[]]'), ('b', '[[],["foreign"],[]]');
  `);
  const migration = read('../supabase/migrations/20261110650000_gradiliste_board_revision.sql');
  await db.exec(migration);
  await db.exec(migration);
  const save = (revision, columns) => db.query(`
    UPDATE public.gradiliste_board_layout SET columns = $1::jsonb
    WHERE company_id = 'a' AND id = true AND revision = $2 RETURNING revision
  `, [JSON.stringify(columns), revision]);
  assert.equal((await save(0, [[], ['site'], []])).rows[0].revision, 1);
  assert.equal((await save(0, [['site'], [], []])).rows.length, 0);
  assert.deepEqual((await db.query("SELECT columns FROM public.gradiliste_board_layout WHERE company_id='a'")).rows[0].columns, [[], ['site'], []]);
  assert.equal((await save(1, [[], [], ['site']])).rows[0].revision, 2);
  await db.exec("UPDATE public.gradiliste_board_layout SET revision=0 WHERE company_id='a'");
  assert.equal((await db.query("SELECT revision FROM public.gradiliste_board_layout WHERE company_id='a'")).rows[0].revision, 3);
  assert.equal((await db.query("SELECT revision FROM public.gradiliste_board_layout WHERE company_id='b'")).rows[0].revision, 0);
});

function apiSetup({ data = { revision: 3 }, error = null } = {}) {
  const calls = [];
  const module = { exports: {} };
  const query = {
    insert(value) { calls.push(['insert', value]); return this; },
    update(value) { calls.push(['update', value]); return this; },
    eq(...args) { calls.push(['eq', ...args]); return this; },
    select() { return this; },
    maybeSingle: async () => ({ data, error }),
  };
  vm.runInNewContext(compile(read('../src/lib/api.ts')), {
    module, exports: module.exports,
    require(name) {
      if (name === './supabase') return { supabase: { from: () => query } };
      if (name === './company') return { requireCompany: () => ({ id: 'company' }) };
      return {};
    },
  });
  return { api: module.exports, calls };
}
const layout = { columns: [[], [], []], sortModes: ['manual', 'manual', 'manual'] };

test('API saves using the company and loaded revision, never an unconditional upsert', async () => {
  const { api, calls } = apiSetup();
  assert.equal(await api.saveGradilisteBoardLayout(layout, 2), 3);
  assert.deepEqual(calls.filter(call => call[0] === 'eq'), [
    ['eq', 'company_id', 'company'], ['eq', 'id', true], ['eq', 'revision', 2],
  ]);
});

test('API explicitly rejects stale updates and competing first inserts', async () => {
  for (const error of [null, { code: '23505' }]) {
    const { api } = apiSetup({ data: null, error });
    await assert.rejects(api.saveGradilisteBoardLayout(layout, error ? null : 0), /stariji raspored nije spremljen/);
  }
});

test('both screens queue guarded writes without retrying stale payloads after failure', () => {
  for (const file of ['GradilistaView', 'RasporedView']) {
    const source = read(`../src/components/views/${file}.tsx`);
    assert.match(source, /saveGradilisteBoardLayout\([\s\S]*?boardRevision.current\)/);
    assert.doesNotMatch(source, /layoutSaveQueue.current\s*\.catch/);
    assert.match(source, /version !== layoutVersion.current/);
  }
  const source = read('../src/components/views/GradilistaView.tsx');
  assert.doesNotMatch(source, /await persistBoardLayout\(nextColumns, nextSortModes\)/);
});
