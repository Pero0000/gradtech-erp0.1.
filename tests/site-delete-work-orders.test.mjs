import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../supabase/migrations/20261110590000_gradiliste_brisi_s_radnim_nalozima.sql', import.meta.url),
  'utf8',
);

test('deleting a site cascades to its work orders so protected deletion can complete', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE public.gradilista (id uuid PRIMARY KEY);
    CREATE TABLE public.radni_nalozi (
      id uuid PRIMARY KEY,
      gradiliste_id uuid,
      broj text NOT NULL,
      CONSTRAINT radni_nalozi_gradiliste_id_fkey
        FOREIGN KEY (gradiliste_id) REFERENCES public.gradilista(id) ON DELETE RESTRICT
    );
    INSERT INTO public.gradilista VALUES ('00000000-0000-0000-0000-000000000001');
    INSERT INTO public.radni_nalozi
    VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'RN-1');
  `);
  await db.exec(migration);

  await db.exec(`DELETE FROM public.gradilista WHERE id = '00000000-0000-0000-0000-000000000001'`);
  const { rows } = await db.query('SELECT count(*)::integer AS count FROM public.radni_nalozi');
  assert.equal(rows[0].count, 0);
});
