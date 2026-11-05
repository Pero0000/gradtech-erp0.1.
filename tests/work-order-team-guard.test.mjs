import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL(
  '../supabase/migrations/20261110280000_zastita_ekipe_naloga_u_radu.sql',
  import.meta.url,
), 'utf8');

test('work-order team membership cannot change after execution or recorded time', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE SCHEMA private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE public.radni_nalozi(
      id uuid PRIMARY KEY, status text NOT NULL, mobile_status text NOT NULL
    );
    CREATE TABLE public.radni_nalozi_radnici(
      nalog_id uuid NOT NULL REFERENCES public.radni_nalozi(id) ON DELETE CASCADE,
      radnik_id uuid NOT NULL, mobile_started_at timestamptz, mobile_finished_at timestamptz,
      vrijeme_od time, vrijeme_do time, PRIMARY KEY(nalog_id,radnik_id)
    );
    CREATE TABLE public.radno_vrijeme(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nalog_id uuid REFERENCES public.radni_nalozi(id), sati numeric
    );
  `);
  await db.exec(migration);
  await db.exec(migration);
  const order = '00000000-0000-0000-0000-000000000001';
  const worker = '00000000-0000-0000-0000-000000000002';
  const replacement = '00000000-0000-0000-0000-000000000003';
  await db.query(
    "INSERT INTO public.radni_nalozi VALUES ($1,'otvoren','dodijeljen')",
    [order],
  );
  await db.query('INSERT INTO public.radni_nalozi_radnici(nalog_id,radnik_id) VALUES ($1,$2)', [order, worker]);
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${worker}',false)`);

  await db.query('UPDATE public.radni_nalozi_radnici SET vrijeme_od=$3 WHERE nalog_id=$1 AND radnik_id=$2', [order, worker, '08:00']);
  await db.query('DELETE FROM public.radni_nalozi_radnici WHERE nalog_id=$1 AND radnik_id=$2', [order, worker]);
  await db.query('INSERT INTO public.radni_nalozi_radnici(nalog_id,radnik_id) VALUES ($1,$2)', [order, worker]);

  await db.query("UPDATE public.radni_nalozi SET status='u_tijeku',mobile_status='u_tijeku' WHERE id=$1", [order]);
  await assert.rejects(
    db.query('DELETE FROM public.radni_nalozi_radnici WHERE nalog_id=$1 AND radnik_id=$2', [order, worker]),
    /Ekipa se ne može mijenjati/,
  );
  await assert.rejects(
    db.query('INSERT INTO public.radni_nalozi_radnici(nalog_id,radnik_id) VALUES ($1,$2)', [order, replacement]),
    /Ekipa se ne može mijenjati/,
  );
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.radni_nalozi_radnici WHERE nalog_id=$1', [order])).rows[0].count, 1);

  await db.query("UPDATE public.radni_nalozi SET status='otvoren',mobile_status='dodijeljen' WHERE id=$1", [order]);
  await db.query('UPDATE public.radni_nalozi_radnici SET mobile_started_at=now() WHERE nalog_id=$1 AND radnik_id=$2', [order, worker]);
  await assert.rejects(
    db.query('DELETE FROM public.radni_nalozi_radnici WHERE nalog_id=$1 AND radnik_id=$2', [order, worker]),
    /Ekipa se ne može mijenjati/,
  );
  await db.query('UPDATE public.radni_nalozi_radnici SET mobile_started_at=NULL WHERE nalog_id=$1 AND radnik_id=$2', [order, worker]);
  await db.query("INSERT INTO public.radno_vrijeme(nalog_id,sati) VALUES ($1,8)", [order]);
  await assert.rejects(
    db.query('DELETE FROM public.radni_nalozi_radnici WHERE nalog_id=$1 AND radnik_id=$2', [order, worker]),
    /Ekipa se ne može mijenjati/,
  );

  await db.query('DELETE FROM public.radno_vrijeme WHERE nalog_id=$1', [order]);
  await db.query('DELETE FROM public.radni_nalozi WHERE id=$1', [order]);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.radni_nalozi_radnici WHERE nalog_id=$1', [order])).rows[0].count, 0,
    'Cascading order deletion remains available to the protected parent recovery flow');
});
