import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261110430000_nalozi_radnici_brisanje_fk.sql', import.meta.url), 'utf8');

test('failed discard leaves the schedule editor open and surfaces the error', () => {
  const source = readFileSync(new URL('../src/components/views/RasporedView.tsx', import.meta.url), 'utf8');
  const discard = source.slice(source.indexOf('const discardNalog = async'), source.indexOf('const saveNalog = async'));
  const failure = discard.slice(discard.indexOf('catch (e)'), discard.indexOf('finally'));
  assert.match(discard, /await discardRasporedNalog\(nalogForm.nalogId\)/);
  assert.match(failure, /setError\(errMsg/);
  assert.doesNotMatch(failure, /closeNalog/);
});

for (const variant of ['NO ACTION', 'RESTRICT', 'SET NULL', 'CASCADE', 'missing', 'duplicate']) {
  test(`discard repairs legacy assignment FK (${variant}) without losing assignments`, async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE TABLE public.radni_nalozi(id integer PRIMARY KEY);
        CREATE TABLE public.radnici(id integer PRIMARY KEY);
        CREATE TABLE public.radni_nalozi_radnici(
          nalog_id integer, radnik_id integer REFERENCES public.radnici(id) ON DELETE RESTRICT,
          PRIMARY KEY(nalog_id,radnik_id)
        );
        INSERT INTO public.radni_nalozi VALUES (1),(2);
        INSERT INTO public.radnici VALUES (10),(20);
        INSERT INTO public.radni_nalozi_radnici VALUES (1,10),(1,20),(2,20);
      `);
      if (variant !== 'missing') {
        await db.exec(`ALTER TABLE public.radni_nalozi_radnici
          ADD CONSTRAINT radni_nalozi_radnici_nalog_id_fkey FOREIGN KEY(nalog_id)
          REFERENCES public.radni_nalozi(id) ON UPDATE CASCADE
          ON DELETE ${variant === 'duplicate' ? 'NO ACTION' : variant} DEFERRABLE INITIALLY DEFERRED;`);
      }
      if (variant === 'duplicate') {
        await db.exec(`ALTER TABLE public.radni_nalozi_radnici ADD CONSTRAINT another_order_fk
          FOREIGN KEY(nalog_id) REFERENCES public.radni_nalozi(id) ON DELETE RESTRICT`);
      }
      if (['NO ACTION', 'RESTRICT', 'duplicate'].includes(variant)) {
        await assert.rejects(db.exec('DELETE FROM public.radni_nalozi WHERE id=1'), (reason) => reason.code === '23503');
      }
      const before = (await db.query('SELECT * FROM public.radni_nalozi_radnici ORDER BY nalog_id,radnik_id')).rows;
      const workerFk = (await db.query(`SELECT pg_get_constraintdef(oid) definition FROM pg_constraint
        WHERE conrelid='public.radni_nalozi_radnici'::regclass AND confrelid='public.radnici'::regclass`)).rows;
      await db.exec(migration);
      assert.deepEqual((await db.query('SELECT * FROM public.radni_nalozi_radnici ORDER BY nalog_id,radnik_id')).rows, before);
      assert.deepEqual((await db.query(`SELECT pg_get_constraintdef(oid) definition FROM pg_constraint
        WHERE conrelid='public.radni_nalozi_radnici'::regclass AND confrelid='public.radnici'::regclass`)).rows, workerFk);
      const constraints = (await db.query(`SELECT conname,confdeltype,confupdtype,condeferrable,condeferred FROM pg_constraint
        WHERE conrelid='public.radni_nalozi_radnici'::regclass AND confrelid='public.radni_nalozi'::regclass`)).rows;
      assert.ok(constraints.length > 0);
      assert.ok(constraints.every((row) => row.confdeltype === 'c'));
      if (variant !== 'missing') {
        const original = constraints.find((row) => row.conname === 'radni_nalozi_radnici_nalog_id_fkey');
        assert.equal(original.confupdtype, 'c');
        assert.equal(original.condeferrable, true);
        assert.equal(original.condeferred, true);
      }
      await db.exec(migration);
      await db.exec('BEGIN; DELETE FROM public.radni_nalozi WHERE id=1');
      assert.deepEqual((await db.query('SELECT * FROM public.radni_nalozi_radnici')).rows, [{ nalog_id: 2, radnik_id: 20 }]);
      assert.equal((await db.query('SELECT count(*)::int n FROM public.radnici')).rows[0].n, 2);
      await db.exec('ROLLBACK');
      assert.deepEqual((await db.query('SELECT * FROM public.radni_nalozi_radnici ORDER BY nalog_id,radnik_id')).rows, before);
    } finally { await db.close(); }
  });
}
