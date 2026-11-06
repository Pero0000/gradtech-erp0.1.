import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../supabase/migrations/20261110380000_fix_mobile_fuel_vehicle_mileage_type.sql', import.meta.url),
  'utf8',
);

test('mobile fuel vehicle RPC casts numeric mileage and remains safe to reapply', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE TABLE public.vozila (
        id uuid PRIMARY KEY,
        company_id uuid NOT NULL,
        marka text NOT NULL,
        model text,
        registracija text NOT NULL,
        tip text NOT NULL,
        kilometraza numeric NOT NULL
      );
      CREATE FUNCTION public.app_mobile_radnik_id() RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
      CREATE FUNCTION public.app_current_company_id() RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000002'::uuid $$;
      INSERT INTO public.vozila
      VALUES (
        '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000002',
        'Test', 'Model', 'TEST-1', 'teretno', 125000
      );
    `);

    await db.exec(migration);
    await db.exec(migration);

    const result = await db.query('SELECT * FROM public.get_mobile_vozila_gorivo_vehicles()');
    assert.deepEqual(result.rows, [{
      id: '00000000-0000-0000-0000-000000000003',
      marka: 'Test',
      model: 'Model',
      registracija: 'TEST-1',
      tip: 'teretno',
      kilometraza: 125000,
    }]);
  } finally {
    await db.close();
  }
});
