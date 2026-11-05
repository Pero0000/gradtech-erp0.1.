import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const serviceSource = readFileSync(new URL('../src/lib/ponude.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL(
  '../supabase/migrations/20261110250000_ponude_povijest_izmjena.sql',
  import.meta.url,
), 'utf8');

const companyId = '00000000-0000-0000-0000-000000000001';
const userId = '00000000-0000-0000-0000-000000000002';
const investorId = '00000000-0000-0000-0000-000000000003';
const objectId = '00000000-0000-0000-0000-000000000004';
const catalogItemId = '00000000-0000-0000-0000-000000000005';

const data = (naslov) => ({
  naslov, investitor_id: investorId, objekt_id: objectId, adresa_radova: 'Ozalj',
  datum: '2026-11-05', status: 'nepotvrdena', popust: 5, pdv: 25,
  prikazi_popust: true, prijenos_porezne_obveze: false, napomene: 'Izvorna napomena',
});

const lines = (opis, cijena = 20) => [{
  stavka_id: catalogItemId, redoslijed: 0, opis, vrsta_posla: 'Fasada',
  podgrupa: 'Silikat', jedinica: 'm2', kolicina: 10, cijena, popust: 2,
}];

function loadOfferService(rpc) {
  const { outputText } = ts.transpileModule(serviceSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require: (name) => {
      assert.equal(name, './supabase');
      return { supabase: { rpc } };
    },
  });
  return module.exports;
}

test('offer service uses history-backed save and restore RPCs and reports missing migration', async () => {
  const calls = [];
  const service = loadOfferService(async (...args) => {
    calls.push(args);
    return { data: { id: 'offer-id' }, error: null };
  });
  await service.createPonuda(data('Ponuda'), lines('Radovi'));
  await service.savePonudaWithHistory('offer-id', { status: 'potvrdena' }, lines('Ažurirano'));
  await service.fetchPonudaChangeHistory('offer-id', '99');
  await service.restorePonudaChange('history-id');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['create_ponuda_with_stavke', { p_data: data('Ponuda'), p_lines: lines('Radovi') }],
    ['save_ponuda_with_history', { p_record_id: 'offer-id', p_data: { status: 'potvrdena' }, p_lines: lines('Ažurirano') }],
    ['get_ponuda_change_history', { p_record_id: 'offer-id', p_before_sequence: '99' }],
    ['restore_ponuda_change', { p_history_id: 'history-id' }],
  ]);
  const missing = loadOfferService(async () => ({ error: { code: 'PGRST202' } }));
  await assert.rejects(missing.fetchPonudaChangeHistory('offer-id'), /20261110250000/);
});

