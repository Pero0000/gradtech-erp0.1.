import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import * as jsxRuntime from 'react/jsx-runtime';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const migration = (name) => read(`../supabase/migrations/${name}.sql`);
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree?.props) return [];
  return [tree, ...nodes(tree.props.children)];
}

test('opening vehicle fuel only reads data; recalculation is explicit, permission-gated and reports failures', async () => {
  for (const canEdit of [false, true]) {
    for (const failure of [false, true]) {
      const source = read('../src/components/views/VoziloGorivo.tsx');
      const stateNames = [...source.matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map((match) => match[1]);
      const states = {};
      let cursor = 0;
      const effects = [];
      const calls = [];
      const module = { exports: {} };
      const api = {
        fetchVoziloGorivo: async () => { calls.push('fuel SELECT'); return []; },
        fetchVozilaGorivoWorkers: async () => { calls.push('workers SELECT'); return []; },
        fetchVozilaGorivoAnomalyThreshold: async () => { calls.push('threshold SELECT'); return 50; },
        recalculateVozilaGorivoAnomalije: async () => {
          calls.push('calculate');
          if (failure) throw new Error('Izračun nije uspio');
        },
      };
      const mocks = {
        react: {
          useState: (initial) => {
            const name = stateNames[cursor++];
            if (!(name in states)) states[name] = initial;
            return [states[name], (next) => { states[name] = typeof next === 'function' ? next(states[name]) : next; }];
          },
          useEffect: (fn) => effects.push(fn), useMemo: (fn) => fn(),
        },
        'react/jsx-runtime': jsxRuntime,
        'lucide-react': { AlertTriangle() {}, Fuel() {}, Pencil() {}, Plus() {}, Trash2() {} },
        '@/lib/api': api, '@/lib/rokovi': { todayISO: () => '2026-11-11' },
        '@/lib/localization': {}, '@/components/ui/Field': { Select() {}, TextInput() {} },
        '@/components/views/FuelChangeHistory': { FuelChangeHistory() {} },
      };
      vm.runInNewContext(compile(source), {
        module, exports: module.exports, Error, Event,
        window: { dispatchEvent: () => calls.push('notify') },
        require: (name) => { assert.ok(name in mocks, name); return mocks[name]; },
      });
      const render = () => {
        cursor = 0;
        return module.exports.VoziloGorivo({ vozilo: { id: 'vehicle', tip: 'auto', kilometraza: 100 }, canEdit });
      };
      render();
      effects.forEach((effect) => effect());
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(calls, ['fuel SELECT', 'workers SELECT', 'threshold SELECT']);
      const button = nodes(render()).find((node) => node.type === 'button'
        && node.props.children === 'Ponovno izračunaj anomalije');
      assert.equal(Boolean(button), canEdit);
      if (!button) continue;
      button.props.onClick();
      assert.equal(nodes(render()).find((node) => node.type === 'button'
        && node.props.children === 'Izračunavanje…').props.disabled, true);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(calls.slice(3), failure ? ['calculate'] : ['calculate', 'notify']);
      if (failure) {
        assert.match(states.error, /Izračun nije uspio/);
        assert.equal(states.recalculationNotice, null);
      } else {
        assert.match(states.recalculationNotice, /ponovno su izračunate/);
      }
    }
  }
});

test('all nine notification sources use SELECT only, including fuel anomalies', async () => {
  const calls = [];
  const module = { exports: {} };
  const paginationModule = { exports: {} };
  vm.runInNewContext(compile(read('../src/lib/pagination.ts')), {
    module: paginationModule, exports: paginationModule.exports,
  });
  const apiMocks = {
    './supabase': { supabase: {
      rpc: (name) => { throw new Error(`Notification loading must not call RPC ${name}`); },
      from(table) {
        calls.push(table);
        const query = {
          select: () => query, order: () => query, is: () => query, range: () => query,
          then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return query; // intentionally no insert, update or delete
      },
    } },
    './pagination': paginationModule.exports,
    './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {},
    './company': {}, './rokovi': {}, './imageCompression': {},
  };
  vm.runInNewContext(compile(read('../src/lib/api.ts')), {
    module, exports: module.exports,
    require: (name) => { assert.ok(name in apiMocks, name); return apiMocks[name]; },
  });
  const notifications = { exports: {} };
  vm.runInNewContext(compile(read('../src/lib/obavijesti.ts')), {
    module: notifications, exports: notifications.exports,
    require: (name) => name === '@/lib/api' ? module.exports : {},
  });
  for (let i = 0; i < 3; i++) await notifications.exports.loadObavijestiSource();
  const expected = ['gradilista', 'radnici', 'vozila', 'rokovi', 'fakture',
    'radnici_dokumenti', 'vozila_dokumenti', 'vozila_obavijesti', 'vozila_gorivo_anomalije'];
  assert.equal(calls.length, 27);
  for (const table of expected) assert.equal(calls.filter((name) => name === table).length, 3, table);
});

test('fuel data changes calculate atomically; reads and legacy refresh do not calculate or write', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    CREATE TABLE public.tvrtke(id uuid PRIMARY KEY);
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.vozila(id uuid PRIMARY KEY, company_id uuid);
    CREATE TABLE public.app_profiles(id uuid, company_id uuid, email text);
    CREATE TABLE public.radnici(id uuid, company_id uuid, ime text, prezime text, status text);
    CREATE TABLE public.vozila_gorivo(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid REFERENCES public.tvrtke(id),
      vozilo_id uuid REFERENCES public.vozila(id), datum date, litara numeric,
      kilometraza integer, tocio_radnik_id uuid, tocio_ime text, created_by uuid,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${id(2)}'::uuid $$;
    CREATE FUNCTION public.app_current_company_id() RETURNS uuid LANGUAGE sql AS $$
      SELECT COALESCE(NULLIF(current_setting('app.company',true),''),'${id(1)}')::uuid
    $$;
    CREATE FUNCTION public.app_has_module_permission(text,text) RETURNS boolean LANGUAGE sql AS $$
      SELECT CASE WHEN $1='obavijesti' AND $2='view' THEN true
        ELSE COALESCE(current_setting('app.edit',true),'true')='true' END
    $$;
    CREATE FUNCTION public.app_mobile_radnik_id() RETURNS uuid LANGUAGE sql AS $$ SELECT '${id(4)}'::uuid $$;
    CREATE SCHEMA cron;
    CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
    INSERT INTO public.tvrtke VALUES ('${id(1)}'),('${id(9)}');
    INSERT INTO auth.users VALUES ('${id(2)}');
    INSERT INTO public.app_profiles VALUES ('${id(2)}','${id(1)}','test@example.test');
    INSERT INTO public.radnici VALUES ('${id(4)}','${id(1)}','Test','Worker','aktivan');
    INSERT INTO public.vozila VALUES ('${id(3)}','${id(1)}'),('${id(8)}','${id(9)}');
  `);
  await db.exec(migration('20261109140000_vozila_gorivo_anomalije'));
  await db.exec(migration('20261109160000_vozila_gorivo_prag'));
  // Keep the old implementation for exact-result comparison.
  await db.exec('ALTER FUNCTION private.compute_vozila_gorivo_anomalije() RENAME TO original_compute');
  await db.exec(migration('20261110680000_gorivo_anomalije_samo_pri_promjeni'));
  await db.exec(migration('20261109200000_gorivo_povijest_vracanje')
    .replace('CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;', ''));
  const fuelSql = migration('20261109100000_vozila_gorivo');
  await db.exec(fuelSql.slice(fuelSql.indexOf('CREATE OR REPLACE FUNCTION public.add_mobile_vozila_gorivo('),
    fuelSql.indexOf('REVOKE ALL ON FUNCTION public.get_mobile_vozila_gorivo_vehicles()')));
  const latestEvent = async (fuelId) => (await db.query(
    'SELECT id FROM private.business_change_history WHERE record_id=$1 ORDER BY sequence DESC LIMIT 1', [fuelId],
  )).rows[0].id;
  const insert = (n, km, liters = 10, company = 1, vehicle = 3) => db.query(`
    INSERT INTO public.vozila_gorivo(id,company_id,vozilo_id,datum,litara,kilometraza)
    VALUES ($1,$2,$3, date '2026-11-01' + $4::integer, $5, $6)
  `, [id(n), id(company), id(vehicle), n - 10, liters, km]);
  const saved = () => db.query('SELECT *, xmin::text AS version FROM public.vozila_gorivo_anomalije ORDER BY gorivo_id,vrsta');
  const expected = async () => {
    const original = (await db.query('SELECT * FROM private.original_compute() ORDER BY gorivo_id,vrsta')).rows;
    const computed = (await db.query('SELECT * FROM private.compute_vozila_gorivo_anomalije() ORDER BY gorivo_id,vrsta')).rows;
    assert.deepEqual(computed, original, 'formula and notification text unchanged');
    const actual = (await saved()).rows.filter((row) => row.company_id === id(1));
    const normalizeNumbers = (rows) => rows.map((row) => ({
      ...row,
      litara: Number(Number(row.litara).toFixed(2)),
      potrosnja: row.potrosnja === null ? null : Number(Number(row.potrosnja).toFixed(2)),
      usporedna_potrosnja: row.usporedna_potrosnja === null ? null : Number(Number(row.usporedna_potrosnja).toFixed(2)),
    }));
    assert.deepEqual(normalizeNumbers(actual.map(({ id: _id, rijeseno_at, rijesio, created_at, updated_at, version, ...row }) => row)),
      normalizeNumbers(original));
  };
  await insert(10, 1000);
  await insert(11, 1100);
  await insert(12, 1200);
  await insert(13, 1300);
  await insert(14, 1400, 30);
  await expected();
  assert.ok((await saved()).rows.some((row) => row.gorivo_id === id(14) && row.vrsta === 'potrosnja_visoka'));
  const initial = (await saved()).rows;
  await db.exec('BEGIN READ ONLY; SELECT * FROM public.vozila_gorivo_anomalije; SELECT * FROM public.refresh_vozila_gorivo_anomalije(); COMMIT');
  assert.deepEqual((await saved()).rows, initial, 'reads preserve values, timestamps and row versions');

  await db.exec(`UPDATE public.vozila_gorivo SET litara=10 WHERE id='${id(14)}'`);
  await expected();
  assert.equal((await saved()).rows.length, 0, 'corrected fuel removes stale anomaly immediately');
  await db.exec(`UPDATE public.vozila_gorivo SET litara=16 WHERE id='${id(14)}'`);
  assert.equal((await saved()).rows.length, 1);
  await db.exec('SELECT public.set_vozila_gorivo_anomaly_threshold(90)');
  assert.equal((await saved()).rows.length, 0, 'threshold updates recalculate without notification reads');
  await db.exec('SELECT public.set_vozila_gorivo_anomaly_threshold(50)');
  await expected();

  const anomaly = (await saved()).rows[0];
  await db.query('SELECT public.resolve_vozila_gorivo_anomalija($1)', [anomaly.id]);
  const resolved = (await saved()).rows[0];
  await db.exec('SELECT public.recalculate_vozila_gorivo_anomalije()');
  assert.deepEqual((await saved()).rows[0], resolved, 'unchanged recalculation does not rewrite or reopen resolved rows');
  await db.exec(`DELETE FROM public.vozila_gorivo WHERE id='${id(11)}'`);
  await expected(); // deletion changes the next fuel interval and comparison medians
  await db.query('SELECT public.restore_fuel_change($1)', [await latestEvent(id(11))]);
  await expected();
  await db.exec(`UPDATE public.vozila_gorivo SET litara=10 WHERE id='${id(14)}'`);
  assert.equal((await saved()).rows.length, 0);
  await db.query('SELECT public.restore_fuel_change($1)', [await latestEvent(id(14))]);
  await expected();
  await insert(15, 1350);
  await expected();
  assert.ok((await saved()).rows.some((row) => row.vrsta === 'kilometraza'));
  await db.exec("SELECT set_config('app.edit','false',false)");
  const mobileId = (await db.query(
    'SELECT public.add_mobile_vozila_gorivo($1,$2,10,1200,$3) AS id', [id(3), '2026-11-20', id(4)],
  )).rows[0].id;
  assert.ok((await saved()).rows.some((row) => row.gorivo_id === mobileId && row.vrsta === 'kilometraza'),
    'mobile insert computes even when worker cannot edit vehicles or read notifications');
  await db.exec("SELECT set_config('app.edit','true',false)");
  await expected();

  await insert(20, 2000, 10, 9, 8);
  await insert(21, 1900, 10, 9, 8);
  const otherCompany = (await saved()).rows.filter((row) => row.company_id === id(9));
  assert.equal(otherCompany.length, 1, 'internal trigger uses row tenant even for service/import writes');
  await db.exec(`
    SELECT set_config('app.edit','false',false);
    SET ROLE authenticated;
    BEGIN READ ONLY;
    SELECT * FROM public.vozila_gorivo_anomalije;
    SELECT * FROM public.refresh_vozila_gorivo_anomalije();
    COMMIT;
  `);
  assert.ok((await db.query('SELECT * FROM public.vozila_gorivo_anomalije')).rows.every((row) => row.company_id === id(1)));
  await assert.rejects(db.exec('SELECT public.recalculate_vozila_gorivo_anomalije()'), /Nemate pravo/);
  await assert.rejects(db.exec(`SELECT private.recalculate_fuel_anomalies('${id(9)}')`), /permission denied/);
  await db.exec("RESET ROLE; SELECT set_config('app.edit','true',false); SET ROLE authenticated");
  await db.exec('SELECT public.recalculate_vozila_gorivo_anomalije()');
  await db.exec('RESET ROLE');
  assert.deepEqual((await saved()).rows.filter((row) => row.company_id === id(9)), otherCompany);

  // Any calculation failure must roll back the fuel mutation, not leave stale results behind.
  await db.exec(`CREATE FUNCTION private.fail_anomaly_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Calculation write failed'; END $$;
    CREATE TRIGGER fail_anomaly_write BEFORE INSERT OR UPDATE OR DELETE ON public.vozila_gorivo_anomalije
    FOR EACH ROW EXECUTE FUNCTION private.fail_anomaly_write();`);
  await assert.rejects(db.exec(`UPDATE public.vozila_gorivo SET kilometraza=100 WHERE id='${id(15)}'`), /Calculation write failed/);
  assert.equal((await db.query(`SELECT kilometraza FROM public.vozila_gorivo WHERE id='${id(15)}'`)).rows[0].kilometraza, 1350);
});
