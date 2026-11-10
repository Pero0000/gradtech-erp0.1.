import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261110640000_portal_site_document_thumbnails.sql', import.meta.url), 'utf8');
const scopeSource = readFileSync(new URL('../supabase/migrations/20261107110000_dual_worker_portal_erp_access.sql', import.meta.url), 'utf8');
const selectSource = readFileSync(new URL('../supabase/migrations/20261016180000_mobile_work_orders.sql', import.meta.url), 'utf8');
const originalScope = scopeSource.slice(scopeSource.indexOf('CREATE POLICY mobile_worker_storage_scope'), scopeSource.indexOf("NOTIFY pgrst"));
const originalSelect = selectSource.slice(selectSource.indexOf('CREATE POLICY mobile_worker_storage_select'), selectSource.indexOf('CREATE POLICY mobile_worker_storage_insert'));

test('linked site previews reproduce Storage denial and become readable without granting unrelated access', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA storage;
    CREATE TABLE storage.objects (bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE TABLE public.gradiliste_dokumenti (id integer PRIMARY KEY, putanja text, thumbnail_path text);
    CREATE TABLE public.nalog_gradiliste_dokumenti (dokument_id integer, nalog_id uuid);
    CREATE TABLE public.test_assignments (nalog_id uuid, worker_id text, company_id text);
    CREATE FUNCTION public.app_is_worker_portal() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT current_setting('test.portal')::boolean
    $$;
    CREATE FUNCTION public.app_mobile_radnik_id() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT current_setting('test.worker')::uuid
    $$;
    CREATE FUNCTION public.app_mobile_assigned_nalog(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.test_assignments
        WHERE nalog_id = id AND worker_id = current_setting('test.worker')
          AND company_id = current_setting('test.company')
      )
    $$;
    CREATE FUNCTION public.app_mobile_editable_nalog(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT public.app_mobile_assigned_nalog(id)
    $$;
    GRANT USAGE ON SCHEMA public, storage TO authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT SELECT, INSERT ON storage.objects TO authenticated;
    INSERT INTO public.gradiliste_dokumenti VALUES
      (1, 'gradiliste/site/original.jpg', 'gradiliste/site/preview.jpg'),
      (2, 'gradiliste/site/unlinked.jpg', 'gradiliste/site/unlinked-preview.jpg'),
      (3, 'gradiliste/other/secret.jpg', 'gradiliste/other/secret-preview.jpg'),
      (4, 'gradiliste/site/manual.pdf', NULL);
    INSERT INTO public.nalog_gradiliste_dokumenti VALUES
      (1, '00000000-0000-0000-0000-000000000138'),
      (3, '00000000-0000-0000-0000-000000000999'),
      (4, '00000000-0000-0000-0000-000000000138');
    INSERT INTO public.test_assignments VALUES
      ('00000000-0000-0000-0000-000000000138', '00000000-0000-0000-0000-000000000001', 'company-a'),
      ('00000000-0000-0000-0000-000000000999', '00000000-0000-0000-0000-000000000001', 'company-b');
    INSERT INTO storage.objects
      SELECT 'nalozi-foto', putanja FROM public.gradiliste_dokumenti
      UNION ALL SELECT 'nalozi-foto', thumbnail_path FROM public.gradiliste_dokumenti WHERE thumbnail_path IS NOT NULL;
    INSERT INTO storage.objects VALUES
      ('nalozi-foto', '00000000-0000-0000-0000-000000000138/photo.jpg'),
      ('other-bucket', 'gradiliste/site/preview.jpg');
    SELECT set_config('test.portal', 'true', false);
    SELECT set_config('test.worker', '00000000-0000-0000-0000-000000000001', false);
    SELECT set_config('test.company', 'company-a', false);
  `);
  await db.exec(originalScope + originalSelect);
  await db.exec('SET ROLE authenticated');
  const before = await db.query('SELECT name FROM storage.objects ORDER BY name');
  assert.deepEqual(before.rows.map(row => row.name), [
    '00000000-0000-0000-0000-000000000138/photo.jpg',
    'gradiliste/site/manual.pdf',
    'gradiliste/site/original.jpg',
  ]);
  await db.exec('RESET ROLE');
  await db.exec(migration);
  await db.exec(migration);
  await db.exec('SET ROLE authenticated');
  const after = await db.query('SELECT name FROM storage.objects ORDER BY name');
  assert.deepEqual(after.rows.map(row => row.name), [
    '00000000-0000-0000-0000-000000000138/photo.jpg',
    'gradiliste/site/manual.pdf',
    'gradiliste/site/original.jpg',
    'gradiliste/site/preview.jpg',
  ]);
  await db.exec("SELECT set_config('test.worker', '00000000-0000-0000-0000-000000000002', false)");
  assert.equal((await db.query('SELECT name FROM storage.objects')).rows.length, 0);
  await db.exec("SELECT set_config('test.worker', '00000000-0000-0000-0000-000000000001', false)");
  await db.exec('RESET ROLE');
  await db.exec(`
    CREATE POLICY test_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'nalozi-foto');
    SET ROLE authenticated;
  `);
  await assert.rejects(db.exec("INSERT INTO storage.objects VALUES ('nalozi-foto', 'gradiliste/site/new.jpg')"), /row-level security/);
  await db.exec("INSERT INTO storage.objects VALUES ('nalozi-foto', '00000000-0000-0000-0000-000000000138/new.jpg')");
  await assert.rejects(db.exec("INSERT INTO storage.objects VALUES ('nalozi-foto', '00000000-0000-0000-0000-000000000999/new.jpg')"), /row-level security/);
});
