import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../supabase/migrations/20261110490000_worker_portal_oprema_read.sql', import.meta.url),
  'utf8',
);

test('worker portal can read equipment catalogs without ERP module grants', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE public.app_user_permissions (
      user_id uuid,
      module text,
      can_view boolean,
      can_edit boolean
    );
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
      $$;
    CREATE FUNCTION public.app_is_admin() RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.is_admin', true)::boolean, false) $$;
    CREATE FUNCTION public.app_is_approved() RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.app_is_worker_portal() RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.worker_portal', true)::boolean, false) $$;
    SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000001', false);
    SELECT set_config('app.worker_portal', 'true', false);
  `);
  await db.exec(migration);

  const { rows: workerResults } = await db.query(`
    SELECT
      public.app_has_module_permission('alat', 'view') AS can_view_tools,
      public.app_has_module_permission('strojevi', 'view') AS can_view_machines,
      public.app_has_module_permission('alat', 'edit') AS can_edit_tools,
      public.app_has_module_permission('radnici', 'view') AS can_view_workers
  `);
  assert.deepEqual(workerResults[0], {
    can_view_tools: true,
    can_view_machines: true,
    can_edit_tools: false,
    can_view_workers: false,
  });

  await db.exec(`
    SELECT set_config('app.worker_portal', 'false', false);
    INSERT INTO public.app_user_permissions (user_id, module, can_view, can_edit)
    VALUES ('00000000-0000-0000-0000-000000000001', 'radnici', true, false);
  `);
  const { rows: erpResults } = await db.query(`
    SELECT
      public.app_has_module_permission('radnici', 'view') AS can_view_workers,
      public.app_has_module_permission('alat', 'view') AS can_view_tools
  `);
  assert.deepEqual(erpResults[0], {
    can_view_workers: true,
    can_view_tools: false,
  });
});
