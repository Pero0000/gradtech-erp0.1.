import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import { PGlite } from '@electric-sql/pglite';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261110700000_rekapitulacija_grupirani_sazeci.sql');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module, exports: module.exports,
    require: name => { assert.ok(name in mocks, name); return mocks[name]; },
  });
  return module.exports;
}

async function database(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE FUNCTION public.app_current_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT current_setting('app.company')::uuid
    $$;
    CREATE TABLE gradilista(id uuid PRIMARY KEY, company_id uuid);
    CREATE TABLE troskovi(id uuid PRIMARY KEY, gradiliste_id uuid, iznos numeric, kategorija text);
    CREATE TABLE radnici(id uuid PRIMARY KEY, company_id uuid, cijena_sata numeric);
    CREATE TABLE radno_vrijeme(id uuid PRIMARY KEY, gradiliste_id uuid, radnik_id uuid, sati numeric);
    CREATE TABLE fakture(id uuid PRIMARY KEY, gradiliste_id uuid, status text, iznos numeric, rabat numeric, rabat_smjer text);
    CREATE TABLE ugovoreni_radovi(id uuid PRIMARY KEY, gradiliste_id uuid, ugovoreni_iznos numeric);
    INSERT INTO gradilista VALUES ('${id(1)}','${id(90)}'), ('${id(2)}','${id(90)}'), ('${id(3)}','${id(91)}');
    INSERT INTO radnici VALUES ('${id(10)}','${id(90)}',12.5), ('${id(11)}','${id(90)}',NULL),
      ('${id(12)}','${id(90)}',0), ('${id(13)}','${id(91)}',200);
    SELECT set_config('app.company','${id(90)}',false);
    SELECT set_config('app.hide_workers','false',false);
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
    ALTER TABLE gradilista ENABLE ROW LEVEL SECURITY;
    CREATE POLICY sites ON gradilista TO authenticated USING(company_id = app_current_company_id());
    ALTER TABLE radnici ENABLE ROW LEVEL SECURITY;
    CREATE POLICY workers ON radnici TO authenticated USING (
      company_id = app_current_company_id() AND current_setting('app.hide_workers') = 'false'
    );
    ALTER TABLE troskovi ENABLE ROW LEVEL SECURITY;
    CREATE POLICY costs ON troskovi TO authenticated USING (
      EXISTS (SELECT 1 FROM gradilista g WHERE g.id=gradiliste_id) AND kategorija <> 'skriveno'
    );
    ALTER TABLE radno_vrijeme ENABLE ROW LEVEL SECURITY;
    CREATE POLICY hours ON radno_vrijeme TO authenticated USING (
      EXISTS (SELECT 1 FROM gradilista g WHERE g.id=gradiliste_id)
    );
    ALTER TABLE fakture ENABLE ROW LEVEL SECURITY;
    CREATE POLICY invoices ON fakture TO authenticated USING (
      EXISTS (SELECT 1 FROM gradilista g WHERE g.id=gradiliste_id)
    );
    ALTER TABLE ugovoreni_radovi ENABLE ROW LEVEL SECURITY;
    CREATE POLICY contracts ON ugovoreni_radovi TO authenticated USING (
      EXISTS (SELECT 1 FROM gradilista g WHERE g.id=gradiliste_id)
    );
  `);
  await db.exec(migration);
  await db.exec(migration);
  return db;
}

test('SQL aggregates match original costs, categories, rebates, paid amounts, contracts and both hourly-rate modes under RLS', async t => {
  const db = await database(t);
  const costs = [
    { iznos: 100.25, kategorija: 'materijal' },
    { iznos: -10.25, kategorija: 'materijal' },
    { iznos: 19.5, kategorija: 'place' },
    { iznos: 0, kategorija: 'gorivo' },
  ];
  const hours = [
    { sati: 8, rate: 12.5, worker: id(10) }, { sati: 1.25, rate: 12.5, worker: id(10) },
    { sati: 3.5, rate: null, worker: id(11) }, { sati: 2, rate: 0, worker: id(12) },
    { sati: 1, rate: null, worker: null }, { sati: 0.5, rate: null, worker: id(13) },
  ];
  const invoices = [
    { iznos: 120, rabat: 20, rabat_smjer: 'oduzmi', status: 'placena' },
    { iznos: 200, rabat: 25, rabat_smjer: 'pribroji', status: 'izdana' },
    { iznos: -20, rabat: null, rabat_smjer: null, status: 'placena' },
  ];
  for (const [i, row] of costs.entries()) {
    await db.query('INSERT INTO troskovi VALUES($1,$2,$3,$4)', [id(100+i), id(1), row.iznos, row.kategorija]);
  }
  for (const [i, row] of hours.entries()) {
    await db.query('INSERT INTO radno_vrijeme VALUES($1,$2,$3,$4)', [id(200+i), id(1), row.worker, row.sati]);
  }
  for (const [i, row] of invoices.entries()) {
    await db.query('INSERT INTO fakture VALUES($1,$2,$3,$4,$5,$6)',
      [id(300+i), id(1), row.status, row.iznos, row.rabat, row.rabat_smjer]);
  }
  await db.exec(`
    INSERT INTO ugovoreni_radovi VALUES('${id(400)}','${id(1)}',1000),('${id(401)}','${id(1)}',-100);
    INSERT INTO troskovi VALUES('${id(500)}','${id(3)}',999999,'materijal'),
      ('${id(501)}','${id(1)}',888888,'skriveno'), ('${id(502)}',NULL,777777,'materijal');
    SET ROLE authenticated;
    BEGIN READ ONLY;
  `);
  const rows = (await db.query('SELECT * FROM get_rekapitulacija_sazeci($1)', [[id(1),id(2),id(3),id(999)]])).rows;
  assert.equal(rows.length, 2, 'foreign and unavailable sites are never returned');
  const row = rows[0];
  assert.equal(Number(row.direktni), costs.reduce((sum,cost) => sum + cost.iznos, 0));
  assert.deepEqual(row.kategorije, { materijal: 90, place: 19.5, gorivo: 0 });
  const amount = f => f.rabat_smjer === 'oduzmi' ? f.iznos - (f.rabat ?? 0) : f.iznos + (f.rabat ?? 0);
  assert.equal(Number(row.fakture), invoices.reduce((sum,f) => sum + amount(f), 0));
  assert.equal(Number(row.placeno), invoices.filter(f => f.status === 'placena').reduce((sum,f) => sum + amount(f), 0));
  assert.equal(Number(row.ugovoreno), 900);
  assert.equal(Number(row.sati), hours.reduce((sum,h) => sum + h.sati, 0));
  for (const rate of [0, 10, 23.75]) {
    assert.equal(Number(row.sati) * rate, hours.reduce((sum,h) => sum + h.sati * rate, 0));
    assert.equal(Number(row.rad_po_satnici) + Number(row.sati_bez_satnice) * rate,
      hours.reduce((sum,h) => sum + h.sati * (h.rate ?? rate), 0));
  }
  assert.deepEqual(rows[1].kategorije, {});
  for (const key of ['direktni','sati','rad_po_satnici','sati_bez_satnice','fakture','placeno','ugovoreno']) {
    assert.equal(Number(rows[1][key]), 0, `empty site's ${key}`);
  }
  await db.exec('COMMIT');
  await db.exec("SELECT set_config('app.hide_workers','true',false)");
  const hidden = (await db.query('SELECT * FROM get_rekapitulacija_sazeci($1)', [[id(1)]])).rows[0];
  assert.equal(Number(hidden.rad_po_satnici), 0);
  assert.equal(Number(hidden.sati_bez_satnice), Number(hidden.sati), 'hidden worker relation uses universal rate exactly as old LEFT JOIN');
  const properties = (await db.query("SELECT prosecdef, provolatile FROM pg_proc WHERE proname='get_rekapitulacija_sazeci'")).rows[0];
  assert.equal(properties.prosecdef, false);
  assert.equal(properties.provolatile, 's');
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(db.query('SELECT * FROM get_rekapitulacija_sazeci($1)', [[id(1)]]), /permission denied/);
});

