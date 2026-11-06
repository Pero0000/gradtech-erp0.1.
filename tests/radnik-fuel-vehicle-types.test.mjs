import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../supabase/migrations/20261110390000_radnik_gorivo_tipovi_vozila.sql', import.meta.url),
  'utf8',
);

test('fuel vehicle type restrictions follow worker categories in mobile options and writes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA private;
      CREATE TABLE public.radnik_kategorije (
        id uuid PRIMARY KEY,
        company_id uuid NOT NULL,
        naziv text NOT NULL
      );
      CREATE TABLE public.vozila_tipovi (
        id uuid PRIMARY KEY,
        company_id uuid NOT NULL,
        naziv text NOT NULL
      );
      CREATE TABLE public.radnici (
        id uuid PRIMARY KEY,
        company_id uuid NOT NULL,
        ime text NOT NULL,
        prezime text NOT NULL,
        uloga text NOT NULL,
        status text NOT NULL
      );
      CREATE TABLE public.vozila (
        id uuid PRIMARY KEY,
        company_id uuid NOT NULL,
        marka text NOT NULL,
        model text,
        registracija text NOT NULL,
        tip text NOT NULL,
        kilometraza numeric NOT NULL
      );
      CREATE TABLE public.vozila_gorivo (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL,
        vozilo_id uuid NOT NULL,
        tocio_radnik_id uuid,
        tocio_ime text
      );
      CREATE FUNCTION public.app_mobile_radnik_id() RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
      CREATE FUNCTION public.app_current_company_id() RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000010'::uuid $$;
      CREATE FUNCTION public.app_has_module_permission(text, text) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT true $$;
      CREATE FUNCTION private.resource_restore_snapshot(text, uuid) RETURNS jsonb
      LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
      CREATE FUNCTION private.validate_vozila_gorivo_company()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER validate_vozila_gorivo_company
        BEFORE INSERT OR UPDATE ON public.vozila_gorivo
        FOR EACH ROW EXECUTE FUNCTION private.validate_vozila_gorivo_company();
      CREATE FUNCTION public.get_vozila_gorivo_workers()
      RETURNS TABLE (id uuid, ime text, prezime text, uloga text)
      LANGUAGE sql AS $$ SELECT NULL::uuid, NULL::text, NULL::text, NULL::text WHERE false $$;
      CREATE FUNCTION public.get_mobile_vozila_gorivo_vehicles()
      RETURNS TABLE (id uuid, marka text, model text, registracija text, tip text, kilometraza integer)
      LANGUAGE sql AS $$ SELECT NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer WHERE false $$;
      INSERT INTO public.radnik_kategorije (id, company_id, naziv)
      VALUES
        ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'Radnik'),
        ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000010', 'Poslovođa');
      INSERT INTO public.vozila_tipovi (id, company_id, naziv)
      VALUES
        ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000010', 'Teretno'),
        ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000010', 'Radno');
      INSERT INTO public.radnici (id, company_id, ime, prezime, uloga, status)
      VALUES
        ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'Ivan', 'Radnik', 'Radnik', 'aktivan'),
        ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010', 'Ana', 'Voditelj', 'Poslovođa', 'aktivan');
      INSERT INTO public.vozila (id, company_id, marka, model, registracija, tip, kilometraza)
      VALUES
        ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000010', 'Teretni', 'Model', 'TEST-1', 'Teretno', 125000),
        ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000010', 'Radno', 'Model', 'TEST-2', 'Radno', 25000);
    `);

    await db.exec(migration);

    const restrictedVehicles = await db.query(
      'SELECT id FROM public.get_mobile_vozila_gorivo_vehicles($1)',
      ['00000000-0000-0000-0000-000000000001'],
    );
    assert.deepEqual(restrictedVehicles.rows.map((row) => row.id), ['00000000-0000-0000-0000-000000000040']);

    const unrestrictedVehicles = await db.query(
      'SELECT id FROM public.get_mobile_vozila_gorivo_vehicles($1)',
      ['00000000-0000-0000-0000-000000000002'],
    );
    assert.deepEqual(unrestrictedVehicles.rows.map((row) => row.id), [
      '00000000-0000-0000-0000-000000000041',
      '00000000-0000-0000-0000-000000000040',
    ]);

    await assert.rejects(
      db.query(
        'INSERT INTO public.vozila_gorivo (company_id, vozilo_id, tocio_radnik_id) VALUES ($1, $2, $3)',
        [
          '00000000-0000-0000-0000-000000000010',
          '00000000-0000-0000-0000-000000000041',
          '00000000-0000-0000-0000-000000000001',
        ],
      ),
      (error) => error.code === '23514',
    );
    await db.query(
      'INSERT INTO public.vozila_gorivo (company_id, vozilo_id, tocio_radnik_id) VALUES ($1, $2, $3)',
      [
        '00000000-0000-0000-0000-000000000010',
        '00000000-0000-0000-0000-000000000040',
        '00000000-0000-0000-0000-000000000001',
      ],
    );

    await db.query(
      'UPDATE public.radnik_kategorije SET dozvoljeni_tipovi_vozila = $1 WHERE naziv = $2',
      [['Radno'], 'Radnik'],
    );
    const updatedVehicles = await db.query(
      'SELECT id FROM public.get_mobile_vozila_gorivo_vehicles($1)',
      ['00000000-0000-0000-0000-000000000001'],
    );
    assert.deepEqual(updatedVehicles.rows.map((row) => row.id), ['00000000-0000-0000-0000-000000000041']);
    await assert.rejects(
      db.query(
        'UPDATE public.radnik_kategorije SET dozvoljeni_tipovi_vozila = $1 WHERE naziv = $2',
        [['Nepoznato'], 'Radnik'],
      ),
      (error) => error.code === '23514',
    );

    await db.exec(readFileSync(
      new URL('../supabase/migrations/20261110400000_vozila_gorivo_pin.sql', import.meta.url),
      'utf8',
    ));
    await db.query('UPDATE public.vozila SET gorivo_pin = $1 WHERE id = $2', [
      '0012', '00000000-0000-0000-0000-000000000041',
    ]);
    const withPin = await db.query(
      'SELECT gorivo_pin FROM public.get_mobile_vozila_gorivo_vehicles($1)',
      ['00000000-0000-0000-0000-000000000001'],
    );
    assert.deepEqual(withPin.rows, [{ gorivo_pin: '0012' }]);
    await assert.rejects(
      db.query('UPDATE public.vozila SET gorivo_pin = $1', ['12a']),
      (error) => error.code === '23514',
    );
    await db.query('UPDATE public.vozila SET gorivo_pin = NULL');
    assert.deepEqual((await db.query(
      'SELECT gorivo_pin FROM public.get_mobile_vozila_gorivo_vehicles($1)',
      ['00000000-0000-0000-0000-000000000001'],
    )).rows, [{ gorivo_pin: null }]);
  } finally {
    await db.close();
  }
});
