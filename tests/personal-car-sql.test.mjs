import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261111100000_osobni_auto_radno_vrijeme.sql', import.meta.url), 'utf8');

test('personal-car work-time constraints allow business shifts and reject missing or invalid work-time data', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE public.osobni_auto_voznje (id uuid PRIMARY KEY, gradiliste_id uuid);
      CREATE TABLE public.radno_vrijeme (id uuid PRIMARY KEY);
    `);
    await db.exec(migration.slice(0, migration.indexOf('DROP FUNCTION')));
    await db.exec(`
      INSERT INTO public.osobni_auto_voznje(id) VALUES ('00000000-0000-0000-0000-000000000001');
      INSERT INTO public.osobni_auto_voznje(id, gradiliste_id, radno_vrijeme_od, radno_vrijeme_do, radno_vrijeme_nocni_sati)
        VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010', '08:00', '16:00', 0);
      INSERT INTO public.osobni_auto_voznje(id, gradiliste_id, radno_vrijeme_od, radno_vrijeme_do, radno_vrijeme_nocni_sati)
        VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000010', '22:00', '06:00', 8);
      INSERT INTO public.radno_vrijeme(id, osobni_auto_voznja_id)
        VALUES ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000002');
    `);

    await assert.rejects(db.exec(`
      INSERT INTO public.osobni_auto_voznje(id, gradiliste_id)
        VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000010');
    `));
    await assert.rejects(db.exec(`
      INSERT INTO public.osobni_auto_voznje(id, gradiliste_id, radno_vrijeme_od, radno_vrijeme_do, radno_vrijeme_nocni_sati)
        VALUES ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000010', '08:00', '08:00', 0);
    `));
    await assert.rejects(db.exec(`
      INSERT INTO public.osobni_auto_voznje(id, gradiliste_id, radno_vrijeme_od, radno_vrijeme_do, radno_vrijeme_nocni_sati)
        VALUES ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000010', '08:00', '16:00', 9);
    `));
    await assert.rejects(db.exec(`
      INSERT INTO public.radno_vrijeme(id, osobni_auto_voznja_id)
        VALUES ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000002');
    `));
    assert.match(migration, /INSERT INTO public\.radno_vrijeme\([\s\S]*osobni_auto_voznja_id/);
    assert.match(migration, /trip\.radno_vrijeme_nocni_sati/);
    assert.match(migration, /USING ERRCODE = '23P01'/);
    assert.doesNotMatch(migration, /DELETE FROM public\.radno_vrijeme/);
  } finally {
    await db.close();
  }
});
