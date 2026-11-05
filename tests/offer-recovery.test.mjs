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

test('offer deletion service uses the recovery RPC and reports a missing migration', async () => {
  const calls = [];
  const service = load('../src/lib/ponude.ts', {
    './supabase': { supabase: { rpc: async (...args) => { calls.push(args); return { error: null }; } } },
  });
  await service.deletePonuda('offer-id');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['delete_ponuda_with_history', { p_record_id: 'offer-id' }],
  ]);

  const missing = load('../src/lib/ponude.ts', {
    './supabase': { supabase: { rpc: async () => ({ error: { code: 'PGRST202' } }) } },
  });
  await assert.rejects(missing.deletePonuda('offer-id'), /20261110220000/);
});

test('offer deletion history uses company-scoped RPC pagination and explicit migration errors', async () => {
  const calls = [];
  const mocks = {
    './supabase': { supabase: { rpc: async (...args) => { calls.push(args); return { data: [], error: null }; } } },
    './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {},
    './company': {}, './pagination': {}, './rokovi': {}, './imageCompression': {},
  };
  const api = load('../src/lib/api.ts', mocks);
  await api.fetchPonudaDeletions({ id: 'older', created_at: '2026-11-05T00:00:00Z' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['get_ponuda_deletions', { p_before_time: '2026-11-05T00:00:00Z', p_before_id: 'older' }],
  ]);

  const missing = load('../src/lib/api.ts', {
    ...mocks,
    './supabase': { supabase: { rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) } },
  });
  await assert.rejects(missing.fetchPonudaDeletions(), /20261110220000/);
});

