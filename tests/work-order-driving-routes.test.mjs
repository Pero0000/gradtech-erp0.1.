import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../supabase/migrations/20261110500000_radni_nalozi_vise_vozaca_relacije.sql', import.meta.url),
  'utf8',
);
const recoveryMigration = readFileSync(
  new URL('../supabase/migrations/20261110520000_radni_nalozi_voznje_povrat_brisanja.sql', import.meta.url),
  'utf8',
);

test('work-order driving routes are ordered, appendable, removable, and limited to assigned workers', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE TABLE public.tvrtke (id uuid PRIMARY KEY);
    INSERT INTO public.tvrtke VALUES ('00000000-0000-0000-0000-000000000001');
    CREATE FUNCTION public.app_current_company_id() RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
    CREATE TABLE public.radnici (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.tvrtke(id));
    CREATE TABLE public.radni_nalozi (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.tvrtke(id));
    CREATE TABLE public.radni_nalozi_radnici (
      nalog_id uuid NOT NULL REFERENCES public.radni_nalozi(id),
      radnik_id uuid NOT NULL REFERENCES public.radnici(id),
      company_id uuid NOT NULL REFERENCES public.tvrtke(id)
    );
    CREATE FUNCTION public.app_mobile_assigned_nalog(p_nalog_id uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.radni_nalozi_radnici
          WHERE nalog_id = p_nalog_id AND radnik_id = '00000000-0000-0000-0000-000000000002'
        )
      $$;
    CREATE FUNCTION public.app_mobile_editable_nalog(p_nalog_id uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT public.app_mobile_assigned_nalog(p_nalog_id) $$;
    INSERT INTO public.radnici (id, company_id) VALUES
      ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001');
    INSERT INTO public.radni_nalozi (id, company_id)
      VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001');
    INSERT INTO public.radni_nalozi_radnici (nalog_id, radnik_id, company_id) VALUES
      ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001');
  `);
  await db.exec(migration);

  const orderId = '00000000-0000-0000-0000-000000000004';
  const driverA = '00000000-0000-0000-0000-000000000002';
  const driverB = '00000000-0000-0000-0000-000000000003';
  const routes = [
    { id: '00000000-0000-0000-0000-000000000005', radnik_id: driverA, polaziste: 'Zadar', odrediste: 'Split' },
    { id: '00000000-0000-0000-0000-000000000006', radnik_id: driverB, polaziste: 'Split', odrediste: 'Intervencija Split' },
    { id: '00000000-0000-0000-0000-000000000007', radnik_id: driverB, polaziste: 'Split', odrediste: 'Zadar' },
  ];
  for (const route of routes) {
    await db.query(
      'SELECT public.mobile_add_nalog_voznja($1, $2, $3, $4, $5)',
      [orderId, route.id, route.radnik_id, route.polaziste, route.odrediste],
    );
  }
  const { rows } = await db.query(
    'SELECT radnik_id, polaziste, odrediste, redoslijed FROM public.get_mobile_nalog_voznje($1)',
    [orderId],
  );
  assert.deepEqual(rows.map(({ radnik_id, polaziste, odrediste, redoslijed }) => ({
    radnik_id, polaziste, odrediste, redoslijed,
  })), routes.map((route, redoslijed) => ({
    radnik_id: route.radnik_id,
    polaziste: route.polaziste,
    odrediste: route.odrediste,
    redoslijed,
  })));

  await assert.rejects(
    db.query(
      'SELECT public.mobile_add_nalog_voznja($1, $2, $3, $4, $5)',
      [orderId, '00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000008', 'Split', 'Zadar'],
    ),
    /Vozač relacije mora biti djelatnik dodijeljen ovom nalogu/,
  );

  await db.query(
    'SELECT public.mobile_delete_nalog_voznja($1, $2)',
    [orderId, routes[1].id],
  );
  const { rows: replaced } = await db.query(
    'SELECT polaziste, odrediste, redoslijed FROM public.get_mobile_nalog_voznje($1)',
    [orderId],
  );
  assert.deepEqual(replaced, [
    { polaziste: 'Zadar', odrediste: 'Split', redoslijed: 0 },
    { polaziste: 'Split', odrediste: 'Zadar', redoslijed: 2 },
  ]);
  await db.query(
    'SELECT public.mobile_add_nalog_voznja($1, $2, $3, $4, $5)',
    [orderId, '00000000-0000-0000-0000-000000000009', driverA, 'Zadar', 'Karlovac'],
  );
  const { rows: appended } = await db.query(
    'SELECT polaziste, odrediste, redoslijed FROM public.get_mobile_nalog_voznje($1)',
    [orderId],
  );
  assert.deepEqual(appended.at(-1), { polaziste: 'Zadar', odrediste: 'Karlovac', redoslijed: 3 });
});

test('work-order driving routes are tracked by resource deletion recovery', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE SCHEMA private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE TABLE public.tvrtke (id uuid PRIMARY KEY);
    INSERT INTO public.tvrtke VALUES ('00000000-0000-0000-0000-000000000001');
    CREATE FUNCTION public.app_current_company_id() RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
    CREATE TABLE public.radnici (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.tvrtke(id));
    CREATE TABLE public.radni_nalozi (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.tvrtke(id));
    CREATE TABLE public.radni_nalozi_radnici (
      nalog_id uuid NOT NULL REFERENCES public.radni_nalozi(id) ON DELETE CASCADE,
      radnik_id uuid NOT NULL REFERENCES public.radnici(id),
      company_id uuid NOT NULL REFERENCES public.tvrtke(id)
    );
    CREATE FUNCTION public.app_mobile_assigned_nalog(p_nalog_id uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.app_mobile_editable_nalog(p_nalog_id uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE TABLE private.resource_recovery_tables (table_name text PRIMARY KEY, key_columns text[] NOT NULL);
    CREATE TABLE private.captured_route_deletions (row_data jsonb NOT NULL);
    CREATE FUNCTION private.capture_resource_recovery_row() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          INSERT INTO private.captured_route_deletions VALUES (to_jsonb(OLD));
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$;
    INSERT INTO public.radnici VALUES
      ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');
    INSERT INTO public.radni_nalozi VALUES
      ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001');
    INSERT INTO public.radni_nalozi_radnici VALUES
      ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');
  `);
  await db.exec(migration);
  await db.exec(recoveryMigration);
  await db.query(
    `SELECT public.mobile_add_nalog_voznja($1, $2, $3, $4, $5)`,
    [
      '00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000002',
      'Karlovac',
      'Dubrovnik',
    ],
  );

  await db.query('DELETE FROM public.radni_nalozi WHERE id = $1', ['00000000-0000-0000-0000-000000000004']);
  const { rows } = await db.query('SELECT row_data FROM private.captured_route_deletions');
  assert.deepEqual(rows, [{
    row_data: {
      id: '00000000-0000-0000-0000-000000000005',
      company_id: '00000000-0000-0000-0000-000000000001',
      nalog_id: '00000000-0000-0000-0000-000000000004',
      radnik_id: '00000000-0000-0000-0000-000000000002',
      polaziste: 'Karlovac',
      odrediste: 'Dubrovnik',
      redoslijed: 0,
      created_at: rows[0].row_data.created_at,
    },
  }]);

  const { rows: recoveryRows } = await db.query(
    "SELECT key_columns FROM private.resource_recovery_tables WHERE table_name = 'radni_nalozi_voznje'",
  );
  assert.deepEqual(recoveryRows, [{ key_columns: ['id'] }]);
});