test('offer changes atomically snapshot the header and lines and restore exact values', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE SCHEMA private;
    CREATE SCHEMA cron;
    CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    CREATE TABLE public.tvrtke (id uuid PRIMARY KEY, aktivna boolean NOT NULL);
    CREATE TABLE public.app_profiles (id uuid PRIMARY KEY, email text, company_id uuid, approved boolean);
    CREATE TABLE public.app_user_permissions (user_id uuid, module text, can_edit boolean);
    CREATE FUNCTION public.app_current_company_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT profile.company_id FROM public.app_profiles profile
        JOIN public.tvrtke company ON company.id = profile.company_id
        WHERE profile.id = auth.uid() AND profile.approved AND company.aktivna;
      $$;
    CREATE FUNCTION public.app_has_module_permission(p_module text, p_action text) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.app_profiles profile
          JOIN public.app_user_permissions permission ON permission.user_id = profile.id
          WHERE profile.id = auth.uid() AND profile.approved
            AND profile.company_id = public.app_current_company_id()
            AND permission.module = p_module AND permission.can_edit
        );
      $$;
    CREATE TABLE public.investitori (id uuid PRIMARY KEY, company_id uuid NOT NULL);
    CREATE TABLE public.objekti (id uuid PRIMARY KEY, company_id uuid NOT NULL);
    CREATE TABLE public.stavke (id uuid PRIMARY KEY, company_id uuid NOT NULL);
    CREATE TABLE public.gradilista (id uuid PRIMARY KEY, company_id uuid NOT NULL);
    CREATE TABLE public.ponude (
      id uuid PRIMARY KEY, company_id uuid NOT NULL, godina integer NOT NULL, redni_broj integer NOT NULL,
      naslov text NOT NULL, investitor_id uuid, objekt_id uuid, adresa_radova text, datum date NOT NULL,
      status text NOT NULL, popust numeric NOT NULL, pdv numeric NOT NULL, napomene text,
      gradiliste_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), prikazi_popust boolean NOT NULL DEFAULT true,
      prijenos_porezne_obveze boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.ponude_stavke (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, ponuda_id uuid NOT NULL,
      stavka_id uuid, redoslijed integer NOT NULL, opis text NOT NULL, vrsta_posla text, podgrupa text,
      jedinica text NOT NULL, kolicina numeric NOT NULL, cijena numeric NOT NULL, popust numeric NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE private.resource_deletions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, table_name text NOT NULL,
      record_id uuid NOT NULL, transaction_id bigint NOT NULL DEFAULT txid_current(),
      active boolean NOT NULL DEFAULT true, restoring boolean NOT NULL DEFAULT false
    );
    CREATE SEQUENCE private.company_offer_number;
    CREATE FUNCTION public.next_company_number(p_kind text, p_year integer) RETURNS integer
      LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT nextval('private.company_offer_number')::integer;
      $$;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ponude, public.ponude_stavke TO authenticated;
    INSERT INTO public.tvrtke VALUES ('${companyId}', true);
    INSERT INTO public.app_profiles VALUES ('${userId}', 'editor@example.test', '${companyId}', true);
    INSERT INTO public.app_user_permissions VALUES ('${userId}', 'ponude', true);
    INSERT INTO public.investitori VALUES ('${investorId}', '${companyId}');
    INSERT INTO public.objekti VALUES ('${objectId}', '${companyId}');
    INSERT INTO public.stavke VALUES ('${catalogItemId}', '${companyId}');
    SELECT set_config('request.jwt.claim.sub', '${userId}', false);
  `);
  await db.exec(migration);
  await db.exec('SET ROLE authenticated');
  const created = await db.query(
    'SELECT public.create_ponuda_with_stavke($1,$2) offer',
    [JSON.stringify(data('Početna ponuda')), JSON.stringify(lines('Početni radovi'))],
  );
  const offer = created.rows[0].offer;
  assert.equal(offer.naslov, 'Početna ponuda');
  const originalLines = (await db.query('SELECT * FROM public.ponude_stavke WHERE ponuda_id=$1', [offer.id])).rows;
  assert.equal(originalLines.length, 1);
  await db.query('SELECT public.save_ponuda_with_history($1,$2,$3)', [
    offer.id, JSON.stringify({ naslov: 'Izmijenjena ponuda', status: 'potvrdena' }),
    JSON.stringify(lines('Izmijenjeni radovi', 40)),
  ]);
  const history = await db.query('SELECT * FROM public.get_ponuda_change_history($1)', [offer.id]);
  assert.equal(history.rows.length, 1);
  assert.equal(history.rows[0].can_restore, true);
  assert.equal(history.rows[0].before_ponuda.naslov, 'Početna ponuda');
  assert.equal(history.rows[0].after_ponuda.naslov, 'Izmijenjena ponuda');
  assert.equal(history.rows[0].before_stavke[0].opis, 'Početni radovi');
  assert.equal(history.rows[0].after_stavke[0].opis, 'Izmijenjeni radovi');

  await db.query('SELECT public.restore_ponuda_change($1)', [history.rows[0].id]);
  const restored = (await db.query('SELECT * FROM public.ponude WHERE id=$1', [offer.id])).rows[0];
  assert.equal(restored.naslov, 'Početna ponuda');
  assert.equal(restored.status, 'nepotvrdena');
  const restoredLines = (await db.query('SELECT * FROM public.ponude_stavke WHERE ponuda_id=$1', [offer.id])).rows;
  assert.deepEqual(restoredLines, originalLines);
  assert.ok((await db.query('SELECT reversed_at FROM public.get_ponuda_change_history($1) WHERE id=$2', [offer.id, history.rows[0].id])).rows[0].reversed_at);

  await assert.rejects(
    db.query("UPDATE public.ponude SET naslov='Untracked' WHERE id=$1", [offer.id]),
    (error) => error.code === '42501',
  );
  await assert.rejects(
    db.query('DELETE FROM public.ponude_stavke WHERE ponuda_id=$1', [offer.id]),
    (error) => error.code === '42501',
  );
  await db.exec('RESET ROLE');
});

test('offer history blocks stale restores and enforces tenant-scoped permissions', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE SCHEMA private;
    CREATE SCHEMA cron;
    CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    CREATE TABLE public.tvrtke (id uuid PRIMARY KEY, aktivna boolean NOT NULL);
    CREATE TABLE public.app_profiles (id uuid PRIMARY KEY, email text, company_id uuid, approved boolean);
    CREATE TABLE public.app_user_permissions (user_id uuid, module text, can_edit boolean);
    CREATE FUNCTION public.app_current_company_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT profile.company_id FROM public.app_profiles profile
        JOIN public.tvrtke company ON company.id = profile.company_id
        WHERE profile.id = auth.uid() AND profile.approved AND company.aktivna;
      $$;
    CREATE FUNCTION public.app_has_module_permission(p_module text, p_action text) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.app_profiles profile
          JOIN public.app_user_permissions permission ON permission.user_id = profile.id
          WHERE profile.id = auth.uid() AND profile.approved
            AND profile.company_id = public.app_current_company_id()
            AND permission.module = p_module AND permission.can_edit
        );
      $$;
    CREATE TABLE public.investitori (id uuid PRIMARY KEY, company_id uuid NOT NULL);
    CREATE TABLE public.objekti (id uuid PRIMARY KEY, company_id uuid NOT NULL);
    CREATE TABLE public.stavke (id uuid PRIMARY KEY, company_id uuid NOT NULL);
    CREATE TABLE public.gradilista (id uuid PRIMARY KEY, company_id uuid NOT NULL);
    CREATE TABLE public.ponude (
      id uuid PRIMARY KEY, company_id uuid NOT NULL, godina integer NOT NULL, redni_broj integer NOT NULL,
      naslov text NOT NULL, investitor_id uuid, objekt_id uuid, adresa_radova text, datum date NOT NULL,
      status text NOT NULL, popust numeric NOT NULL, pdv numeric NOT NULL, napomene text,
      gradiliste_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), prikazi_popust boolean NOT NULL DEFAULT true,
      prijenos_porezne_obveze boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.ponude_stavke (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, ponuda_id uuid NOT NULL,
      stavka_id uuid, redoslijed integer NOT NULL, opis text NOT NULL, vrsta_posla text, podgrupa text,
      jedinica text NOT NULL, kolicina numeric NOT NULL, cijena numeric NOT NULL, popust numeric NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE private.resource_deletions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, table_name text NOT NULL,
      record_id uuid NOT NULL, transaction_id bigint NOT NULL DEFAULT txid_current(),
      active boolean NOT NULL DEFAULT true, restoring boolean NOT NULL DEFAULT false
    );
    CREATE SEQUENCE private.company_offer_number;
    CREATE FUNCTION public.next_company_number(p_kind text, p_year integer) RETURNS integer
      LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT nextval('private.company_offer_number')::integer;
      $$;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ponude, public.ponude_stavke TO authenticated;
    INSERT INTO public.tvrtke VALUES ('${companyId}', true);
    INSERT INTO public.app_profiles VALUES ('${userId}', 'editor@example.test', '${companyId}', true);
    INSERT INTO public.app_user_permissions VALUES ('${userId}', 'ponude', true);
    INSERT INTO public.investitori VALUES ('${investorId}', '${companyId}');
    INSERT INTO public.objekti VALUES ('${objectId}', '${companyId}');
    INSERT INTO public.stavke VALUES ('${catalogItemId}', '${companyId}');
    SELECT set_config('request.jwt.claim.sub', '${userId}', false);
  `);
  await db.exec(migration);
  await db.exec('SET ROLE authenticated');
  const created = await db.query(
    'SELECT public.create_ponuda_with_stavke($1,$2) offer',
    [JSON.stringify(data('Ponuda')), JSON.stringify([])],
  );
  const offerId = created.rows[0].offer.id;
  const first = await db.query(
    'SELECT public.save_ponuda_with_history($1,$2,$3)',
    [offerId, JSON.stringify({ naslov: 'Prva izmjena' }), JSON.stringify(lines('Radovi A'))],
  );
  const firstHistoryId = (await db.query('SELECT id FROM public.get_ponuda_change_history($1)', [offerId])).rows[0].id;
  await db.query('SELECT public.save_ponuda_with_history($1,$2,$3)', [
    offerId, JSON.stringify({ naslov: 'Druga izmjena' }), JSON.stringify(lines('Radovi B')),
  ]);
  assert.equal((await db.query('SELECT can_restore FROM public.get_ponuda_change_history($1) WHERE id=$2', [
    offerId, firstHistoryId,
  ])).rows[0].can_restore, false);
  await assert.rejects(
    db.query('SELECT public.restore_ponuda_change($1)', [firstHistoryId]),
    (error) => error.code === '40001',
  );
  await db.exec("SELECT set_config('request.jwt.claim.sub', '', false)");
  await assert.rejects(
    db.query('SELECT * FROM public.get_ponuda_change_history($1)', [offerId]),
    (error) => error.code === '42501',
  );
  await db.exec('RESET ROLE');
});