test('offer recovery SQL preserves module mappings and atomically captures the offer with its lines', async (t) => {
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
    CREATE TABLE public.ponude (
      id uuid PRIMARY KEY, company_id uuid NOT NULL, godina integer, redni_broj integer,
      naslov text NOT NULL, datum date NOT NULL, status text NOT NULL
    );
    CREATE TABLE public.ponude_stavke (
      id uuid PRIMARY KEY, company_id uuid NOT NULL,
      ponuda_id uuid NOT NULL REFERENCES public.ponude(id) ON DELETE CASCADE, opis text NOT NULL
    );
    GRANT SELECT, DELETE ON public.ponude, public.ponude_stavke TO authenticated;
    CREATE TABLE private.resource_recovery_tables (table_name text PRIMARY KEY, key_columns text[] NOT NULL);
    INSERT INTO private.resource_recovery_tables VALUES
      ('ponude', ARRAY['id']), ('ponude_stavke', ARRAY['id']);
    CREATE TABLE private.resource_deletions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, module text NOT NULL,
      table_name text NOT NULL, record_id uuid NOT NULL, snapshot jsonb NOT NULL, actor_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '30 days',
      transaction_id bigint NOT NULL DEFAULT txid_current(), active boolean NOT NULL DEFAULT true,
      restoring boolean NOT NULL DEFAULT false, reversed_at timestamptz
    );
    CREATE TABLE private.resource_deletion_rows (
      sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      deletion_id uuid NOT NULL REFERENCES private.resource_deletions(id),
      table_name text NOT NULL, row_key jsonb NOT NULL, before_data jsonb,
      after_data jsonb, before_revision bigint, after_revision bigint NOT NULL,
      UNIQUE (deletion_id, table_name, row_key)
    );
    CREATE TABLE private.resource_deletion_events (deletion_id uuid, history_id uuid);
    CREATE TABLE private.business_change_history (
      sequence bigint GENERATED ALWAYS AS IDENTITY, id uuid DEFAULT gen_random_uuid(),
      transaction_id bigint NOT NULL DEFAULT txid_current(), table_name text, record_id uuid,
      before_data jsonb, after_data jsonb
    );
    CREATE FUNCTION private.guard_resource_deletion() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      BEGIN
        IF auth.uid() IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM private.resource_deletions d
          WHERE d.active AND d.transaction_id = txid_current() AND d.table_name = TG_TABLE_NAME
            AND d.record_id = OLD.id AND d.company_id = OLD.company_id
        ) THEN
          RAISE EXCEPTION 'Protected deletion required.' USING ERRCODE = '42501';
        END IF;
        RETURN OLD;
      END;
      $$;
    CREATE FUNCTION private.capture_resource_recovery_row() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE operation_id uuid;
      BEGIN
        SELECT id INTO operation_id FROM private.resource_deletions
          WHERE active AND transaction_id = txid_current();
        IF operation_id IS NOT NULL THEN
          INSERT INTO private.resource_deletion_rows
            (deletion_id, table_name, row_key, before_data, after_data, after_revision)
          VALUES
            (operation_id, TG_TABLE_NAME, jsonb_build_object('id', OLD.id), to_jsonb(OLD), NULL, 1)
          ON CONFLICT (deletion_id, table_name, row_key) DO UPDATE SET after_data = NULL;
        END IF;
        RETURN OLD;
      END;
      $$;
    CREATE TRIGGER capture_offer_delete AFTER DELETE ON public.ponude
      FOR EACH ROW EXECUTE FUNCTION private.capture_resource_recovery_row();
    CREATE TRIGGER capture_offer_line_delete AFTER DELETE ON public.ponude_stavke
      FOR EACH ROW EXECUTE FUNCTION private.capture_resource_recovery_row();
    CREATE FUNCTION private.resource_deletion_allowed(p_deletion_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT d.module = 'ponude' AND public.app_has_module_permission('ponude', 'edit')
          AND EXISTS (SELECT 1 FROM private.resource_deletion_rows r WHERE r.deletion_id = d.id AND r.table_name = 'ponude')
          AND EXISTS (SELECT 1 FROM private.resource_deletion_rows r WHERE r.deletion_id = d.id AND r.table_name = 'ponude_stavke')
        FROM private.resource_deletions d WHERE d.id = p_deletion_id;
      $$;
    INSERT INTO public.tvrtke VALUES ('00000000-0000-0000-0000-000000000001', true);
    INSERT INTO public.app_profiles VALUES (
      '00000000-0000-0000-0000-000000000002', 'editor@example.test',
      '00000000-0000-0000-0000-000000000001', true
    );
    INSERT INTO public.app_user_permissions VALUES ('00000000-0000-0000-0000-000000000002', 'ponude', true);
  `);

  await db.exec(read('../supabase/migrations/20261110220000_ponude_povrat_brisanja.sql'));
  const mappings = await db.query(`
    SELECT private.resource_recovery_module('ponude_stavke', '{}'::jsonb) AS offer,
      private.resource_recovery_module('gradiliste_zadaci', '{}'::jsonb) AS sites,
      private.resource_recovery_module('troskovi', '{}'::jsonb) AS costs,
      private.resource_recovery_module('kooperant_dokumenti', '{}'::jsonb) AS cooperator
  `);
  assert.deepEqual(mappings.rows[0], { offer: 'ponude', sites: 'gradilista', costs: 'troskovi', cooperator: 'kooperanti' });

  await db.exec(`
    INSERT INTO public.ponude VALUES
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 2026, 8, 'Sanacija krova', '2026-11-05', 'nepotvrdena'),
      ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 2026, 9, 'Druga ponuda', '2026-11-05', 'nepotvrdena');
    INSERT INTO public.ponude_stavke VALUES
      ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'Krovni radovi'),
      ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'Limarija');
    SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
    SET ROLE authenticated;
  `);
  await assert.rejects(
    db.query("DELETE FROM public.ponude WHERE id = '00000000-0000-0000-0000-000000000020'"),
    (error) => error.code === '42501',
  );
  const { rows: deletion } = await db.query(
    "SELECT public.delete_ponuda_with_history('00000000-0000-0000-0000-000000000010') AS id",
  );
  const id = deletion[0].id;
  await db.exec('RESET ROLE');
  assert.equal((await db.query("SELECT count(*)::int AS count FROM public.ponude_stavke WHERE ponuda_id = '00000000-0000-0000-0000-000000000010'")).rows[0].count, 0);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM private.resource_deletion_rows WHERE deletion_id = $1', [id])).rows[0].count, 3);
  assert.equal((await db.query('SELECT active FROM private.resource_deletions WHERE id = $1', [id])).rows[0].active, false);
  await db.exec('SET ROLE authenticated');
  const history = await db.query('SELECT * FROM public.get_ponuda_deletions()');
  assert.equal(history.rows.length, 1);
  assert.deepEqual(history.rows[0].affected_rows, { ponude: 1, ponude_stavke: 2 });
  await db.exec('RESET ROLE');
});
