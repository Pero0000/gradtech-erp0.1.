import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../supabase/migrations/20261110560000_odvezivanje_otkazanog_naloga_iz_rasporeda.sql', import.meta.url),
  'utf8',
);

test('cancelling an order detaches its schedule assignment but preserves the cancelled order', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA private;
    CREATE TABLE public.radni_nalozi (id uuid PRIMARY KEY, status text NOT NULL);
    CREATE TABLE public.dnevni_raspored_gradilista (
      id uuid PRIMARY KEY,
      nalog_id uuid REFERENCES public.radni_nalozi(id)
    );
    INSERT INTO public.radni_nalozi (id, status)
    VALUES ('00000000-0000-0000-0000-000000000001', 'otvoren');
    INSERT INTO public.dnevni_raspored_gradilista (id, nalog_id)
    VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');
  `);
  await db.exec(migration);

  await db.exec(`
    UPDATE public.radni_nalozi
    SET status = 'u_tijeku'
    WHERE id = '00000000-0000-0000-0000-000000000001';
  `);
  let result = await db.query(`
    SELECT nalog_id FROM public.dnevni_raspored_gradilista
    WHERE id = '00000000-0000-0000-0000-000000000002';
  `);
  assert.equal(result.rows[0].nalog_id, '00000000-0000-0000-0000-000000000001');

  await db.exec(`
    UPDATE public.radni_nalozi
    SET status = 'otkazan'
    WHERE id = '00000000-0000-0000-0000-000000000001';
  `);
  result = await db.query(`
    SELECT nalog_id FROM public.dnevni_raspored_gradilista
    WHERE id = '00000000-0000-0000-0000-000000000002';
  `);
  assert.equal(result.rows[0].nalog_id, null);

  result = await db.query(`
    SELECT status FROM public.radni_nalozi
    WHERE id = '00000000-0000-0000-0000-000000000001';
  `);
  assert.equal(result.rows[0].status, 'otkazan');
});
