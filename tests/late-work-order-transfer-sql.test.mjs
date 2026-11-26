import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../supabase/migrations/20261126070000_naknadni_prijenos_sadrzaja_naloga.sql', import.meta.url),
  'utf8',
);

async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA private;
    CREATE TABLE public.radni_nalozi (
      id uuid PRIMARY KEY,
      company_id uuid NOT NULL,
      gradiliste_id uuid,
      status text NOT NULL DEFAULT 'otvoren',
      created_at timestamptz NOT NULL
    );
    CREATE TABLE public.radni_nalozi_stavke (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nalog_id uuid REFERENCES public.radni_nalozi(id),
      gradiliste_id uuid,
      tip text NOT NULL,
      naziv text NOT NULL,
      gotovo boolean NOT NULL DEFAULT false,
      uzeto boolean NOT NULL DEFAULT false,
      oprema_id uuid,
      izvor_materijal_id uuid,
      izvor_alat_id uuid,
      company_id uuid NOT NULL
    );
    CREATE UNIQUE INDEX radni_nalozi_stavke_nalog_materijal_izvor_unique
      ON public.radni_nalozi_stavke(nalog_id, izvor_materijal_id);
    CREATE UNIQUE INDEX radni_nalozi_stavke_nalog_alat_izvor_unique
      ON public.radni_nalozi_stavke(nalog_id, izvor_alat_id);
    CREATE TABLE public.gradiliste_zadaci (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nalog_id uuid REFERENCES public.radni_nalozi(id),
      gradiliste_id uuid,
      naziv text NOT NULL,
      rok date,
      kooperant_id uuid,
      vrsta text NOT NULL DEFAULT 'zadatak',
      gotovo boolean NOT NULL DEFAULT false,
      izvor_zadatak_id uuid,
      company_id uuid NOT NULL
    );
    CREATE UNIQUE INDEX gradiliste_zadaci_nalog_izvor_unique
      ON public.gradiliste_zadaci(nalog_id, izvor_zadatak_id);
  `);
  await db.exec(migration);
  return db;
}

const SITE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const RN224 = '00000000-0000-0000-0000-000000000224';
const RN229 = '00000000-0000-0000-0000-000000000229';
const RN230 = '00000000-0000-0000-0000-000000000230';

async function insertOrders(db) {
  await db.exec(`
    INSERT INTO public.radni_nalozi(id, company_id, gradiliste_id, status, created_at) VALUES
      ('${RN224}', '${COMPANY}', '${SITE}', 'zavrsen', '2026-11-24 08:00:00+00'),
      ('${RN229}', '${COMPANY}', '${SITE}', 'zavrsen', '2026-11-24 09:00:00+00'),
      ('${RN230}', '${COMPANY}', '${SITE}', 'otvoren', '2026-11-24 10:00:00+00');
  `);
}

test('late material and tool on RN-224 appear on immediately following RN-229 even when both are closed', async (t) => {
  const db = await setup(t);
  await insertOrders(db);
  await db.query(`
    INSERT INTO public.radni_nalozi_stavke(
      nalog_id, gradiliste_id, tip, naziv, company_id
    ) VALUES ($1::uuid, $2::uuid, 'materijal', 'Cement za nastavak', $3::uuid)
  `, [RN224, SITE, COMPANY]);
  await db.query(`
    INSERT INTO public.radni_nalozi_stavke(
      nalog_id, gradiliste_id, tip, naziv, company_id
    ) VALUES ($1::uuid, $2::uuid, 'alat', 'Bušilica', $3::uuid)
  `, [RN224, SITE, COMPANY]);
  const material = await db.query(`SELECT nalog_id::text, naziv FROM public.radni_nalozi_stavke WHERE naziv = 'Cement za nastavak' ORDER BY nalog_id`);
  const tool = await db.query(`SELECT nalog_id::text, naziv FROM public.radni_nalozi_stavke WHERE naziv = 'Bušilica' ORDER BY nalog_id`);
  assert.deepEqual(material.rows.map((row) => row.nalog_id).sort(), [RN224, RN229].sort());
  assert.deepEqual(tool.rows.map((row) => row.nalog_id).sort(), [RN224, RN229].sort());
});

test('late regular and additional tasks on RN-224 appear on RN-229 only', async (t) => {
  const db = await setup(t);
  await insertOrders(db);
  for (const [naziv, vrsta] of [['Žbuka stupa', 'zadatak'], ['Dodatni beton', 'dodatni']]) {
    await db.query(`
      INSERT INTO public.gradiliste_zadaci(
        nalog_id, gradiliste_id, naziv, vrsta, company_id
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid)
    `, [RN224, SITE, naziv, vrsta, COMPANY]);
  }
  const { rows } = await db.query(`SELECT nalog_id::text, naziv FROM public.gradiliste_zadaci ORDER BY naziv, nalog_id`);
  assert.deepEqual(rows.map((row) => [row.nalog_id, row.naziv]), [
    [RN224, 'Dodatni beton'],
    [RN229, 'Dodatni beton'],
    [RN224, 'Žbuka stupa'],
    [RN229, 'Žbuka stupa'],
  ]);
});

test('completed/taken items and already copied rows do not propagate', async (t) => {
  const db = await setup(t);
  await insertOrders(db);
  await db.query(`
    INSERT INTO public.radni_nalozi_stavke(
      nalog_id, gradiliste_id, tip, naziv, uzeto, company_id
    ) VALUES ($1::uuid, $2::uuid, 'materijal', 'Već uzeto', true, $3::uuid)
  `, [RN224, SITE, COMPANY]);
  const source = await db.query(`
    INSERT INTO public.radni_nalozi_stavke(
      nalog_id, gradiliste_id, tip, naziv, company_id
    ) VALUES ($1::uuid, $2::uuid, 'alat', 'Otvoreni alat', $3::uuid)
    RETURNING id
  `, [RN224, SITE, COMPANY]);
  const copies = await db.query(`
    SELECT count(*)::int AS count
    FROM public.radni_nalozi_stavke
    WHERE izvor_alat_id = $1::uuid
  `, [source.rows[0].id]);
  assert.equal(copies.rows[0].count, 1);
  const { rows } = await db.query(`SELECT nalog_id::text, naziv FROM public.radni_nalozi_stavke ORDER BY naziv, nalog_id`);
  assert.equal(rows.filter((row) => row.naziv === 'Već uzeto').length, 1);
  assert.equal(rows.filter((row) => row.naziv === 'Otvoreni alat').length, 2);
  assert.equal(rows.filter((row) => row.naziv === 'Otvoreni alat').some((row) => row.nalog_id === RN230), false);
});