test('aggregates have no raw-row truncation above 1000 records and return one group per site', async t => {
  const db = await database(t);
  await db.exec(`
    INSERT INTO troskovi SELECT gen_random_uuid(),'${id(1)}',1.25,'materijal' FROM generate_series(1,1501);
    INSERT INTO radno_vrijeme SELECT gen_random_uuid(),'${id(1)}','${id(10)}',0.5 FROM generate_series(1,1501);
    SET ROLE authenticated;
  `);
  const rows = (await db.query('SELECT * FROM get_rekapitulacija_sazeci($1)', [[id(1),id(2)]])).rows;
  assert.equal(rows.length, 2);
  assert.equal(Number(rows[0].direktni), 1876.25);
  assert.equal(Number(rows[0].sati), 750.5);
  assert.equal(Number(rows[0].rad_po_satnici), 9381.25);
});

function apiSetup() {
  const calls = [];
  let failure = null;
  let records = [];
  const pagination = load('../src/lib/pagination.ts', {});
  const api = load('../src/lib/api.ts', {
    './supabase': { supabase: {
      rpc(name, payload) {
        return { order(column) {
          assert.equal(column, 'gradiliste_id');
          return { range(from,to) {
            calls.push({name, payload, from, to});
            return Promise.resolve({ data: records.slice(from,to+1), error: failure });
          } };
        } };
      },
    } },
    './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {},
    './company': {}, './pagination': pagination, './rokovi': {}, './imageCompression': {},
  });
  return { api, calls, rows: value => { records = value; }, fail: value => { failure = value; } };
}

