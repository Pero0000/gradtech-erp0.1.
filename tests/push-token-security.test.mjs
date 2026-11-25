import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../supabase/migrations/20261124080000_push_token_registracija.sql', import.meta.url),
  'utf8',
);

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_A1 = '11111111-1111-1111-1111-111111111111';
const USER_A2 = '22222222-2222-2222-2222-222222222222';
const USER_B1 = '33333333-3333-3333-3333-333333333333';
const USER_PENDING = '44444444-4444-4444-4444-444444444444';
const DEVICE_1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DEVICE_2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const DEVICE_B = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('gradtech.user_id', true), '')::uuid $$;

    CREATE TABLE public.app_profiles (
      id uuid PRIMARY KEY,
      approved boolean NOT NULL,
      company_id uuid NOT NULL
    );
    CREATE TABLE public.app_push_tokens (
      user_id uuid NOT NULL,
      token text NOT NULL,
      platform text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      company_id uuid NOT NULL,
      PRIMARY KEY (user_id, token)
    );
    ALTER TABLE public.app_push_tokens ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_push_tokens TO authenticated;
    REVOKE ALL ON public.app_push_tokens FROM anon;
    INSERT INTO public.app_profiles (id, approved, company_id) VALUES
      ('${USER_A1}', true, '${A}'),
      ('${USER_A2}', true, '${A}'),
      ('${USER_B1}', true, '${B}'),
      ('${USER_PENDING}', false, '${A}');

    CREATE FUNCTION public.app_current_company_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
      SELECT company_id FROM public.app_profiles
      WHERE id = auth.uid()
        AND approved = true;
    $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
  `);
  await db.exec(migration);
  await db.exec(`
    CREATE FUNCTION public.test_register_push_token(
      p_user_id uuid,
      p_token text,
      p_installation_proof text
    ) RETURNS void
    LANGUAGE plpgsql
    AS $$
    BEGIN
      PERFORM set_config('gradtech.user_id', p_user_id::text, true);
      PERFORM public.register_app_push_token(p_token, 'android', NULL, p_installation_proof);
    END;
    $$;
  `);
  return db;
}

async function asUser(db, userId, sql, params = []) {
  await db.exec(`SELECT set_config('gradtech.user_id', '${userId}', false)`);
  return db.query(sql, params);
}

test('push token security: cross-company delete cannot remove another registration', async (t) => {
  const db = await setup(t);
  await asUser(db, USER_B1, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['owned-b', DEVICE_B]);
  await asUser(db, USER_A1, `SELECT public.unregister_app_push_token($1, 'android', $2)`, ['owned-b', DEVICE_1]);
  const { rows } = await db.query(`SELECT user_id::text, token FROM public.app_push_tokens`);
  assert.deepEqual(rows, [{ user_id: USER_B1, token: 'owned-b' }]);
});

test('push token security: cross-company token cannot be taken without installation proof', async (t) => {
  const db = await setup(t);
  await asUser(db, USER_B1, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['owned-b', DEVICE_B]);
  await assert.rejects(
    asUser(db, USER_A1, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['owned-b', DEVICE_1]),
    /drugom uređaju ili računu/,
  );
});

test('push token security: another user in the same company cannot delete or take a token', async (t) => {
  const db = await setup(t);
  await asUser(db, USER_A1, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['owned-a', DEVICE_1]);
  await asUser(db, USER_A2, `SELECT public.unregister_app_push_token($1, 'android', $2)`, ['owned-a', DEVICE_1]);
  await assert.rejects(
    asUser(db, USER_A2, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['owned-a', DEVICE_2]),
    /drugom uređaju ili računu/,
  );
  const { rows } = await db.query(`SELECT user_id::text FROM public.app_push_tokens WHERE token = 'owned-a'`);
  assert.equal(rows[0].user_id, USER_A1);
});

test('push token security: owner rotates the token for the same installation', async (t) => {
  const db = await setup(t);
  await asUser(db, USER_A1, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['old', DEVICE_1]);
  await asUser(db, USER_A1, `SELECT public.register_app_push_token($1, 'android', $2, $3)`, ['new', 'old', DEVICE_1]);
  const { rows } = await db.query(`SELECT token FROM public.app_push_tokens WHERE user_id = $1::uuid`, [USER_A1]);
  assert.deepEqual(rows, [{ token: 'new' }]);
});

test('push token security: legacy NULL proof is protected by owner and company', async (t) => {
  const db = await setup(t);
  await db.query(`INSERT INTO public.app_push_tokens (user_id, token, platform, company_id) VALUES ($1::uuid, 'legacy', 'android', $2::uuid)`, [USER_A1, A]);
  await assert.rejects(
    asUser(db, USER_B1, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['legacy', DEVICE_B]),
    /drugom uređaju ili računu/,
  );
  await asUser(db, USER_A1, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['legacy', DEVICE_1]);
  const { rows } = await db.query(`SELECT user_id::text, installation_proof FROM public.app_push_tokens WHERE token = 'legacy'`);
  assert.equal(rows[0].user_id, USER_A1);
  assert.equal(rows[0].installation_proof, DEVICE_1);
});

test('push token security: one user may register multiple devices', async (t) => {
  const db = await setup(t);
  await asUser(db, USER_A1, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['phone-1', DEVICE_1]);
  await asUser(db, USER_A1, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['phone-2', DEVICE_2]);
  const { rows } = await db.query(`SELECT token FROM public.app_push_tokens WHERE user_id = $1::uuid ORDER BY token`, [USER_A1]);
  assert.deepEqual(rows, [{ token: 'phone-1' }, { token: 'phone-2' }]);
});

test('push token security: clean logout removes registration before a new user uses the device', async (t) => {
  const db = await setup(t);
  await asUser(db, USER_A1, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['shared-phone', DEVICE_1]);
  await asUser(db, USER_A1, `SELECT public.unregister_app_push_token($1, 'android', $2)`, ['shared-phone', DEVICE_1]);
  await asUser(db, USER_A2, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['shared-phone', DEVICE_1]);
  const { rows } = await db.query(`SELECT user_id::text FROM public.app_push_tokens WHERE token = 'shared-phone'`);
  assert.equal(rows[0].user_id, USER_A2);
});

test('push token security: failed logout leaves ownership protected until the same installation registers again', async (t) => {
  const db = await setup(t);
  await asUser(db, USER_A1, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['offline-phone', DEVICE_1]);
  await assert.rejects(
    asUser(db, USER_A2, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['offline-phone', DEVICE_2]),
    /drugom uređaju ili računu/,
  );
  await asUser(db, USER_A2, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['offline-phone', DEVICE_1]);
  const { rows } = await db.query(`SELECT user_id::text FROM public.app_push_tokens WHERE token = 'offline-phone'`);
  assert.deepEqual(rows, [{ user_id: USER_A2 }]);
});

test('push token security: unapproved user cannot register', async (t) => {
  const db = await setup(t);
  await assert.rejects(
    asUser(db, USER_PENDING, `SELECT public.register_app_push_token($1, 'android', NULL, $2)`, ['pending', DEVICE_1]),
    /nije ovlašten/,
  );
});

test('push token security: anonymous role has no RPC EXECUTE permission', async (t) => {
  const db = await setup(t);
  const privilege = await db.query(`SELECT has_function_privilege('anon', 'public.register_app_push_token(text,text,text,text)', 'EXECUTE') AS allowed`);
  assert.equal(privilege.rows[0].allowed, false);
  await db.exec(`SET ROLE anon`);
  await assert.rejects(
    db.query(`SELECT public.register_app_push_token('anonymous', 'android', NULL, $1)`, [DEVICE_1]),
    /permission denied/,
  );
});

test('push token security: concurrent registration with different installations yields one protected owner', async (t) => {
  const db = await setup(t);
  const attempts = await Promise.allSettled([
    db.query(`SELECT public.test_register_push_token($1::uuid, $2, $3)`, [USER_A1, 'race', DEVICE_1]),
    db.query(`SELECT public.test_register_push_token($1::uuid, $2, $3)`, [USER_A2, 'race', DEVICE_2]),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 1);
  const { rows } = await db.query(`SELECT count(*)::int AS count FROM public.app_push_tokens WHERE token = 'race'`);
  assert.equal(rows[0].count, 1);
});

test('push token security: concurrent rotation of one installation leaves one token', async (t) => {
  const db = await setup(t);
  await asUser(db, USER_A1, `SELECT public.register_app_push_token('base', 'android', NULL, $1)`, [DEVICE_1]);
  const attempts = await Promise.allSettled([
    asUser(db, USER_A1, `SELECT public.register_app_push_token('rotate-a', 'android', 'base', $1)`, [DEVICE_1]),
    asUser(db, USER_A1, `SELECT public.register_app_push_token('rotate-b', 'android', 'base', $1)`, [DEVICE_1]),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 1);
  const { rows } = await db.query(`SELECT count(*)::int AS count, min(token) AS token FROM public.app_push_tokens WHERE installation_proof = $1`, [DEVICE_1]);
  assert.equal(rows[0].count, 1);
  assert.match(rows[0].token, /^rotate-(a|b)$/);
});

test('push migration duplicate-token preflight fails without deleting production rows', async (t) => {
  const db = await setup(t);
  await db.exec(`DROP INDEX app_push_tokens_token_unique`);
  await db.query(`INSERT INTO public.app_push_tokens (user_id, token, platform, company_id) VALUES ($1::uuid, 'duplicate', 'android', $2::uuid)`, [USER_A1, A]);
  await db.query(`INSERT INTO public.app_push_tokens (user_id, token, platform, company_id) VALUES ($1::uuid, 'duplicate', 'android', $2::uuid)`, [USER_A2, A]);
  await assert.rejects(db.exec(migration), /duplicate tokens/);
  await db.exec('ROLLBACK');
  const { rows } = await db.query(`SELECT count(*)::int AS count FROM public.app_push_tokens WHERE token = 'duplicate'`);
  assert.equal(rows[0].count, 2, 'preflight does not reconcile or delete ambiguous production rows');
});

test('push token security: authenticated roles cannot read or mutate the token table directly', async (t) => {
  const db = await setup(t);
  const privileges = await db.query(`
    SELECT
      has_table_privilege('authenticated', 'public.app_push_tokens', 'SELECT') AS can_select,
      has_table_privilege('authenticated', 'public.app_push_tokens', 'INSERT') AS can_insert,
      has_table_privilege('authenticated', 'public.app_push_tokens', 'UPDATE') AS can_update,
      has_table_privilege('authenticated', 'public.app_push_tokens', 'DELETE') AS can_delete
  `);
  assert.deepEqual(privileges.rows[0], {
    can_select: false,
    can_insert: false,
    can_update: false,
    can_delete: false,
  });
  await db.exec(`SET ROLE authenticated`);
  await assert.rejects(db.query(`SELECT * FROM public.app_push_tokens`), /permission denied/);
  await assert.rejects(db.query(`INSERT INTO public.app_push_tokens (user_id, token, platform, company_id) VALUES ($1::uuid, 'direct', 'android', $2::uuid)`, [USER_A1, A]), /permission denied/);
});

test('push migration has fixed search paths and no anon/public execute grants', async (t) => {
  const db = await setup(t);
  const { rows } = await db.query(`
    SELECT proname, prosecdef, proconfig,
      has_function_privilege('authenticated', oid, 'EXECUTE') AS authenticated_execute,
      has_function_privilege('anon', oid, 'EXECUTE') AS anon_execute,
      has_function_privilege('public', oid, 'EXECUTE') AS public_execute
    FROM pg_proc
    WHERE oid IN (
      'public.register_app_push_token(text,text,text,text)'::regprocedure,
      'public.unregister_app_push_token(text,text,text)'::regprocedure
    )
    ORDER BY proname
  `);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.prosecdef, true);
    assert.deepEqual(row.proconfig, ['search_path=public, pg_temp']);
    assert.equal(row.authenticated_execute, true);
    assert.equal(row.anon_execute, false);
    assert.equal(row.public_execute, false);
  }
});

test('push migration drops legacy RPC signatures and keeps only protected signatures', async (t) => {
  const db = await setup(t);
  for (const signature of [
    'public.register_app_push_token(text,text)',
    'public.register_app_push_token(text,text,text)',
    'public.unregister_app_push_token(text)',
  ]) {
    const { rows } = await db.query(`SELECT to_regprocedure($1) IS NULL AS absent`, [signature]);
    assert.equal(rows[0].absent, true);
  }
});

test('push recipient query excludes unapproved users and scopes recipients to the company', () => {
  const source = readFileSync(new URL('../supabase/functions/notify-work-order/index.ts', import.meta.url), 'utf8');
  assert.match(source, /\.eq\('approved', true\)/);
  assert.match(source, /\.eq\('company_id', profile\.company_id\)/);
  assert.match(source, /\.eq\('company_id', profile\.company_id\)[\s\S]*\.in\('user_id', userIds\)/);
});
