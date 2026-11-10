import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA private;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT '00000000-0000-0000-0000-000000000001'::uuid
    $$;
    CREATE FUNCTION public.app_current_company_id() RETURNS uuid LANGUAGE sql AS $$
      SELECT '00000000-0000-0000-0000-000000000002'::uuid
    $$;
    CREATE FUNCTION public.app_has_module_permission(text, text) RETURNS boolean LANGUAGE sql AS $$
      SELECT COALESCE(current_setting('app.allow_edit', true), 'true') = 'true'
    $$;
    CREATE FUNCTION public.app_mobile_editable_nalog(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE public.radni_nalozi (
      id uuid PRIMARY KEY, company_id uuid DEFAULT public.app_current_company_id(), broj text,
      km_pocetak numeric, km_kraj numeric, status text DEFAULT 'u_tijeku',
      bez_troska boolean DEFAULT false, bez_izvrsenja boolean DEFAULT false
    );
    CREATE TABLE public.vozila (
      id uuid PRIMARY KEY, company_id uuid DEFAULT public.app_current_company_id(),
      marka text, model text, registracija text, cijena_km numeric DEFAULT 0.28
    );
    CREATE TABLE public.dnevni_raspored_gradilista (
      company_id uuid DEFAULT public.app_current_company_id(), nalog_id uuid, vozilo_id uuid, datum date
    );
    CREATE TABLE public.troskovi (
      company_id uuid DEFAULT public.app_current_company_id(), nalog_id uuid, datum date,
      kategorija text, opis text, iznos numeric
    );
    INSERT INTO public.vozila (id, marka, model) VALUES
      ('00000000-0000-0000-0000-000000000003', 'Opel', 'Vivaro');
    INSERT INTO public.radni_nalozi (id, broj, km_pocetak, km_kraj) VALUES
      ('00000000-0000-0000-0000-000000000004', 'RN-1', 81000, 81600),
      ('00000000-0000-0000-0000-000000000005', 'RN-2', 81600, 82200);
    INSERT INTO public.dnevni_raspored_gradilista (nalog_id, vozilo_id, datum) VALUES
      ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '2026-11-09'),
      ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000003', '2026-11-09');
  `);
  await db.exec(read('../supabase/migrations/20261110610000_provjera_kilometara_naloga.sql'));
  return db;
}

test('database requires exact confirmation above 1000 km and preserves partial draft entries', async (t) => {
  const db = await setup(t);
  const id = '00000000-0000-0000-0000-000000000004';
  for (const [start, end] of [[-1, 100], [100, 99], [10.5, 20], ['NaN', 100], [0, 'Infinity']]) {
    await assert.rejects(db.query('UPDATE public.radni_nalozi SET km_pocetak=$1, km_kraj=$2 WHERE id=$3',
      [start, end, id]), /Neispravna očitanja/);
  }
  await db.query('UPDATE public.radni_nalozi SET km_pocetak=NULL, km_kraj=82000 WHERE id=$1', [id]);
  await assert.rejects(db.query('UPDATE public.radni_nalozi SET km_pocetak=0 WHERE id=$1', [id]), /više od 1.000 km/);
  await db.query('SELECT public.confirm_work_order_km($1, 0, 82000)', [id]);
  await db.query('UPDATE public.radni_nalozi SET km_pocetak=0 WHERE id=$1', [id]);
  assert.equal((await db.query('SELECT public.work_order_km_confirmed($1, 0, 82000) AS ok', [id])).rows[0].ok, true);
  await assert.rejects(db.query('UPDATE public.radni_nalozi SET km_kraj=82001 WHERE id=$1', [id]), /više od 1.000 km/);
  await db.query('UPDATE public.radni_nalozi SET km_pocetak=81000, km_kraj=82000 WHERE id=$1', [id]);
  await db.exec("SELECT set_config('app.allow_edit','false',false)");
  await assert.rejects(db.query('SELECT public.confirm_work_order_km($1, 0, 82000)', [id]), /nije dostupan/);
});

test('daily total above 1000 requires confirmation tied to all exact readings, even if each order is below 1000', async (t) => {
  const db = await setup(t);
  await db.exec("UPDATE public.radni_nalozi SET status='zavrsen'");
  const review = (await db.query("SELECT * FROM public.review_daily_vehicle_km('2026-11-09')")).rows[0];
  assert.equal(Number(review.kilometri), 1200);
  assert.equal(review.confirmed, false);
  const insertCost = () => db.exec(`
    INSERT INTO public.troskovi (nalog_id, datum, kategorija, opis, iznos)
    VALUES ('00000000-0000-0000-0000-000000000004', '2026-11-09', 'put', 'Kilometri: Opel Vivaro 600 km', 168)
  `);
  await assert.rejects(insertCost(), /Kilometarski trošak nije spremljen/);
  await db.query("SELECT public.confirm_daily_vehicle_km('2026-11-09',$1,$2)", [review.vozilo_id, review.signature]);
  await insertCost();
  assert.equal((await db.query("SELECT * FROM public.review_daily_vehicle_km('2026-11-09')")).rows[0].confirmed, true);
  await db.exec("UPDATE public.radni_nalozi SET km_kraj=82201 WHERE broj='RN-2'");
  await assert.rejects(insertCost(), /Kilometarski trošak nije spremljen/);
  await assert.rejects(db.query("SELECT public.confirm_daily_vehicle_km('2026-11-09',$1,$2)", [review.vozilo_id, review.signature]),
    /Očitanja su promijenjena/);
  await db.exec("UPDATE public.radni_nalozi SET bez_izvrsenja=true WHERE broj='RN-2'");
  assert.equal((await db.query("SELECT * FROM public.review_daily_vehicle_km('2026-11-09')")).rows.length, 0);
});

test('partial legacy readings cannot create a kilometre cost', async (t) => {
  const db = await setup(t);
  await db.exec("UPDATE public.radni_nalozi SET km_pocetak=NULL WHERE broj='RN-1'");
  await assert.rejects(db.exec(`
    INSERT INTO public.troskovi (nalog_id, datum, kategorija, opis, iznos)
    VALUES ('00000000-0000-0000-0000-000000000004', '2026-11-09', 'put', 'Kilometri: Opel Vivaro 82000 km', 22960)
  `), /Kilometarski trošak/);
});

test('database rejects the old cross-order phantom 82000 km cost even when real daily mileage is below 1000', async (t) => {
  const db = await setup(t);
  await db.exec(`
    UPDATE public.radni_nalozi SET km_pocetak=0, km_kraj=0, status='zavrsen' WHERE broj='RN-1';
    UPDATE public.radni_nalozi SET km_pocetak=81900, km_kraj=82000, status='zavrsen' WHERE broj='RN-2';
  `);
  await assert.rejects(db.exec(`
    INSERT INTO public.troskovi (nalog_id, datum, kategorija, opis, iznos)
    VALUES ('00000000-0000-0000-0000-000000000004', '2026-11-09', 'put', 'Kilometri: Opel Vivaro 82000 km', 22960)
  `), /ne odgovara upisanim vožnjama/);
  await db.exec(`
    INSERT INTO public.troskovi (nalog_id, datum, kategorija, opis, iznos)
    VALUES ('00000000-0000-0000-0000-000000000005', '2026-11-09', 'put', 'Kilometri: Opel Vivaro 100 km', 28)
  `);
});

test('office and mobile kilometre save request confirmation, cancel safely and accept explicitly approved long trips', async () => {
  const vehicleModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read('../src/lib/vehicleKmCosts.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { module: vehicleModule, exports: vehicleModule.exports });
  for (const operation of ['office', 'mobileReport', 'mobileFinal']) {
   for (const accept of [false, true]) {
    const calls = [];
    let updated = false;
    const apiModule = { exports: {} };
    const query = {
      update: () => { updated = true; return query; },
      eq: () => query,
      then: (resolve) => resolve({ error: null }),
    };
    const apiSource = read('../src/lib/api.ts');
    const helper = apiSource.slice(apiSource.indexOf('async function verifyWorkOrderKm('), apiSource.indexOf('export interface NalogRadnikVrijeme'))
      + apiSource.slice(apiSource.indexOf('export async function saveMobileNalogReport('), apiSource.indexOf('export async function submitMobileNalog('));
    vm.runInNewContext(ts.transpileModule(helper, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      module: apiModule, exports: apiModule.exports,
      validateWorkOrderKm: vehicleModule.exports.validateWorkOrderKm,
      window: { confirm: (message) => { calls.push(['prompt', message]); return accept; } },
      syncNalogTroskovi: async () => {},
      supabase: {
        rpc: async (name, args) => { calls.push([name, args]); return { data: false, error: null }; },
        from: () => query,
      },
    });

    const save = operation === 'office'
      ? apiModule.exports.saveNalogIzvrsenje('order', { km_pocetak: 0, km_kraj: 82000, napomena: null })
      : operation === 'mobileReport'
        ? apiModule.exports.saveMobileNalogReport({ nalogId: 'order', kmPocetak: 0, kmKraj: 82000, kmNa: false })
        : apiModule.exports.saveMobileNalogIzvjestaj({ nalogId: 'order', kmPocetak: 0, kmKraj: 82000, kmNa: false, potvrde: [] });
    if (accept) await save;
    else await assert.rejects(save, /Kilometri nisu spremljeni/);
    assert.equal(updated, operation === 'office' && accept);
    assert.equal(calls.some(([name]) => name === 'confirm_work_order_km'), accept);
    assert.match(calls.find(([name]) => name === 'prompt')[1], /82000 km/);
    if (operation !== 'office') {
      assert.equal(calls.some(([name]) => name === (operation === 'mobileReport' ? 'mobile_save_nalog_report' : 'mobile_save_nalog_izvjestaj')), accept);
    }
   }
  }
});

test('daily synchronization prompts above 1000 km and never replaces costs after cancellation', async () => {
  const costModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read('../src/lib/vehicleKmCosts.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: costModule, exports: costModule.exports });
  const source = read('../src/lib/api.ts');
  const syncSource = source.slice(source.indexOf('async function syncKmGrupe('), source.indexOf('export async function fetchDailyVehicleKmAllocations('));
  for (const accept of [false, true]) {
    const calls = [];
    const assignments = [
      { nalog_id: 'one', vozilo_id: 'vehicle', gradiliste_id: 'site-one' },
      { nalog_id: 'two', vozilo_id: 'vehicle', gradiliste_id: 'site-two' },
    ];
    const orders = [
      { id: 'one', broj: 'RN-1', gradiliste_id: 'site-one', km_pocetak: 81000, km_kraj: 81600 },
      { id: 'two', broj: 'RN-2', gradiliste_id: 'site-two', km_pocetak: 81600, km_kraj: 82200 },
    ];
    const context = {
      calculateDailyVehicleKmCosts: costModule.exports.calculateDailyVehicleKmCosts,
      verifyWorkOrderKm: async () => {},
      window: { confirm: (message) => { calls.push(['prompt', message]); return accept; } },
      replaceDailyVehicleKmSettlement: async (...args) => { calls.push(['replace', ...args]); },
      supabase: {
        rpc: async (name, args) => {
          calls.push([name, args]);
          return {
            data: name === 'review_daily_vehicle_km'
              ? [{ vozilo_id: 'vehicle', naziv: 'Opel Vivaro', kilometri: 1200, signature: 'exact-readings', confirmed: false }]
              : [],
            error: null,
          };
        },
        from: (table) => {
          const query = {
            select: () => query, eq: () => query, not: () => query, in: () => query,
            then: (resolve) => resolve({
              data: table === 'dnevni_raspored_gradilista' ? assignments
                : table === 'radni_nalozi' ? orders
                  : [{ id: 'vehicle', marka: 'Opel', model: 'Vivaro', cijena_km: 0.28 }],
              error: null,
            }),
          };
          return query;
        },
      },
    };
    vm.createContext(context);
    vm.runInContext(ts.transpileModule(`${syncSource}\nthis.sync = syncKmGrupe;`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    const result = context.sync('2026-11-09');
    if (accept) await result;
    else await assert.rejects(result, /Dnevni kilometarski obračun nije spremljen/);
    assert.equal(calls.some(([name]) => name === 'confirm_daily_vehicle_km'), accept);
    assert.equal(calls.some(([name]) => name === 'replace'), accept);
    assert.match(calls.find(([name]) => name === 'prompt')[1], /1200 km/);
    if (accept) {
      const costs = calls.find(([name]) => name === 'replace')[2];
      assert.equal(costs.reduce((sum, cost) => sum + cost.iznos, 0), 336);
    }
  }
});

async function setupIncorrectTrip(t, duplicate = false) {
  const db = await setup(t);
  await db.exec(`
    ALTER TABLE public.troskovi ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid();
    ALTER TABLE public.troskovi ADD COLUMN gradiliste_id uuid;
    CREATE TABLE public.gradilista (id uuid PRIMARY KEY, company_id uuid DEFAULT public.app_current_company_id(), naziv text);
    INSERT INTO public.gradilista (id, naziv) VALUES ('00000000-0000-0000-0000-000000000006', 'Brane Stan');
    ALTER TABLE public.radni_nalozi DISABLE TRIGGER validate_work_order_km;
    UPDATE public.radni_nalozi SET km_pocetak=0, km_kraj=82000, status='zavrsen' WHERE broj='RN-1';
    ALTER TABLE public.radni_nalozi ENABLE TRIGGER validate_work_order_km;
    ALTER TABLE public.troskovi DISABLE TRIGGER validate_daily_vehicle_km_amount;
    INSERT INTO public.troskovi (nalog_id, gradiliste_id, datum, kategorija, opis, iznos) VALUES
      ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000006',
       '2026-11-09', 'put', 'Kilometri: Opel Vivaro 82000 km × 0.28 €/km', 22960),
      ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000006',
       '2026-11-09', 'place', 'Rad 8 sati', 144),
      ('00000000-0000-0000-0000-000000000005', NULL,
       '2026-11-09', 'put', 'Kilometri: drugo vozilo 100 km', 28);
    ALTER TABLE public.troskovi ENABLE TRIGGER validate_daily_vehicle_km_amount;
    CREATE TABLE private.resource_deletions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, module text,
      table_name text, record_id uuid, snapshot jsonb, actor_name text,
      active boolean DEFAULT true, transaction_id bigint DEFAULT txid_current()
    );
    CREATE TABLE private.business_change_history (
      sequence bigserial, id uuid DEFAULT gen_random_uuid(), transaction_id bigint DEFAULT txid_current()
    );
    CREATE TABLE private.resource_deletion_events (deletion_id uuid, history_id uuid);
  `);
  if (duplicate) {
    await db.exec(`
      ALTER TABLE public.troskovi DISABLE TRIGGER validate_daily_vehicle_km_amount;
      INSERT INTO public.troskovi (nalog_id, gradiliste_id, datum, kategorija, opis, iznos)
      SELECT nalog_id, gradiliste_id, datum, kategorija, opis, iznos
      FROM public.troskovi WHERE iznos=22960;
      ALTER TABLE public.troskovi ENABLE TRIGGER validate_daily_vehicle_km_amount;
    `);
  }
  const original = read('../supabase/migrations/20261110240000_dnevni_kilometarski_troskovi_povrat.sql');
  await db.exec(original.slice(0, original.indexOf('CREATE FUNCTION private.daily_vehicle_km_settlement_unchanged')));
  return db;
}

test('requested cleanup removes only the exact wrong trip, records a snapshot and prevents its recalculation', async (t) => {
  const db = await setupIncorrectTrip(t);
  const cleanup = read('../supabase/migrations/20261110620000_uklanjanje_pogresnog_puta_brane_stan.sql');
  const before = (await db.query('SELECT id::text, opis, iznos::int FROM public.troskovi WHERE iznos<>22960 ORDER BY id')).rows;
  await db.exec(cleanup);
  assert.deepEqual((await db.query('SELECT id::text, opis, iznos::int FROM public.troskovi ORDER BY id')).rows, before);
  const order = (await db.query("SELECT km_bez_obracuna, km_pocetak::int, km_kraj::int FROM public.radni_nalozi WHERE broj='RN-1'")).rows[0];
  assert.deepEqual(order, { km_bez_obracuna: true, km_pocetak: 0, km_kraj: 82000 });
  assert.equal((await db.query("SELECT km_bez_obracuna FROM public.radni_nalozi WHERE broj='RN-2'")).rows[0].km_bez_obracuna, false);
  assert.equal((await db.query('SELECT (snapshot->\'original_cost\'->>\'iznos\')::int AS amount, active FROM private.resource_deletions')).rows[0].amount, 22960);
  assert.equal((await db.query('SELECT active FROM private.resource_deletions')).rows[0].active, false);
  assert.equal((await db.query('SELECT jsonb_array_length(after_costs) AS count FROM private.daily_vehicle_km_settlements')).rows[0].count, 1);
  assert.equal((await db.query("SELECT * FROM public.review_daily_vehicle_km('2026-11-09')")).rows.length, 0);
  await db.exec(cleanup);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM private.resource_deletions')).rows[0].count, 1);
  await assert.rejects(db.exec(`
    INSERT INTO public.troskovi (nalog_id, datum, kategorija, opis, iznos)
    VALUES ('00000000-0000-0000-0000-000000000004','2026-11-09','put','Kilometri: Opel Vivaro 82000 km',22960)
  `), /Kilometarski troškovi mijenjaju se samo/);
});

test('requested cleanup stops without touching data if multiple costs match', async (t) => {
  const db = await setupIncorrectTrip(t, true);
  await assert.rejects(db.exec(read('../supabase/migrations/20261110620000_uklanjanje_pogresnog_puta_brane_stan.sql')),
    /Pronađeno je 2/);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.troskovi WHERE iznos=22960')).rows[0].count, 2);
  assert.equal((await db.query("SELECT km_bez_obracuna FROM public.radni_nalozi WHERE broj='RN-1'")).rows[0].km_bez_obracuna, false);
});