test('twenty sites use one aggregate RPC, not 120 SELECTs; summary pages and errors are complete', async () => {
  const s = apiSetup();
  assert.equal((await s.api.fetchRekapitulacijaSazeci([])).length, 0);
  assert.equal(s.calls.length, 0);
  const ids = Array.from({length:20}, (_,i) => id(i+1));
  s.rows(ids.map(gradiliste_id => ({gradiliste_id})));
  assert.equal((await s.api.fetchRekapitulacijaSazeci([...ids,ids[0]])).length, 20);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].name, 'get_rekapitulacija_sazeci');
  assert.equal(s.calls[0].payload.p_gradiliste_ids.length, 20);
  const many = Array.from({length:1001}, (_,i) => id(i+1));
  s.rows(many.map(gradiliste_id => ({gradiliste_id})));
  s.calls.length = 0;
  assert.equal((await s.api.fetchRekapitulacijaSazeci(many)).length, 1001);
  assert.equal(s.calls.length, 3, 'paginate summaries, not detail records per site');
  s.rows([]);
  await assert.rejects(s.api.fetchRekapitulacijaSazeci([id(1)]), /Nisu dostupni/);
  s.fail({code:'PGRST202',message:'Missing'});
  await assert.rejects(s.api.fetchRekapitulacijaSazeci([id(1)]), /Primijenite migraciju/);
  s.fail({code:'42501',message:'Denied'});
  await assert.rejects(s.api.fetchRekapitulacijaSazeci([id(1)]), {message:'Denied'});
});

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree?.props) return [];
  return [tree, ...nodes(tree.props.children)];
}

test('all-site view uses one summary load; rate changes, status filtering, sorting, opening detail and export keep their values', async () => {
  const state = [];
  let cursor = 0;
  let pendingEffect;
  const calls = [];
  const sites = [
    {id:id(1),naziv:'A',status:'aktivno'}, {id:id(2),naziv:'B',status:'zavrseno'},
  ];
  const data = [
    {gradiliste_id:id(1),direktni:100,kategorije:{materijal:100},sati:10,rad_po_satnici:60,sati_bez_satnice:5,fakture:300,placeno:100,ugovoreno:500},
    {gradiliste_id:id(2),direktni:50,kategorije:{place:50},sati:2,rad_po_satnici:0,sati_bez_satnice:2,fakture:20,placeno:20,ugovoreno:80},
  ];
  const api = { fetchRekapitulacijaSazeci: async ids => { calls.push(ids); return data; } };
  const ExportMenu = () => null;
  const icons = new Proxy({}, {get: () => 'span'});
  const { RekapitulacijaSva } = load('../src/components/views/RekapitulacijaSva.tsx', {
    react: {
      useState(initial) { const i=cursor++; if (!(i in state)) state[i]=initial; return [state[i],next => {state[i]=typeof next==='function'?next(state[i]):next;}]; },
      useMemo: fn => fn(),
      useEffect: effect => { pendingEffect ??= effect; },
    },
    'react/jsx-runtime': jsxRuntime, 'lucide-react': icons, '@/lib/api': api,
    '@/components/ui/Badge': {Badge:'span'}, '@/components/ui/ExportMenu': {ExportMenu},
  });
  let rate = 10;
  let netto = false;
  const opened = [];
  const render = () => {cursor=0; return RekapitulacijaSva({gradilista:sites,satnica:rate,nettoPoRadnicima:netto,onOpen:value=>opened.push(value)});};
  render(); pendingEffect();
  await new Promise(resolve => setImmediate(resolve));
  const exportData = () => nodes(render()).find(node=>node.type===ExportMenu).props.build();
  assert.equal(calls.length, 1);
  assert.equal(exportData().totals.Troškovi, 270);
  netto = true;
  assert.equal(exportData().totals.Troškovi, 280);
  rate = 20;
  assert.equal(exportData().totals.Troškovi, 350);
  assert.equal(calls.length, 1, 'changing hourly settings does not refetch');
  const tree = render();
  const link = nodes(tree).find(node => node.type==='tr' && node.key === id(1));
  assert.ok(link);
  link.props.onClick();
  assert.deepEqual(opened,[id(1)]);
  const statusButton = nodes(tree).find(node=>node.type==='button' && node.key==='zavrseno');
  assert.ok(statusButton);
  statusButton.props.onClick();
  assert.equal(exportData().rows.length, 1);
  assert.equal(exportData().rows[0].g.id, id(2));
  assert.equal(exportData().totals.Troškovi, 90);
  nodes(render()).find(node=>node.type==='button' && node.key==='sve').props.onClick();
  const header = nodes(render()).find(node=>typeof node.type==='function' && node.props.k === 'naziv');
  assert.ok(header);
  nodes(header.type(header.props)).find(node=>node.type==='button').props.onClick();
  assert.deepEqual(Array.from(exportData().rows,row=>row.g.naziv), ['A','B']);
  const nextHeader = nodes(render()).find(node=>typeof node.type==='function' && node.props.k === 'naziv');
  nodes(nextHeader.type(nextHeader.props)).find(node=>node.type==='button').props.onClick();
  assert.deepEqual(Array.from(exportData().rows,row=>row.g.naziv), ['B','A']);
  assert.equal(calls.length, 1, 'filters and sorting reuse grouped results');
});
