import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

function load(file, mocks) {
  const { outputText } = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
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

function apiSetup(result) {
  const calls = [];
  const api = load('../src/lib/api.ts', {
    './supabase': { supabase: { rpc: async (...args) => { calls.push(args); return result; } } },
    './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {},
    './company': {}, './pagination': {}, './rokovi': {}, './imageCompression': {},
  });
  return { api, calls };
}

test('work-order settlement API sends atomic payloads and has distinct recovery endpoints', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  const hours = [{
    radnik_id: 'worker', gradiliste_id: 'site', datum: '2026-11-05', sati: 8,
    napomena: null, nalog_id: 'order', nocni_sati: 2,
  }];
  const costs = [{
    gradiliste_id: 'site', kategorija: 'place', opis: 'Noćni rad', iznos: 12,
    datum: '2026-11-05', nalog_id: 'order',
  }];
  await api.replaceWorkOrderSettlement('order', hours, costs);
  await api.fetchWorkOrderSettlementDeletions({ id: 'older', created_at: '2026-11-05T00:00:00Z' });
  await api.restoreWorkOrderSettlement('package');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['replace_work_order_settlement', { p_nalog_id: 'order', p_entries: hours, p_costs: costs }],
    ['get_work_order_settlement_deletions', { p_before_time: '2026-11-05T00:00:00Z', p_before_id: 'older' }],
    ['restore_work_order_settlement', { p_deletion_id: 'package' }],
  ]);
  for (const operation of ['replaceWorkOrderSettlement', 'fetchWorkOrderSettlementDeletions', 'restoreWorkOrderSettlement']) {
    const missing = apiSetup({ error: { code: 'PGRST202' } }).api;
    await assert.rejects(operation === 'replaceWorkOrderSettlement'
      ? missing[operation]('order', [], [])
      : operation === 'fetchWorkOrderSettlementDeletions' ? missing[operation]()
        : missing[operation]('package'), /20261110230000/);
  }
});

test('daily vehicle kilometre API uses the atomic settlement and recovery RPCs', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  const costs = [{
    nalog_id: 'order', gradiliste_id: 'site', kategorija: 'put', opis: 'Kilometri: Opel Vivaro 20 km × 0.5 €/km',
    iznos: 10, datum: '2026-11-05',
  }];
  await api.replaceDailyVehicleKmSettlement('2026-11-05', costs);
  await api.fetchDailyVehicleKmSettlements({ id: 'older', created_at: '2026-11-05T00:00:00Z' });
  await api.restoreDailyVehicleKmSettlement('package');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['replace_daily_vehicle_km_settlement', { p_datum: '2026-11-05', p_costs: costs }],
    ['get_daily_vehicle_km_settlements', { p_before_time: '2026-11-05T00:00:00Z', p_before_id: 'older' }],
    ['restore_daily_vehicle_km_settlement', { p_deletion_id: 'package' }],
  ]);
  for (const [operation, args] of [
    ['replaceDailyVehicleKmSettlement', ['2026-11-05', costs]],
    ['fetchDailyVehicleKmSettlements', []],
    ['restoreDailyVehicleKmSettlement', ['package']],
  ]) {
    const missing = apiSetup({ error: { code: 'PGRST202' } }).api;
    await assert.rejects(missing[operation](...args), /20261110240000/);
  }
});

test('kilometre sync retry recalculates only the work-order day and propagates failures', async () => {
  const createApi = (rpcResult) => {
    const calls = [];
    const supabase = {
      rpc: async (...args) => {
        calls.push(args);
        return rpcResult;
      },
      from: (table) => {
        const query = {
          select: () => query,
          eq: () => query,
          order: () => query,
          not: () => query,
          in: () => query,
          limit: () => query,
          single: async () => ({
            data: {
              status: 'zavrsen', km_kraj: 125, bez_izvrsenja: false,
              rok: '2026-11-05', datum_kreiranja: '2026-11-01T10:00:00Z',
            },
            error: null,
          }),
          then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
        };
        assert.ok(['radni_nalozi', 'dnevni_raspored_gradilista'].includes(table));
        return query;
      },
    };
    const api = load('../src/lib/api.ts', {
      './supabase': { supabase },
      './postavke': {}, './obracunSati': {},
      './vehicleKmCosts': { calculateDailyVehicleKmCosts: () => [] },
      './company': {}, './pagination': {}, './rokovi': {}, './imageCompression': {},
    });
    return { api, calls };
  };

  const success = createApi({ error: null });
  await success.api.retryNalogKilometrazaSync('order');
  assert.deepEqual(JSON.parse(JSON.stringify(success.calls)), [
    ['replace_daily_vehicle_km_settlement', { p_datum: '2026-11-05', p_costs: [] }],
  ]);

  const failure = createApi({ error: { code: '40001', message: 'Conflict' } });
  await assert.rejects(failure.api.retryNalogKilometrazaSync('order'), (error) => error.message === 'Conflict');
});

