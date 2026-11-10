import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../supabase/migrations/20261110570000_gradiliste_brisi_s_osobnim_voznjama.sql', import.meta.url),
  'utf8',
);
const allocationRecoveryMigration = readFileSync(
  new URL('../supabase/migrations/20261110580000_kilometarski_udjeli_povrat_brisanja.sql', import.meta.url),
  'utf8',
);

test('deleting a site preserves personal-car trip snapshots and detaches site and cost references', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE SCHEMA private;
    CREATE TABLE private.resource_recovery_tables (
      table_name text PRIMARY KEY,
      key_columns text[] NOT NULL
    );
    CREATE TABLE private.recovery_capture_log (
      table_name text,
      operation text,
      old_row jsonb,
      new_row jsonb
    );
    CREATE FUNCTION private.capture_resource_recovery_row()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO private.recovery_capture_log
      VALUES (TG_TABLE_NAME, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
      RETURN COALESCE(NEW, OLD);
    END;
    $$;
    CREATE TABLE public.gradilista (id uuid PRIMARY KEY);
    CREATE TABLE public.tvrtke (id uuid PRIMARY KEY);
    CREATE TABLE public.vozila (id uuid PRIMARY KEY);
    CREATE TABLE public.troskovi (
      id uuid PRIMARY KEY,
      gradiliste_id uuid NOT NULL REFERENCES public.gradilista(id) ON DELETE CASCADE
    );
    CREATE TABLE public.osobni_auto_voznje (
      id uuid PRIMARY KEY,
      gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE RESTRICT,
      gradiliste_naziv text,
      cijena_km numeric NOT NULL,
      iznos numeric(12,2) NOT NULL,
      trosak_id uuid UNIQUE REFERENCES public.troskovi(id) ON DELETE RESTRICT,
      CHECK (
        (gradiliste_id IS NULL AND gradiliste_naziv IS NULL AND trosak_id IS NULL AND iznos = 0)
        OR (gradiliste_id IS NOT NULL AND gradiliste_naziv IS NOT NULL AND trosak_id IS NOT NULL AND cijena_km > 0)
      )
    );
    CREATE TABLE public.dnevni_kilometarski_udjeli (
      company_id uuid NOT NULL REFERENCES public.tvrtke(id) ON DELETE CASCADE,
      datum date NOT NULL,
      vozilo_id uuid NOT NULL REFERENCES public.vozila(id) ON DELETE CASCADE,
      gradiliste_id uuid NOT NULL REFERENCES public.gradilista(id) ON DELETE CASCADE,
      postotak numeric(5, 2) NOT NULL,
      PRIMARY KEY (company_id, datum, vozilo_id, gradiliste_id)
    );
    INSERT INTO public.gradilista VALUES ('00000000-0000-0000-0000-000000000001');
    INSERT INTO public.tvrtke VALUES ('00000000-0000-0000-0000-000000000004');
    INSERT INTO public.vozila VALUES ('00000000-0000-0000-0000-000000000005');
    INSERT INTO public.dnevni_kilometarski_udjeli
    VALUES (
      '00000000-0000-0000-0000-000000000004',
      '2026-11-10',
      '00000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000001',
      100
    );
    INSERT INTO public.troskovi VALUES (
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001'
    );
    INSERT INTO public.osobni_auto_voznje
    VALUES (
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000001',
      'Gradilište povijesno',
      0.5,
      12.50,
      '00000000-0000-0000-0000-000000000002'
    );
  `);
  await db.exec(migration);
  await db.exec(allocationRecoveryMigration);

  await db.exec(`DELETE FROM public.gradilista WHERE id = '00000000-0000-0000-0000-000000000001'`);
  const { rows } = await db.query(`
    SELECT gradiliste_id, gradiliste_naziv, cijena_km, iznos, trosak_id
    FROM public.osobni_auto_voznje
    WHERE id = '00000000-0000-0000-0000-000000000003';
  `);
  assert.equal(rows[0].gradiliste_id, null);
  assert.equal(rows[0].gradiliste_naziv, 'Gradilište povijesno');
  assert.equal(Number(rows[0].cijena_km), 0.5);
  assert.equal(Number(rows[0].iznos), 12.5);
  assert.equal(rows[0].trosak_id, null);

  const recovery = await db.query(`
    SELECT table_name, key_columns
    FROM private.resource_recovery_tables
    WHERE table_name = 'osobni_auto_voznje';
  `);
  assert.equal(recovery.rows[0].key_columns[0], 'id');
  const captured = await db.query(`
    SELECT count(*)::integer AS updates
    FROM private.recovery_capture_log
    WHERE table_name = 'osobni_auto_voznje' AND operation = 'UPDATE';
  `);
  assert.equal(captured.rows[0].updates, 2);

  const allocation = await db.query(`
    SELECT count(*)::integer AS count
    FROM public.dnevni_kilometarski_udjeli;
  `);
  assert.equal(allocation.rows[0].count, 0);

  const allocationRecovery = await db.query(`
    SELECT key_columns
    FROM private.resource_recovery_tables
    WHERE table_name = 'dnevni_kilometarski_udjeli';
  `);
  assert.deepEqual(allocationRecovery.rows[0].key_columns, ['company_id', 'datum', 'vozilo_id', 'gradiliste_id']);

  const allocationCaptured = await db.query(`
    SELECT count(*)::integer AS deletes
    FROM private.recovery_capture_log
    WHERE table_name = 'dnevni_kilometarski_udjeli' AND operation = 'DELETE';
  `);
  assert.equal(allocationCaptured.rows[0].deletes, 1);
});