test('status restore commits once and recalculates daily vehicle kilometres separately', async () => {
  const calls = [];
  const supabase = {
    rpc: async (...args) => {
      calls.push(args);
      return { data: null, error: null };
    },
    from: (table) => {
      assert.ok(['radni_nalozi', 'dnevni_raspored_gradilista'].includes(table));
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        not: () => query,
        in: () => query,
        limit: () => query,
        single: async () => ({
          data: {
            status: 'u_tijeku', km_kraj: null, bez_izvrsenja: false,
            rok: '2026-11-05', datum_kreiranja: '2026-11-01T10:00:00Z',
          },
          error: null,
        }),
        then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return query;
    },
  };
  const api = load('../src/lib/api.ts', {
    './supabase': { supabase },
    './postavke': {}, './obracunSati': {},
    './vehicleKmCosts': { calculateDailyVehicleKmCosts: () => [] },
    './company': {}, './pagination': {}, './rokovi': {}, './imageCompression': {},
  });
  await api.restoreWorkOrderStatusChange('change-id', 'order-id');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['restore_work_order_status_change', { p_status_change_id: 'change-id' }],
    ['replace_daily_vehicle_km_settlement', { p_datum: '2026-11-05', p_costs: [] }],
  ]);
});

test('settlement migration atomically replaces hours and operating costs, restores exact snapshots and blocks conflicts', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE SCHEMA private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    CREATE TABLE public.tvrtke (id uuid PRIMARY KEY, aktivna boolean NOT NULL);
    CREATE TABLE public.app_profiles (id uuid PRIMARY KEY, email text, company_id uuid, approved boolean);
    CREATE TABLE public.app_user_permissions (user_id uuid, module text, can_edit boolean);
    CREATE FUNCTION public.app_current_company_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT p.company_id FROM public.app_profiles p
        JOIN public.tvrtke c ON c.id = p.company_id
        WHERE p.id = auth.uid() AND p.approved AND c.aktivna;
      $$;
    CREATE FUNCTION public.app_has_module_permission(p_module text, p_action text) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.app_profiles p
          JOIN public.app_user_permissions permission ON permission.user_id = p.id
          WHERE p.id = auth.uid() AND p.approved AND p.company_id = public.app_current_company_id()
            AND permission.module = p_module AND permission.can_edit
        );
      $$;
    CREATE TABLE public.radnici (id uuid PRIMARY KEY, company_id uuid NOT NULL);
    CREATE TABLE public.gradilista (id uuid PRIMARY KEY, company_id uuid NOT NULL);
    CREATE TABLE public.gradiliste_zadaci (
      id uuid PRIMARY KEY, company_id uuid NOT NULL, nalog_id uuid,
      gradiliste_id uuid, gotovo boolean NOT NULL DEFAULT false, gotovo_at timestamptz,
      naziv text, rok date, kooperant_id uuid
    );
    CREATE TABLE public.rokovi (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
      gradiliste_id uuid, zadatak_id uuid, naziv text NOT NULL, datum date NOT NULL,
      datum_pocetka date, datum_zavrsetka date, kooperant_id uuid,
      status text NOT NULL, opis text, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.radni_nalozi (
      id uuid PRIMARY KEY, company_id uuid NOT NULL, broj text NOT NULL,
      status text NOT NULL, mobile_status text NOT NULL DEFAULT 'nije_poslan',
      bez_izvrsenja boolean NOT NULL DEFAULT false, zakljucen_at timestamptz,
      km_pocetak numeric, km_kraj numeric, napomena text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.mobile_work_order_audit (
      id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      nalog_id uuid NOT NULL, actor_name text NOT NULL, action text NOT NULL,
      details jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION public.write_mobile_work_order_audit(p_nalog_id uuid, p_action text, p_details jsonb DEFAULT '{}'::jsonb)
      RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
        INSERT INTO public.mobile_work_order_audit(nalog_id,actor_name,action,details)
        VALUES (p_nalog_id, 'Editor', p_action, p_details)
      $$;
    CREATE TABLE public.radno_vrijeme (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
      radnik_id uuid NOT NULL, gradiliste_id uuid, datum date NOT NULL,
      sati numeric NOT NULL, napomena text, nalog_id uuid NOT NULL, nocni_sati numeric NOT NULL DEFAULT 0
    );
    CREATE TABLE public.troskovi (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
      gradiliste_id uuid, kategorija text NOT NULL, opis text NOT NULL,
      iznos numeric NOT NULL, datum date NOT NULL, nalog_id uuid NOT NULL
    );
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.radni_nalozi, public.radno_vrijeme, public.troskovi TO authenticated;
    GRANT SELECT ON public.gradiliste_zadaci TO authenticated;
    CREATE TABLE private.resource_recovery_tables (table_name text PRIMARY KEY, key_columns text[] NOT NULL);
    INSERT INTO private.resource_recovery_tables VALUES
      ('radno_vrijeme', ARRAY['id']), ('troskovi', ARRAY['id']);
    CREATE SEQUENCE private.resource_recovery_revision;
    CREATE TABLE private.deadline_sync_context (
      transaction_id bigint NOT NULL, task_id uuid NOT NULL, PRIMARY KEY(transaction_id,task_id)
    );
    CREATE TABLE private.task_deadline_projection_calls (task_id uuid NOT NULL);
    CREATE FUNCTION private.project_task_deadline(p_task_id uuid)
      RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
        INSERT INTO private.task_deadline_projection_calls VALUES (p_task_id);
      $$;
    CREATE TABLE private.resource_recovery_versions (table_name text, row_key jsonb, revision bigint, PRIMARY KEY(table_name,row_key));
    CREATE TABLE private.resource_deletions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, module text NOT NULL,
      table_name text NOT NULL, record_id uuid NOT NULL, snapshot jsonb NOT NULL, actor_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '30 days',
      transaction_id bigint NOT NULL DEFAULT txid_current(), active boolean NOT NULL DEFAULT true,
      restoring boolean NOT NULL DEFAULT false, reversed_at timestamptz
    );
    CREATE UNIQUE INDEX active_deletion_per_transaction ON private.resource_deletions(transaction_id) WHERE active;
    CREATE TABLE private.resource_deletion_rows (
      sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      deletion_id uuid NOT NULL REFERENCES private.resource_deletions(id) ON DELETE CASCADE,
      table_name text NOT NULL, row_key jsonb NOT NULL, before_data jsonb, after_data jsonb,
      before_revision bigint, after_revision bigint NOT NULL, UNIQUE(deletion_id,table_name,row_key)
    );
    CREATE TABLE private.resource_deletion_events (deletion_id uuid, history_id uuid);
    CREATE TABLE private.business_change_history (
      sequence bigint GENERATED ALWAYS AS IDENTITY, id uuid DEFAULT gen_random_uuid(),
      transaction_id bigint NOT NULL DEFAULT txid_current(), table_name text, record_id uuid,
      before_data jsonb, after_data jsonb, expires_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE private.work_order_team_change_history (expires_at timestamptz NOT NULL);
    CREATE TABLE private.work_time_order_versions (nalog_id uuid PRIMARY KEY, revision bigint NOT NULL);
    CREATE FUNCTION private.resource_recovery_module(p_table text, p_data jsonb) RETURNS text
      LANGUAGE sql IMMUTABLE AS $$
        SELECT CASE p_table WHEN 'radno_vrijeme' THEN 'radno_vrijeme'
          WHEN 'troskovi' THEN 'troskovi' WHEN 'radni_nalozi' THEN 'radni_nalozi'
          WHEN 'gradilista' THEN 'gradilista' ELSE 'unsupported' END;
      $$;
    CREATE FUNCTION private.resource_deletion_allowed(p_deletion_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT public.app_has_module_permission(d.module, 'edit')
          AND bool_and(public.app_has_module_permission(
            private.resource_recovery_module(r.table_name, COALESCE(r.before_data,r.after_data)), 'edit'))
        FROM private.resource_deletions d JOIN private.resource_deletion_rows r ON r.deletion_id=d.id
        WHERE d.id=p_deletion_id GROUP BY d.module;
      $$;
    CREATE FUNCTION private.capture_work_time_order_version() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE target uuid;
      BEGIN
        target := COALESCE(NEW.nalog_id, OLD.nalog_id);
        INSERT INTO private.work_time_order_versions VALUES (target, nextval('private.resource_recovery_revision'))
          ON CONFLICT (nalog_id) DO UPDATE SET revision=EXCLUDED.revision;
        RETURN COALESCE(NEW,OLD);
      END;
      $$;
    CREATE TRIGGER capture_time_revision AFTER INSERT OR UPDATE OR DELETE ON public.radno_vrijeme
      FOR EACH ROW EXECUTE FUNCTION private.capture_work_time_order_version();
    CREATE FUNCTION private.capture_resource_recovery_row() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        before_row jsonb;
        after_row jsonb;
        row_id uuid;
        current_revision bigint;
        operation_id uuid;
      BEGIN
        IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
        IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
        row_id := COALESCE(NEW.id, OLD.id);
        SELECT id INTO operation_id FROM private.resource_deletions WHERE active AND transaction_id=txid_current();
        SELECT revision INTO current_revision FROM private.resource_recovery_versions
          WHERE table_name=TG_TABLE_NAME AND row_key=jsonb_build_object('id',row_id) FOR UPDATE;
        INSERT INTO private.resource_recovery_versions VALUES
          (TG_TABLE_NAME,jsonb_build_object('id',row_id),nextval('private.resource_recovery_revision'))
        ON CONFLICT (table_name,row_key) DO UPDATE SET revision=EXCLUDED.revision
        RETURNING revision INTO current_revision;
        IF operation_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM private.resource_deletions WHERE id=operation_id AND restoring
        ) THEN
          INSERT INTO private.resource_deletion_rows(
            deletion_id,table_name,row_key,before_data,after_data,before_revision,after_revision
          ) VALUES(operation_id,TG_TABLE_NAME,jsonb_build_object('id',row_id),before_row,after_row,NULL,current_revision)
          ON CONFLICT(deletion_id,table_name,row_key) DO UPDATE SET after_data=EXCLUDED.after_data,
            after_revision=EXCLUDED.after_revision;
        END IF;
        RETURN COALESCE(NEW,OLD);
      END;
      $$;
    CREATE TRIGGER capture_time_recovery AFTER INSERT OR UPDATE OR DELETE ON public.radno_vrijeme
      FOR EACH ROW EXECUTE FUNCTION private.capture_resource_recovery_row();
    CREATE TRIGGER capture_cost_recovery AFTER INSERT OR UPDATE OR DELETE ON public.troskovi
      FOR EACH ROW EXECUTE FUNCTION private.capture_resource_recovery_row();
    CREATE FUNCTION public.restore_resource_deletion(p_deletion_id uuid) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        operation private.resource_deletions%ROWTYPE;
        item record;
      BEGIN
        SELECT * INTO operation FROM private.resource_deletions WHERE id=p_deletion_id FOR UPDATE;
        UPDATE private.resource_deletions SET active=true,restoring=true,transaction_id=txid_current() WHERE id=p_deletion_id;
        FOR item IN SELECT * FROM private.resource_deletion_rows WHERE deletion_id=p_deletion_id ORDER BY sequence LOOP
          IF item.table_name='radno_vrijeme' THEN
            IF item.before_data IS NULL THEN
              DELETE FROM public.radno_vrijeme WHERE id=(item.row_key->>'id')::uuid;
            ELSIF item.after_data IS NULL THEN
              INSERT INTO public.radno_vrijeme SELECT (jsonb_populate_record(NULL::public.radno_vrijeme,item.before_data)).*;
            END IF;
          ELSE
            IF item.before_data IS NULL THEN
              DELETE FROM public.troskovi WHERE id=(item.row_key->>'id')::uuid;
            ELSIF item.after_data IS NULL THEN
              INSERT INTO public.troskovi SELECT (jsonb_populate_record(NULL::public.troskovi,item.before_data)).*;
            END IF;
          END IF;
        END LOOP;
        UPDATE private.resource_deletions SET active=false,restoring=false,reversed_at=clock_timestamp() WHERE id=p_deletion_id;
      END;
      $$;
    INSERT INTO public.tvrtke VALUES ('00000000-0000-0000-0000-000000000001',true);
    INSERT INTO public.app_profiles VALUES (
      '00000000-0000-0000-0000-000000000002','editor@example.test',
      '00000000-0000-0000-0000-000000000001',true
    );
    INSERT INTO public.app_user_permissions VALUES
      ('00000000-0000-0000-0000-000000000002','radni_nalozi',true),
      ('00000000-0000-0000-0000-000000000002','radno_vrijeme',true),
      ('00000000-0000-0000-0000-000000000002','troskovi',true),
      ('00000000-0000-0000-0000-000000000002','gradilista',true);
    INSERT INTO public.radnici VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001');
    INSERT INTO public.gradilista VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001');
    INSERT INTO public.gradiliste_zadaci VALUES
      ('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000004',false,NULL,'Otvoreni zadatak',NULL,NULL),
      ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000004',true,NULL,'Dovršeni zadatak',NULL,NULL);
    INSERT INTO public.radni_nalozi VALUES
      ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','RN-1','zavrsen',now());
    INSERT INTO public.radno_vrijeme(id,company_id,radnik_id,gradiliste_id,datum,sati,napomena,nalog_id,nocni_sati)
      VALUES ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004',
        '2026-11-04',7.5,'Izvorno','00000000-0000-0000-0000-000000000005',1);
    INSERT INTO public.troskovi(id,company_id,gradiliste_id,kategorija,opis,iznos,datum,nalog_id)
      VALUES
        ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000004','place','Izvorni trošak',10,
          '2026-11-04','00000000-0000-0000-0000-000000000005'),
        ('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000004','put','Kilometri: RN-1',4,
          '2026-11-04','00000000-0000-0000-0000-000000000005');
    SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
  `);
  await db.exec(read('../supabase/migrations/20261110230000_nalozi_obracun_povijest_vracanje.sql'));
  await db.exec(read('../supabase/migrations/20261110310000_nalog_obracun_povrat_status_guard.sql'));
  await db.exec(read('../supabase/migrations/20261110310000_nalog_obracun_povrat_status_guard.sql'));
  await db.exec(read('../supabase/migrations/20261110320000_nalog_status_obracun_atomaran.sql'));
  await db.exec(read('../supabase/migrations/20261110320000_nalog_status_obracun_atomaran.sql'));
  await db.exec(`
    CREATE FUNCTION public.set_work_order_status_with_settlement(
      uuid, boolean, boolean, boolean, jsonb, jsonb
    ) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
  `);
  await db.exec(read('../supabase/migrations/20261110330000_nalog_zavrsni_izvjestaj_atomaran.sql'));
  await db.exec(read('../supabase/migrations/20261110330000_nalog_zavrsni_izvjestaj_atomaran.sql'));
  await db.exec(read('../supabase/migrations/20261110340000_nalog_rokovi_atomarna_sinkronizacija.sql'));
  await db.exec(read('../supabase/migrations/20261110340000_nalog_rokovi_atomarna_sinkronizacija.sql'));
  await db.exec(read('../supabase/migrations/20261110350000_nalog_status_povijest_ured.sql'));
  await db.exec(read('../supabase/migrations/20261110350000_nalog_status_povijest_ured.sql'));
  await db.exec(read('../supabase/migrations/20261110360000_nalog_status_izvrsenje_povrat.sql'));
  await db.exec('SET ROLE authenticated');
  const hours = [{
    radnik_id: '00000000-0000-0000-0000-000000000003',
    gradiliste_id: '00000000-0000-0000-0000-000000000004', datum: '2026-11-05',
    sati: 8, napomena: 'Novi obračun', nalog_id: '00000000-0000-0000-0000-000000000005', nocni_sati: 2,
  }];
  const costs = [{
    gradiliste_id: '00000000-0000-0000-0000-000000000004', kategorija: 'place',
    opis: 'Novi noćni dodatak', iznos: 14, datum: '2026-11-05',
    nalog_id: '00000000-0000-0000-0000-000000000005',
  }];
  const { rows } = await db.query(
    'SELECT public.replace_work_order_settlement($1,$2,$3) id',
    ['00000000-0000-0000-0000-000000000005', JSON.stringify(hours), JSON.stringify(costs)],
  );
  const packageId = rows[0].id;
  assert.ok(packageId);
  assert.equal((await db.query('SELECT count(*)::int count FROM public.radno_vrijeme')).rows[0].count, 1);
  assert.equal((await db.query("SELECT opis FROM public.troskovi WHERE kategorija='put'")).rows[0].opis, 'Kilometri: RN-1');
  assert.equal((await db.query("SELECT opis FROM public.troskovi WHERE kategorija='place'")).rows[0].opis, 'Novi noćni dodatak');
  const history = await db.query('SELECT * FROM public.get_work_order_settlement_deletions()');
  assert.equal(history.rows.length, 1);
  assert.equal(history.rows[0].can_restore, true);
  assert.deepEqual(history.rows[0].affected_rows, { radno_vrijeme: 2, troskovi: 2 });
  await assert.rejects(
    db.query('SELECT public.restore_resource_deletion($1)', [packageId]),
    (error) => error.code === '42501',
  );
  await db.query('SELECT public.restore_work_order_settlement($1)', [packageId]);
  assert.equal((await db.query('SELECT sati::text,napomena,nocni_sati::text FROM public.radno_vrijeme')).rows[0]
    .sati, '7.5');
  assert.equal((await db.query("SELECT opis FROM public.troskovi WHERE kategorija='place'")).rows[0].opis, 'Izvorni trošak');
  assert.equal((await db.query("SELECT count(*)::int count FROM public.troskovi WHERE kategorija='put'")).rows[0].count, 1);
  assert.ok((await db.query(
    'SELECT reversed_at FROM public.get_work_order_settlement_deletions() WHERE id=$1', [packageId],
  )).rows[0].reversed_at);

  await db.query(
    'SELECT public.set_work_order_status_with_settlement($1,false,false,false,false,NULL,NULL,NULL,$2,$3)',
    ['00000000-0000-0000-0000-000000000005', JSON.stringify(hours), JSON.stringify(costs)],
  );
  await db.exec('RESET ROLE');
  const statusAudit = (await db.query(
    "SELECT action,details FROM public.mobile_work_order_audit WHERE nalog_id=$1",
    ['00000000-0000-0000-0000-000000000005'],
  )).rows;
  assert.equal(statusAudit.length, 1);
  assert.equal(statusAudit[0].action, 'office_status_changed');
  assert.equal(statusAudit[0].details.old_status, 'zavrsen');
  assert.equal(statusAudit[0].details.new_status, 'u_tijeku');
  assert.ok(statusAudit[0].details.settlement_id);

  await db.exec('SET ROLE authenticated');
  await db.query(`
    UPDATE public.radni_nalozi SET status='u_tijeku',mobile_status='predan'
    WHERE id='00000000-0000-0000-0000-000000000005'
  `);
  await db.exec('RESET ROLE');
  await db.exec(`
    CREATE FUNCTION public.reject_work_order_task_transfer()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.nalog_id IS NOT NULL AND NEW.nalog_id IS NULL THEN
        RAISE EXCEPTION 'Task transfer rejected';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER reject_work_order_task_transfer
    BEFORE UPDATE ON public.gradiliste_zadaci
    FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_task_transfer();
  `);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(
    db.query(
      'SELECT public.set_work_order_status_with_settlement($1,true,false,false,true,120,145,$4,$2,$3)',
      ['00000000-0000-0000-0000-000000000005', JSON.stringify(hours), JSON.stringify(costs), 'Završni izvještaj'],
    ),
    /Task transfer rejected/,
  );
  assert.deepEqual((await db.query(
    'SELECT status,mobile_status,km_pocetak,km_kraj,napomena FROM public.radni_nalozi WHERE id=$1',
    ['00000000-0000-0000-0000-000000000005'],
  )).rows[0], {
    status: 'u_tijeku', mobile_status: 'predan', km_pocetak: null, km_kraj: null, napomena: null,
  });
  assert.equal((await db.query(
    'SELECT nalog_id FROM public.gradiliste_zadaci WHERE id=$1',
    ['00000000-0000-0000-0000-000000000009'],
  )).rows[0].nalog_id, '00000000-0000-0000-0000-000000000005');
  await db.exec('RESET ROLE');
  await db.exec('DROP TRIGGER reject_work_order_task_transfer ON public.gradiliste_zadaci');
  await db.exec('SET ROLE authenticated');
  await db.exec('RESET ROLE');
  await db.exec(`
    CREATE FUNCTION public.reject_task_deadline_projection()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Deadline projection rejected';
    END;
    $$;
    CREATE TRIGGER reject_task_deadline_projection
    BEFORE INSERT ON private.task_deadline_projection_calls
    FOR EACH ROW EXECUTE FUNCTION public.reject_task_deadline_projection();
  `);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(
    db.query(
      'SELECT public.set_work_order_status_with_settlement($1,true,false,false,true,120,145,$4,$2,$3)',
      ['00000000-0000-0000-0000-000000000005', JSON.stringify(hours), JSON.stringify(costs), 'Završni izvještaj'],
    ),
    /Deadline projection rejected/,
  );
  assert.deepEqual((await db.query(
    'SELECT status,mobile_status,km_pocetak,km_kraj,napomena FROM public.radni_nalozi WHERE id=$1',
    ['00000000-0000-0000-0000-000000000005'],
  )).rows[0], {
    status: 'u_tijeku', mobile_status: 'predan', km_pocetak: null, km_kraj: null, napomena: null,
  });
  assert.equal((await db.query(
    'SELECT nalog_id FROM public.gradiliste_zadaci WHERE id=$1',
    ['00000000-0000-0000-0000-000000000009'],
  )).rows[0].nalog_id, '00000000-0000-0000-0000-000000000005');
  assert.equal((await db.query(
    'SELECT gotovo_at FROM public.gradiliste_zadaci WHERE id=$1',
    ['00000000-0000-0000-0000-000000000010'],
  )).rows[0].gotovo_at, null);
  await db.exec('RESET ROLE');
  await db.exec('DROP TRIGGER reject_task_deadline_projection ON private.task_deadline_projection_calls');
  await db.exec('SET ROLE authenticated');
  const atomicClose = await db.query(
    'SELECT public.set_work_order_status_with_settlement($1,true,false,false,true,120,145,$4,$2,$3) id',
    ['00000000-0000-0000-0000-000000000005', JSON.stringify(hours), JSON.stringify(costs), 'Završni izvještaj'],
  );
  assert.ok(atomicClose.rows[0].id);
  assert.deepEqual((await db.query(
    'SELECT status,mobile_status,bez_izvrsenja FROM public.radni_nalozi WHERE id=$1',
    ['00000000-0000-0000-0000-000000000005'],
  )).rows[0], { status: 'zavrsen', mobile_status: 'odobren', bez_izvrsenja: false });
  assert.deepEqual((await db.query(
    'SELECT km_pocetak::int,km_kraj::int,napomena FROM public.radni_nalozi WHERE id=$1',
    ['00000000-0000-0000-0000-000000000005'],
  )).rows[0], { km_pocetak: 120, km_kraj: 145, napomena: 'Završni izvještaj' });
  assert.equal((await db.query(
    'SELECT nalog_id FROM public.gradiliste_zadaci WHERE id=$1',
    ['00000000-0000-0000-0000-000000000009'],
  )).rows[0].nalog_id, null);
  assert.ok((await db.query(
    'SELECT gotovo_at FROM public.gradiliste_zadaci WHERE id=$1',
    ['00000000-0000-0000-0000-000000000010'],
  )).rows[0].gotovo_at);
  await db.exec('RESET ROLE');
  assert.deepEqual((await db.query('SELECT task_id FROM private.task_deadline_projection_calls'))
    .rows.map(({ task_id }) => task_id), ['00000000-0000-0000-0000-000000000010']);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(
    db.query(
      'SELECT public.set_work_order_status_with_settlement($1,true,false,false,true,145,120,$4,$2,$3)',
      ['00000000-0000-0000-0000-000000000005', JSON.stringify(hours), JSON.stringify(costs), 'Neispravno'],
    ),
    (error) => error.code === '22023',
  );
  assert.equal((await db.query(
    'SELECT status FROM public.radni_nalozi WHERE id=$1',
    ['00000000-0000-0000-0000-000000000005'],
  )).rows[0].status, 'zavrsen');
  await db.query(`
    UPDATE public.radni_nalozi SET status='u_tijeku',mobile_status='u_tijeku'
    WHERE id='00000000-0000-0000-0000-000000000005'
  `);
  await assert.rejects(
    db.query(
      'SELECT public.set_work_order_status_with_settlement($1,true,false,false,false,NULL,NULL,NULL,$2,$3)',
      ['00000000-0000-0000-0000-000000000005', JSON.stringify(hours), JSON.stringify(costs)],
    ),
    (error) => error.code === '55000',
  );
  assert.deepEqual((await db.query(
    'SELECT status,mobile_status FROM public.radni_nalozi WHERE id=$1',
    ['00000000-0000-0000-0000-000000000005'],
  )).rows[0], { status: 'u_tijeku', mobile_status: 'u_tijeku' });
  await db.query(`
    UPDATE public.radni_nalozi SET status='zavrsen',mobile_status='predan'
    WHERE id='00000000-0000-0000-0000-000000000005'
  `);

  const second = await db.query(
    'SELECT public.replace_work_order_settlement($1,$2,$3) id',
    ['00000000-0000-0000-0000-000000000005', JSON.stringify(hours), JSON.stringify(costs)],
  );
  const conflictId = second.rows[0].id;
  await db.query("UPDATE public.radni_nalozi SET status='u_tijeku' WHERE id='00000000-0000-0000-0000-000000000005'");
  const statusChanged = await db.query(
    'SELECT can_restore FROM public.get_work_order_settlement_deletions() WHERE id=$1',
    [conflictId],
  );
  assert.equal(statusChanged.rows[0].can_restore, false);
  await assert.rejects(
    db.query('SELECT public.restore_work_order_settlement($1)', [conflictId]),
    (error) => error.code === '40001',
  );
  await db.query("UPDATE public.radni_nalozi SET status='zavrsen' WHERE id='00000000-0000-0000-0000-000000000005'");
  await db.query(`
    INSERT INTO public.troskovi(company_id,gradiliste_id,kategorija,opis,iznos,datum,nalog_id)
    VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004',
      'place','Naknadni trošak',1,'2026-11-05','00000000-0000-0000-0000-000000000005')
  `);
  const conflicted = await db.query('SELECT can_restore FROM public.get_work_order_settlement_deletions() WHERE id=$1',[conflictId]);
  assert.equal(conflicted.rows[0].can_restore, false);
  await assert.rejects(
    db.query('SELECT public.restore_work_order_settlement($1)', [conflictId]),
    (error) => error.code === '40001',
  );

  await db.exec('RESET ROLE');
  await db.exec(read('../supabase/migrations/20261110240000_dnevni_kilometarski_troskovi_povrat.sql'));
  await db.exec('SET ROLE authenticated');
  const dailyCosts = [{
    nalog_id: '00000000-0000-0000-0000-000000000005',
    gradiliste_id: '00000000-0000-0000-0000-000000000004',
    kategorija: 'put', opis: 'Kilometri: Opel Vivaro 20 km × 0.5 €/km', iznos: 10, datum: '2026-11-05',
  }];
  const firstDaily = await db.query(
    'SELECT public.replace_daily_vehicle_km_settlement($1,$2) id',
    ['2026-11-05', JSON.stringify(dailyCosts)],
  );
  const firstDailyId = firstDaily.rows[0].id;
  assert.ok(firstDailyId);
  assert.equal((await db.query("SELECT count(*)::int count FROM public.troskovi WHERE opis LIKE 'Kilometri:%' AND datum='2026-11-05'")).rows[0].count, 1);
  assert.equal((await db.query(
    'SELECT public.replace_daily_vehicle_km_settlement($1,$2) id',
    ['2026-11-05', JSON.stringify(dailyCosts)],
  )).rows[0].id, null);
  await assert.rejects(
    db.query("UPDATE public.troskovi SET iznos=11 WHERE opis LIKE 'Kilometri:%' AND datum='2026-11-05'"),
    (error) => error.code === '42501',
  );

  const revisedDailyCosts = [{ ...dailyCosts[0], opis: 'Kilometri: Opel Vivaro 24 km × 0.5 €/km', iznos: 12 }];
  const secondDaily = await db.query(
    'SELECT public.replace_daily_vehicle_km_settlement($1,$2) id',
    ['2026-11-05', JSON.stringify(revisedDailyCosts)],
  );
  const secondDailyId = secondDaily.rows[0].id;
  await assert.rejects(
    db.query('SELECT public.restore_resource_deletion($1)', [secondDailyId]),
    (error) => error.code === '42501',
  );
  await db.query('SELECT public.restore_daily_vehicle_km_settlement($1)', [secondDailyId]);
  assert.equal((await db.query("SELECT opis FROM public.troskovi WHERE opis LIKE 'Kilometri:%' AND datum='2026-11-05'")).rows[0].opis,
    dailyCosts[0].opis);
  assert.ok((await db.query('SELECT reversed_at FROM public.get_daily_vehicle_km_settlements() WHERE id=$1', [secondDailyId])).rows[0].reversed_at);

  const clearedDaily = await db.query(
    'SELECT public.replace_daily_vehicle_km_settlement($1,$2) id',
    ['2026-11-05', '[]'],
  );
  const clearedDailyId = clearedDaily.rows[0].id;
  assert.ok(clearedDailyId);
  assert.equal((await db.query("SELECT count(*)::int count FROM public.troskovi WHERE opis LIKE 'Kilometri:%' AND datum='2026-11-05'")).rows[0].count, 0);
  await db.query('SELECT public.restore_daily_vehicle_km_settlement($1)', [clearedDailyId]);
  assert.equal((await db.query("SELECT opis FROM public.troskovi WHERE opis LIKE 'Kilometri:%' AND datum='2026-11-05'")).rows[0].opis,
    dailyCosts[0].opis);

  const thirdDaily = await db.query(
    'SELECT public.replace_daily_vehicle_km_settlement($1,$2) id',
    ['2026-11-05', JSON.stringify(revisedDailyCosts)],
  );
  const thirdDailyId = thirdDaily.rows[0].id;
  const fourthDailyCosts = [{ ...dailyCosts[0], opis: 'Kilometri: Opel Vivaro 26 km × 0.5 €/km', iznos: 13 }];
  await db.query('SELECT public.replace_daily_vehicle_km_settlement($1,$2)', ['2026-11-05', JSON.stringify(fourthDailyCosts)]);
  assert.equal((await db.query('SELECT can_restore FROM public.get_daily_vehicle_km_settlements() WHERE id=$1', [thirdDailyId])).rows[0].can_restore, false);
  await assert.rejects(
    db.query('SELECT public.restore_daily_vehicle_km_settlement($1)', [thirdDailyId]),
    (error) => error.code === '40001',
  );

  await db.exec('RESET ROLE');
  await db.exec(`
    UPDATE public.radni_nalozi
    SET status='u_tijeku', mobile_status='predan', bez_izvrsenja=false,
        zakljucen_at=NULL, km_pocetak=NULL, km_kraj=NULL, napomena=NULL
    WHERE id='00000000-0000-0000-0000-000000000005';
    UPDATE public.gradiliste_zadaci SET nalog_id='00000000-0000-0000-0000-000000000005'
    WHERE id='00000000-0000-0000-0000-000000000009';
    UPDATE public.gradiliste_zadaci SET gotovo_at=NULL
    WHERE id='00000000-0000-0000-0000-000000000010';
  `);
  await db.exec('SET ROLE authenticated');
  const statusRestoreHours = [{ ...hours[0], sati: 6, napomena: 'Izmjena za povrat' }];
  const statusRestoreCosts = [{ ...costs[0], opis: 'Izmijenjeni trošak za povrat', iznos: 22 }];
  await db.query(
    'SELECT public.set_work_order_status_with_settlement($1,true,false,false,true,120,145,$4,$2,$3)',
    ['00000000-0000-0000-0000-000000000005', JSON.stringify(statusRestoreHours), JSON.stringify(statusRestoreCosts), 'Završni izvještaj za povrat'],
  );
  await db.exec('RESET ROLE');
  const restorableStatusId = (await db.query(
    `SELECT audit.details->>'status_change_id' id FROM public.mobile_work_order_audit audit
     WHERE audit.nalog_id='00000000-0000-0000-0000-000000000005'
       AND audit.action='office_status_changed'
     ORDER BY audit.id DESC LIMIT 1`,
  )).rows[0].id;
  const orderSnapshots = (await db.query(
    `SELECT to_jsonb(order_row)-'updated_at' current_data,
            change.after_order-'updated_at' expected_data
     FROM public.radni_nalozi order_row
     JOIN private.work_order_status_changes change ON change.id=$1`,
    [restorableStatusId],
  )).rows[0];
  assert.deepEqual(orderSnapshots.current_data, orderSnapshots.expected_data);
  await db.exec('SET ROLE authenticated');
  await db.query('SELECT public.restore_work_order_status_change($1)', [restorableStatusId]);
  assert.equal((await db.query(
    'SELECT status FROM public.radni_nalozi WHERE id=$1',
    ['00000000-0000-0000-0000-000000000005'],
  )).rows[0].status, 'u_tijeku');
  assert.equal((await db.query(
    'SELECT sati::int FROM public.radno_vrijeme WHERE nalog_id=$1',
    ['00000000-0000-0000-0000-000000000005'],
  )).rows[0].sati, 8);
  const restoredCostDescriptions = (await db.query(
    "SELECT opis FROM public.troskovi WHERE nalog_id=$1 AND kategorija='place'",
    ['00000000-0000-0000-0000-000000000005'],
  )).rows.map(({ opis }) => opis).sort();
  assert.deepEqual(restoredCostDescriptions, ['Naknadni trošak', 'Novi noćni dodatak'].sort());
  assert.equal((await db.query(
    'SELECT nalog_id FROM public.gradiliste_zadaci WHERE id=$1',
    ['00000000-0000-0000-0000-000000000009'],
  )).rows[0].nalog_id, '00000000-0000-0000-0000-000000000005');
  assert.equal((await db.query(
    'SELECT gotovo_at FROM public.gradiliste_zadaci WHERE id=$1',
    ['00000000-0000-0000-0000-000000000010'],
  )).rows[0].gotovo_at, null);
  await assert.rejects(
    db.query('SELECT public.restore_work_order_status_change($1)', [restorableStatusId]),
    /već vraćena/,
  );
  await db.exec('RESET ROLE');
});
