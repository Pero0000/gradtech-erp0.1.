import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sqlFile = (name) => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8');

test('recovery SQL compiles and passes transactional, permission and retention checks', async (t) => {
  const db = new PGlite();
  try {
    // Minimal Supabase schema with real PostgreSQL roles and tenant/permission functions.
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE SCHEMA private;
      REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
      CREATE TABLE public.tvrtke (id uuid PRIMARY KEY, aktivna boolean NOT NULL);
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE TABLE public.app_profiles (
        id uuid PRIMARY KEY REFERENCES auth.users(id), email text,
        company_id uuid REFERENCES public.tvrtke(id), approved boolean, is_admin boolean
      );
      CREATE TABLE public.app_user_permissions (
        user_id uuid, module text, can_view boolean, can_edit boolean
      );
      CREATE TABLE public.radnici (
        id uuid PRIMARY KEY, company_id uuid, ime text, prezime text, status text, uloga text
      );
      CREATE TABLE public.vozila (
        id uuid PRIMARY KEY, company_id uuid, registracija text, marka text,
        model text, tip text, status text, kilometraza integer, updated_at timestamptz
      );
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      CREATE FUNCTION public.app_current_company_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT p.company_id FROM public.app_profiles p JOIN public.tvrtke c ON c.id = p.company_id
        WHERE p.id = auth.uid() AND p.approved AND c.aktivna;
      $$;
      CREATE FUNCTION public.app_has_module_permission(p_module text, p_action text) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT EXISTS (SELECT 1 FROM public.app_profiles p
          WHERE p.id = auth.uid() AND p.approved
            AND p.company_id = public.app_current_company_id()
            AND (p.is_admin OR EXISTS (
              SELECT 1 FROM public.app_user_permissions permission
              WHERE permission.user_id = p.id AND permission.module = p_module
                AND CASE WHEN p_action = 'edit' THEN permission.can_edit ELSE permission.can_view END
            )));
      $$;
      CREATE FUNCTION public.app_mobile_radnik_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid; $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      CREATE SCHEMA cron;
      CREATE TABLE cron.test_jobs (name text, schedule text, command text);
      CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE plpgsql AS $$
        BEGIN INSERT INTO cron.test_jobs VALUES ($1, $2, $3); RETURN 1; END;
      $$;
      INSERT INTO public.tvrtke VALUES ('00000000-0000-0000-0000-000000000001', true);
      INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000002');
      INSERT INTO public.app_profiles VALUES (
        '00000000-0000-0000-0000-000000000002', 'editor@example.test',
        '00000000-0000-0000-0000-000000000001', true, true
      );
    `);
    await db.exec(sqlFile('migrations/20261109100000_vozila_gorivo.sql'));
    await db.exec(sqlFile('migrations/20261109150000_vozila_gorivo_kilometraza.sql'));
    await db.exec(sqlFile('migrations/20261109180000_vozila_gorivo_zakasnjeli_unos.sql'));
    const history = sqlFile('migrations/20261109200000_gorivo_povijest_vracanje.sql');
    // WASM PostgreSQL cannot run a background scheduler. Validate its job command separately.
    const extensionStatement = 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;';
    assert.ok(history.includes(extensionStatement));
    await db.exec(history.replace(extensionStatement, ''));
    await db.exec(sqlFile('tests/gorivo_povijest_vracanje.sql'));

    const jobs = await db.query('SELECT * FROM cron.test_jobs');
    assert.deepEqual(jobs.rows, [{
      name: 'prune-business-change-history',
      schedule: '17 * * * *',
      command: 'SELECT private.prune_business_change_history();',
    }]);
    await db.exec(jobs.rows[0].command);

    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
      INSERT INTO public.vozila VALUES (
        '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
        'TEST', 'Test', 'Test', 'teretno', 'slobodno', 100000, now()
      );
      INSERT INTO public.vozila_gorivo (
        id, vozilo_id, litara, kilometraza, tocio_ime
      ) VALUES (
        '00000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000003', 40, 99500, 'Test'
      );
    `);
    const event = (await db.query("SELECT id FROM private.business_change_history WHERE record_id = '00000000-0000-0000-0000-000000000004'")).rows[0].id;
    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query('SELECT * FROM private.business_change_history'), (reason) => reason.code === '42501');
    assert.equal((await db.query("SELECT * FROM public.get_fuel_change_history('00000000-0000-0000-0000-000000000003')")).rows.length, 1);
    await db.query('SELECT public.restore_fuel_change($1)', [event]);
    await db.exec('RESET ROLE');

    // Another company's active editor must not read or restore this event.
    await db.exec(`
      INSERT INTO public.tvrtke VALUES ('00000000-0000-0000-0000-000000000005', true);
      INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000006');
      INSERT INTO public.app_profiles VALUES (
        '00000000-0000-0000-0000-000000000006', 'other@example.test',
        '00000000-0000-0000-0000-000000000005', true, true
      );
      SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
      SET ROLE authenticated;
    `);
    await assert.rejects(db.query('SELECT public.restore_fuel_change($1)', [event]), (reason) => reason.code === '42501');
    await assert.rejects(db.query("SELECT * FROM public.get_fuel_change_history('00000000-0000-0000-0000-000000000003')"), (reason) => reason.code === '42501');
    await db.exec(`
      RESET ROLE;
      UPDATE public.app_profiles SET is_admin = false WHERE id = '00000000-0000-0000-0000-000000000006';
      SET ROLE authenticated;
    `);
    await assert.rejects(db.query('SELECT public.restore_fuel_change($1)', [event]), (reason) => reason.code === '42501');
    await db.exec('RESET ROLE');

    // A non-admin with edit permission can undo; cursor pagination retains all changes.
    await db.exec(`
      UPDATE public.app_profiles
      SET company_id = '00000000-0000-0000-0000-000000000001'
      WHERE id = '00000000-0000-0000-0000-000000000006';
      INSERT INTO public.app_user_permissions VALUES ('00000000-0000-0000-0000-000000000006', 'vozila', true, true);
      INSERT INTO public.vozila_gorivo (vozilo_id, litara, kilometraza, tocio_ime)
      SELECT '00000000-0000-0000-0000-000000000003', 40, 99500, 'Test'
      FROM generate_series(1, 55);
      SET ROLE authenticated;
    `);
    const firstPage = (await db.query("SELECT * FROM public.get_fuel_change_history('00000000-0000-0000-0000-000000000003')")).rows;
    assert.equal(firstPage.length, 50);
    assert.equal(typeof firstPage[0].sequence, 'string');
    const secondPage = (await db.query("SELECT * FROM public.get_fuel_change_history('00000000-0000-0000-0000-000000000003', $1)", [firstPage.at(-1).sequence])).rows;
    assert.equal(secondPage.length, 7);
    assert.equal(new Set([...firstPage, ...secondPage].map((row) => row.id)).size, 57);
    await db.query('SELECT public.restore_fuel_change($1)', [firstPage[0].id]);
    await db.exec('RESET ROLE');
    await db.exec(`UPDATE private.business_change_history SET expires_at = now() - interval '1 second'`);
    await db.exec(jobs.rows[0].command);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM private.business_change_history')).rows[0].count, 0);
    await db.exec("DELETE FROM public.vozila WHERE id = '00000000-0000-0000-0000-000000000003'");
    const orphanedEvent = (await db.query('SELECT id FROM private.business_change_history ORDER BY sequence DESC LIMIT 1')).rows[0].id;
    await assert.rejects(db.query('SELECT public.restore_fuel_change($1)', [orphanedEvent]), /Vozilo je obrisano/);

    await t.test('resource recovery supports consecutive updates and protects restricted fields and tenants', async () => {
      await db.exec(`
        ALTER TABLE public.radnici ADD COLUMN updated_at timestamptz DEFAULT now();
        ALTER TABLE public.radnici ADD COLUMN telefon text;
        ALTER TABLE public.radnici ADD COLUMN cijena_sata numeric DEFAULT 10;
        ALTER TABLE public.vozila ADD COLUMN cijena_km numeric DEFAULT 0;
        CREATE TABLE public.oprema (
          id uuid PRIMARY KEY, company_id uuid, kategorija text, naziv text,
          gradiliste_id uuid, cijena_sata numeric DEFAULT 0, updated_at timestamptz DEFAULT now()
        );
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
      `);
      await db.exec(sqlFile('migrations/20261109210000_resursi_povijest_izmjena.sql'));
      await db.exec(`
        INSERT INTO public.radnici (id, company_id, ime, prezime, status, uloga)
        VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001',
          'Marko', 'Test', 'aktivan', 'Radnik');
        UPDATE public.radnici SET ime = 'Pero' WHERE id = '00000000-0000-0000-0000-000000000010';
        UPDATE public.radnici SET ime = 'Ivan' WHERE id = '00000000-0000-0000-0000-000000000010';
      `);
      const history = async (table, id) => (await db.query('SELECT * FROM public.get_resource_change_history($1, $2)', [table, id])).rows;
      const workerId = '00000000-0000-0000-0000-000000000010';
      const changes = await history('radnici', workerId);
      assert.equal(changes.length, 2);
      assert.equal(changes[0].can_restore, true);
      assert.equal(changes[1].can_restore, false);
      await assert.rejects(db.query('SELECT public.restore_resource_change($1)', [changes[1].id]), (reason) => reason.code === '40001');
      await db.query('SELECT public.restore_resource_change($1)', [changes[0].id]);
      await db.query('SELECT public.restore_resource_change($1)', [changes[1].id]);
      assert.equal((await db.query('SELECT ime FROM public.radnici WHERE id = $1', [workerId])).rows[0].ime, 'Marko');
      await assert.rejects(db.query('SELECT public.restore_resource_change($1)', [changes[1].id]), /već je vraćena/);
      await db.exec(`UPDATE public.radnici SET cijena_sata = 25 WHERE id = '${workerId}'`);
      const priceChange = (await history('radnici', workerId))[0];
      assert.equal(priceChange.can_restore, false);
      await assert.rejects(db.query('SELECT public.restore_resource_change($1)', [priceChange.id]), /sadrži polja/);
      assert.equal(Number((await db.query('SELECT cijena_sata FROM public.radnici WHERE id = $1', [workerId])).rows[0].cijena_sata), 25);

      const vehicleId = '00000000-0000-0000-0000-000000000011';
      await db.exec(`
        INSERT INTO public.vozila (id, company_id, registracija, marka, model, tip, kilometraza)
        VALUES ('${vehicleId}', '00000000-0000-0000-0000-000000000001', 'TEST-RESTORE', 'Opel', 'Vivaro', 'teretno', 100000);
        UPDATE public.vozila SET kilometraza = 250000 WHERE id = '${vehicleId}';
      `);
      const mileageChange = (await history('vozila', vehicleId))[0];
      await db.query('SELECT public.restore_resource_change($1)', [mileageChange.id]);
      assert.equal((await db.query('SELECT kilometraza FROM public.vozila WHERE id = $1', [vehicleId])).rows[0].kilometraza, 100000);
      await assert.rejects(db.query('SELECT * FROM public.get_resource_change_history($1, $2)', ['app_profiles', workerId]), (reason) => reason.code === '22023');

      const machineId = '00000000-0000-0000-0000-000000000012';
      await db.exec(`
        INSERT INTO public.oprema (id, company_id, kategorija, naziv)
        VALUES ('${machineId}', '00000000-0000-0000-0000-000000000001', 'stroj', 'Bager');
        UPDATE public.oprema SET naziv = 'Pogresno' WHERE id = '${machineId}';
      `);
      const machineChange = (await history('oprema', machineId))[0];
      await db.exec(`
        CREATE FUNCTION public.test_prevent_resource_restore() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.naziv = 'Bager' THEN RETURN NULL; END IF; RETURN NEW; END;
        $$;
        CREATE TRIGGER test_prevent_resource_restore BEFORE UPDATE ON public.oprema
          FOR EACH ROW EXECUTE FUNCTION public.test_prevent_resource_restore();
      `);
      await assert.rejects(db.query('SELECT public.restore_resource_change($1)', [machineChange.id]), /nisu dopustila točno vraćanje/);
      assert.equal((await db.query('SELECT naziv FROM public.oprema WHERE id = $1', [machineId])).rows[0].naziv, 'Pogresno');
      assert.equal((await history('oprema', machineId))[0].reversed_at, null);
      await db.exec('DROP TRIGGER test_prevent_resource_restore ON public.oprema');
      await db.exec(`
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
        INSERT INTO public.app_user_permissions VALUES ('00000000-0000-0000-0000-000000000006', 'alat', true, true);
        SET ROLE authenticated;
      `);
      await assert.rejects(db.query('SELECT public.restore_resource_change($1)', [machineChange.id]), (reason) => reason.code === '42501');
      await db.exec(`
        RESET ROLE;
        INSERT INTO public.app_user_permissions VALUES ('00000000-0000-0000-0000-000000000006', 'strojevi', true, true);
        SET ROLE authenticated;
      `);
      await db.query('SELECT public.restore_resource_change($1)', [machineChange.id]);
      await db.exec(`
        RESET ROLE;
        UPDATE public.app_profiles SET company_id = '00000000-0000-0000-0000-000000000005'
        WHERE id = '00000000-0000-0000-0000-000000000006';
        SET ROLE authenticated;
      `);
      await assert.rejects(db.query('SELECT * FROM public.get_resource_change_history($1, $2)', ['radnici', workerId]), (reason) => reason.code === '42501');
      await assert.rejects(db.query('SELECT public.restore_resource_change($1)', [priceChange.id]), (reason) => reason.code === '42501');
      await db.exec(`
        RESET ROLE;
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
        UPDATE public.oprema SET naziv = 'Novi naziv' WHERE id = '${machineId}';
      `);
      const expired = (await history('oprema', machineId))[0];
      await db.query("UPDATE private.business_change_history SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.id]);
      await assert.rejects(db.query('SELECT public.restore_resource_change($1)', [expired.id]), /30 dana/);
      await db.exec(`UPDATE public.oprema SET naziv = 'Jos noviji naziv' WHERE id = '${machineId}'`);
      const deleted = (await history('oprema', machineId))[0];
      await db.exec(`DELETE FROM public.oprema WHERE id = '${machineId}'`);
      await assert.rejects(db.query('SELECT public.restore_resource_change($1)', [deleted.id]), /Zapis je obrisan/);
      await db.exec(`
        INSERT INTO public.oprema (id, company_id, kategorija, naziv)
        VALUES ('${machineId}', '00000000-0000-0000-0000-000000000001', 'stroj', 'Jos noviji naziv');
      `);
      await assert.rejects(db.query('SELECT public.restore_resource_change($1)', [deleted.id]), (reason) => reason.code === '40001');
    });
    await t.test('document recovery retains attachments, enforces Storage policies and restores all three operations', async () => {
      await db.exec(sqlFile('migrations/20261015310000_radnici_cijene_dokumenti.sql'));
      await db.exec(sqlFile('migrations/20261015320000_vozila_dokumenti_servis.sql'));
      await db.exec(sqlFile('migrations/20261016140000_create_oprema.sql'));
      for (const table of ['radnici_dokumenti', 'vozila_dokumenti', 'oprema_dokumenti']) {
        await db.exec(`ALTER TABLE public.${table} ADD COLUMN company_id uuid NOT NULL DEFAULT public.app_current_company_id()`);
      }
      await db.exec(sqlFile('migrations/20261109190000_radnik_dokument_kategorije.sql'));
      await db.exec(`
        CREATE SCHEMA storage;
        CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text UNIQUE);
        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
        GRANT USAGE ON SCHEMA storage TO authenticated;
        GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
        CREATE POLICY storage_test_base ON storage.objects FOR ALL TO authenticated USING (true) WITH CHECK (true);
        INSERT INTO public.oprema (id, company_id, kategorija, naziv)
          VALUES ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'alat', 'Busilica');
      `);
      // Apply the real tenant Storage gate, not just the new supplementary policies.
      const tenant = sqlFile('migrations/20261021100000_multi_company.sql');
      await db.exec(tenant.slice(tenant.indexOf('CREATE FUNCTION public.app_storage_in_company'), tenant.indexOf('-- Preserve mature mobile')));
      await db.exec(sqlFile('migrations/20261109220000_dokumenti_povijest_vracanje.sql'));
      const company = '00000000-0000-0000-0000-000000000001';
      const worker = '00000000-0000-0000-0000-000000000010';
      const vehicle = '00000000-0000-0000-0000-000000000011';
      const tool = '00000000-0000-0000-0000-000000000013';
      const history = async (table, parent) => (await db.query('SELECT * FROM public.get_document_change_history($1, $2)', [table, parent])).rows;
      const restore = (event) => db.query('SELECT public.restore_document_change($1)', [event.id]);
      for (const [table, parentColumn, parent, prefix, vrsta] of [
        ['radnici_dokumenti', 'radnik_id', worker, 'radnici', 'atest'],
        ['vozila_dokumenti', 'vozilo_id', vehicle, 'vozila', 'servis'],
        ['oprema_dokumenti', 'oprema_id', tool, 'oprema', 'atest'],
      ]) {
        const path = `${prefix}/${parent}/original.pdf`;
        const replacement = `${prefix}/${parent}/replacement.pdf`;
        await db.query('INSERT INTO storage.objects (bucket_id, name) VALUES ($1, $2), ($1, $3)', ['nalozi-foto', path, replacement]);
        const record = (await db.query(`INSERT INTO public.${table} (${parentColumn}, vrsta, naziv, putanja, datum_do)
          VALUES ($1, $2, 'Atest', $3, '2027-01-01') RETURNING id`, [parent, vrsta, path])).rows[0].id;
        const inserted = (await history(table, parent))[0];
        await db.query(`UPDATE public.${table} SET putanja = $1, datum_do = '2028-01-01' WHERE id = $2`, [replacement, record]);
        const changed = (await history(table, parent))[0];
        await db.exec('SET ROLE authenticated');
        assert.equal((await db.query('SELECT name FROM storage.objects WHERE name = $1', [path])).rows.length, 0);
        assert.equal((await db.query('SELECT name FROM storage.objects WHERE name = $1', [replacement])).rows.length, 1);
        assert.equal((await db.query('DELETE FROM storage.objects WHERE name = $1 RETURNING name', [replacement])).rows.length, 0);
        assert.equal((await db.query('UPDATE storage.objects SET name = name WHERE name = $1 RETURNING name', [replacement])).rows.length, 0);
        await db.exec('RESET ROLE');
        await assert.rejects(restore(inserted), (reason) => reason.code === '40001');
        await db.query(`UPDATE public.${table} SET datum_do = '2029-01-01' WHERE id = $1`, [record]);
        const secondChange = (await history(table, parent))[0];
        await assert.rejects(restore(changed), (reason) => reason.code === '40001');
        await restore(secondChange);
        await restore(changed);
        assert.equal((await db.query(`SELECT putanja FROM public.${table} WHERE id = $1`, [record])).rows[0].putanja, path);
        await assert.rejects(restore(changed), /već vraćena/);
        await db.query(`DELETE FROM public.${table} WHERE id = $1`, [record]);
        const removed = (await history(table, parent))[0];
        await restore(removed);
        assert.equal((await db.query(`SELECT datum_do::text FROM public.${table} WHERE id = $1`, [record])).rows[0].datum_do, '2027-01-01');
        await restore(inserted);
        assert.equal((await db.query(`SELECT id FROM public.${table} WHERE id = $1`, [record])).rows.length, 0);
        await db.exec('SET ROLE authenticated');
        assert.equal((await db.query('SELECT name FROM storage.objects WHERE name = $1', [path])).rows.length, 0);
        await db.exec('RESET ROLE');
        assert.equal((await db.query('SELECT name FROM storage.objects WHERE name = $1', [path])).rows.length, 1);
      }

      const custom = (await db.query("INSERT INTO public.radnik_dokument_kategorije(naziv) VALUES ('Rad na visini') RETURNING id")).rows[0].id;
      const customDoc = (await db.query("INSERT INTO public.radnici_dokumenti(radnik_id, vrsta, naziv) VALUES ($1, $2, 'ignored') RETURNING id",
        [worker, `custom:${custom}`])).rows[0].id;
      await db.query('DELETE FROM public.radnici_dokumenti WHERE id = $1', [customDoc]);
      const customDeletion = (await history('radnici_dokumenti', worker))[0];
      await db.query('DELETE FROM public.radnik_dokument_kategorije WHERE id = $1', [custom]);
      await assert.rejects(restore(customDeletion), (reason) => reason.code === '23514');
      assert.equal((await db.query('SELECT id FROM public.radnici_dokumenti WHERE id = $1', [customDoc])).rows.length, 0);

      const missingDoc = (await db.query("INSERT INTO public.oprema_dokumenti(oprema_id, naziv, putanja) VALUES ($1, 'Missing', 'absent.pdf') RETURNING id", [tool])).rows[0].id;
      await db.query('DELETE FROM public.oprema_dokumenti WHERE id = $1', [missingDoc]);
      const missing = (await history('oprema_dokumenti', tool))[0];
      await assert.rejects(restore(missing), /Prilog više nije/);
      assert.equal((await db.query('SELECT id FROM public.oprema_dokumenti WHERE id = $1', [missingDoc])).rows.length, 0);
      await assert.rejects(db.query('SELECT * FROM public.get_document_change_history($1, $2)', ['app_profiles', worker]), (reason) => reason.code === '22023');

      const permissionsDoc = (await db.query("INSERT INTO public.oprema_dokumenti(oprema_id, naziv) VALUES ($1, 'Permission test') RETURNING id", [tool])).rows[0].id;
      const permissionEvent = (await history('oprema_dokumenti', tool))[0];
      await db.exec(`
        UPDATE public.app_profiles SET company_id = '${company}' WHERE id = '00000000-0000-0000-0000-000000000006';
        DELETE FROM public.app_user_permissions WHERE user_id = '00000000-0000-0000-0000-000000000006' AND module = 'alat';
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
        SET ROLE authenticated;
      `);
      await assert.rejects(restore(permissionEvent), (reason) => reason.code === '42501');
      await assert.rejects(db.query('SELECT * FROM public.get_document_change_history($1, $2)', ['oprema_dokumenti', tool]), (reason) => reason.code === '42501');
      await db.exec(`
        RESET ROLE;
        INSERT INTO public.app_user_permissions VALUES ('00000000-0000-0000-0000-000000000006', 'alat', true, true);
        SET ROLE authenticated;
      `);
      await restore(permissionEvent);
      await assert.rejects(db.query('SELECT * FROM private.retained_document_files'), /permission denied/);
      await db.exec(`
        RESET ROLE;
        UPDATE public.app_profiles SET company_id = '00000000-0000-0000-0000-000000000005'
          WHERE id = '00000000-0000-0000-0000-000000000006';
        SET ROLE authenticated;
      `);
      await assert.rejects(restore(permissionEvent), (reason) => reason.code === '42501');
      await db.exec(`
        RESET ROLE;
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
      `);
      assert.equal((await db.query('SELECT id FROM public.oprema_dokumenti WHERE id = $1', [permissionsDoc])).rows.length, 0);
      await db.query("UPDATE private.business_change_history SET expires_at = now() - interval '1 second' WHERE id = $1", [missing.id]);
      await assert.rejects(restore(missing), /30 dana/);
      await db.exec('SELECT private.prune_business_change_history()');
      assert.ok((await db.query('SELECT path FROM private.retained_document_files')).rows.length >= 6);
      await db.query("INSERT INTO public.oprema_dokumenti(oprema_id, naziv) VALUES ($1, 'Parent deletion test')", [tool]);
      const parentEvent = (await history('oprema_dokumenti', tool))[0];
      await db.query('DELETE FROM public.oprema WHERE id = $1', [tool]);
      await assert.rejects(restore(parentEvent), /Resurs je obrisan/);
      await db.query("INSERT INTO public.oprema(id, company_id, kategorija, naziv) VALUES ($1, $2, 'alat', 'Different tool')", [tool, company]);
      await assert.rejects(restore(parentEvent), (reason) => reason.code === '40001');

      await db.query(`INSERT INTO public.vozila_dokumenti(vozilo_id, naziv)
        SELECT $1, 'Page ' || number::text FROM generate_series(1, 57) number`, [vehicle]);
      const firstPage = await history('vozila_dokumenti', vehicle);
      assert.equal(firstPage.length, 50);
      const nextPage = (await db.query('SELECT * FROM public.get_document_change_history($1, $2, $3)',
        ['vozila_dokumenti', vehicle, firstPage.at(-1).sequence])).rows;
      assert.ok(nextPage.length >= 7);
      assert.ok(nextPage.every((event) => BigInt(event.sequence) < BigInt(firstPage.at(-1).sequence)));
    });
    await t.test('resource deletion restores the complete relational transaction, not just the parent', async () => {
      await db.exec(sqlFile('migrations/20261015360000_radnici_povijest.sql'));
      await db.exec(`
        CREATE FUNCTION public.app_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
          SELECT EXISTS (SELECT 1 FROM public.app_profiles WHERE id = auth.uid() AND is_admin AND approved
            AND company_id = public.app_current_company_id());
        $$;
        CREATE TABLE public.gradilista(id uuid PRIMARY KEY, company_id uuid, naziv text);
        CREATE TABLE public.radni_nalozi (
          id uuid PRIMARY KEY, company_id uuid, naslov text, poslovodja_id uuid REFERENCES public.radnici(id) ON DELETE SET NULL,
          vozac_id uuid REFERENCES public.radnici(id) ON DELETE SET NULL
        );
        CREATE TABLE public.radni_nalozi_radnici (
          nalog_id uuid REFERENCES public.radni_nalozi(id) ON DELETE CASCADE,
          radnik_id uuid REFERENCES public.radnici(id) ON DELETE CASCADE,
          company_id uuid, vrijeme_od text, vrijeme_do text, PRIMARY KEY(nalog_id, radnik_id)
        );
        CREATE TABLE public.radni_nalozi_stavke (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
          nalog_id uuid REFERENCES public.radni_nalozi(id) ON DELETE CASCADE,
          oprema_id uuid REFERENCES public.oprema(id) ON DELETE SET NULL,
          tip text, naziv text, cijena_sata numeric DEFAULT 0, koristenje_at timestamptz,
          created_at timestamptz DEFAULT now()
        );
        CREATE TABLE public.radno_vrijeme (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
          radnik_id uuid REFERENCES public.radnici(id) ON DELETE CASCADE,
          gradiliste_id uuid REFERENCES public.gradilista(id), nalog_id uuid REFERENCES public.radni_nalozi(id),
          sati numeric, datum date
        );
        CREATE TABLE public.raspored (id uuid PRIMARY KEY, company_id uuid);
        CREATE TABLE public.raspored_radnici (
          raspored_id uuid REFERENCES public.raspored(id), radnik_id uuid REFERENCES public.radnici(id) ON DELETE CASCADE,
          company_id uuid, PRIMARY KEY(raspored_id, radnik_id)
        );
        CREATE TABLE public.raspored_vozila (
          raspored_id uuid REFERENCES public.raspored(id), vozilo_id uuid REFERENCES public.vozila(id) ON DELETE CASCADE,
          company_id uuid, PRIMARY KEY(raspored_id, vozilo_id)
        );
        ALTER TABLE public.radnici_povijest ADD COLUMN company_id uuid DEFAULT public.app_current_company_id();
        ALTER TABLE public.app_profiles ADD COLUMN radnik_id uuid REFERENCES public.radnici(id) ON DELETE SET NULL;
        ALTER TABLE public.app_user_permissions ADD CONSTRAINT test_permissions_profile
          FOREIGN KEY (user_id) REFERENCES public.app_profiles(id) ON DELETE CASCADE;
        ALTER TABLE public.oprema ADD COLUMN radnik_id uuid REFERENCES public.radnici(id) ON DELETE SET NULL;
        CREATE TABLE public.radnici_odsustva (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
          radnik_id uuid REFERENCES public.radnici(id) ON DELETE CASCADE, vrsta text, datum_od date, datum_do date
        );
        CREATE TABLE public.mobile_work_order_audit (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
          nalog_id uuid REFERENCES public.radni_nalozi(id), actor_radnik_id uuid REFERENCES public.radnici(id) ON DELETE SET NULL,
          action text
        );
        CREATE TABLE public.vozila_gorivo_anomalije (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
          vozilo_id uuid REFERENCES public.vozila(id) ON DELETE CASCADE,
          gorivo_id uuid REFERENCES public.vozila_gorivo(id) ON DELETE CASCADE, napomena text
        );
      `);
      await db.exec(sqlFile('migrations/20261015120000_create_dnevni_raspored.sql'));
      await db.exec(`
        ALTER TABLE public.dnevni_raspored_gradilista ADD COLUMN company_id uuid DEFAULT public.app_current_company_id();
        ALTER TABLE public.dnevni_raspored_radnici ADD COLUMN company_id uuid DEFAULT public.app_current_company_id();
      `);
      await db.exec(sqlFile('migrations/20261018110000_work_order_driver.sql').split('CREATE OR REPLACE FUNCTION public.mobile_set_nalog_vozac')[0]);
      const machine = sqlFile('migrations/20261104120000_machine_usage_log.sql');
      await db.exec(machine.slice(machine.indexOf('CREATE OR REPLACE FUNCTION private.snapshot_machine_usage'), machine.indexOf('CREATE OR REPLACE FUNCTION private.record_nalog_inventory_machine')));
      await db.exec(sqlFile('migrations/20261109230000_resursi_povrat_brisanja.sql'));
      const company = '00000000-0000-0000-0000-000000000001';
      const worker = '00000000-0000-0000-0000-000000000020';
      const vehicle = '00000000-0000-0000-0000-000000000021';
      const tool = '00000000-0000-0000-0000-000000000022';
      const order = '00000000-0000-0000-0000-000000000023';
      const site = '00000000-0000-0000-0000-000000000024';
      const schedule = '00000000-0000-0000-0000-000000000025';
      await db.exec(`
        INSERT INTO public.radnici(id, company_id, ime, prezime, status, uloga)
          VALUES ('${worker}', '${company}', 'Povrat', 'Djelatnika', 'aktivan', 'Radnik');
        INSERT INTO public.vozila(id, company_id, registracija, marka, model, tip, kilometraza)
          VALUES ('${vehicle}', '${company}', 'RESTORE-ALL', 'Opel', 'Vivaro', 'teretno', 100000);
        INSERT INTO public.oprema(id, company_id, kategorija, naziv, radnik_id, cijena_sata)
          VALUES ('${tool}', '${company}', 'stroj', 'Bager s povijesti', '${worker}', 80);
        INSERT INTO public.gradilista VALUES ('${site}', '${company}', 'Test gradiliste');
        INSERT INTO public.radni_nalozi(id, company_id, naslov, poslovodja_id)
          VALUES ('${order}', '${company}', 'Povezani nalog', '${worker}');
        INSERT INTO public.radni_nalozi_radnici VALUES ('${order}', '${worker}', '${company}', '07:00', '15:00');
        UPDATE public.radni_nalozi SET vozac_id = '${worker}' WHERE id = '${order}';
        INSERT INTO public.radno_vrijeme(company_id, radnik_id, gradiliste_id, nalog_id, sati, datum)
          VALUES ('${company}', '${worker}', '${site}', '${order}', 8, '2026-11-04');
        INSERT INTO public.raspored VALUES ('${schedule}', '${company}');
        INSERT INTO public.raspored_radnici VALUES ('${schedule}', '${worker}', '${company}');
        INSERT INTO public.raspored_vozila VALUES ('${schedule}', '${vehicle}', '${company}');
        INSERT INTO public.dnevni_raspored_radnici(datum, vozilo_id, radnik_id, company_id)
          VALUES ('2026-11-04', '${vehicle}', '${worker}', '${company}');
        INSERT INTO public.dnevni_raspored_gradilista(datum, vozilo_id, gradiliste_id, company_id)
          VALUES ('2026-11-04', '${vehicle}', '${site}', '${company}');
        INSERT INTO public.radnici_odsustva(company_id, radnik_id, vrsta, datum_od, datum_do)
          VALUES ('${company}', '${worker}', 'godisnji', '2026-11-05', '2026-11-06');
        INSERT INTO public.radnici_povijest(radnik_id, polje, stara_vrijednost, nova_vrijednost, company_id)
          VALUES ('${worker}', 'cijena_sata', '10', '12', '${company}');
        INSERT INTO public.mobile_work_order_audit(company_id, nalog_id, actor_radnik_id, action)
          VALUES ('${company}', '${order}', '${worker}', 'Old immutable event');
        UPDATE public.app_profiles SET company_id = '${company}', radnik_id = '${worker}' WHERE id = '00000000-0000-0000-0000-000000000006';
        INSERT INTO storage.objects(bucket_id, name) VALUES ('nalozi-foto', 'radnici/${worker}/atest.pdf');
        INSERT INTO public.radnici_dokumenti(radnik_id, vrsta, naziv, putanja)
          VALUES ('${worker}', 'atest', 'Atest', 'radnici/${worker}/atest.pdf');
        UPDATE public.radnici_dokumenti SET naziv = 'Povijesni naziv prije kategorija' WHERE radnik_id = '${worker}';
        INSERT INTO public.radni_nalozi_stavke(company_id, nalog_id, oprema_id, tip, naziv)
          VALUES ('${company}', '${order}', '${tool}', 'stroj', 'Bager');
        UPDATE public.oprema SET cijena_sata = 120 WHERE id = '${tool}';
      `);
      const tableRows = async (table) => (await db.query(`SELECT to_jsonb(r) snapshot FROM public.${table} r ORDER BY to_jsonb(r)::text`)).rows.map((row) => row.snapshot);
      const tables = ['radnici', 'oprema', 'radni_nalozi', 'radni_nalozi_radnici', 'radno_vrijeme', 'raspored_radnici',
        'dnevni_raspored_radnici', 'radnici_odsustva', 'radnici_povijest', 'mobile_work_order_audit', 'app_profiles', 'radnici_dokumenti'];
      const before = new Map();
      for (const table of tables) before.set(table, await tableRows(table));
      const remove = async (table, id) => (await db.query('SELECT public.delete_resource_with_history($1, $2) id', [table, id])).rows[0].id;
      const restore = (id) => db.query('SELECT public.restore_resource_deletion($1)', [id]);
      await db.exec(`
        INSERT INTO public.app_user_permissions VALUES ('00000000-0000-0000-0000-000000000006', 'radnici', true, true);
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
        SET ROLE authenticated;
      `);
      await assert.rejects(remove('radnici', worker), (reason) => reason.code === '42501');
      await db.exec(`
        RESET ROLE;
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
      `);
      for (const table of tables) assert.deepEqual(await tableRows(table), before.get(table), `Denied deletion is atomic: ${table}`);
      await db.exec(`
        INSERT INTO public.app_user_permissions(user_id, module, can_view, can_edit)
          SELECT '00000000-0000-0000-0000-000000000006', module, true, true
          FROM (VALUES ('vozila'), ('alat'), ('strojevi'), ('radno_vrijeme'), ('raspored'), ('radni_nalozi')) modules(module)
          WHERE NOT EXISTS (SELECT 1 FROM public.app_user_permissions p
            WHERE p.user_id = '00000000-0000-0000-0000-000000000006' AND p.module = modules.module);
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
        SET ROLE authenticated;
      `);
      await assert.rejects(remove('radnici', worker), (reason) => reason.code === '42501', 'Even all module rights cannot reconnect an account without admin');
      await db.exec(`
        RESET ROLE;
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
      `);
      await assert.rejects(db.query('DELETE FROM public.radnici WHERE id = $1', [worker]), (reason) => reason.code === '42501');
      const deletedWorker = await remove('radnici', worker);
      assert.equal((await db.query('SELECT id FROM public.radnici WHERE id = $1', [worker])).rows.length, 0);
      assert.equal((await db.query('SELECT vozac_id FROM public.radni_nalozi WHERE id = $1', [order])).rows[0].vozac_id, null);
      await restore(deletedWorker);
      for (const table of tables) assert.deepEqual(await tableRows(table), before.get(table), `Full restored state: ${table}`);
      await assert.rejects(restore(deletedWorker), /već vraćeno/);
      const restoredDocEvents = (await db.query('SELECT * FROM public.get_document_change_history($1, $2)', ['radnici_dokumenti', worker])).rows;
      assert.equal(restoredDocEvents.filter((event) => event.operation === 'DELETE').every((event) => event.reversed_at !== null), true);

      const machineBefore = await tableRows('radni_nalozi_stavke');
      const deletedMachine = await remove('oprema', tool);
      assert.equal((await db.query('SELECT oprema_id FROM public.radni_nalozi_stavke WHERE nalog_id = $1', [order])).rows[0].oprema_id, null);
      await restore(deletedMachine);
      assert.deepEqual(await tableRows('radni_nalozi_stavke'), machineBefore, 'Keep original usage timestamp and historical rate, not current rate');

      // Exercise the real append-only mobile audit trigger alongside cascade recovery.
      await db.exec(`
        CREATE FUNCTION public.write_mobile_work_order_audit(p_nalog_id uuid, p_action text, p_details jsonb)
          RETURNS void LANGUAGE sql AS $$
          INSERT INTO public.mobile_work_order_audit(company_id, nalog_id, action)
            VALUES (public.app_current_company_id(), p_nalog_id, p_action);
          $$;
      `);
      const audit = sqlFile('migrations/20261016200000_mobile_work_order_audit.sql');
      await db.exec(audit.slice(audit.indexOf('CREATE OR REPLACE FUNCTION public.audit_mobile_work_order_change()'),
        audit.indexOf('CREATE TRIGGER mobile_audit_order_changes')));
      const audited = await remove('radnici', worker);
      await restore(audited);
      const auditAfter = await tableRows('mobile_work_order_audit');
      assert.ok(auditAfter.some((row) => row.action === 'worker_unassigned'));
      assert.ok(auditAfter.some((row) => row.action === 'worker_assigned'));
      assert.equal(auditAfter.find((row) => row.action === 'Old immutable event').actor_radnik_id, worker);
      const approvalTest = await remove('radnici', worker);
      await db.exec("UPDATE public.app_profiles SET approved = false WHERE id = '00000000-0000-0000-0000-000000000006'");
      await restore(approvalTest);
      assert.equal((await db.query("SELECT approved FROM public.app_profiles WHERE id = '00000000-0000-0000-0000-000000000006'")).rows[0].approved, false,
        'Restoring the worker link must not restore account approval or rights');

      await db.exec(`
        INSERT INTO public.vozila_gorivo(vozilo_id, datum, litara, kilometraza, tocio_radnik_id, tocio_ime)
          VALUES ('${vehicle}', '2026-11-04', 42.5, 99500, '${worker}', 'Djelatnik');
        UPDATE public.radnici SET ime = 'Promijenjeno ime' WHERE id = '${worker}';
        INSERT INTO public.vozila_gorivo_anomalije(company_id, vozilo_id, gorivo_id, napomena)
          SELECT '${company}', '${vehicle}', id, 'Provjereno' FROM public.vozila_gorivo WHERE vozilo_id = '${vehicle}';
        INSERT INTO storage.objects(bucket_id, name) VALUES ('nalozi-foto', 'vozila/${vehicle}/servis.pdf');
        INSERT INTO public.vozila_dokumenti(vozilo_id, vrsta, naziv, iznos, putanja)
          VALUES ('${vehicle}', 'servis', 'Servis', 350, 'vozila/${vehicle}/servis.pdf');
      `);
      const vehicleTables = ['vozila', 'vozila_gorivo', 'vozila_gorivo_anomalije', 'vozila_dokumenti', 'raspored_vozila', 'dnevni_raspored_radnici', 'dnevni_raspored_gradilista'];
      const vehicleBefore = new Map();
      for (const table of vehicleTables) vehicleBefore.set(table, await tableRows(table));
      const deletedVehicle = await remove('vozila', vehicle);
      await restore(deletedVehicle);
      for (const table of vehicleTables) assert.deepEqual(await tableRows(table), vehicleBefore.get(table), `Restore vehicle dependency: ${table}`);

      const overlapTables = [...new Set([...tables, ...vehicleTables])].filter((table) => table !== 'mobile_work_order_audit');
      const overlapBefore = new Map();
      for (const table of overlapTables) overlapBefore.set(table, await tableRows(table));
      const overlapWorker = await remove('radnici', worker);
      const overlapVehicle = await remove('vozila', vehicle);
      await assert.rejects(restore(overlapWorker), (reason) => ['40001', '23503'].includes(reason.code));
      await restore(overlapVehicle);
      await restore(overlapWorker);
      for (const table of overlapTables) assert.deepEqual(await tableRows(table), overlapBefore.get(table), `Overlapping undo lineage: ${table}`);

      const absentFile = await remove('vozila', vehicle);
      await db.query("DELETE FROM storage.objects WHERE name = $1", [`vozila/${vehicle}/servis.pdf`]);
      await assert.rejects(restore(absentFile), /Nedostaje prilog/);
      assert.equal((await db.query('SELECT id FROM public.vozila WHERE id = $1', [vehicle])).rows.length, 0);
      await db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ('nalozi-foto', $1)", [`vozila/${vehicle}/servis.pdf`]);
      await restore(absentFile);

      await db.exec(`
        UPDATE public.app_profiles SET company_id = '00000000-0000-0000-0000-000000000005', approved = true
          WHERE id = '00000000-0000-0000-0000-000000000006';
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
        SET ROLE authenticated;
      `);
      await assert.rejects(restore(deletedVehicle), (reason) => reason.code === '42501');
      await assert.rejects(remove('vozila', vehicle), (reason) => reason.code === '42501');
      assert.equal((await db.query("SELECT * FROM public.get_resource_deletions('radnici')")).rows.length, 0);
      await assert.rejects(db.query('SELECT * FROM private.resource_deletion_rows'), /permission denied/);
      await db.exec(`
        RESET ROLE;
        UPDATE public.app_profiles SET company_id = '${company}' WHERE id = '00000000-0000-0000-0000-000000000006';
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
      `);
      await assert.rejects(remove('app_profiles', worker), (reason) => reason.code === '22023');

      const deletionPage = (await db.query("SELECT * FROM public.get_resource_deletions('radnici')")).rows;
      assert.ok(deletionPage.every((item) => item.affected_rows.radnici === 1));
      assert.ok(deletionPage.some((item) => item.affected_rows.app_profiles === 1));

      const conflicting = await remove('radnici', worker);
      await db.query("UPDATE public.radni_nalozi SET naslov = 'Promjena druge osobe' WHERE id = $1", [order]);
      await assert.rejects(restore(conflicting), (reason) => reason.code === '40001');
      assert.equal((await db.query('SELECT id FROM public.radnici WHERE id = $1', [worker])).rows.length, 0, 'Failed restoration rolls back even the already restored parent');
      await db.query("UPDATE public.radni_nalozi SET naslov = 'Povezani nalog' WHERE id = $1", [order]);
      await assert.rejects(restore(conflicting), (reason) => reason.code === '40001', 'ABA edits are detected by revisions');
      await db.query("UPDATE private.resource_deletions SET expires_at = now() - interval '1 second' WHERE id = $1", [conflicting]);
      await assert.rejects(restore(conflicting), /30 dana/);
      await db.exec('SELECT private.prune_resource_deletions()');
      assert.equal((await db.query('SELECT id FROM private.resource_deletions WHERE id = $1', [conflicting])).rows.length, 0);
    });
    await t.test('site updates use shared atomic recovery with tenant guards, paging and financial exclusions', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const otherCompany = '00000000-0000-0000-0000-000000000005';
      const site = '00000000-0000-0000-0000-000000000070';
      const object = '00000000-0000-0000-0000-000000000071';
      const otherObject = '00000000-0000-0000-0000-000000000072';
      await db.exec(`
        CREATE TABLE public.objekti(id uuid PRIMARY KEY, company_id uuid, naziv text);
        ALTER TABLE public.gradilista
          ADD COLUMN adresa text, ADD COLUMN regija text,
          ADD COLUMN objekt_id uuid REFERENCES public.objekti(id) ON DELETE SET NULL,
          ADD COLUMN voditelj_gradilista text, ADD COLUMN status text DEFAULT 'planirano',
          ADD COLUMN datum_pocetka date, ADD COLUMN datum_zavrsetka date,
          ADD COLUMN opis text, ADD COLUMN onedrive_map_link text,
          ADD COLUMN onedrive_map_file_path text,
          ADD COLUMN ugovorena_vrijednost numeric DEFAULT 1000,
          ADD COLUMN predvidena_marza numeric DEFAULT 300,
          ADD COLUMN updated_at timestamptz DEFAULT now();
        CREATE FUNCTION private.tenant_tables() RETURNS SETOF text LANGUAGE sql AS $$
          VALUES ('gradilista'), ('objekti');
        $$;
      `);
      const tenant = sqlFile('migrations/20261021100000_multi_company.sql');
      await db.exec(tenant.slice(tenant.indexOf('CREATE FUNCTION private.enforce_company_integrity()'),
        tenant.indexOf('\nDO $$', tenant.indexOf('CREATE FUNCTION private.enforce_company_integrity()'))));
      await db.exec(`
        CREATE TRIGGER tenant_integrity BEFORE INSERT OR UPDATE ON public.gradilista
          FOR EACH ROW EXECUTE FUNCTION private.enforce_company_integrity();
        INSERT INTO public.objekti VALUES ('${object}', '${company}', 'Izvorni objekt'),
          ('${otherObject}', '${company}', 'Drugi objekt');
        INSERT INTO public.gradilista(id, company_id, naziv, objekt_id)
          VALUES ('${site}', '${company}', 'Izvorno gradiliste', '${object}');
      `);
      await db.exec(sqlFile('migrations/20261109233000_gradilista_povijest_izmjena.sql'));
      const history = async () => (await db.query('SELECT * FROM public.get_resource_change_history($1, $2)', ['gradilista', site])).rows;
      const undo = (id) => db.query('SELECT public.restore_resource_change($1)', [id]);
      const snapshot = async () => (await db.query("SELECT to_jsonb(g) - 'updated_at' AS value FROM public.gradilista g WHERE id = $1", [site])).rows[0].value;
      const original = await snapshot();
      await db.exec(`
        UPDATE public.gradilista SET naziv = 'Krivi naziv', status = 'aktivno', regija = 'dalmacija',
          datum_pocetka = '2026-11-04', datum_zavrsetka = '2026-12-01',
          adresa = 'Nova adresa', opis = 'Opis', voditelj_gradilista = 'Voditelj',
          onedrive_map_link = 'https://example.test/mapa', objekt_id = '${otherObject}' WHERE id = '${site}';
        UPDATE public.gradilista SET naziv = 'Druga izmjena' WHERE id = '${site}';
        SET ROLE authenticated;
      `);
      const changes = await history();
      assert.equal(changes.length, 2);
      assert.equal(changes[0].can_restore, true);
      assert.equal(changes[1].can_restore, false);
      assert.equal(changes[0].actor_name, 'editor@example.test');
      await assert.rejects(undo(changes[1].id), (reason) => reason.code === '40001');
      await undo(changes[0].id);
      await undo(changes[1].id);
      await assert.rejects(undo(changes[1].id), /već je vraćena/);
      await db.exec('RESET ROLE');
      assert.deepEqual(await snapshot(), original);
      assert.equal((await db.query('SELECT id FROM public.objekti WHERE id = $1', [otherObject])).rows.length, 1);

      for (const assignment of ["ugovorena_vrijednost = 2000", "predvidena_marza = 600", "onedrive_map_file_path = 'new.pdf'"]) {
        await db.exec(`UPDATE public.gradilista SET naziv = naziv || 'x', ${assignment} WHERE id = '${site}'`);
        const blocked = (await history())[0];
        assert.equal(blocked.can_restore, false);
        const before = await snapshot();
        await assert.rejects(undo(blocked.id), /sadrži polja/);
        assert.deepEqual(await snapshot(), before);
      }

      await db.exec(`UPDATE public.gradilista SET naziv = 'Jedan' WHERE id = '${site}'`);
      const first = (await history())[0];
      await db.exec(`UPDATE public.gradilista SET naziv = 'Dva' WHERE id = '${site}'`);
      await db.exec(`UPDATE public.gradilista SET naziv = 'Jedan' WHERE id = '${site}'`);
      await assert.rejects(undo(first.id), (reason) => reason.code === '40001', 'Returning to the same value does not bypass newer journal entries');

      await db.exec(`UPDATE public.gradilista SET objekt_id = '${otherObject}' WHERE id = '${site}'`);
      await db.exec(`UPDATE public.gradilista SET objekt_id = '${object}' WHERE id = '${site}'`);
      const objectChange = (await history())[0];
      await db.exec(`UPDATE public.objekti SET company_id = '${otherCompany}' WHERE id = '${otherObject}'`);
      await assert.rejects(undo(objectChange.id), (reason) => reason.code === '23514');
      assert.equal((await history())[0].reversed_at, null);
      await db.exec(`UPDATE public.objekti SET company_id = '${company}' WHERE id = '${otherObject}'`);
      await undo(objectChange.id);

      await db.exec(`
        UPDATE public.gradilista SET naziv = 'Ne smije se tiho preskociti' WHERE id = '${site}';
        CREATE FUNCTION public.test_skip_site_restore() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RETURN NULL; END;
        $$;
        CREATE TRIGGER test_skip_site_restore BEFORE UPDATE ON public.gradilista
          FOR EACH ROW EXECUTE FUNCTION public.test_skip_site_restore();
      `);
      const skipped = (await history())[0];
      await assert.rejects(undo(skipped.id), /nisu dopustila točno vraćanje/);
      assert.equal((await history())[0].reversed_at, null);
      await db.exec('DROP TRIGGER test_skip_site_restore ON public.gradilista');

      await db.exec(`
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
        SET ROLE authenticated;
      `);
      await assert.rejects(history(), (reason) => reason.code === '42501');
      await assert.rejects(undo(skipped.id), (reason) => reason.code === '42501');
      await db.exec(`
        RESET ROLE;
        INSERT INTO public.app_user_permissions VALUES ('00000000-0000-0000-0000-000000000006', 'gradilista', true, true);
        SET ROLE authenticated;
      `);
      assert.equal((await history())[0].can_restore, true);
      await db.exec(`
        RESET ROLE;
        UPDATE public.app_profiles SET company_id = '${otherCompany}' WHERE id = '00000000-0000-0000-0000-000000000006';
        SET ROLE authenticated;
      `);
      await assert.rejects(history(), (reason) => reason.code === '42501');
      await assert.rejects(undo(skipped.id), (reason) => reason.code === '42501');
      await assert.rejects(db.query('SELECT * FROM private.business_change_history'), (reason) => reason.code === '42501');
      await db.exec(`
        RESET ROLE;
        UPDATE public.app_profiles SET company_id = '${company}' WHERE id = '00000000-0000-0000-0000-000000000006';
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
      `);
      await undo(skipped.id);

      await db.exec(`UPDATE public.gradilista SET naziv = 'Istek' WHERE id = '${site}'`);
      const expired = (await history())[0];
      await db.query("UPDATE private.business_change_history SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.id]);
      await assert.rejects(undo(expired.id), /30 dana/);
      assert.ok(!(await history()).some((row) => row.id === expired.id));
      await db.exec(`DO $$ BEGIN FOR i IN 1..55 LOOP
        UPDATE public.gradilista SET naziv = 'Stranica ' || i WHERE id = '${site}';
      END LOOP; END $$`);
      const page = await history();
      assert.equal(page.length, 50);
      assert.equal(typeof page[0].sequence, 'string');
      const next = (await db.query('SELECT * FROM public.get_resource_change_history($1, $2, $3)', ['gradilista', site, page.at(-1).sequence])).rows;
      assert.ok(next.length > 5);
      assert.equal(new Set([...page, ...next].map((row) => row.id)).size, page.length + next.length);
      assert.equal(page.filter((row) => row.can_restore).length, 1);

      // Replaced shared RPCs must still restore existing resource types.
      for (const [table, id, field] of [
        ['vozila', '00000000-0000-0000-0000-000000000011', 'registracija'],
        ['oprema', '00000000-0000-0000-0000-000000000012', 'naziv'],
      ]) {
        const prior = (await db.query(`SELECT ${field} FROM public.${table} WHERE id = $1`, [id])).rows[0][field];
        await db.query(`UPDATE public.${table} SET ${field} = 'Provjera regresije' WHERE id = $1`, [id]);
        const row = (await db.query('SELECT * FROM public.get_resource_change_history($1, $2)', [table, id])).rows[0];
        assert.equal(row.can_restore, true);
        await undo(row.id);
        assert.equal((await db.query(`SELECT ${field} FROM public.${table} WHERE id = $1`, [id])).rows[0][field], prior);
      }
    });
    await t.test('site deletion restores orders, financials, identity audit, self-references and retained files atomically', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const site = '00000000-0000-0000-0000-000000000080';
      const order = '00000000-0000-0000-0000-000000000081';
      const worker = '00000000-0000-0000-0000-000000000010';
      const vehicle = '00000000-0000-0000-0000-000000000011';
      const machine = '00000000-0000-0000-0000-000000000012';
      const source = '00000000-0000-0000-0000-000000000082';
      const copy = '00000000-0000-0000-0000-000000000083';
      const doc = '00000000-0000-0000-0000-000000000084';
      const paths = ['gradiliste/map.pdf', 'gradiliste/site.pdf', 'gradiliste/image.webp',
        'gradiliste/thumb.webp', 'nalog/report.pdf', 'nalog/photo.webp', 'nalog/thumb.webp', 'gradiliste/vtr.pdf'];
      await db.exec(`
        ALTER TABLE public.gradilista ADD COLUMN onedrive_map_file_name text;
        ALTER TABLE public.radni_nalozi ADD COLUMN gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE CASCADE;
        ALTER TABLE public.radno_vrijeme
          DROP CONSTRAINT radno_vrijeme_gradiliste_id_fkey, DROP CONSTRAINT radno_vrijeme_nalog_id_fkey,
          ADD FOREIGN KEY (gradiliste_id) REFERENCES public.gradilista(id) ON DELETE CASCADE,
          ADD FOREIGN KEY (nalog_id) REFERENCES public.radni_nalozi(id) ON DELETE CASCADE;
        ALTER TABLE public.raspored ADD COLUMN gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE CASCADE;
        ALTER TABLE public.raspored_radnici DROP CONSTRAINT raspored_radnici_raspored_id_fkey,
          ADD FOREIGN KEY (raspored_id) REFERENCES public.raspored(id) ON DELETE CASCADE;
        ALTER TABLE public.raspored_vozila DROP CONSTRAINT raspored_vozila_raspored_id_fkey,
          ADD FOREIGN KEY (raspored_id) REFERENCES public.raspored(id) ON DELETE CASCADE;
        CREATE TABLE public.gradiliste_board_layout (
          id boolean DEFAULT true, company_id uuid, columns jsonb, sort_modes jsonb,
          updated_at timestamptz DEFAULT now(), PRIMARY KEY(company_id, id)
        );
        ALTER TABLE public.radni_nalozi_stavke
          ADD COLUMN gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE CASCADE,
          ADD COLUMN izvor_id uuid REFERENCES public.radni_nalozi_stavke(id) ON DELETE SET NULL;
        CREATE TABLE public.gradiliste_zadaci (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
          gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE CASCADE,
          nalog_id uuid REFERENCES public.radni_nalozi(id) ON DELETE SET NULL, naziv text, gotovo boolean
        );
        CREATE TABLE public.rokovi (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
          gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE CASCADE,
          zadatak_id uuid REFERENCES public.gradiliste_zadaci(id) ON DELETE CASCADE, datum date
        );
        CREATE TABLE public.fakture (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
          gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE CASCADE,
          broj text UNIQUE, iznos numeric, status text
        );
        CREATE TABLE public.troskovi (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
          gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE CASCADE,
          nalog_id uuid REFERENCES public.radni_nalozi(id) ON DELETE CASCADE, iznos numeric, placen boolean
        );
        CREATE TABLE public.ugovoreni_radovi (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
          gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE CASCADE,
          ugovoreni_iznos numeric, dokument_putanja text
        );
        CREATE TABLE public.gradiliste_stavke (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
          gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE CASCADE, cijena numeric, kolicina numeric
        );
        CREATE TABLE public.ponude (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
          gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE SET NULL, naziv text
        );
        CREATE TABLE public.kooperant_angazmani (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid,
          gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE CASCADE, dogovoreni_iznos numeric
        );
        ALTER TABLE public.oprema ADD CONSTRAINT test_equipment_site
          FOREIGN KEY (gradiliste_id) REFERENCES public.gradilista(id) ON DELETE SET NULL;
        DROP TABLE public.mobile_work_order_audit;
      `);
      const audit = sqlFile('migrations/20261016200000_mobile_work_order_audit.sql');
      await db.exec(audit.slice(0, audit.indexOf('CREATE OR REPLACE FUNCTION public.get_mobile_worker_display_name')));
      await db.exec('ALTER TABLE public.mobile_work_order_audit ADD COLUMN company_id uuid');
      const tenant = sqlFile('migrations/20261021100000_multi_company.sql');
      await db.exec(tenant.slice(tenant.indexOf('CREATE OR REPLACE FUNCTION public.write_mobile_work_order_audit'),
        tenant.indexOf('-- Storage paths already')));
      await db.exec(sqlFile('migrations/20261015290000_gradiliste_materijal_dokumenti.sql'));
      await db.exec(sqlFile('migrations/20261015240000_nalog_stavke_dokumenti.sql'));
      await db.exec(`CREATE TABLE public.radni_nalozi_foto (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nalog_id uuid REFERENCES public.radni_nalozi(id) ON DELETE CASCADE,
        putanja text, naziv text
      )`);
      await db.exec(sqlFile('migrations/20261015300000_nalog_gradiliste_dokumenti.sql'));
      await db.exec(sqlFile('migrations/20261107150000_site_photo_thumbnails.sql'));
      // These production tables predate the recovery registry; the minimal fixture creates them only now.
      for (const table of ['gradiliste_dokumenti', 'radni_nalozi_dokumenti', 'radni_nalozi_foto', 'nalog_gradiliste_dokumenti']) {
        await db.exec(`ALTER TABLE public.${table} ADD COLUMN company_id uuid DEFAULT public.app_current_company_id()`);
      }
      await db.exec(`
        DO $$ DECLARE target record; keys text[]; BEGIN
          FOR target IN SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
              AND c.relname NOT IN ('app_user_permissions', 'app_push_tokens')
              AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = c.oid AND attname = 'company_id')
              AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = c.oid AND tgname = 'zzzz_resource_recovery')
          LOOP
            SELECT array_agg(a.attname ORDER BY k.ordinality) INTO keys FROM pg_constraint pk
              CROSS JOIN LATERAL unnest(pk.conkey) WITH ORDINALITY k(num, ordinality)
              JOIN pg_attribute a ON a.attrelid = pk.conrelid AND a.attnum = k.num
              WHERE pk.conrelid = target.oid AND pk.contype = 'p';
            INSERT INTO private.resource_recovery_tables VALUES (target.relname, keys) ON CONFLICT DO NOTHING;
            EXECUTE format('CREATE TRIGGER zzzz_resource_recovery AFTER INSERT OR UPDATE OR DELETE ON public.%I
              FOR EACH ROW EXECUTE FUNCTION private.capture_resource_recovery_row()', target.relname);
          END LOOP;
        END $$;
      `);
      await db.exec(sqlFile('migrations/20261109235000_gradilista_povrat_brisanja.sql'));
      await db.exec(`
        INSERT INTO public.gradilista(id, company_id, naziv, onedrive_map_file_path)
          VALUES ('${site}', '${company}', 'Gradiliste za cjeloviti povrat', '${paths[0]}');
        INSERT INTO public.radni_nalozi(id, company_id, naslov, gradiliste_id, poslovodja_id)
          VALUES ('${order}', '${company}', 'Povijesni nalog', '${site}', '${worker}');
        INSERT INTO public.radni_nalozi_radnici(nalog_id, radnik_id, company_id, vrijeme_od, vrijeme_do)
          VALUES ('${order}', '${worker}', '${company}', '08:00', '16:00');
        UPDATE public.radni_nalozi SET vozac_id = '${worker}' WHERE id = '${order}';
        INSERT INTO public.gradiliste_board_layout(company_id, columns, sort_modes) VALUES (
          '${company}', '[[],["${site}"],[]]', '["manual","manual","manual"]');
        INSERT INTO public.radno_vrijeme(company_id, radnik_id, gradiliste_id, nalog_id, sati, datum)
          VALUES ('${company}', '${worker}', '${site}', '${order}', 8, '2026-11-06');
        INSERT INTO public.raspored(id, company_id, gradiliste_id)
          VALUES ('00000000-0000-0000-0000-000000000085', '${company}', '${site}');
        INSERT INTO public.raspored_radnici VALUES ('00000000-0000-0000-0000-000000000085', '${worker}', '${company}');
        INSERT INTO public.raspored_vozila VALUES ('00000000-0000-0000-0000-000000000085', '${vehicle}', '${company}');
        INSERT INTO public.gradiliste_zadaci(company_id, gradiliste_id, nalog_id, naziv, gotovo)
          VALUES ('${company}', '${site}', '${order}', 'Rijeseni zadatak', true);
        INSERT INTO public.rokovi(company_id, gradiliste_id, zadatak_id, datum)
          SELECT '${company}', '${site}', id, '2026-12-01' FROM public.gradiliste_zadaci WHERE gradiliste_id = '${site}';
        INSERT INTO public.fakture(company_id, gradiliste_id, broj, iznos, status) VALUES ('${company}', '${site}', 'TEST-1', 1234.56, 'placena');
        INSERT INTO public.troskovi(company_id, gradiliste_id, nalog_id, iznos, placen) VALUES ('${company}', '${site}', '${order}', 321.12, true);
        INSERT INTO public.ugovoreni_radovi(company_id, gradiliste_id, ugovoreni_iznos, dokument_putanja)
          VALUES ('${company}', '${site}', 456.78, '${paths[7]}');
        INSERT INTO public.gradiliste_stavke(company_id, gradiliste_id, cijena, kolicina) VALUES ('${company}', '${site}', 9.99, 13);
        INSERT INTO public.ponude(company_id, gradiliste_id, naziv) VALUES ('${company}', '${site}', 'Ostaje uz praznu vezu');
        INSERT INTO public.kooperant_angazmani(company_id, gradiliste_id, dogovoreni_iznos) VALUES ('${company}', '${site}', 999);
        INSERT INTO public.radni_nalozi_stavke(id, company_id, gradiliste_id, nalog_id, tip, naziv)
          VALUES ('${source}', '${company}', '${site}', '${order}', 'materijal', 'Izvor'),
            ('${copy}', '${company}', '${site}', '${order}', 'materijal', 'Kopija');
        UPDATE public.radni_nalozi_stavke SET izvor_id = '${source}' WHERE id = '${copy}';
        INSERT INTO public.gradiliste_dokumenti(id, company_id, gradiliste_id, vrsta, putanja, naziv)
          VALUES ('${doc}', '${company}', '${site}', 'dokument', '${paths[1]}', 'PDF');
        INSERT INTO public.gradiliste_dokumenti(company_id, gradiliste_id, vrsta, putanja, thumbnail_path, naziv)
          VALUES ('${company}', '${site}', 'slika', '${paths[2]}', '${paths[3]}', 'Fotografija');
        INSERT INTO public.radni_nalozi_dokumenti(company_id, nalog_id, putanja, naziv) VALUES ('${company}', '${order}', '${paths[4]}', 'Izvjestaj');
        INSERT INTO public.radni_nalozi_foto(company_id, nalog_id, putanja, thumbnail_path) VALUES ('${company}', '${order}', '${paths[5]}', '${paths[6]}');
        INSERT INTO public.nalog_gradiliste_dokumenti VALUES ('${order}', '${doc}', '${company}');
        UPDATE public.oprema SET gradiliste_id = '${site}' WHERE id = '${machine}';
        INSERT INTO public.mobile_work_order_audit(company_id, nalog_id, actor_name, action)
          VALUES ('${company}', '${order}', 'Stari autor', 'original_history');
        UPDATE public.oprema SET cijena_sata = 17 WHERE id = '${machine}';
        INSERT INTO public.radni_nalozi_stavke(company_id, nalog_id, gradiliste_id, tip, oprema_id, naziv)
          VALUES ('${company}', '${order}', '${site}', 'stroj', '${machine}', 'Povijesni stroj');
        UPDATE public.oprema SET cijena_sata = 99 WHERE id = '${machine}';
        INSERT INTO public.dnevni_raspored_gradilista(datum, vozilo_id, gradiliste_id, company_id)
          VALUES ('2026-11-06', '${vehicle}', '${site}', '${company}');
      `);
      for (const path of paths) await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('nalozi-foto',$1)", [path]);
      const tables = ['gradilista', 'radni_nalozi', 'radni_nalozi_radnici', 'radni_nalozi_stavke', 'gradiliste_zadaci',
        'rokovi', 'fakture', 'troskovi', 'ugovoreni_radovi', 'gradiliste_stavke', 'ponude', 'kooperant_angazmani',
        'gradiliste_dokumenti', 'radni_nalozi_dokumenti', 'radni_nalozi_foto', 'nalog_gradiliste_dokumenti',
        'oprema', 'dnevni_raspored_gradilista', 'radno_vrijeme', 'raspored', 'raspored_radnici', 'raspored_vozila',
        'gradiliste_board_layout'];
      const rows = async (table) => (await db.query(`SELECT to_jsonb(r) data FROM public.${table} r ORDER BY to_jsonb(r)::text`)).rows.map((row) => row.data);
      const baseline = new Map();
      for (const table of tables) baseline.set(table, await rows(table));
      const originalAudit = (await db.query('SELECT * FROM public.mobile_work_order_audit WHERE nalog_id = $1', [order])).rows;
      const remove = async () => (await db.query("SELECT public.delete_resource_with_history('gradilista', $1) id", [site])).rows[0].id;
      const restore = (id) => db.query('SELECT public.restore_resource_deletion($1)', [id]);

      await db.query('DELETE FROM storage.objects WHERE name = $1', [paths[0]]);
      await assert.rejects(remove(), /Zaštićeno brisanje nije moguće/);
      for (const table of tables) assert.deepEqual(await rows(table), baseline.get(table), `Missing original file blocks deletion: ${table}`);
      await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('nalozi-foto',$1)", [paths[0]]);
      await db.exec(`GRANT SELECT, DELETE ON public.gradilista TO authenticated; SET ROLE authenticated`);
      await assert.rejects(db.query('DELETE FROM public.gradilista WHERE id = $1', [site]), /Zaštićeno brisanje/);
      const deletion = await remove();
      assert.equal((await db.query("SELECT * FROM public.get_resource_deletions('gradilista')")).rows[0].affected_rows.fakture, 1);
      for (const path of paths) {
        assert.equal((await db.query('SELECT public.app_document_file_visible($1) visible, public.app_document_file_mutable($1) mutable', [path])).rows[0].visible, false);
        assert.equal((await db.query('SELECT name FROM storage.objects WHERE name = $1', [path])).rows.length, 0, 'Archived files cannot be read with a new Storage request');
        assert.equal((await db.query('DELETE FROM storage.objects WHERE name = $1 RETURNING name', [path])).rows.length, 0);
      }
      await restore(deletion);
      await assert.rejects(restore(deletion), /već vraćeno/);
      await db.exec('RESET ROLE');
      for (const table of tables) assert.deepEqual(await rows(table), baseline.get(table), `Exact site bundle: ${table}`);
      for (const original of originalAudit) assert.deepEqual((await db.query('SELECT * FROM public.mobile_work_order_audit WHERE id = $1', [original.id])).rows[0], original);
      assert.ok((await db.query('SELECT * FROM public.mobile_work_order_audit WHERE nalog_id = $1', [order])).rows.length > originalAudit.length, 'Recovery appends audit rather than overwriting old identity rows');
      assert.ok((await db.query('SELECT public.app_document_file_visible($1) visible', [paths[3]])).rows[0].visible);

      const missing = await remove();
      await db.query('DELETE FROM storage.objects WHERE name = $1', [paths[6]]);
      const deletedState = new Map();
      for (const table of tables) deletedState.set(table, await rows(table));
      await assert.rejects(restore(missing), /Nedostaje prilog/);
      for (const table of tables) assert.deepEqual(await rows(table), deletedState.get(table), `Missing thumbnail rollback: ${table}`);
      await db.query("INSERT INTO storage.objects(bucket_id, name) VALUES ('nalozi-foto', $1)", [paths[6]]);
      await restore(missing);

      const restrictedSite = '00000000-0000-0000-0000-000000000086';
      await db.exec(`
        INSERT INTO public.gradilista(id, company_id, naziv) VALUES ('${restrictedSite}', '${company}', 'Provjera financijskih prava');
        INSERT INTO public.fakture(company_id, gradiliste_id, broj, iznos) VALUES ('${company}', '${restrictedSite}', 'RESTRICTED', 42);
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
        SET ROLE authenticated;
      `);
      await assert.rejects(db.query("SELECT public.delete_resource_with_history('gradilista', $1)", [restrictedSite]), (reason) => reason.code === '42501');
      await db.exec('RESET ROLE');
      assert.equal((await db.query('SELECT id FROM public.gradilista WHERE id = $1', [restrictedSite])).rows.length, 1);
      assert.equal((await db.query('SELECT iznos FROM public.fakture WHERE gradiliste_id = $1', [restrictedSite])).rows[0].iznos, '42');
      await db.exec(`SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false)`);
      const uniqueConflict = (await db.query("SELECT public.delete_resource_with_history('gradilista', $1) id", [restrictedSite])).rows[0].id;
      await db.exec(`INSERT INTO public.fakture(company_id, broj, iznos) VALUES ('${company}', 'RESTRICTED', 99)`);
      await assert.rejects(restore(uniqueConflict), (reason) => reason.code === '23505');
      assert.equal((await db.query('SELECT id FROM public.gradilista WHERE id = $1', [restrictedSite])).rows.length, 0);
      assert.equal((await db.query("SELECT iznos FROM public.fakture WHERE broj = 'RESTRICTED'")).rows[0].iznos, '99');
      await db.exec("DELETE FROM public.fakture WHERE broj = 'RESTRICTED'");
      await restore(uniqueConflict);

      const conflict = await remove();
      await db.exec(`UPDATE public.ponude SET naziv = 'Novija ponuda' WHERE gradiliste_id IS NULL`);
      await assert.rejects(restore(conflict), (reason) => reason.code === '40001');
      assert.equal((await db.query('SELECT id FROM public.gradilista WHERE id = $1', [site])).rows.length, 0);
      await db.exec(`UPDATE public.ponude SET naziv = 'Ostaje uz praznu vezu' WHERE gradiliste_id IS NULL`);
      await assert.rejects(restore(conflict), (reason) => reason.code === '40001', 'ABA changes still block the whole site');

      await db.exec(`
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
        SET ROLE authenticated;
      `);
      const list = (await db.query("SELECT * FROM public.get_resource_deletions('gradilista')")).rows;
      assert.equal(list.find((item) => item.id === conflict).can_restore, false, 'Site edit alone cannot restore financial or equipment dependencies');
      await assert.rejects(restore(conflict), (reason) => reason.code === '42501');
      await db.exec(`
        RESET ROLE;
        UPDATE public.app_profiles SET company_id = '00000000-0000-0000-0000-000000000005'
          WHERE id = '00000000-0000-0000-0000-000000000006';
        SET ROLE authenticated;
      `);
      assert.equal((await db.query("SELECT * FROM public.get_resource_deletions('gradilista')")).rows.length, 0);
      await assert.rejects(restore(conflict), (reason) => reason.code === '42501');
      await db.exec(`
        RESET ROLE;
        UPDATE public.app_profiles SET company_id = '${company}' WHERE id = '00000000-0000-0000-0000-000000000006';
        SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
        CREATE TABLE public.test_untracked_site_child(id uuid PRIMARY KEY, gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE CASCADE);
      `);
      await assert.rejects(db.query("SELECT public.delete_resource_with_history('gradilista','00000000-0000-0000-0000-000000000024')"), /Povrat nije pripremljen/);
      await db.exec('DROP TABLE public.test_untracked_site_child');

      // Exercise pre-existing worker/vehicle/equipment recovery through the replaced restore engine.
      for (const [table, id] of [['radnici', worker], ['vozila', vehicle], ['oprema', machine]]) {
        const before = await rows(table);
        const operation = (await db.query('SELECT public.delete_resource_with_history($1, $2) id', [table, id])).rows[0].id;
        await restore(operation);
        assert.deepEqual(await rows(table), before, `Earlier recovery stays compatible: ${table}`);
      }
      await db.exec(`INSERT INTO public.dnevni_raspored_radnici(datum, vozilo_id, radnik_id, company_id)
        VALUES ('2026-11-07', '${vehicle}', '${worker}', '${company}')`);
      const sharedAssignment = await rows('dnevni_raspored_radnici');
      const workerDeletion = (await db.query("SELECT public.delete_resource_with_history('radnici', $1) id", [worker])).rows[0].id;
      const vehicleDeletion = (await db.query("SELECT public.delete_resource_with_history('vozila', $1) id", [vehicle])).rows[0].id;
      await assert.rejects(restore(workerDeletion), (reason) => reason.code === '23503');
      await restore(vehicleDeletion);
      await restore(workerDeletion);
      assert.deepEqual(await rows('dnevni_raspored_radnici'), sharedAssignment, 'Shared row recovery remains safe across overlapping resource deletions');
      await assert.rejects(db.query("UPDATE public.radni_nalozi SET vozac_id = $1 WHERE id = '00000000-0000-0000-0000-000000000023'", [worker]),
        /Vozač mora biti djelatnik dodijeljen/, 'Normal driver validation is not weakened by bundle recovery');
    });
    await t.test('standalone order deletion captures item release, transferred sources and all downstream data in one transaction', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const site = '00000000-0000-0000-0000-000000000086';
      const order = '00000000-0000-0000-0000-000000000090';
      const previousOrder = '00000000-0000-0000-0000-000000000091';
      const worker = '00000000-0000-0000-0000-000000000010';
      const vehicle = '00000000-0000-0000-0000-000000000011';
      const source = '00000000-0000-0000-0000-000000000092';
      const copy = '00000000-0000-0000-0000-000000000093';
      const pending = '00000000-0000-0000-0000-000000000094';
      const completed = '00000000-0000-0000-0000-000000000095';
      const doc = '00000000-0000-0000-0000-000000000096';
      const paths = ['nalog/samostalni.pdf', 'nalog/samostalni.webp', 'nalog/samostalni-thumb.webp'];
      await db.exec(`
        ALTER TABLE public.radni_nalozi ADD COLUMN broj text, ADD COLUMN status text, ADD COLUMN mobile_status text,
          ADD COLUMN zakljucen_at timestamptz;
        ALTER TABLE public.radni_nalozi_stavke ADD COLUMN gotovo boolean DEFAULT false,
          ADD COLUMN preneseno boolean DEFAULT false;
        ALTER TABLE public.rokovi ADD COLUMN nalog_id uuid REFERENCES public.radni_nalozi(id) ON DELETE CASCADE;
        ALTER TABLE public.dnevni_raspored_gradilista ADD COLUMN nalog_id uuid REFERENCES public.radni_nalozi(id) ON DELETE SET NULL;
      `);
      await db.exec(sqlFile('migrations/20261019110000_zadaci_bez_gradilista.sql'));
      await db.exec(sqlFile('migrations/20261110000000_nalozi_povrat_brisanja.sql'));
      await db.exec(`
        INSERT INTO public.radni_nalozi(id, company_id, gradiliste_id, naslov, broj, status, mobile_status, zakljucen_at)
          VALUES ('${order}', '${company}', '${site}', 'Zavrseni nalog', 'RN-TEST-1', 'zavrsen', 'predan', '2026-11-04T08:00:00Z'),
            ('${previousOrder}', '${company}', '${site}', 'Prethodni nalog', 'RN-TEST-0', 'zavrsen', 'predan', '2026-11-03T08:00:00Z');
        INSERT INTO public.radni_nalozi_radnici(nalog_id, radnik_id, company_id, vrijeme_od, vrijeme_do)
          VALUES ('${order}', '${worker}', '${company}', '08:00', '16:00');
        UPDATE public.radni_nalozi SET vozac_id = '${worker}', poslovodja_id = '${worker}' WHERE id = '${order}';
        INSERT INTO public.radni_nalozi_stavke(id, company_id, gradiliste_id, nalog_id, tip, naziv, preneseno, gotovo)
          VALUES ('${source}', '${company}', '${site}', '${previousOrder}', 'materijal', 'Izvor s prethodnog naloga', true, false),
            ('${copy}', '${company}', '${site}', '${order}', 'materijal', 'Prenesena kopija', false, false),
            ('${pending}', '${company}', '${site}', '${order}', 'alat', 'Nerijeseni alat', false, false),
            ('${completed}', '${company}', '${site}', '${order}', 'materijal', 'Potroseno', false, true);
        UPDATE public.radni_nalozi_stavke SET izvor_id = '${source}' WHERE id = '${copy}';
        UPDATE public.oprema SET cijena_sata = 21 WHERE id = '00000000-0000-0000-0000-000000000012';
        INSERT INTO public.radni_nalozi_stavke(company_id, gradiliste_id, nalog_id, tip, naziv, oprema_id, gotovo)
          VALUES ('${company}', '${site}', '${order}', 'stroj', 'Povijesna cijena stroja',
            '00000000-0000-0000-0000-000000000012', true);
        UPDATE public.oprema SET cijena_sata = 105 WHERE id = '00000000-0000-0000-0000-000000000012';
        INSERT INTO public.gradiliste_zadaci(company_id, gradiliste_id, nalog_id, naziv, gotovo)
          VALUES ('${company}', '${site}', '${order}', 'Zadatak ostaje gradilistu', true),
            ('${company}', NULL, '${order}', 'Zadatak bez gradilista', false);
        INSERT INTO public.rokovi(company_id, gradiliste_id, nalog_id, datum) VALUES ('${company}', '${site}', '${order}', '2026-11-07');
        INSERT INTO public.troskovi(company_id, gradiliste_id, nalog_id, iznos, placen) VALUES ('${company}', '${site}', '${order}', 321.98, true);
        INSERT INTO public.radno_vrijeme(company_id, gradiliste_id, nalog_id, radnik_id, sati, datum)
          VALUES ('${company}', '${site}', '${order}', '${worker}', 7.5, '2026-11-04');
        INSERT INTO public.radni_nalozi_dokumenti(company_id, nalog_id, naziv, putanja) VALUES ('${company}', '${order}', 'Izvjestaj', '${paths[0]}');
        INSERT INTO public.gradiliste_dokumenti(id, company_id, gradiliste_id, naziv, putanja)
          VALUES ('${doc}', '${company}', '${site}', 'Ista datoteka na gradilistu', '${paths[0]}');
        INSERT INTO public.nalog_gradiliste_dokumenti VALUES ('${order}', '${doc}', '${company}');
        INSERT INTO public.radni_nalozi_foto(company_id, nalog_id, putanja, thumbnail_path)
          VALUES ('${company}', '${order}', '${paths[1]}', '${paths[2]}');
        INSERT INTO public.dnevni_raspored_gradilista(datum, vozilo_id, gradiliste_id, company_id, nalog_id)
          VALUES ('2026-11-08', '${vehicle}', '${site}', '${company}', '${order}');
        INSERT INTO public.mobile_work_order_audit(company_id, nalog_id, actor_name, action)
          VALUES ('${company}', '${order}', 'Izvorni autor', 'original_history');
      `);
      for (const path of paths) await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('nalozi-foto',$1)", [path]);
      const tables = ['radni_nalozi', 'radni_nalozi_radnici', 'radni_nalozi_stavke', 'gradiliste_zadaci', 'rokovi',
        'troskovi', 'radno_vrijeme', 'radni_nalozi_dokumenti', 'gradiliste_dokumenti', 'radni_nalozi_foto',
        'nalog_gradiliste_dokumenti', 'dnevni_raspored_gradilista', 'gradilista', 'fakture'];
      const rows = async (table) => (await db.query(`SELECT to_jsonb(r) data FROM public.${table} r ORDER BY to_jsonb(r)::text`)).rows.map((row) => row.data);
      const before = new Map();
      for (const table of tables) before.set(table, await rows(table));
      const remove = async () => (await db.query("SELECT public.delete_resource_with_history('radni_nalozi', $1) id", [order])).rows[0].id;
      const restore = (id) => db.query('SELECT public.restore_resource_deletion($1)', [id]);
      const auditBefore = (await db.query('SELECT * FROM public.mobile_work_order_audit WHERE nalog_id = $1', [order])).rows;
      await db.query('DELETE FROM storage.objects WHERE name = $1', [paths[0]]);
      await assert.rejects(remove(), /Zaštićeno brisanje nije moguće/);
      for (const table of tables) assert.deepEqual(await rows(table), before.get(table), `Missing report blocks order deletion: ${table}`);
      await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('nalozi-foto',$1)", [paths[0]]);
      await db.exec('GRANT SELECT, DELETE ON public.radni_nalozi TO authenticated; SET ROLE authenticated');
      await assert.rejects(db.query('DELETE FROM public.radni_nalozi WHERE id = $1', [order]), /Zaštićeno brisanje naloga/);
      const deletion = await remove();
      const history = (await db.query("SELECT * FROM public.get_resource_deletions('radni_nalozi')")).rows;
      assert.equal(history[0].id, deletion);
      assert.equal(history[0].snapshot.broj, 'RN-TEST-1');
      assert.equal(history[0].affected_rows.radni_nalozi_stavke, 5);
      assert.equal(history[0].can_restore, true);
      assert.ok((await db.query('SELECT public.app_document_file_visible($1) visible', [paths[0]])).rows[0].visible, 'Site still references shared PDF');
      assert.equal((await db.query('SELECT public.app_document_file_visible($1) visible', [paths[2]])).rows[0].visible, false);
      await db.exec('RESET ROLE');
      assert.equal((await db.query('SELECT nalog_id FROM public.radni_nalozi_stavke WHERE id = $1', [pending])).rows[0].nalog_id, null);
      assert.equal((await db.query('SELECT preneseno FROM public.radni_nalozi_stavke WHERE id = $1', [source])).rows[0].preneseno, false);
      assert.equal((await db.query('SELECT id FROM public.radni_nalozi_stavke WHERE id IN ($1,$2)', [copy, completed])).rows.length, 0);
      assert.equal((await db.query('SELECT id FROM public.gradiliste_zadaci WHERE nalog_id = $1', [order])).rows.length, 0);
      await restore(deletion);
      for (const table of tables) assert.deepEqual(await rows(table), before.get(table), `Exact standalone order undo: ${table}`);
      for (const original of auditBefore) assert.deepEqual((await db.query('SELECT * FROM public.mobile_work_order_audit WHERE id = $1', [original.id])).rows[0], original);
      await assert.rejects(restore(deletion), /već vraćeno/);

      // Both deleting and restoring require every module, even with access to the order itself.
      await db.exec(`
        INSERT INTO public.app_user_permissions(user_id, module, can_view, can_edit)
          SELECT '00000000-0000-0000-0000-000000000006', module, true, true
          FROM unnest(ARRAY['radni_nalozi','raspored','radno_vrijeme']) module;
        SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',false);
        SET ROLE authenticated;
      `);
      await assert.rejects(remove(), (reason) => reason.code === '42501');
      await db.exec('RESET ROLE');
      for (const table of tables) assert.deepEqual(await rows(table), before.get(table), `Denied deletion leaves no item-release side effects: ${table}`);
      await db.exec(`SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false)`);
      const missing = await remove();
      await db.exec(`SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',false); SET ROLE authenticated`);
      assert.equal((await db.query("SELECT * FROM public.get_resource_deletions('radni_nalozi')")).rows.find((row) => row.id === missing).can_restore, false);
      await assert.rejects(restore(missing), (reason) => reason.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false)`);
      await db.query('DELETE FROM storage.objects WHERE name = $1', [paths[2]]);
      const absent = new Map();
      for (const table of tables) absent.set(table, await rows(table));
      await assert.rejects(restore(missing), /Nedostaje prilog/);
      for (const table of tables) assert.deepEqual(await rows(table), absent.get(table), `Missing order thumbnail rollback: ${table}`);
      await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('nalozi-foto',$1)", [paths[2]]);
      await restore(missing);

      // Site cascades remain supported and do not release items outside the deleted site.
      const siteDeletion = (await db.query("SELECT public.delete_resource_with_history('gradilista',$1) id", [site])).rows[0].id;
      await restore(siteDeletion);
      for (const table of tables) assert.deepEqual(await rows(table), before.get(table), `Site deletion still works with the order guard: ${table}`);

      const noSiteOrder = '00000000-0000-0000-0000-000000000097';
      await db.exec(`
        INSERT INTO public.radni_nalozi(id, company_id, naslov, broj, status)
          VALUES ('${noSiteOrder}', '${company}', 'Nalog Ostalo bez gradilista', 'OSTALO-TEST', 'otvoren');
        INSERT INTO public.gradiliste_zadaci(company_id, nalog_id, naziv, gotovo)
          VALUES ('${company}', '${noSiteOrder}', 'Samo na nalogu', false);
      `);
      const noSiteBefore = await rows('gradiliste_zadaci');
      const noSiteDeletion = (await db.query("SELECT public.delete_resource_with_history('radni_nalozi',$1) id", [noSiteOrder])).rows[0].id;
      assert.equal((await db.query('SELECT id FROM public.gradiliste_zadaci WHERE nalog_id = $1', [noSiteOrder])).rows.length, 0);
      await restore(noSiteDeletion);
      assert.deepEqual(await rows('gradiliste_zadaci'), noSiteBefore, 'Order without a site restores trigger-deleted tasks');

      const changed = await remove();
      await db.query("UPDATE public.radni_nalozi_stavke SET naziv = 'Netko je preuzeo izvor' WHERE id = $1", [source]);
      await assert.rejects(restore(changed), (reason) => reason.code === '40001');
      assert.equal((await db.query('SELECT id FROM public.radni_nalozi WHERE id = $1', [order])).rows.length, 0);
      await db.query("UPDATE public.radni_nalozi_stavke SET naziv = 'Izvor s prethodnog naloga' WHERE id = $1", [source]);
      await assert.rejects(restore(changed), (reason) => reason.code === '40001');
      await db.exec(`
        UPDATE public.app_profiles SET company_id = '00000000-0000-0000-0000-000000000005'
          WHERE id = '00000000-0000-0000-0000-000000000006';
        SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',false);
        SET ROLE authenticated;
      `);
      assert.equal((await db.query("SELECT * FROM public.get_resource_deletions('radni_nalozi')")).rows.length, 0);
      await assert.rejects(restore(changed), (reason) => reason.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false)`);
    });
    await t.test('individual task deletion restores all deadlines atomically, respects parents, revisions and current permissions', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const actor = '00000000-0000-0000-0000-000000000002';
      const other = '00000000-0000-0000-0000-000000000006';
      const site = '00000000-0000-0000-0000-000000000101';
      const order = '00000000-0000-0000-0000-000000000102';
      const task = '00000000-0000-0000-0000-000000000103';
      const noSiteTask = '00000000-0000-0000-0000-000000000106';
      await db.exec(`
        ALTER TABLE public.gradiliste_zadaci ADD COLUMN rok date, ADD COLUMN gotovo_at timestamptz,
          ADD COLUMN vrsta text DEFAULT 'zadatak', ADD COLUMN created_at timestamptz DEFAULT now();
        ALTER TABLE public.rokovi ADD COLUMN naziv text, ADD COLUMN status text DEFAULT 'otvoren',
          ADD COLUMN opis text, ADD COLUMN created_at timestamptz DEFAULT now();
        CREATE TABLE public.kooperanti(id uuid PRIMARY KEY, company_id uuid, naziv text);
      `);
      await db.exec(sqlFile('migrations/20261107160000_rokovi_period.sql'));
      await db.exec(sqlFile('migrations/20261107170000_gradiliste_zadaci_kooperant.sql'));
      await db.exec(sqlFile('migrations/20261107180000_rokovi_kooperant.sql'));
      await db.exec(sqlFile('migrations/20261110010000_zadaci_povrat_brisanja.sql'));
      await db.exec(`
        INSERT INTO public.gradilista(id, company_id, naziv) VALUES ('${site}', '${company}', 'Zadaci za povrat');
        INSERT INTO public.radni_nalozi(id, company_id, gradiliste_id, naslov, status)
          VALUES ('${order}', '${company}', '${site}', 'Nalog za pojedinacne zadatke', 'zavrsen');
        INSERT INTO public.kooperanti VALUES ('00000000-0000-0000-0000-000000000107', '${company}', 'Izvodjac'),
          ('00000000-0000-0000-0000-000000000108', '${company}', 'Drugi izvodjac');
        INSERT INTO public.gradiliste_zadaci(id, company_id, gradiliste_id, nalog_id, naziv, gotovo, gotovo_at, rok, vrsta, kooperant_id)
          VALUES ('${task}', '${company}', '${site}', '${order}', 'Dovrseni dodatni rad', true,
            '2026-11-04T10:15:00Z', '2026-11-06', 'dodatni', '00000000-0000-0000-0000-000000000107'),
            ('${noSiteTask}', '${company}', NULL, '${order}', 'Zadatak samo na nalogu', false, NULL, NULL, 'zadatak', NULL);
        INSERT INTO public.rokovi(id, company_id, gradiliste_id, nalog_id, zadatak_id, naziv, datum, datum_pocetka, datum_zavrsetka, status, opis, kooperant_id)
          VALUES ('00000000-0000-0000-0000-000000000104', '${company}', '${site}', '${order}', '${task}',
            'Prvi rok zadatka', '2026-11-06', '2026-11-04', '2026-11-06', 'zavrsen', 'Povijesni opis', '00000000-0000-0000-0000-000000000107'),
            ('00000000-0000-0000-0000-000000000105', '${company}', '${site}', NULL, '${task}',
            'Drugi rok zadatka', '2026-11-08', '2026-11-07', '2026-11-08', 'otvoren', NULL, '00000000-0000-0000-0000-000000000108');
      `);
      const rows = async (table) => (await db.query(`SELECT to_jsonb(r) snapshot FROM public.${table} r ORDER BY id`)).rows.map((r) => r.snapshot);
      const remove = async (id = task) => (await db.query("SELECT public.delete_resource_with_history('gradiliste_zadaci', $1) id", [id])).rows[0].id;
      const restore = (id) => db.query('SELECT public.restore_resource_deletion($1)', [id]);
      const history = async () => (await db.query('SELECT * FROM public.get_task_deletions()')).rows;
      const tables = ['gradiliste_zadaci', 'rokovi', 'radni_nalozi', 'gradilista'];
      const before = new Map();
      for (const table of tables) before.set(table, await rows(table));
      await assert.rejects(db.query('DELETE FROM public.gradiliste_zadaci WHERE id = $1', [task]), (e) => e.code === '42501');
      const deleted = await remove();
      assert.equal((await db.query('SELECT id FROM public.rokovi WHERE zadatak_id = $1', [task])).rows.length, 0);
      const item = (await history()).find((r) => r.id === deleted);
      assert.deepEqual(item.affected_rows, { gradiliste_zadaci: 1, rokovi: 2 });
      assert.equal(item.snapshot.vrsta, 'dodatni');
      assert.equal(item.can_restore, true);
      assert.ok(!(await db.query("SELECT * FROM public.get_resource_deletions('gradilista')")).rows.some((r) => r.id === deleted),
        'Task deletion never appears as deletion of a whole site');
      await restore(deleted);
      for (const table of tables) assert.deepEqual(await rows(table), before.get(table), `Exact task/period/cooperator/assignment restore: ${table}`);
      await assert.rejects(restore(deleted), /već vraćeno/);

      const missingParent = await remove();
      const deletedSite = (await db.query("SELECT public.delete_resource_with_history('gradilista', $1) id", [site])).rows[0].id;
      await assert.rejects(restore(missingParent), (e) => e.code === '23503');
      assert.equal((await db.query('SELECT id FROM public.gradiliste_zadaci WHERE id = $1', [task])).rows.length, 0);
      await restore(deletedSite);
      await restore(missingParent);
      for (const table of tables) assert.deepEqual(await rows(table), before.get(table), `Restore parent package before the earlier task: ${table}`);

      const missingCooperator = await remove();
      await db.exec("DELETE FROM public.kooperanti WHERE id = '00000000-0000-0000-0000-000000000108'");
      await assert.rejects(restore(missingCooperator), (e) => e.code === '23503');
      assert.equal((await db.query('SELECT id FROM public.gradiliste_zadaci WHERE id = $1', [task])).rows.length, 0,
        'A missing dependency of the second deadline rolls back even the restored task');
      assert.equal((await db.query('SELECT id FROM public.rokovi WHERE zadatak_id = $1', [task])).rows.length, 0);
      await db.exec(`INSERT INTO public.kooperanti VALUES ('00000000-0000-0000-0000-000000000108', '${company}', 'Drugi izvodjac')`);
      await restore(missingCooperator);

      const restricted = await remove();
      await db.exec(`
        UPDATE public.app_profiles SET company_id = '${company}' WHERE id = '${other}';
        UPDATE public.app_user_permissions SET can_edit = false WHERE user_id = '${other}' AND module = 'gradilista';
        SELECT set_config('request.jwt.claim.sub', '${other}', false);
        SET ROLE authenticated;
      `);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(restricted), (e) => e.code === '42501');
      await assert.rejects(remove(noSiteTask), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit = true WHERE user_id = '${other}' AND module = 'gradilista'; SET ROLE authenticated;`);
      assert.equal((await history()).find((r) => r.id === restricted).can_restore, true);
      await restore(restricted);
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${actor}', false)`);

      const expired = await remove(noSiteTask);
      await db.query("UPDATE private.resource_deletions SET expires_at = now() - interval '1 second' WHERE id = $1", [expired]);
      assert.ok(!(await history()).some((r) => r.id === expired));
      await assert.rejects(restore(expired), /30 dana/);
      await db.query("UPDATE private.resource_deletions SET expires_at = now() + interval '30 days' WHERE id = $1", [expired]);
      await restore(expired);
      assert.deepEqual(await rows('gradiliste_zadaci'), before.get('gradiliste_zadaci'), 'Tasks without sites keep their order and original state');

      const conflict = await remove();
      await db.query(`INSERT INTO public.gradiliste_zadaci SELECT * FROM jsonb_populate_record(NULL::public.gradiliste_zadaci, $1)`,
        [before.get('gradiliste_zadaci').find((r) => r.id === task)]);
      // Restoring byte-identical data under the same ID does not erase the intervening revision.
      await assert.rejects(restore(conflict), (e) => e.code === '40001');
      assert.equal((await db.query('SELECT id FROM public.rokovi WHERE zadatak_id = $1', [task])).rows.length, 0, 'Conflict rolls back all deadline inserts');

      const second = await remove(noSiteTask);
      await db.query("UPDATE private.resource_deletions SET created_at = '2026-11-04T12:00:00Z' WHERE id IN ($1, $2)", [conflict, second]);
      const page = await history();
      const tied = page.filter((r) => [conflict, second].includes(r.id));
      const older = (await db.query('SELECT * FROM public.get_task_deletions($1, $2)', [tied[0].created_at, tied[0].id])).rows;
      assert.ok(older.some((r) => r.id === tied[1].id));
      assert.ok(!older.some((r) => r.id === tied[0].id), 'Timestamp ties paginate by operation ID');
      await assert.rejects(db.query('SELECT * FROM public.get_task_deletions(now(), NULL)'), (e) => e.code === '22023');
      const generated = (await db.query(`INSERT INTO public.gradiliste_zadaci(company_id, gradiliste_id, nalog_id, naziv, gotovo)
        SELECT $1, $2, $3, 'Stranica ' || n, false FROM generate_series(1, 51) n RETURNING id`, [company, site, order])).rows;
      const generatedOperations = new Set();
      for (const row of generated) generatedOperations.add(await remove(row.id));
      const firstPage = await history();
      assert.equal(firstPage.length, 50, 'The SQL endpoint returns the required 50-row page');
      const seen = new Set(firstPage.map((r) => r.id));
      let next = firstPage;
      while (next.length === 50) {
        const last = next.at(-1);
        next = (await db.query('SELECT * FROM public.get_task_deletions($1, $2)', [last.created_at, last.id])).rows;
        for (const row of next) {
          assert.ok(!seen.has(row.id), 'No repeated operations between pages');
          seen.add(row.id);
        }
      }
      assert.equal([...generatedOperations].filter((id) => seen.has(id)).length, 51, 'No deleted task is lost across pages');
      await db.exec(`
        UPDATE public.app_profiles SET company_id = '00000000-0000-0000-0000-000000000005' WHERE id = '${other}';
        SELECT set_config('request.jwt.claim.sub', '${other}', false);
        SET ROLE authenticated;
      `);
      assert.equal((await history()).length, 0);
      await assert.rejects(restore(second), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${actor}', false)`);
    });
    await t.test('individual deadline recovery preserves periods and rejects task changes and regenerated deadlines', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const actor = '00000000-0000-0000-0000-000000000002';
      const other = '00000000-0000-0000-0000-000000000006';
      const site = '00000000-0000-0000-0000-000000000201';
      const order = '00000000-0000-0000-0000-000000000202';
      const task = '00000000-0000-0000-0000-000000000203';
      const manual = '00000000-0000-0000-0000-000000000204';
      const linked = '00000000-0000-0000-0000-000000000205';
      await db.exec(sqlFile('migrations/20261110020000_rokovi_povrat_brisanja.sql'));
      await db.exec(`
        INSERT INTO public.gradilista(id, company_id, naziv) VALUES ('${site}', '${company}', 'Rokovi za povrat');
        INSERT INTO public.radni_nalozi(id, company_id, gradiliste_id, naslov, status)
          VALUES ('${order}', '${company}', '${site}', 'Nalog rokova', 'otvoren');
        INSERT INTO public.gradiliste_zadaci(id, company_id, gradiliste_id, nalog_id, naziv, gotovo, rok, vrsta)
          VALUES ('${task}', '${company}', '${site}', '${order}', 'Dodatni rad s rokom', true, '2026-11-09', 'dodatni');
        INSERT INTO public.rokovi(id, company_id, gradiliste_id, nalog_id, zadatak_id, naziv, datum, datum_pocetka, datum_zavrsetka, status, opis, kooperant_id)
          VALUES ('${manual}', '${company}', '${site}', '${order}', NULL, 'Rucni termin',
            '2026-11-09', '2026-11-04', '2026-11-09', 'otvoren', 'Izvorni opis', '00000000-0000-0000-0000-000000000107'),
            ('${linked}', '${company}', '${site}', NULL, '${task}', 'Povijesni rok zadatka',
            '2026-11-09', '2026-11-07', '2026-11-09', 'zavrsen', 'Povijesni opis', NULL);
      `);
      const snapshot = async (id) => (await db.query('SELECT to_jsonb(r) data FROM public.rokovi r WHERE id = $1', [id])).rows[0]?.data;
      const before = await snapshot(manual);
      const beforeLinked = await snapshot(linked);
      const remove = async (id) => (await db.query("SELECT public.delete_resource_with_history('rokovi', $1) id", [id])).rows[0].id;
      const restore = (id) => db.query('SELECT public.restore_resource_deletion($1)', [id]);
      const history = async () => (await db.query('SELECT * FROM public.get_deadline_deletions()')).rows;
      const sync = () => db.query('SELECT public.sync_task_deadline($1)', [task]);
      await assert.rejects(db.query('DELETE FROM public.rokovi WHERE id = $1', [manual]), (e) => e.code === '42501');
      await assert.rejects(db.query('DELETE FROM public.rokovi WHERE id = $1', [linked]), (e) => e.code === '42501');
      const deleted = await remove(manual);
      assert.equal(await snapshot(manual), undefined);
      const item = (await history()).find((r) => r.id === deleted);
      assert.deepEqual(item.affected_rows, { rokovi: 1 });
      assert.deepEqual(item.snapshot, before);
      assert.ok(!(await db.query("SELECT * FROM public.get_resource_deletions('gradilista')")).rows.some((r) => r.id === deleted));
      assert.ok(!(await db.query('SELECT * FROM public.get_task_deletions()')).rows.some((r) => r.id === deleted));
      await restore(deleted);
      assert.deepEqual(await snapshot(manual), before);
      await assert.rejects(restore(deleted), /već vraćeno/);

      const deletedLinked = await remove(linked);
      await restore(deletedLinked);
      assert.deepEqual(await snapshot(linked), beforeLinked, 'Linked deadline restores original period, not the current task single-day projection');
      assert.equal((await db.query('SELECT count(*)::int count FROM public.rokovi WHERE zadatak_id = $1', [task])).rows[0].count, 1);
      const stale = await remove(linked);
      await sync();
      const replacement = (await db.query('SELECT * FROM public.rokovi WHERE zadatak_id = $1', [task])).rows;
      assert.equal(replacement.length, 1);
      assert.equal(replacement[0].naziv, 'Dodatni rad s rokom');
      assert.equal(replacement[0].opis, 'Dodatni rad');
      assert.equal(replacement[0].status, 'zavrsen');
      await assert.rejects(restore(stale), (e) => e.code === '40001');
      assert.equal(await snapshot(linked), undefined, 'Regeneration blocks an obsolete deadline without creating duplicates');
      await sync();
      assert.equal((await db.query('SELECT count(*)::int count FROM public.rokovi WHERE zadatak_id = $1', [task])).rows[0].count, 1,
        'Repeated synchronization updates the existing deadline');
      const replacementId = replacement[0].id;
      await remove(replacementId);
      await assert.rejects(restore(stale), (e) => e.code === '40001', 'Deleting the replacement does not erase its generation revision');
      await db.query("UPDATE public.gradiliste_zadaci SET rok = NULL WHERE id = $1", [task]);
      await sync();
      assert.equal((await db.query('SELECT count(*)::int count FROM public.rokovi WHERE zadatak_id = $1', [task])).rows[0].count, 0);
      await db.query("UPDATE public.gradiliste_zadaci SET rok = '2026-11-09' WHERE id = $1", [task]);
      await sync();
      const regeneratedId = (await db.query('SELECT id FROM public.rokovi WHERE zadatak_id = $1', [task])).rows[0].id;
      const changedTask = await remove(regeneratedId);
      await db.query("UPDATE public.gradiliste_zadaci SET naziv = 'Izmjena' WHERE id = $1", [task]);
      await db.query("UPDATE public.gradiliste_zadaci SET naziv = 'Dodatni rad s rokom' WHERE id = $1", [task]);
      await assert.rejects(restore(changedTask), (e) => e.code === '40001', 'Task ABA is rejected even with no replacement deadline');

      // Automatic synchronization removal remains transactional but is not advertised as a manual deletion.
      await sync();
      const historyCount = (await history()).length;
      await db.query('UPDATE public.gradiliste_zadaci SET rok = NULL WHERE id = $1', [task]);
      await sync();
      assert.equal((await history()).length, historyCount);
      assert.equal((await db.query('SELECT count(*)::int count FROM private.deadline_sync_context')).rows[0].count, 0);
      await db.query("UPDATE public.gradiliste_zadaci SET rok = '2026-11-09' WHERE id = $1", [task]);
      await sync();
      const beforeFailedSync = (await db.query('SELECT to_jsonb(r) data FROM public.rokovi r WHERE zadatak_id = $1 ORDER BY id', [task])).rows;
      await db.exec(`
        CREATE FUNCTION public.reject_test_deadline_change() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Test odbijene sinkronizacije'; END; $$;
        CREATE TRIGGER reject_test_deadline_change AFTER DELETE ON public.rokovi
          FOR EACH ROW EXECUTE FUNCTION public.reject_test_deadline_change();
      `);
      await db.query('UPDATE public.gradiliste_zadaci SET rok = NULL WHERE id = $1', [task]);
      await assert.rejects(sync(), /Test odbijene sinkronizacije/);
      assert.deepEqual((await db.query('SELECT to_jsonb(r) data FROM public.rokovi r WHERE zadatak_id = $1 ORDER BY id', [task])).rows, beforeFailedSync,
        'Failed synchronization rolls back deletion and internal marker');
      assert.equal((await db.query('SELECT count(*)::int count FROM private.deadline_sync_context')).rows[0].count, 0);
      await db.exec('DROP TRIGGER reject_test_deadline_change ON public.rokovi; DROP FUNCTION public.reject_test_deadline_change()');
      await db.query("UPDATE public.gradiliste_zadaci SET rok = '2026-11-09' WHERE id = $1", [task]);
      const taskBefore = (await db.query('SELECT to_jsonb(z) data FROM public.gradiliste_zadaci z WHERE id=$1', [task])).rows[0].data;
      const allBefore = (await db.query('SELECT to_jsonb(r) data FROM public.rokovi r WHERE gradiliste_id = $1 ORDER BY id', [site])).rows;
      const taskDeletion = (await db.query("SELECT public.delete_resource_with_history('gradiliste_zadaci', $1) id", [task])).rows[0].id;
      await restore(taskDeletion);
      assert.deepEqual((await db.query('SELECT to_jsonb(z) data FROM public.gradiliste_zadaci z WHERE id=$1', [task])).rows[0].data, taskBefore);
      assert.deepEqual((await db.query('SELECT to_jsonb(r) data FROM public.rokovi r WHERE gradiliste_id = $1 ORDER BY id', [site])).rows, allBefore);
      const siteDeletion = (await db.query("SELECT public.delete_resource_with_history('gradilista', $1) id", [site])).rows[0].id;
      await restore(siteDeletion);
      assert.deepEqual((await db.query('SELECT to_jsonb(r) data FROM public.rokovi r WHERE gradiliste_id = $1 ORDER BY id', [site])).rows, allBefore,
        'New deadline guards preserve whole-site cascade recovery');

      const missingParent = await remove(manual);
      const parent = (await db.query("SELECT public.delete_resource_with_history('radni_nalozi', $1) id", [order])).rows[0].id;
      await assert.rejects(restore(missingParent), (e) => e.code === '23503');
      await restore(parent);
      await restore(missingParent);
      assert.deepEqual(await snapshot(manual), before);
      const expired = await remove(manual);
      await db.query("UPDATE private.resource_deletions SET expires_at = now() - interval '1 second' WHERE id = $1", [expired]);
      assert.ok(!(await history()).some((r) => r.id === expired));
      await assert.rejects(restore(expired), /30 dana/);
      await db.query("UPDATE private.resource_deletions SET expires_at = now() + interval '30 days' WHERE id = $1", [expired]);

      await db.exec(`
        UPDATE public.app_profiles SET company_id = '${company}' WHERE id = '${other}';
        UPDATE public.app_user_permissions SET can_edit = false WHERE user_id = '${other}' AND module = 'gradilista';
        SELECT set_config('request.jwt.claim.sub', '${other}', false); SET ROLE authenticated;
      `);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(expired), (e) => e.code === '42501');
      await assert.rejects(sync(), (e) => e.code === '42501');
      await assert.rejects(db.query('SELECT * FROM private.deadline_deletion_tasks'), (e) => e.code === '42501');
      await assert.rejects(db.query('INSERT INTO private.deadline_sync_context VALUES (txid_current(), $1)', [task]), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit = true WHERE user_id = '${other}' AND module = 'gradilista'; SET ROLE authenticated;`);
      await restore(expired);
      await sync();
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${actor}', false)`);
      const generated = (await db.query(`INSERT INTO public.rokovi(company_id, gradiliste_id, naziv, datum, datum_pocetka, datum_zavrsetka)
        SELECT $1, $2, 'Rok ' || n, '2026-11-09'::date, '2026-11-08'::date, '2026-11-09'::date
        FROM generate_series(1, 51) n RETURNING id`, [company, site])).rows;
      for (const row of generated) await remove(row.id);
      const page = await history();
      assert.equal(page.length, 50);
      const cursor = page.at(-1);
      const next = (await db.query('SELECT * FROM public.get_deadline_deletions($1, $2)', [cursor.created_at, cursor.id])).rows;
      assert.ok(next.length > 0);
      assert.ok(next.every((r) => !page.some((first) => first.id === r.id)));
      await assert.rejects(db.query('SELECT * FROM public.get_deadline_deletions(now(), NULL)'), (e) => e.code === '22023');
      await db.exec(`
        UPDATE public.app_profiles SET company_id = '00000000-0000-0000-0000-000000000005' WHERE id = '${other}';
        SELECT set_config('request.jwt.claim.sub', '${other}', false); SET ROLE authenticated;
      `);
      assert.equal((await history()).length, 0);
      await assert.rejects(remove(manual), (e) => e.code === '42501');
      await assert.rejects(sync(), (e) => e.code === '42501');
      await assert.rejects(restore(stale), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${actor}', false)`);
      assert.equal((await db.query('SELECT count(*)::int count FROM private.deadline_deletion_tasks WHERE deletion_id = $1', [changedTask])).rows[0].count, 1);
      await db.query('DELETE FROM private.resource_deletions WHERE id = $1', [changedTask]);
      assert.equal((await db.query('SELECT count(*)::int count FROM private.deadline_deletion_tasks WHERE deletion_id = $1', [changedTask])).rows[0].count, 0,
        'Removing expired package payload also removes its private dependency snapshot');
    });
    await t.test('manual deadline updates support multi-step undo while task-maintained changes and stale states are blocked', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const actor = '00000000-0000-0000-0000-000000000002';
      const other = '00000000-0000-0000-0000-000000000006';
      const firstSite = '00000000-0000-0000-0000-000000000301';
      const secondSite = '00000000-0000-0000-0000-000000000302';
      const firstCooperator = '00000000-0000-0000-0000-000000000303';
      const secondCooperator = '00000000-0000-0000-0000-000000000304';
      const order = '00000000-0000-0000-0000-000000000305';
      const deadline = '00000000-0000-0000-0000-000000000306';
      const task = '00000000-0000-0000-0000-000000000307';
      await db.exec(sqlFile('migrations/20261110030000_rokovi_povijest_izmjena.sql'));
      await db.exec(`
        INSERT INTO public.gradilista(id, company_id, naziv) VALUES ('${firstSite}', '${company}', 'Prvo'), ('${secondSite}', '${company}', 'Drugo');
        INSERT INTO public.kooperanti VALUES ('${firstCooperator}', '${company}', 'Prvi'), ('${secondCooperator}', '${company}', 'Drugi');
        INSERT INTO public.radni_nalozi(id, company_id, gradiliste_id, naslov) VALUES ('${order}', '${company}', '${secondSite}', 'Nalog roka');
        INSERT INTO public.rokovi(id, company_id, gradiliste_id, naziv, datum, datum_pocetka, datum_zavrsetka, status, opis, kooperant_id)
          VALUES ('${deadline}', '${company}', '${firstSite}', 'Izvorni rok', '2026-11-09', '2026-11-04', '2026-11-09', 'otvoren', 'Izvorno', '${firstCooperator}');
        INSERT INTO public.gradiliste_zadaci(id, company_id, gradiliste_id, naziv, gotovo, rok, vrsta)
          VALUES ('${task}', '${company}', '${secondSite}', 'Zadatak za rok', false, '2026-11-09', 'zadatak');
      `);
      const snapshot = async () => (await db.query('SELECT to_jsonb(r) data FROM public.rokovi r WHERE id=$1', [deadline])).rows[0]?.data;
      const history = async (before = null) => (await db.query('SELECT * FROM public.get_deadline_change_history($1, $2)', [deadline, before])).rows;
      const restore = (id) => db.query('SELECT public.restore_deadline_change($1)', [id]);
      const original = await snapshot();
      assert.equal((await history()).length, 0, 'Initial creation is not presented as an update undo');
      await db.query(`UPDATE public.rokovi SET naziv='Promijenjeni rok', datum='2026-11-12', datum_pocetka='2026-11-10',
        datum_zavrsetka='2026-11-12', opis='Novi opis', status='prekoracen', gradiliste_id=$2, nalog_id=$3, kooperant_id=$4 WHERE id=$1`,
      [deadline, secondSite, order, secondCooperator]);
      const changed = await snapshot();
      const first = (await history())[0];
      assert.equal(first.can_restore, true);
      assert.equal(typeof first.sequence, 'string');
      assert.deepEqual(first.before_data, original);
      assert.deepEqual(first.after_data, changed);
      await db.query("UPDATE public.rokovi SET status='zavrsen' WHERE id=$1", [deadline]);
      const second = (await history())[0];
      assert.equal((await history()).find((r) => r.id === first.id).can_restore, false);
      await assert.rejects(restore(first.id), (e) => e.code === '40001');
      await restore(second.id);
      assert.deepEqual(await snapshot(), changed);
      assert.equal((await history()).find((r) => r.id === first.id).can_restore, true);
      await assert.rejects(restore(second.id), /već vraćena/);
      await assert.rejects(restore((await history()).find((r) => r.reverses_id === second.id).id), /već vraćena/);

      await db.query('DELETE FROM public.kooperanti WHERE id=$1', [firstCooperator]);
      await assert.rejects(restore(first.id), (e) => e.code === '23503');
      assert.deepEqual(await snapshot(), changed, 'Missing old cooperator rolls back the complete date/status/site/link undo');
      await db.query('INSERT INTO public.kooperanti VALUES ($1,$2,$3)', [firstCooperator, company, 'Prvi']);
      const parent = (await db.query("SELECT public.delete_resource_with_history('gradilista',$1) id", [firstSite])).rows[0].id;
      await assert.rejects(restore(first.id), (e) => e.code === '23503');
      await db.query('SELECT public.restore_resource_deletion($1)', [parent]);
      await db.exec(`CREATE FUNCTION public.test_deadline_undo_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.naziv='Izvorni rok' THEN RETURN NULL; END IF; RETURN NEW; END; $$;
        CREATE TRIGGER test_deadline_undo_guard BEFORE UPDATE ON public.rokovi FOR EACH ROW EXECUTE FUNCTION public.test_deadline_undo_guard();`);
      await assert.rejects(restore(first.id), /točno vraćanje/);
      assert.deepEqual(await snapshot(), changed, 'A trigger swallowing the update cannot produce success');
      await db.exec('DROP TRIGGER test_deadline_undo_guard ON public.rokovi; DROP FUNCTION public.test_deadline_undo_guard()');
      await restore(first.id);
      assert.deepEqual(await snapshot(), original, 'All supported fields are restored exactly');

      await db.query("UPDATE public.rokovi SET opis='Za povrat nakon brisanja' WHERE id=$1", [deadline]);
      const beforeDeletion = (await history())[0];
      const deletion = (await db.query("SELECT public.delete_resource_with_history('rokovi',$1) id", [deadline])).rows[0].id;
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(beforeDeletion.id), /obrisan/);
      await db.query('SELECT public.restore_resource_deletion($1)', [deletion]);
      assert.equal((await history()).find((r) => r.id === beforeDeletion.id).can_restore, true,
        'Protected deletion recovery marks its journal events and preserves the earlier update lineage');
      await restore(beforeDeletion.id);
      assert.deepEqual(await snapshot(), original);

      await db.query("UPDATE public.rokovi SET created_at=created_at + interval '1 second', naziv='Nepodrzano' WHERE id=$1", [deadline]);
      const restricted = (await history())[0];
      assert.equal(restricted.can_restore, false);
      await assert.rejects(restore(restricted.id), /nepodržana polja/);
      await db.query('SELECT public.sync_task_deadline($1)', [task]);
      const linked = (await db.query('SELECT id FROM public.rokovi WHERE zadatak_id=$1', [task])).rows[0].id;
      await db.query("UPDATE public.rokovi SET opis='Rucna izmjena povezanog roka' WHERE id=$1", [linked]);
      const linkedHistory = (await db.query('SELECT * FROM public.get_deadline_change_history($1)', [linked])).rows;
      assert.equal(linkedHistory[0].can_restore, false);
      await assert.rejects(restore(linkedHistory[0].id), /povezani zadatak/);
      await db.query('UPDATE public.rokovi SET zadatak_id=NULL WHERE id=$1', [linked]);
      const detached = (await db.query('SELECT * FROM public.get_deadline_change_history($1)', [linked])).rows[0];
      assert.equal(detached.can_restore, false, 'Detaching a task does not turn its old journal into manual undo');
      await assert.rejects(restore(detached.id), /povezani zadatak/);

      for (let n = 0; n < 52; n++) await db.query('UPDATE public.rokovi SET opis=$2 WHERE id=$1', [deadline, `Opis ${n}`]);
      const page = await history();
      assert.equal(page.length, 50);
      const next = await history(page.at(-1).sequence);
      assert.ok(next.length > 0);
      assert.ok(next.every((r) => !page.some((firstRow) => firstRow.id === r.id)));
      const newest = page[0];
      await db.query("UPDATE private.business_change_history SET expires_at=now()-interval '1 second' WHERE id=$1", [newest.id]);
      await assert.rejects(restore(newest.id), /30 dana/);
      assert.ok(!(await history()).some((r) => r.id === newest.id));
      await db.query("UPDATE private.business_change_history SET expires_at=now()+interval '30 days' WHERE id=$1", [newest.id]);
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}' WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}' AND module='gradilista';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;`);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(newest.id), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='gradilista'; SET ROLE authenticated;`);
      await restore(newest.id);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='00000000-0000-0000-0000-000000000005' WHERE id='${other}'; SET ROLE authenticated;`);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(page[1].id), (e) => e.code === '42501');
      await assert.rejects(db.query('SELECT * FROM private.business_change_history'), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false)`);
    });
    await t.test('individual work-time deletion restores exact hours and rejects changed or regenerated order inputs atomically', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const actor = '00000000-0000-0000-0000-000000000002';
      const other = '00000000-0000-0000-0000-000000000006';
      const worker = '00000000-0000-0000-0000-000000000401';
      const site = '00000000-0000-0000-0000-000000000402';
      const order = '00000000-0000-0000-0000-000000000403';
      await db.exec(`
        SELECT set_config('request.jwt.claim.sub', '${actor}', false);
        ALTER TABLE public.radno_vrijeme ADD COLUMN nocni_sati numeric(4,1) NOT NULL DEFAULT 0,
          ADD COLUMN napomena text, ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
        ALTER TABLE public.radno_vrijeme ALTER COLUMN sati TYPE numeric(4,1);
        ALTER TABLE public.radni_nalozi_radnici ADD COLUMN mobile_started_at timestamptz,
          ADD COLUMN mobile_finished_at timestamptz, ADD COLUMN mobile_reviewed_sections text[];
      `);
      await db.exec(sqlFile('migrations/20261110040000_radno_vrijeme_povrat_brisanja.sql'));
      await db.exec(`
        INSERT INTO public.radnici(id,company_id,ime,prezime,status,uloga) VALUES ('${worker}','${company}','Test','Sati','aktivan','Radnik');
        INSERT INTO public.gradilista(id,company_id,naziv) VALUES ('${site}','${company}','Gradiliste sati');
        INSERT INTO public.radni_nalozi(id,company_id,gradiliste_id,naslov,status) VALUES ('${order}','${company}','${site}','Sati naloga','zavrsen');
        INSERT INTO public.radni_nalozi_radnici(nalog_id,radnik_id,company_id,vrijeme_od,vrijeme_do)
          VALUES ('${order}','${worker}','${company}','08:00','16:00');
      `);
      const create = async (linked = false) => (await db.query(`
        INSERT INTO public.radno_vrijeme(company_id,radnik_id,gradiliste_id,nalog_id,datum,sati,nocni_sati,napomena,created_at)
          VALUES ($1,$2,$3,$4,'2026-11-09',7.5,2.5,'Izvorna napomena','2026-11-09T08:12:34Z') RETURNING id`,
      [company, worker, site, linked ? order : null])).rows[0].id;
      const remove = async (id) => (await db.query('SELECT public.delete_work_time_with_history($1) id', [id])).rows[0].id;
      const restore = (id) => db.query('SELECT public.restore_resource_deletion($1)', [id]);
      const history = async () => (await db.query('SELECT * FROM public.get_work_time_deletions()')).rows;
      const replace = (entries) => db.query('SELECT public.replace_work_order_hours($1,$2)', [order, JSON.stringify(entries)]);
      const snapshot = async (id) => (await db.query('SELECT to_jsonb(r) data FROM public.radno_vrijeme r WHERE id=$1', [id])).rows[0]?.data;
      const manual = await create();
      const original = await snapshot(manual);
      await db.exec('GRANT SELECT, DELETE ON public.radno_vrijeme TO authenticated; SET ROLE authenticated;');
      await assert.rejects(db.query('DELETE FROM public.radno_vrijeme WHERE id=$1', [manual]), /Zaštićeno brisanje ručnih sati/);
      await db.exec('RESET ROLE');
      const deletion = await remove(manual);
      assert.equal(await snapshot(manual), undefined);
      const entry = (await history()).find((r) => r.id === deletion);
      assert.deepEqual(entry.snapshot, original);
      assert.equal(entry.can_restore, true);
      assert.deepEqual(entry.affected_rows, { radno_vrijeme: 1 });
      assert.ok(!(await db.query("SELECT * FROM public.get_resource_deletions('radnici')")).rows.some((r) => r.id === deletion));
      await restore(deletion);
      assert.deepEqual(await snapshot(manual), original, 'Restores exact day/night hours, note, identities and timestamps');
      await assert.rejects(restore(deletion), /već vraćeno/);
      const driftDeletion = await remove(manual);
      await db.exec(`CREATE FUNCTION public.test_hours_drift() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN NEW.sati := NEW.sati + 1; RETURN NEW; END; $$;
        CREATE TRIGGER test_hours_drift BEFORE INSERT ON public.radno_vrijeme FOR EACH ROW EXECUTE FUNCTION public.test_hours_drift();`);
      await assert.rejects(restore(driftDeletion), /točan povrat/);
      assert.equal(await snapshot(manual), undefined);
      assert.equal((await db.query('SELECT reversed_at FROM private.resource_deletions WHERE id=$1', [driftDeletion])).rows[0].reversed_at, null);
      await db.exec('DROP TRIGGER test_hours_drift ON public.radno_vrijeme; DROP FUNCTION public.test_hours_drift();');
      await restore(driftDeletion);
      assert.deepEqual(await snapshot(manual), original);

      const linked = await create(true);
      const linkedBefore = await snapshot(linked);
      await restore(await remove(linked));
      assert.deepEqual(await snapshot(linked), linkedBefore);
      const stale = await remove(linked);
      await create(true); // Cost sync regenerates hours with another ID.
      assert.equal((await history()).find((r) => r.id === stale).can_restore, false);
      await assert.rejects(restore(stale), /Nalog, ekipa ili sati/);
      assert.equal(await snapshot(linked), undefined);
      assert.equal((await db.query('SELECT reversed_at FROM private.resource_deletions WHERE id=$1', [stale])).rows[0].reversed_at, null);
      await db.query('DELETE FROM public.radno_vrijeme WHERE nalog_id=$1', [order]);
      await assert.rejects(restore(stale), /Nalog, ekipa ili sati/, 'Removing regenerated hours does not erase the ABA conflict');

      for (const change of ['order', 'team', 'hours']) {
        const row = await create(true);
        const removed = await remove(row);
        if (change === 'order') {
          await db.query("UPDATE public.radni_nalozi SET naslov='Promijenjeno' WHERE id=$1", [order]);
          await db.query("UPDATE public.radni_nalozi SET naslov='Sati naloga' WHERE id=$1", [order]);
        } else if (change === 'team') {
          await db.query("UPDATE public.radni_nalozi_radnici SET vrijeme_do='17:00' WHERE nalog_id=$1", [order]);
          await db.query("UPDATE public.radni_nalozi_radnici SET vrijeme_do='16:00' WHERE nalog_id=$1", [order]);
        } else {
          const later = await create(true);
          await db.query('UPDATE public.radno_vrijeme SET sati=8 WHERE id=$1', [later]);
          await db.query('DELETE FROM public.radno_vrijeme WHERE id=$1', [later]);
        }
        await assert.rejects(restore(removed), /Nalog, ekipa ili sati/, `Rejects ${change} ABA`);
        assert.equal(await snapshot(row), undefined);
      }

      const output = {
        radnik_id: worker, gradiliste_id: site, nalog_id: order, datum: '2026-11-09',
        sati: 6.55, nocni_sati: 1.55, napomena: 'Novi obracun',
      };
      const replaceRow = await create(true);
      await restore(await remove(replaceRow));
      await replace([output]);
      assert.equal(await snapshot(replaceRow), undefined, 'Replacement after recovery removes the old row instead of duplicating hours');
      const orderRows = async () => (await db.query('SELECT to_jsonb(r) data FROM public.radno_vrijeme r WHERE nalog_id=$1 ORDER BY id', [order])).rows;
      const replaced = await orderRows();
      assert.equal(replaced.length, 1);
      assert.equal(replaced[0].data.sati, 6.6, 'Uses the real numeric column precision');
      assert.equal(replaced[0].data.nocni_sati, 1.6);
      const beforeReplacement = await remove(replaced[0].data.id);
      await replace([output]);
      await assert.rejects(restore(beforeReplacement), /Nalog, ekipa ili sati/);
      const afterReplacement = await orderRows();
      await assert.rejects(replace([output, output]), (e) => e.code === '22023');
      await assert.rejects(replace([{ ...output, nalog_id: site }]), (e) => e.code === '22023');
      await assert.rejects(replace([{ ...output, company_id: company }]), (e) => e.code === '22023');
      await assert.rejects(replace([{ ...output, radnik_id: '00000000-0000-0000-0000-000000000499' }]), (e) => e.code === '22023');
      await assert.rejects(replace([{ ...output, sati: 1, nocni_sati: 2 }]), (e) => e.code === '22023');
      await assert.rejects(replace(null), (e) => e.code === '22023');
      assert.deepEqual(await orderRows(), afterReplacement, 'Invalid replacement cannot clear old hours');
      await db.exec(`CREATE FUNCTION public.test_hours_drift() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN NEW.sati := NEW.sati + 1; RETURN NEW; END; $$;
        CREATE TRIGGER test_hours_drift BEFORE INSERT ON public.radno_vrijeme FOR EACH ROW EXECUTE FUNCTION public.test_hours_drift();`);
      await assert.rejects(replace([output]), /točnu zamjenu/);
      assert.deepEqual(await orderRows(), afterReplacement, 'Trigger drift rolls back the complete deletion and insertion');
      await db.exec('DROP TRIGGER test_hours_drift ON public.radno_vrijeme; DROP FUNCTION public.test_hours_drift();');
      const beforeEmptyReplacement = await remove(afterReplacement[0].data.id);
      await replace([]);
      await assert.rejects(restore(beforeEmptyReplacement), /Nalog, ekipa ili sati/, 'Even an empty recalculation invalidates the old undo');
      assert.equal((await orderRows()).length, 0);

      // These guards must not change existing whole-order and whole-worker recovery.
      const cascadeRow = await create(true);
      const cascadeBefore = await snapshot(cascadeRow);
      const parent = (await db.query("SELECT public.delete_resource_with_history('radni_nalozi',$1) id", [order])).rows[0].id;
      await restore(parent);
      assert.deepEqual(await snapshot(cascadeRow), cascadeBefore);
      const siteDeletion = (await db.query("SELECT public.delete_resource_with_history('gradilista',$1) id", [site])).rows[0].id;
      await restore(siteDeletion);
      assert.deepEqual(await snapshot(cascadeRow), cascadeBefore);
      const workerDeletion = (await db.query("SELECT public.delete_resource_with_history('radnici',$1) id", [worker])).rows[0].id;
      await restore(workerDeletion);
      assert.deepEqual(await snapshot(cascadeRow), cascadeBefore);

      const missingParent = await remove(manual);
      const deletedWorker = (await db.query("SELECT public.delete_resource_with_history('radnici',$1) id", [worker])).rows[0].id;
      await assert.rejects(restore(missingParent), (e) => e.code === '23503');
      await restore(deletedWorker);
      await restore(missingParent);
      assert.deepEqual(await snapshot(manual), original);

      const expired = await remove(manual);
      await db.query("UPDATE private.resource_deletions SET expires_at=now()-interval '1 second' WHERE id=$1", [expired]);
      assert.ok(!(await history()).some((r) => r.id === expired));
      await assert.rejects(restore(expired), /30 dana/);
      await db.query("UPDATE private.resource_deletions SET expires_at=now()+interval '30 days' WHERE id=$1", [expired]);
      await db.exec(`
        UPDATE public.app_profiles SET company_id='${company}' WHERE id='${other}';
        INSERT INTO public.app_user_permissions(user_id,module,can_view,can_edit) VALUES ('${other}','radno_vrijeme',true,false);
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}' AND module='radno_vrijeme';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;
      `);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(remove(cascadeRow), (e) => e.code === '42501');
      await assert.rejects(restore(expired), (e) => e.code === '42501');
      await assert.rejects(replace([output]), (e) => e.code === '42501');
      await assert.rejects(db.query('SELECT * FROM private.work_time_deletion_orders'), (e) => e.code === '42501');
      await assert.rejects(db.query('SELECT * FROM private.work_time_order_versions'), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='radno_vrijeme'; SET ROLE authenticated;`);
      await restore(expired);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='00000000-0000-0000-0000-000000000005' WHERE id='${other}'; SET ROLE authenticated;`);
      assert.equal((await history()).length, 0);
      await assert.rejects(remove(manual), (e) => e.code === '42501');
      await assert.rejects(restore(stale), (e) => e.code === '42501');
      await assert.rejects(replace([]), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false);`);

      for (let n = 0; n < 51; n++) await remove(await create());
      const firstPage = await history();
      assert.equal(firstPage.length, 50);
      const cursor = firstPage.at(-1);
      const secondPage = (await db.query('SELECT * FROM public.get_work_time_deletions($1,$2)', [cursor.created_at, cursor.id])).rows;
      assert.ok(secondPage.length > 0);
      assert.ok(secondPage.every((r) => !firstPage.some((first) => first.id === r.id)));
      await assert.rejects(db.query('SELECT * FROM public.get_work_time_deletions(now(),NULL)'), (e) => e.code === '22023');
      await db.query('DELETE FROM private.resource_deletions WHERE id=$1', [stale]);
      assert.equal((await db.query('SELECT count(*)::int count FROM private.work_time_deletion_orders WHERE deletion_id=$1', [stale])).rows[0].count, 0);
    });
    await t.test('manual work-time updates support exact multi-step undo, deletion lineage and fail-closed order/parent checks', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const actor = '00000000-0000-0000-0000-000000000002';
      const other = '00000000-0000-0000-0000-000000000006';
      const otherCompany = '00000000-0000-0000-0000-000000000005';
      const worker = '00000000-0000-0000-0000-000000000501';
      const nextWorker = '00000000-0000-0000-0000-000000000502';
      const site = '00000000-0000-0000-0000-000000000503';
      const nextSite = '00000000-0000-0000-0000-000000000504';
      const order = '00000000-0000-0000-0000-000000000505';
      const hours = '00000000-0000-0000-0000-000000000506';
      await db.exec(sqlFile('migrations/20261110050000_radno_vrijeme_povijest_izmjena.sql'));
      await db.exec(`
        SELECT set_config('request.jwt.claim.sub','${actor}',false);
        INSERT INTO public.radnici(id,company_id,ime,prezime,status,uloga) VALUES
          ('${worker}','${company}','Prvi','Radnik','aktivan','Radnik'),
          ('${nextWorker}','${company}','Drugi','Radnik','aktivan','Radnik');
        INSERT INTO public.gradilista(id,company_id,naziv) VALUES
          ('${site}','${company}','Prvo gradiliste'), ('${nextSite}','${company}','Drugo gradiliste');
        INSERT INTO public.radni_nalozi(id,company_id,gradiliste_id,naslov,status)
          VALUES ('${order}','${company}','${nextSite}','Nalog sati','zavrsen');
        INSERT INTO public.radno_vrijeme(id,company_id,radnik_id,gradiliste_id,datum,sati,nocni_sati,napomena,created_at)
          VALUES ('${hours}','${company}','${worker}','${site}','2026-11-09',7.5,2.5,'Izvorno','2026-11-09T08:12:34Z');
      `);
      const snapshot = async () => (await db.query('SELECT to_jsonb(r) data FROM public.radno_vrijeme r WHERE id=$1', [hours])).rows[0]?.data;
      const history = async (before = null) => (await db.query('SELECT * FROM public.get_work_time_change_history($1,$2)', [hours, before])).rows;
      const restore = (id) => db.query('SELECT public.restore_work_time_change($1)', [id]);
      const original = await snapshot();
      assert.equal((await history()).length, 0, 'INSERT is tracked but not offered as update undo');
      await db.query(`UPDATE public.radno_vrijeme SET radnik_id=$2,gradiliste_id=$3,datum='2026-11-10',
        sati=9.5,nocni_sati=1.5,napomena='Promijenjeno' WHERE id=$1`, [hours, nextWorker, nextSite]);
      const changed = await snapshot();
      const first = (await history())[0];
      assert.equal(typeof first.sequence, 'string');
      assert.equal(first.can_restore, true);
      assert.deepEqual(first.before_data, original);
      assert.deepEqual(first.after_data, changed);
      await db.query("UPDATE public.radno_vrijeme SET sati=8,nocni_sati=0,napomena=NULL WHERE id=$1", [hours]);
      const second = (await history())[0];
      assert.equal((await history()).find((r) => r.id === first.id).can_restore, false);
      await assert.rejects(restore(first.id), (e) => e.code === '40001');
      await restore(second.id);
      assert.deepEqual(await snapshot(), changed);
      await assert.rejects(restore(second.id), /već vraćena/);
      await assert.rejects(restore((await history()).find((r) => r.reverses_id === second.id).id), /već vraćena/);

      const removedWorker = (await db.query("SELECT public.delete_resource_with_history('radnici',$1) id", [worker])).rows[0].id;
      await assert.rejects(restore(first.id), /Izvorni djelatnik/);
      assert.deepEqual(await snapshot(), changed);
      await db.query('SELECT public.restore_resource_deletion($1)', [removedWorker]);
      const removedSite = (await db.query("SELECT public.delete_resource_with_history('gradilista',$1) id", [site])).rows[0].id;
      await assert.rejects(restore(first.id), /Izvorno gradilište/);
      await db.query('SELECT public.restore_resource_deletion($1)', [removedSite]);
      for (const [table, id] of [['radnici', worker], ['gradilista', site]]) {
        await db.exec('BEGIN');
        await db.query('SELECT public.delete_resource_with_history($1,$2)', [table, id]);
        await db.query(`INSERT INTO public.${table}(id,company_id,${table === 'radnici' ? 'ime' : 'naziv'}) VALUES ($1,$2,'Druga tvrtka')`, [id, otherCompany]);
        await assert.rejects(restore(first.id), (e) => e.code === '23503');
        await db.exec('ROLLBACK');
        assert.deepEqual(await snapshot(), changed, 'Cannot restore a foreign-tenant parent link');
      }
      await db.exec(`CREATE FUNCTION public.test_hours_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.napomena='Izvorno' THEN RETURN NULL; END IF; RETURN NEW; END; $$;
        CREATE TRIGGER test_hours_update_guard BEFORE UPDATE ON public.radno_vrijeme
          FOR EACH ROW EXECUTE FUNCTION public.test_hours_update_guard();`);
      await assert.rejects(restore(first.id), /točno vraćanje/);
      assert.deepEqual(await snapshot(), changed);
      assert.equal((await db.query('SELECT reversed_at FROM private.business_change_history WHERE id=$1', [first.id])).rows[0].reversed_at, null);
      await db.exec('DROP TRIGGER test_hours_update_guard ON public.radno_vrijeme; DROP FUNCTION public.test_hours_update_guard();');
      await restore(first.id);
      assert.deepEqual(await snapshot(), original, 'All six editable fields are restored exactly');
      await db.query('UPDATE public.radno_vrijeme SET gradiliste_id=NULL WHERE id=$1', [hours]);
      const noSite = (await history())[0];
      await restore(noSite.id);
      assert.deepEqual(await snapshot(), original, 'Nullable site assignments are restored');

      await db.query("UPDATE public.radno_vrijeme SET napomena='Prije brisanja' WHERE id=$1", [hours]);
      const beforeDeletion = (await history())[0];
      const beforeMismatch = await snapshot();
      await db.query(`UPDATE private.business_change_history SET after_data=jsonb_set(after_data,'{sati}','100'::jsonb) WHERE id=$1`, [beforeDeletion.id]);
      assert.equal((await history()).find((r) => r.id === beforeDeletion.id).can_restore, false);
      await assert.rejects(restore(beforeDeletion.id), /naknadno promijenjeno/);
      assert.deepEqual(await snapshot(), beforeMismatch, 'Full snapshot mismatch cannot write any fields');
      await db.query('UPDATE private.business_change_history SET after_data=$2 WHERE id=$1', [beforeDeletion.id, beforeDeletion.after_data]);
      const deletion = (await db.query('SELECT public.delete_work_time_with_history($1) id', [hours])).rows[0].id;
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(beforeDeletion.id), /obrisano/);
      await db.query('SELECT public.restore_resource_deletion($1)', [deletion]);
      assert.equal((await history()).find((r) => r.id === beforeDeletion.id).can_restore, true);
      await restore(beforeDeletion.id);
      assert.deepEqual(await snapshot(), original);

      await db.query("UPDATE public.radno_vrijeme SET created_at=created_at+interval '1 second',sati=9 WHERE id=$1", [hours]);
      const restricted = (await history())[0];
      assert.equal(restricted.can_restore, false);
      await assert.rejects(restore(restricted.id), /nepodržana polja/);
      await db.query('UPDATE public.radno_vrijeme SET nalog_id=$2 WHERE id=$1', [hours, order]);
      await db.query("UPDATE public.radno_vrijeme SET napomena='Izmjena sati naloga' WHERE id=$1", [hours]);
      const linked = (await history())[0];
      assert.equal(linked.can_restore, false);
      await assert.rejects(restore(linked.id), /povezani radni nalog/);
      await db.query('UPDATE public.radno_vrijeme SET nalog_id=NULL WHERE id=$1', [hours]);
      const detached = (await history())[0];
      assert.equal(detached.can_restore, false);
      await assert.rejects(restore(detached.id), /povezani radni nalog/);
      await db.query("UPDATE public.radno_vrijeme SET napomena='ABA' WHERE id=$1", [hours]);
      const aba = (await history())[0];
      await db.query("UPDATE public.radno_vrijeme SET napomena='Drugo' WHERE id=$1", [hours]);
      await db.query("UPDATE public.radno_vrijeme SET napomena='ABA' WHERE id=$1", [hours]);
      await assert.rejects(restore(aba.id), /noviju promjenu/);
      for (let n = 0; n < 52; n++) await db.query('UPDATE public.radno_vrijeme SET napomena=$2 WHERE id=$1', [hours, `Biljeska ${n}`]);
      const page = await history();
      assert.equal(page.length, 50);
      const nextPage = await history(page.at(-1).sequence);
      assert.ok(nextPage.length > 0);
      assert.ok(nextPage.every((r) => !page.some((firstRow) => firstRow.id === r.id)));
      const newest = page[0];
      await db.query("UPDATE private.business_change_history SET expires_at=now()-interval '1 second' WHERE id=$1", [newest.id]);
      assert.ok(!(await history()).some((r) => r.id === newest.id));
      await assert.rejects(restore(newest.id), /30 dana/);
      await db.query("UPDATE private.business_change_history SET expires_at=now()+interval '30 days' WHERE id=$1", [newest.id]);
      await db.exec(`
        UPDATE public.app_profiles SET company_id='${company}' WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}' AND module='radno_vrijeme';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;
      `);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(newest.id), (e) => e.code === '42501');
      await assert.rejects(db.query('SELECT * FROM private.business_change_history'), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='radno_vrijeme'; SET ROLE authenticated;`);
      await restore(newest.id);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='${otherCompany}' WHERE id='${other}'; SET ROLE authenticated;`);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(page[1].id), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false);`);

      const beforeOrderSync = (await db.query('SELECT public.delete_work_time_with_history($1) id', [hours])).rows[0].id;
      await db.query('SELECT public.restore_resource_deletion($1)', [beforeOrderSync]);
      await db.query('SELECT public.replace_work_order_hours($1,$2)', [order, JSON.stringify([{
        nalog_id: order, radnik_id: nextWorker, gradiliste_id: nextSite, datum: '2026-11-10',
        sati: 8, nocni_sati: 1.5, napomena: 'Automatski',
      }])]);
      const generated = (await db.query('SELECT id FROM public.radno_vrijeme WHERE nalog_id=$1', [order])).rows[0].id;
      await db.query("UPDATE public.radno_vrijeme SET napomena='Rucno na generiranim satima' WHERE id=$1", [generated]);
      const generatedHistory = (await db.query('SELECT * FROM public.get_work_time_change_history($1)', [generated])).rows;
      assert.equal(generatedHistory[0].can_restore, false);
      await assert.rejects(restore(generatedHistory[0].id), /povezani radni nalog/);
      const parent = (await db.query("SELECT public.delete_resource_with_history('radni_nalozi',$1) id", [order])).rows[0].id;
      await db.query('SELECT public.restore_resource_deletion($1)', [parent]);
      assert.equal((await db.query('SELECT count(*)::int count FROM public.radno_vrijeme WHERE id=$1', [generated])).rows[0].count, 1,
        'New audit triggers preserve whole-order recovery and generated hours');
      const manualBeforeCascade = await snapshot();
      for (const [table, id] of [['radnici', worker], ['gradilista', site]]) {
        const bundle = (await db.query('SELECT public.delete_resource_with_history($1,$2) id', [table, id])).rows[0].id;
        assert.equal(await snapshot(), undefined);
        await db.query('SELECT public.restore_resource_deletion($1)', [bundle]);
        assert.deepEqual(await snapshot(), manualBeforeCascade, 'New journal preserves manual hours in parent recovery');
      }
      await db.exec('SET ROLE anon');
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(page[1].id), (e) => e.code === '42501');
      await db.exec('RESET ROLE');
    });
    await t.test('absence deletion recovery restores all categories exactly and blocks replacements, ABA and foreign access', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const actor = '00000000-0000-0000-0000-000000000002';
      const other = '00000000-0000-0000-0000-000000000006';
      const worker = '00000000-0000-0000-0000-000000000601';
      const secondWorker = '00000000-0000-0000-0000-000000000602';
      await db.exec(`
        SELECT set_config('request.jwt.claim.sub','${actor}',false);
        ALTER TABLE public.radnici_odsustva ADD COLUMN napomena text,
          ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
          ADD CONSTRAINT test_absence_period CHECK (datum_do >= datum_od),
          ADD CONSTRAINT test_absence_kind CHECK (vrsta IN ('godisnji','bolovanje','praznik'));
        INSERT INTO public.radnici(id,company_id,ime,prezime,status,uloga) VALUES
          ('${worker}','${company}','Ana','Odsustva','aktivan','Radnik'),
          ('${secondWorker}','${company}','Ivo','Odsustva','aktivan','Radnik');
      `);
      await db.exec(sqlFile('migrations/20261110060000_odsustva_povrat_brisanja.sql'));
      const create = async (kind = 'godisnji', workerId = worker) => (await db.query(`
        INSERT INTO public.radnici_odsustva(company_id,radnik_id,vrsta,datum_od,datum_do,napomena,created_at)
          VALUES ($1,$2,$3,'2026-11-09','2026-11-13','Izvorna napomena','2026-11-04T08:12:34Z') RETURNING id`,
      [company, workerId, kind])).rows[0].id;
      const snapshot = async (id) => (await db.query('SELECT to_jsonb(r) data FROM public.radnici_odsustva r WHERE id=$1', [id])).rows[0]?.data;
      const remove = async (id) => (await db.query('SELECT public.delete_absence_with_history($1) id', [id])).rows[0].id;
      const restore = (id) => db.query('SELECT public.restore_resource_deletion($1)', [id]);
      const history = async () => (await db.query('SELECT * FROM public.get_absence_deletions()')).rows;
      for (const kind of ['godisnji', 'bolovanje', 'praznik']) {
        const row = await create(kind);
        const original = await snapshot(row);
        await db.exec('GRANT SELECT, DELETE ON public.radnici_odsustva TO authenticated; SET ROLE authenticated;');
        await assert.rejects(db.query('DELETE FROM public.radnici_odsustva WHERE id=$1', [row]), /Zaštićeno brisanje odsustva/);
        const deletion = await remove(row);
        await db.exec('RESET ROLE');
        assert.equal(await snapshot(row), undefined);
        const entry = (await history()).find((r) => r.id === deletion);
        assert.deepEqual(entry.snapshot, original);
        assert.deepEqual(entry.affected_rows, { radnici_odsustva: 1 });
        assert.equal(entry.can_restore, true);
        assert.ok(!(await db.query("SELECT * FROM public.get_resource_deletions('radnici')")).rows.some((r) => r.id === deletion),
          'Absence deletions never appear as whole-worker deletions');
        await restore(deletion);
        assert.deepEqual(await snapshot(row), original, `Exact ${kind} recovery`);
        await assert.rejects(restore(deletion), /već vraćeno/);
      }

      const target = await create();
      const original = await snapshot(target);
      await db.exec(`CREATE FUNCTION public.test_absence_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RETURN NULL; END; $$;
        CREATE TRIGGER test_absence_delete_guard BEFORE DELETE ON public.radnici_odsustva
          FOR EACH ROW EXECUTE FUNCTION public.test_absence_delete_guard();`);
      const countBefore = (await history()).length;
      await assert.rejects(remove(target), /Brisanje nije provedeno/);
      assert.deepEqual(await snapshot(target), original);
      assert.equal((await history()).length, countBefore, 'A swallowed DELETE creates no recoverable success');
      await db.exec('DROP TRIGGER test_absence_delete_guard ON public.radnici_odsustva; DROP FUNCTION public.test_absence_delete_guard();');
      const deletion = await remove(target);
      await create('bolovanje', secondWorker);
      assert.equal((await history()).find((r) => r.id === deletion).can_restore, true, 'Other workers do not invalidate recovery');
      await db.exec(`CREATE FUNCTION public.test_absence_restore_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RETURN NULL; END; $$;
        CREATE TRIGGER test_absence_restore_guard BEFORE INSERT ON public.radnici_odsustva
          FOR EACH ROW EXECUTE FUNCTION public.test_absence_restore_guard();`);
      await assert.rejects(restore(deletion), /točan povrat/);
      assert.equal(await snapshot(target), undefined);
      assert.equal((await db.query('SELECT reversed_at FROM private.resource_deletions WHERE id=$1', [deletion])).rows[0].reversed_at, null);
      await db.exec('DROP TRIGGER test_absence_restore_guard ON public.radnici_odsustva; DROP FUNCTION public.test_absence_restore_guard();');
      await restore(deletion);
      assert.deepEqual(await snapshot(target), original);
      const foreignWorkerRow = await create('godisnji', secondWorker);
      const foreignWorkerDeletion = await remove(foreignWorkerRow);
      await db.exec('BEGIN');
      await db.query("SELECT public.delete_resource_with_history('radnici',$1)", [secondWorker]);
      await db.query("INSERT INTO public.radnici(id,company_id,ime) VALUES ($1,'00000000-0000-0000-0000-000000000005','Druga tvrtka')", [secondWorker]);
      await assert.rejects(restore(foreignWorkerDeletion), (e) => e.code === '23503');
      await db.exec('ROLLBACK');
      await restore(foreignWorkerDeletion);
      assert.equal((await snapshot(foreignWorkerRow)).radnik_id, secondWorker);

      for (const change of ['insert', 'update', 'delete', 'reassign']) {
        const row = await create();
        const related = await create();
        const removed = await remove(row);
        if (change === 'insert') {
          await remove(await create()); // Insert then delete a regenerated record with another ID.
        } else if (change === 'update') {
          await db.query("UPDATE public.radnici_odsustva SET napomena='Promjena' WHERE id=$1", [related]);
          await db.query("UPDATE public.radnici_odsustva SET napomena='Izvorna napomena' WHERE id=$1", [related]);
        } else if (change === 'delete') {
          await restore(await remove(related));
        } else {
          await db.query('UPDATE public.radnici_odsustva SET radnik_id=$2 WHERE id=$1', [related, secondWorker]);
          await db.query('UPDATE public.radnici_odsustva SET radnik_id=$2 WHERE id=$1', [related, worker]);
        }
        assert.equal((await history()).find((r) => r.id === removed).can_restore, false);
        await assert.rejects(restore(removed), /Odsustva djelatnika naknadno/, `${change} ABA must fail closed`);
        assert.equal(await snapshot(row), undefined);
      }

      const beforeWorkerDeletion = (await db.query('SELECT to_jsonb(r) data FROM public.radnici_odsustva r WHERE radnik_id=$1 ORDER BY id', [worker])).rows;
      const parent = (await db.query("SELECT public.delete_resource_with_history('radnici',$1) id", [worker])).rows[0].id;
      assert.equal((await db.query('SELECT count(*)::int count FROM public.radnici_odsustva WHERE radnik_id=$1', [worker])).rows[0].count, 0);
      await restore(parent);
      assert.deepEqual((await db.query('SELECT to_jsonb(r) data FROM public.radnici_odsustva r WHERE radnik_id=$1 ORDER BY id', [worker])).rows, beforeWorkerDeletion,
        'Whole-worker deletion still restores the complete absence set');
      const missing = await remove(target);
      const missingParent = (await db.query("SELECT public.delete_resource_with_history('radnici',$1) id", [worker])).rows[0].id;
      await assert.rejects(restore(missing), (e) => e.code === '23503');
      await restore(missingParent);
      await assert.rejects(restore(missing), /Odsustva djelatnika naknadno/,
        'Parent restoration cannot erase intervening absence revisions');

      const expiredRow = await create();
      const expired = await remove(expiredRow);
      await db.query("UPDATE private.resource_deletions SET expires_at=now()-interval '1 second' WHERE id=$1", [expired]);
      assert.ok(!(await history()).some((r) => r.id === expired));
      await assert.rejects(restore(expired), /30 dana/);
      await db.query("UPDATE private.resource_deletions SET expires_at=now()+interval '30 days' WHERE id=$1", [expired]);
      await db.exec(`
        UPDATE public.app_profiles SET company_id='${company}' WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}' AND module='radnici';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;
      `);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(remove(expiredRow), (e) => e.code === '42501');
      await assert.rejects(restore(expired), (e) => e.code === '42501');
      await assert.rejects(db.query('SELECT * FROM private.absence_worker_versions'), (e) => e.code === '42501');
      await assert.rejects(db.query('SELECT * FROM private.absence_deletion_workers'), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='radnici'; SET ROLE authenticated;`);
      await restore(expired);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='00000000-0000-0000-0000-000000000005' WHERE id='${other}'; SET ROLE authenticated;`);
      assert.equal((await history()).length, 0);
      await assert.rejects(remove(expiredRow), (e) => e.code === '42501');
      await assert.rejects(restore(missing), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false);`);
      for (let n = 0; n < 51; n++) await remove(await create());
      const page = await history();
      assert.equal(page.length, 50);
      const cursor = page.at(-1);
      const next = (await db.query('SELECT * FROM public.get_absence_deletions($1,$2)', [cursor.created_at, cursor.id])).rows;
      assert.ok(next.length > 0);
      assert.ok(next.every((r) => !page.some((first) => first.id === r.id)));
      await assert.rejects(db.query('SELECT * FROM public.get_absence_deletions(now(),NULL)'), (e) => e.code === '22023');
      await db.query('DELETE FROM private.resource_deletions WHERE id=$1', [missing]);
      assert.equal((await db.query('SELECT count(*)::int count FROM private.absence_deletion_workers WHERE deletion_id=$1', [missing])).rows[0].count, 0);
      await db.exec('SET ROLE anon');
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(remove(expiredRow), (e) => e.code === '42501');
      await db.exec('RESET ROLE');
    });
    await t.test('manual cost deletion recovery restores exact financial fields and excludes isolated order/invoice recovery', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const actor = '00000000-0000-0000-0000-000000000002';
      const other = '00000000-0000-0000-0000-000000000006';
      const site = '00000000-0000-0000-0000-000000000701';
      const cooperator = '00000000-0000-0000-0000-000000000702';
      const order = '00000000-0000-0000-0000-000000000703';
      const invoice = '00000000-0000-0000-0000-000000000704';
      await db.exec(`
        SELECT set_config('request.jwt.claim.sub','${actor}',false);
        ALTER TABLE public.troskovi ADD COLUMN kategorija text, ADD COLUMN opis text,
          ADD COLUMN datum date, ADD COLUMN placeno_at date, ADD COLUMN created_at timestamptz DEFAULT now(),
          ADD COLUMN kooperant_id uuid REFERENCES public.kooperanti(id) ON DELETE SET NULL,
          ADD COLUMN kooperant_racun_id uuid, ADD COLUMN broj_racuna text,
          ADD COLUMN kolicina numeric(14,3), ADD COLUMN jedinica text, ADD COLUMN jedinicna_cijena numeric(14,4);
        ALTER TABLE public.troskovi ALTER COLUMN iznos TYPE numeric(12,2);
        INSERT INTO public.gradilista(id,company_id,naziv) VALUES ('${site}','${company}','Gradiliste troskova');
        INSERT INTO public.kooperanti VALUES ('${cooperator}','${company}','Kooperant troskova');
        INSERT INTO public.radni_nalozi(id,company_id,gradiliste_id,naslov,status)
          VALUES ('${order}','${company}','${site}','Nalog troskova','zavrsen');
      `);
      await db.exec(sqlFile('migrations/20261110070000_troskovi_povrat_brisanja.sql'));
      const create = async ({ nalog = null, racun = null, placen = true, gradiliste = site, kooperant = cooperator } = {}) => (
        await db.query(`INSERT INTO public.troskovi(company_id,gradiliste_id,kooperant_id,nalog_id,kooperant_racun_id,
          kategorija,opis,iznos,datum,placen,placeno_at,broj_racuna,kolicina,jedinica,jedinicna_cijena,created_at)
          VALUES ($1,$2,$3,$4,$5,'materijal','Izvorni trosak',1234.56,'2026-11-09',$6,$7,'R-2026',12.345,'m2',100.0001,'2026-11-04T08:12:34Z') RETURNING id`,
        [company, gradiliste, kooperant, nalog, racun, placen, placen ? '2026-11-10' : null])).rows[0].id;
      const remove = async (id) => (await db.query('SELECT public.delete_cost_with_history($1) id', [id])).rows[0].id;
      const restore = (id) => db.query('SELECT public.restore_resource_deletion($1)', [id]);
      const snapshot = async (id) => (await db.query('SELECT to_jsonb(r) data FROM public.troskovi r WHERE id=$1', [id])).rows[0]?.data;
      const history = async () => (await db.query('SELECT * FROM public.get_cost_deletions()')).rows;
      for (const options of [{}, { placen: false, gradiliste: null, kooperant: null }]) {
        const row = await create(options);
        const original = await snapshot(row);
        await db.exec('GRANT SELECT, DELETE ON public.troskovi TO authenticated; SET ROLE authenticated;');
        await assert.rejects(db.query('DELETE FROM public.troskovi WHERE id=$1', [row]), /Zaštićeno brisanje ručnog troška/);
        const deletion = await remove(row);
        await db.exec('RESET ROLE');
        assert.equal(await snapshot(row), undefined);
        const entry = (await history()).find((r) => r.id === deletion);
        assert.equal(entry.can_restore, true);
        assert.deepEqual(entry.snapshot, original);
        assert.deepEqual(entry.affected_rows, { troskovi: 1 });
        await restore(deletion);
        assert.deepEqual(await snapshot(row), original, 'Exact amounts, payment dates, quantities and original timestamps');
        await assert.rejects(restore(deletion), /već vraćeno/);
      }

      const manual = await create();
      const before = await snapshot(manual);
      await db.exec(`CREATE FUNCTION public.test_cost_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RETURN NULL; END; $$;
        CREATE TRIGGER test_cost_delete_guard BEFORE DELETE ON public.troskovi
          FOR EACH ROW EXECUTE FUNCTION public.test_cost_delete_guard();`);
      const countBefore = (await history()).length;
      await assert.rejects(remove(manual), /Brisanje nije provedeno/);
      assert.equal((await history()).length, countBefore);
      assert.deepEqual(await snapshot(manual), before);
      await db.exec('DROP TRIGGER test_cost_delete_guard ON public.troskovi; DROP FUNCTION public.test_cost_delete_guard();');
      const deleted = await remove(manual);
      await db.exec(`CREATE FUNCTION public.test_cost_restore_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN NEW.iznos := NEW.iznos+1; RETURN NEW; END; $$;
        CREATE TRIGGER test_cost_restore_guard BEFORE INSERT ON public.troskovi
          FOR EACH ROW EXECUTE FUNCTION public.test_cost_restore_guard();`);
      await assert.rejects(restore(deleted), /točan povrat/);
      assert.equal(await snapshot(manual), undefined);
      assert.equal((await db.query('SELECT reversed_at FROM private.resource_deletions WHERE id=$1', [deleted])).rows[0].reversed_at, null);
      await db.exec('DROP TRIGGER test_cost_restore_guard ON public.troskovi; DROP FUNCTION public.test_cost_restore_guard();');
      await restore(deleted);
      assert.deepEqual(await snapshot(manual), before);

      const duplicate = await remove(manual);
      await db.query(`INSERT INTO public.troskovi SELECT * FROM jsonb_populate_record(NULL::public.troskovi,$1)`, [before]);
      await assert.rejects(restore(duplicate), (e) => e.code === '40001');
      await remove(manual);
      await assert.rejects(restore(duplicate), (e) => e.code === '40001', 'Deleting an ABA replacement does not erase its revision');
      for (const options of [{ nalog: order }, { racun: invoice }]) {
        const row = await create(options);
        const linkedDeletion = await remove(row);
        assert.equal((await history()).find((r) => r.id === linkedDeletion).can_restore, false);
        await assert.rejects(restore(linkedDeletion), /zajednički povrat obračuna/);
        assert.equal(await snapshot(row), undefined);
        const automatic = await create(options);
        await db.exec('SET ROLE authenticated');
        await db.query('DELETE FROM public.troskovi WHERE id=$1', [automatic]);
        await db.exec('RESET ROLE');
        assert.equal(await snapshot(automatic), undefined, 'Existing order/invoice cleanup remains functional');
      }
      const linkedForParent = await create({ nalog: order });
      const linkedBefore = await snapshot(linkedForParent);
      const parent = (await db.query("SELECT public.delete_resource_with_history('radni_nalozi',$1) id", [order])).rows[0].id;
      await assert.doesNotReject(restore(parent), 'Cost order bundle restores');
      assert.deepEqual(await snapshot(linkedForParent), linkedBefore, 'Complete order recovery still restores its costs');
      const siteBundle = (await db.query("SELECT public.delete_resource_with_history('gradilista',$1) id", [site])).rows[0].id;
      await assert.doesNotReject(restore(siteBundle), 'Cost site bundle restores');
      assert.deepEqual(await snapshot(linkedForParent), linkedBefore, 'Complete site recovery keeps financial history intact');

      const missingSiteRow = await create();
      const missingSiteDeletion = await remove(missingSiteRow);
      const removedSite = (await db.query("SELECT public.delete_resource_with_history('gradilista',$1) id", [site])).rows[0].id;
      await assert.rejects(restore(missingSiteDeletion), (e) => e.code === '23503');
      await restore(removedSite);
      await restore(missingSiteDeletion);
      const missingCooperatorDeletion = await remove(missingSiteRow);
      await db.exec('BEGIN');
      await db.query('DELETE FROM public.kooperanti WHERE id=$1', [cooperator]);
      await assert.rejects(restore(missingCooperatorDeletion), (e) => e.code === '23503');
      await db.exec('ROLLBACK');
      for (const [table, id, labelField] of [['kooperanti', cooperator, 'naziv'], ['gradilista', site, 'naziv']]) {
        await db.exec('BEGIN');
        if (table === 'gradilista') await db.query("SELECT public.delete_resource_with_history('gradilista',$1)", [id]);
        else await db.query('DELETE FROM public.kooperanti WHERE id=$1', [id]);
        await db.query(`INSERT INTO public.${table}(id,company_id,${labelField}) VALUES ($1,'00000000-0000-0000-0000-000000000005','Druga tvrtka')`, [id]);
        await assert.rejects(restore(missingCooperatorDeletion), (e) => e.code === '23503');
        await db.exec('ROLLBACK');
      }
      await restore(missingCooperatorDeletion);

      const expiry = await remove(missingSiteRow);
      await db.query("UPDATE private.resource_deletions SET expires_at=now()-interval '1 second' WHERE id=$1", [expiry]);
      assert.ok(!(await history()).some((r) => r.id === expiry));
      await assert.rejects(restore(expiry), /30 dana/);
      await db.query("UPDATE private.resource_deletions SET expires_at=now()+interval '30 days' WHERE id=$1", [expiry]);
      await db.exec(`
        UPDATE public.app_profiles SET company_id='${company}' WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}';
        INSERT INTO public.app_user_permissions(user_id,module,can_view,can_edit) VALUES ('${other}','troskovi',true,false);
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;
      `);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(remove(missingSiteRow), (e) => e.code === '42501');
      await assert.rejects(restore(expiry), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='troskovi'; SET ROLE authenticated;`);
      await assert.doesNotReject(restore(expiry), 'Cost-only editor can restore a standalone manual cost');
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='00000000-0000-0000-0000-000000000005' WHERE id='${other}'; SET ROLE authenticated;`);
      assert.equal((await history()).length, 0);
      await assert.rejects(remove(missingSiteRow), (e) => e.code === '42501');
      await assert.rejects(restore(duplicate), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false);`);
      for (let n = 0; n < 51; n++) await remove(await create({ gradiliste: null, kooperant: null }));
      const page = await history();
      assert.equal(page.length, 50);
      const cursor = page.at(-1);
      const next = (await db.query('SELECT * FROM public.get_cost_deletions($1,$2)', [cursor.created_at, cursor.id])).rows;
      assert.ok(next.length > 0);
      assert.ok(next.every((r) => !page.some((first) => first.id === r.id)));
      await assert.rejects(db.query('SELECT * FROM public.get_cost_deletions(now(),NULL)'), (e) => e.code === '22023');
      await db.exec('SET ROLE anon');
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(remove(missingSiteRow), (e) => e.code === '42501');
      await db.exec('RESET ROLE');
    });
    await t.test('manual cost changes support exact multi-step undo, audit lineage and fail-closed linked and parent checks', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const actor = '00000000-0000-0000-0000-000000000002';
      const other = '00000000-0000-0000-0000-000000000006';
      const foreign = '00000000-0000-0000-0000-000000000005';
      const site = '00000000-0000-0000-0000-000000000801';
      const cooperator = '00000000-0000-0000-0000-000000000802';
      const order = '00000000-0000-0000-0000-000000000803';
      const cost = '00000000-0000-0000-0000-000000000804';
      await db.exec(sqlFile('migrations/20261110080000_troskovi_povijest_izmjena.sql'));
      await db.exec(`
        SELECT set_config('request.jwt.claim.sub','${actor}',false);
        INSERT INTO public.gradilista(id,company_id,naziv) VALUES ('${site}','${company}','Izvorno gradiliste');
        INSERT INTO public.kooperanti VALUES ('${cooperator}','${company}','Izvorni kooperant');
        INSERT INTO public.radni_nalozi(id,company_id,naslov,status) VALUES ('${order}','${company}','Nalog promjena','zavrsen');
        INSERT INTO public.troskovi(id,company_id,gradiliste_id,kooperant_id,kategorija,opis,iznos,datum,placen,placeno_at,
          broj_racuna,kolicina,jedinica,jedinicna_cijena,created_at)
          VALUES ('${cost}','${company}','${site}','${cooperator}','kooperanti','Izvorno',1234.56,'2026-11-09',true,'2026-11-10',
            'R-1',12.345,'m2',100.0001,'2026-11-04T08:12:34Z');
      `);
      const snapshot = async () => (await db.query('SELECT to_jsonb(r) data FROM public.troskovi r WHERE id=$1', [cost])).rows[0]?.data;
      const history = async (before = null) => (await db.query('SELECT * FROM public.get_cost_change_history($1,$2)', [cost, before])).rows;
      const restore = (id) => db.query('SELECT public.restore_cost_change($1)', [id]);
      const original = await snapshot();
      assert.equal((await history()).length, 0);
      await db.query(`UPDATE public.troskovi SET gradiliste_id=NULL,kooperant_id=NULL,kategorija='materijal',
        opis='Novo',iznos=78.91,datum='2026-11-11',placen=false,placeno_at=NULL WHERE id=$1`, [cost]);
      const changed = await snapshot();
      const first = (await history())[0];
      assert.equal(typeof first.sequence, 'string');
      assert.equal(first.can_restore, true);
      assert.deepEqual(first.before_data, original);
      assert.deepEqual(first.after_data, changed);
      await db.query('UPDATE public.troskovi SET iznos=99.99 WHERE id=$1', [cost]);
      const second = (await history())[0];
      await assert.rejects(restore(first.id), /noviju promjenu/);
      await restore(second.id);
      assert.deepEqual(await snapshot(), changed);
      await restore(first.id);
      assert.deepEqual(await snapshot(), original, 'Exact cents, payment fields and unchanged invoice details');
      await assert.rejects(restore(first.id), /već vraćena/);
      const undo = (await history()).find((r) => r.reverses_id === first.id);
      assert.equal(undo.can_restore, false);
      await assert.rejects(restore(undo.id), /već vraćena/);
      await db.query("UPDATE public.troskovi SET opis='Za povrat nakon brisanja' WHERE id=$1", [cost]);
      const beforeDelete = await snapshot();
      const beforeDeleteEvent = (await history())[0];
      const deletion = (await db.query('SELECT public.delete_cost_with_history($1) id', [cost])).rows[0].id;
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(beforeDeleteEvent.id), /obrisan/);
      await db.query('SELECT public.restore_resource_deletion($1)', [deletion]);
      assert.deepEqual(await snapshot(), beforeDelete);
      await restore(beforeDeleteEvent.id);
      assert.deepEqual(await snapshot(), original);

      for (const [field, value] of [['nalog_id', order], ['kooperant_racun_id', order]]) {
        await db.query(`UPDATE public.troskovi SET ${field}=$2,iznos=22.22 WHERE id=$1`, [cost, value]);
        const linked = (await history())[0];
        assert.equal(linked.can_restore, false);
        await assert.rejects(restore(linked.id), /zajednički povrat obračuna/);
        await db.query(`UPDATE public.troskovi SET ${field}=NULL WHERE id=$1`, [cost]);
        const detached = (await history())[0];
        assert.equal(detached.can_restore, false, 'Detaching does not make the linked event safe to undo');
        await assert.rejects(restore(detached.id), /zajednički povrat obračuna/);
      }
      await db.query("UPDATE public.troskovi SET iznos=33.33,broj_racuna='R-2' WHERE id=$1", [cost]);
      const unsupported = (await history())[0];
      assert.equal(unsupported.can_restore, false);
      await assert.rejects(restore(unsupported.id), /nepodržana polja/);
      assert.equal((await snapshot()).iznos, 33.33, 'Unsupported mixed change is not partially undone');

      await db.query('UPDATE public.troskovi SET gradiliste_id=NULL,kooperant_id=NULL WHERE id=$1', [cost]);
      const parentsEvent = (await history())[0];
      for (const [table, id] of [['gradilista', site], ['kooperanti', cooperator]]) {
        for (const replace of [false, true]) {
          await db.exec('BEGIN');
          if (table === 'gradilista') await db.query("SELECT public.delete_resource_with_history('gradilista',$1)", [id]);
          else await db.query('DELETE FROM public.kooperanti WHERE id=$1', [id]);
          if (replace) await db.query(`INSERT INTO public.${table}(id,company_id,naziv) VALUES ($1,$2,'Tuđi roditelj')`, [id, foreign]);
          await assert.rejects(restore(parentsEvent.id), (e) => e.code === '23503');
          await db.exec('ROLLBACK');
        }
      }
      await restore(parentsEvent.id);
      await db.query("UPDATE public.troskovi SET opis='ABA' WHERE id=$1", [cost]);
      const aba = (await history())[0];
      await db.query("UPDATE public.troskovi SET iznos=44.44 WHERE id=$1", [cost]);
      await db.query('UPDATE public.troskovi SET iznos=33.33 WHERE id=$1', [cost]);
      await assert.rejects(restore(aba.id), /noviju promjenu/);

      await db.query("UPDATE public.troskovi SET opis='Provjera' WHERE id=$1", [cost]);
      const guarded = (await history())[0];
      const guardedBefore = await snapshot();
      for (const body of ['RETURN NULL;', 'NEW.iznos := NEW.iznos+1; RETURN NEW;']) {
        await db.exec(`CREATE FUNCTION public.test_cost_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN ${body} END; $$;
          CREATE TRIGGER test_cost_update_guard BEFORE UPDATE ON public.troskovi
            FOR EACH ROW EXECUTE FUNCTION public.test_cost_update_guard();`);
        await assert.rejects(restore(guarded.id), /točno vraćanje troška/);
        assert.deepEqual(await snapshot(), guardedBefore);
        assert.equal((await history()).find((r) => r.id === guarded.id).reversed_at, null);
        await db.exec('DROP TRIGGER test_cost_update_guard ON public.troskovi; DROP FUNCTION public.test_cost_update_guard();');
      }
      await db.query("UPDATE private.business_change_history SET expires_at=now()-interval '1 second' WHERE id=$1", [guarded.id]);
      assert.ok(!(await history()).some((r) => r.id === guarded.id));
      await assert.rejects(restore(guarded.id), /30 dana/);
      await db.query("UPDATE private.business_change_history SET expires_at=now()+interval '30 days' WHERE id=$1", [guarded.id]);
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=false,approved=true WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;`);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(guarded.id), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='troskovi'; SET ROLE authenticated;`);
      await restore(guarded.id);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='${foreign}' WHERE id='${other}'; SET ROLE authenticated;`);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(first.id), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false);`);
      for (let n = 0; n < 51; n++) await db.query('UPDATE public.troskovi SET iznos=iznos+0.01 WHERE id=$1', [cost]);
      const page = await history();
      assert.equal(page.length, 50);
      const next = await history(page.at(-1).sequence);
      assert.ok(next.length > 0);
      assert.ok(next.every((r) => BigInt(r.sequence) < BigInt(page.at(-1).sequence)));
      const insertEvent = (await db.query("SELECT id FROM private.business_change_history WHERE table_name='troskovi' AND record_id=$1 AND operation='INSERT' AND reverses_id IS NULL ORDER BY sequence LIMIT 1", [cost])).rows[0];
      await assert.rejects(restore(insertEvent.id), (e) => e.code === '42501');
      const parent = (await db.query("SELECT public.delete_resource_with_history('gradilista',$1) id", [site])).rows[0].id;
      const beforeParentRestore = page[0];
      await db.query('SELECT public.restore_resource_deletion($1)', [parent]);
      await restore(beforeParentRestore.id);
      assert.equal((await snapshot()).iznos, beforeParentRestore.before_data.iznos, 'Whole-site restoration preserves previous update lineage');
      await db.exec('SET ROLE anon');
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(first.id), (e) => e.code === '42501');
      await db.exec('RESET ROLE');
    });
    await t.test('invoice deletion restores exact rebate direction and payment state with tenant, parent and transactional guards', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const actor = '00000000-0000-0000-0000-000000000002';
      const other = '00000000-0000-0000-0000-000000000006';
      const foreign = '00000000-0000-0000-0000-000000000005';
      const site = '00000000-0000-0000-0000-000000000901';
      const investor = '00000000-0000-0000-0000-000000000902';
      await db.exec(`
        SELECT set_config('request.jwt.claim.sub','${actor}',false);
        CREATE TABLE public.investitori(id uuid PRIMARY KEY,company_id uuid,naziv text);
        ALTER TABLE public.fakture ADD COLUMN investitor_id uuid REFERENCES public.investitori(id) ON DELETE SET NULL,
          ADD COLUMN kupac text, ADD COLUMN opis text, ADD COLUMN rabat numeric(12,2) DEFAULT 0,
          ADD COLUMN rabat_smjer text DEFAULT 'pribroji', ADD COLUMN datum_izdavanja date DEFAULT current_date,
          ADD COLUMN datum_dospjecja date, ADD COLUMN datum_naplate date, ADD COLUMN created_at timestamptz DEFAULT now();
        ALTER TABLE public.fakture ALTER COLUMN iznos TYPE numeric(12,2);
        INSERT INTO public.gradilista(id,company_id,naziv) VALUES ('${site}','${company}','Gradiliste faktura');
        INSERT INTO public.investitori VALUES ('${investor}','${company}','Investitor faktura');
      `);
      await db.exec(sqlFile('migrations/20261110090000_fakture_povrat_brisanja.sql'));
      let counter = 0;
      const create = async ({ status = 'placena', direction = 'oduzmi', gradiliste = site, investitor = investor } = {}) => (
        await db.query(`INSERT INTO public.fakture(company_id,gradiliste_id,investitor_id,broj,kupac,opis,iznos,rabat,rabat_smjer,
          datum_izdavanja,datum_dospjecja,datum_naplate,status,created_at)
          VALUES ($1,$2,$3,$4,'Izvorni kupac','Izvorni opis',1234.56,12.34,$5,'2026-11-09','2026-12-09',$6,$7,'2026-11-04T08:12:34Z') RETURNING id`,
        [company, gradiliste, investitor, `F-Povrat-${++counter}`, direction, status === 'placena' ? '2026-11-10' : null, status])).rows[0].id;
      const remove = async (id) => (await db.query('SELECT public.delete_invoice_with_history($1) id', [id])).rows[0].id;
      const restore = (id) => db.query('SELECT public.restore_resource_deletion($1)', [id]);
      const snapshot = async (id) => (await db.query('SELECT to_jsonb(r) data FROM public.fakture r WHERE id=$1', [id])).rows[0]?.data;
      const history = async () => (await db.query('SELECT * FROM public.get_invoice_deletions()')).rows;
      for (const options of [{}, { status: 'izdana', direction: 'pribroji', gradiliste: null, investitor: null }, { status: 'nep placena' }]) {
        const row = await create(options);
        const original = await snapshot(row);
        await db.exec('GRANT SELECT, DELETE ON public.fakture TO authenticated; SET ROLE authenticated;');
        await assert.rejects(db.query('DELETE FROM public.fakture WHERE id=$1', [row]), /Zaštićeno brisanje fakture/);
        const deletion = await remove(row);
        await db.exec('RESET ROLE');
        assert.equal(await snapshot(row), undefined);
        const entry = (await history()).find((r) => r.id === deletion);
        assert.equal(entry.can_restore, true);
        assert.deepEqual(entry.snapshot, original);
        assert.deepEqual(entry.affected_rows, { fakture: 1 });
        await restore(deletion);
        assert.deepEqual(await snapshot(row), original, 'Original cents, rebate mode, buyer, status and all dates are preserved');
        await assert.rejects(restore(deletion), /već vraćeno/);
      }
      const row = await create();
      const original = await snapshot(row);
      await db.exec(`CREATE TABLE public.test_invoice_child(id uuid PRIMARY KEY,faktura_id uuid REFERENCES public.fakture(id) ON DELETE CASCADE);
        INSERT INTO public.test_invoice_child VALUES (gen_random_uuid(),'${row}');`);
      await assert.rejects(remove(row), /povezanu tablicu test_invoice_child/);
      assert.deepEqual(await snapshot(row), original);
      await db.exec('DROP TABLE public.test_invoice_child');
      await db.exec(`CREATE FUNCTION public.test_invoice_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RETURN NULL; END; $$;
        CREATE TRIGGER test_invoice_delete_guard BEFORE DELETE ON public.fakture
          FOR EACH ROW EXECUTE FUNCTION public.test_invoice_delete_guard();`);
      const count = (await history()).length;
      await assert.rejects(remove(row), /Brisanje nije provedeno/);
      assert.deepEqual(await snapshot(row), original);
      assert.equal((await history()).length, count);
      await db.exec('DROP TRIGGER test_invoice_delete_guard ON public.fakture; DROP FUNCTION public.test_invoice_delete_guard();');
      const deletion = await remove(row);
      for (const body of ['RETURN NULL;', 'NEW.iznos := NEW.iznos+1; RETURN NEW;']) {
        await db.exec(`CREATE FUNCTION public.test_invoice_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN ${body} END; $$;
          CREATE TRIGGER test_invoice_insert_guard BEFORE INSERT ON public.fakture
            FOR EACH ROW EXECUTE FUNCTION public.test_invoice_insert_guard();`);
        await assert.rejects(restore(deletion), /točan povrat/);
        assert.equal(await snapshot(row), undefined);
        assert.equal((await db.query('SELECT reversed_at FROM private.resource_deletions WHERE id=$1', [deletion])).rows[0].reversed_at, null);
        await db.exec('DROP TRIGGER test_invoice_insert_guard ON public.fakture; DROP FUNCTION public.test_invoice_insert_guard();');
      }
      for (const [table, id] of [['gradilista', site], ['investitori', investor]]) {
        for (const replace of [false, true]) {
          await db.exec('BEGIN');
          if (table === 'gradilista') await db.query("SELECT public.delete_resource_with_history('gradilista',$1)", [id]);
          else await db.query('DELETE FROM public.investitori WHERE id=$1', [id]);
          if (replace) await db.query(`INSERT INTO public.${table}(id,company_id,naziv) VALUES ($1,$2,'Druga tvrtka')`, [id, foreign]);
          await assert.rejects(restore(deletion), (e) => e.code === '23503');
          await db.exec('ROLLBACK');
        }
      }
      await restore(deletion);
      assert.deepEqual(await snapshot(row), original);
      const parent = (await db.query("SELECT public.delete_resource_with_history('gradilista',$1) id", [site])).rows[0].id;
      await restore(parent);
      assert.deepEqual(await snapshot(row), original, 'Whole-site recovery still restores invoices exactly');
      const aba = await remove(row);
      await db.query('INSERT INTO public.fakture SELECT * FROM jsonb_populate_record(NULL::public.fakture,$1)', [original]);
      await assert.rejects(restore(aba), (e) => e.code === '40001');
      await remove(row);
      await assert.rejects(restore(aba), (e) => e.code === '40001');

      const pendingRow = await create();
      const pending = await remove(pendingRow);
      await db.query("UPDATE private.resource_deletions SET expires_at=now()-interval '1 second' WHERE id=$1", [pending]);
      assert.ok(!(await history()).some((r) => r.id === pending));
      await assert.rejects(restore(pending), /30 dana/);
      await db.query("UPDATE private.resource_deletions SET expires_at=now()+interval '30 days' WHERE id=$1", [pending]);
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=false,approved=true WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}';
        INSERT INTO public.app_user_permissions VALUES ('${other}','fakture',true,false);
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;`);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(remove(pendingRow), (e) => e.code === '42501');
      await assert.rejects(restore(pending), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='fakture'; SET ROLE authenticated;`);
      await restore(pending);
      const ownDeletion = await remove(pendingRow);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='${foreign}' WHERE id='${other}'; SET ROLE authenticated;`);
      assert.equal((await history()).length, 0);
      await assert.rejects(remove(pendingRow), (e) => e.code === '42501');
      await assert.rejects(restore(ownDeletion), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false);`);
      for (let n = 0; n < 51; n++) await remove(await create({ gradiliste: null, investitor: null }));
      const page = await history();
      assert.equal(page.length, 50);
      const cursor = page.at(-1);
      const next = (await db.query('SELECT * FROM public.get_invoice_deletions($1,$2)', [cursor.created_at, cursor.id])).rows;
      assert.ok(next.length > 0);
      assert.ok(next.every((r) => !page.some((first) => first.id === r.id)));
      await assert.rejects(db.query('SELECT * FROM public.get_invoice_deletions(now(),NULL)'), (e) => e.code === '22023');
      await db.exec('SET ROLE anon');
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(remove(pendingRow), (e) => e.code === '42501');
      await db.exec('RESET ROLE');
    });
    await t.test('invoice updates restore exact finance and payment data with latest-first lineage and parent/tenant guards', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const actor = '00000000-0000-0000-0000-000000000002';
      const other = '00000000-0000-0000-0000-000000000006';
      const foreign = '00000000-0000-0000-0000-000000000005';
      const site = '00000000-0000-0000-0000-000000001001';
      const investor = '00000000-0000-0000-0000-000000001002';
      const invoice = '00000000-0000-0000-0000-000000001003';
      await db.exec(sqlFile('migrations/20261110100000_fakture_povijest_izmjena.sql'));
      await db.exec(`
        SELECT set_config('request.jwt.claim.sub','${actor}',false);
        INSERT INTO public.gradilista(id,company_id,naziv) VALUES ('${site}','${company}','Izvorno gradiliste');
        INSERT INTO public.investitori VALUES ('${investor}','${company}','Izvorni investitor');
        INSERT INTO public.fakture(id,company_id,gradiliste_id,investitor_id,broj,kupac,opis,iznos,rabat,rabat_smjer,
          datum_izdavanja,datum_dospjecja,datum_naplate,status,created_at)
          VALUES ('${invoice}','${company}','${site}','${investor}','F-Izvorno','Kupac','Opis',1234.56,12.34,'oduzmi',
            '2026-11-09','2026-12-09','2026-11-10','placena','2026-11-04T08:12:34Z');
      `);
      const snapshot = async () => (await db.query('SELECT to_jsonb(r) data FROM public.fakture r WHERE id=$1', [invoice])).rows[0]?.data;
      const history = async (before = null) => (await db.query('SELECT * FROM public.get_invoice_change_history($1,$2)', [invoice, before])).rows;
      const restore = (id) => db.query('SELECT public.restore_invoice_change($1)', [id]);
      const original = await snapshot();
      assert.equal((await history()).length, 0, 'New entries are audited, not offered as update undo');
      await db.query(`UPDATE public.fakture SET gradiliste_id=NULL,investitor_id=NULL,broj='F-Novo',kupac=NULL,opis=NULL,
        iznos=78.91,rabat=2.12,rabat_smjer='pribroji',datum_izdavanja='2026-11-11',datum_dospjecja=NULL,
        datum_naplate=NULL,status='izdana' WHERE id=$1`, [invoice]);
      const changed = await snapshot();
      const first = (await history())[0];
      assert.equal(typeof first.sequence, 'string');
      assert.equal(first.can_restore, true);
      assert.deepEqual(first.before_data, original);
      assert.deepEqual(first.after_data, changed);
      await db.query("UPDATE public.fakture SET iznos=99.99,status='nep placena' WHERE id=$1", [invoice]);
      const second = (await history())[0];
      assert.equal((await history()).find((r) => r.id === first.id).can_restore, false);
      await assert.rejects(restore(first.id), /noviju promjenu/);
      await restore(second.id);
      assert.deepEqual(await snapshot(), changed);
      await db.exec('BEGIN');
      await db.query(`INSERT INTO public.fakture(company_id,broj,iznos,status)
        VALUES ($1,'F-Izvorno',1,'izdana')`, [company]);
      await assert.rejects(restore(first.id), (e) => e.code === '23505', 'Existing number constraint rejects the complete undo');
      await db.exec('ROLLBACK');
      assert.deepEqual(await snapshot(), changed);
      assert.equal((await history()).find((r) => r.id === first.id).reversed_at, null);
      for (const [table, id] of [['gradilista', site], ['investitori', investor]]) {
        for (const replace of [false, true]) {
          await db.exec('BEGIN');
          if (table === 'gradilista') await db.query("SELECT public.delete_resource_with_history('gradilista',$1)", [id]);
          else await db.query('DELETE FROM public.investitori WHERE id=$1', [id]);
          if (replace) await db.query(`INSERT INTO public.${table}(id,company_id,naziv) VALUES ($1,$2,'Tuđi roditelj')`, [id, foreign]);
          await assert.rejects(restore(first.id), (e) => e.code === '23503');
          await db.exec('ROLLBACK');
        }
      }
      await restore(first.id);
      assert.deepEqual(await snapshot(), original, 'Original cents, rebate direction, status, all dates and parent links restored together');
      await assert.rejects(restore(first.id), /već vraćena/);
      const undo = (await history()).find((r) => r.reverses_id === first.id);
      assert.equal(undo.can_restore, false);
      await assert.rejects(restore(undo.id), /već vraćena/);

      await db.query("UPDATE public.fakture SET opis='Prije brisanja' WHERE id=$1", [invoice]);
      const deletedChange = (await history())[0];
      const beforeDelete = await snapshot();
      const deletion = (await db.query('SELECT public.delete_invoice_with_history($1) id', [invoice])).rows[0].id;
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(deletedChange.id), /obrisana/);
      await db.query('SELECT public.restore_resource_deletion($1)', [deletion]);
      assert.deepEqual(await snapshot(), beforeDelete);
      await restore(deletedChange.id);
      assert.deepEqual(await snapshot(), original);
      await db.query("UPDATE public.fakture SET opis='Paket gradilista' WHERE id=$1", [invoice]);
      const parentChange = (await history())[0];
      const parent = (await db.query("SELECT public.delete_resource_with_history('gradilista',$1) id", [site])).rows[0].id;
      await db.query('SELECT public.restore_resource_deletion($1)', [parent]);
      await restore(parentChange.id);
      assert.deepEqual(await snapshot(), original);

      await db.query("UPDATE public.fakture SET opis='ABA' WHERE id=$1", [invoice]);
      const aba = (await history())[0];
      await db.query('UPDATE public.fakture SET iznos=22.22 WHERE id=$1', [invoice]);
      await db.query('UPDATE public.fakture SET iznos=1234.56 WHERE id=$1', [invoice]);
      await assert.rejects(restore(aba.id), /noviju promjenu/);
      await db.query("UPDATE public.fakture SET opis='Smije li se vratiti' WHERE id=$1", [invoice]);
      const guarded = (await history())[0];
      const guardedBefore = await snapshot();
      await db.exec('BEGIN; ALTER TABLE public.fakture DISABLE TRIGGER invoice_change_history;');
      await db.query('UPDATE public.fakture SET iznos=55.55 WHERE id=$1', [invoice]);
      assert.equal((await history()).find((r) => r.id === guarded.id).can_restore, false);
      await assert.rejects(restore(guarded.id), /naknadno promijenjena/);
      await db.exec('ROLLBACK');
      for (const body of ['RETURN NULL;', 'NEW.iznos := NEW.iznos+1; RETURN NEW;']) {
        await db.exec(`CREATE FUNCTION public.test_invoice_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN ${body} END; $$;
          CREATE TRIGGER test_invoice_update_guard BEFORE UPDATE ON public.fakture
            FOR EACH ROW EXECUTE FUNCTION public.test_invoice_update_guard();`);
        await assert.rejects(restore(guarded.id), /točno vraćanje fakture/);
        assert.deepEqual(await snapshot(), guardedBefore);
        assert.equal((await history()).find((r) => r.id === guarded.id).reversed_at, null);
        await db.exec('DROP TRIGGER test_invoice_update_guard ON public.fakture; DROP FUNCTION public.test_invoice_update_guard();');
      }
      await db.query("UPDATE private.business_change_history SET expires_at=now()-interval '1 second' WHERE id=$1", [guarded.id]);
      assert.ok(!(await history()).some((r) => r.id === guarded.id));
      await assert.rejects(restore(guarded.id), /30 dana/);
      await db.query("UPDATE private.business_change_history SET expires_at=now()+interval '30 days' WHERE id=$1", [guarded.id]);
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=false,approved=true WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;`);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(guarded.id), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='fakture'; SET ROLE authenticated;`);
      await restore(guarded.id);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='${foreign}' WHERE id='${other}'; SET ROLE authenticated;`);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(first.id), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false);`);
      await db.query("UPDATE public.fakture SET iznos=111.11,created_at='2026-11-01T10:00:00Z' WHERE id=$1", [invoice]);
      const unsupported = (await history())[0];
      assert.equal(unsupported.can_restore, false);
      await assert.rejects(restore(unsupported.id), /nepodržana polja/);
      assert.equal((await snapshot()).iznos, 111.11, 'Mixed unsupported changes are never partially restored');
      for (let n = 0; n < 51; n++) await db.query('UPDATE public.fakture SET iznos=iznos+0.01 WHERE id=$1', [invoice]);
      const page = await history();
      assert.equal(page.length, 50);
      const next = await history(page.at(-1).sequence);
      assert.ok(next.length > 0);
      assert.ok(next.every((r) => BigInt(r.sequence) < BigInt(page.at(-1).sequence)));
      const insertEvent = (await db.query("SELECT id FROM private.business_change_history WHERE table_name='fakture' AND record_id=$1 AND operation='INSERT' AND reverses_id IS NULL ORDER BY sequence LIMIT 1", [invoice])).rows[0];
      await assert.rejects(restore(insertEvent.id), (e) => e.code === '42501');
      await db.exec('SET ROLE anon');
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(first.id), (e) => e.code === '42501');
      await db.exec('RESET ROLE');
    });
    await t.test('contracted and VTR work deletion restores exact financial data, original offer and retained file atomically', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const actor = '00000000-0000-0000-0000-000000000002';
      const other = '00000000-0000-0000-0000-000000000006';
      const foreign = '00000000-0000-0000-0000-000000000005';
      const site = '00000000-0000-0000-0000-000000001101';
      const offer = '00000000-0000-0000-0000-000000001102';
      const path = `gradiliste/${site}/vtr/izvorni.pdf`;
      await db.exec(`
        SELECT set_config('request.jwt.claim.sub','${actor}',false);
        ALTER TABLE public.ugovoreni_radovi ADD COLUMN naziv text, ADD COLUMN opis text,
          ADD COLUMN ostvareni_iznos numeric(12,2) DEFAULT 0, ADD COLUMN status text DEFAULT 'planirano',
          ADD COLUMN vrsta text DEFAULT 'ugovoreni', ADD COLUMN ponuda_id uuid REFERENCES public.ponude(id) ON DELETE SET NULL,
          ADD COLUMN dokument_naziv text, ADD COLUMN created_at timestamptz DEFAULT now();
        ALTER TABLE public.ugovoreni_radovi ALTER COLUMN ugovoreni_iznos TYPE numeric(12,2);
        CREATE UNIQUE INDEX test_contracted_offer ON public.ugovoreni_radovi(ponuda_id) WHERE ponuda_id IS NOT NULL;
        INSERT INTO public.gradilista(id,company_id,naziv) VALUES ('${site}','${company}','Gradiliste radova');
        INSERT INTO public.ponude(id,company_id,gradiliste_id,naziv) VALUES ('${offer}','${company}','${site}','Izvorna ponuda');
        INSERT INTO storage.objects(bucket_id,name) VALUES ('nalozi-foto','${path}');
      `);
      await db.exec(sqlFile('migrations/20261110110000_ugovoreni_radovi_povrat_brisanja.sql'));
      const create = async ({ vrsta = 'vtr', gradiliste = site, ponuda = offer, file = path } = {}) => (
        await db.query(`INSERT INTO public.ugovoreni_radovi(company_id,gradiliste_id,ponuda_id,naziv,opis,ugovoreni_iznos,
          ostvareni_iznos,status,vrsta,dokument_putanja,dokument_naziv,created_at)
          VALUES ($1,$2,$3,'Izvorni rad','Detaljan opis',1234.56,789.12,'u_tijeku',$4,$5,$6,'2026-11-04T08:12:34Z') RETURNING id`,
        [company, gradiliste, ponuda, vrsta, file, file ? 'Izvorni dokument.pdf' : null])).rows[0].id;
      const remove = async (id) => (await db.query('SELECT public.delete_contracted_work_with_history($1) id', [id])).rows[0].id;
      const restore = (id) => db.query('SELECT public.restore_resource_deletion($1)', [id]);
      const snapshot = async (id) => (await db.query('SELECT to_jsonb(r) data FROM public.ugovoreni_radovi r WHERE id=$1', [id])).rows[0]?.data;
      const history = async () => (await db.query('SELECT * FROM public.get_contracted_work_deletions()')).rows;
      const row = await create();
      const original = await snapshot(row);
      const offerBefore = (await db.query('SELECT to_jsonb(p) data FROM public.ponude p WHERE id=$1', [offer])).rows[0].data;
      await db.exec('GRANT SELECT, DELETE ON public.ugovoreni_radovi TO authenticated; SET ROLE authenticated;');
      await assert.rejects(db.query('DELETE FROM public.ugovoreni_radovi WHERE id=$1', [row]), /Zaštićeno brisanje/);
      const deletion = await remove(row);
      assert.equal((await db.query('SELECT public.app_document_file_visible($1) visible', [path])).rows[0].visible, false);
      assert.equal((await db.query('SELECT name FROM storage.objects WHERE name=$1', [path])).rows.length, 0);
      assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name', [path])).rows.length, 0);
      await db.exec('RESET ROLE');
      assert.equal((await db.query('SELECT name FROM storage.objects WHERE name=$1', [path])).rows.length, 1, 'Bytes remain archived');
      const entry = (await history()).find((r) => r.id === deletion);
      assert.equal(entry.can_restore, true);
      assert.deepEqual(entry.snapshot, original);
      assert.deepEqual(entry.affected_rows, { ugovoreni_radovi: 1 });
      await db.query('DELETE FROM storage.objects WHERE name=$1', [path]);
      await assert.rejects(restore(deletion), /Nedostaje prilog/);
      assert.equal(await snapshot(row), undefined);
      assert.equal((await db.query('SELECT reversed_at FROM private.resource_deletions WHERE id=$1', [deletion])).rows[0].reversed_at, null);
      await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('nalozi-foto',$1)", [path]);
      for (const [table, id] of [['gradilista', site], ['ponude', offer]]) {
        for (const replace of [false, true]) {
          await db.exec('BEGIN');
          if (table === 'gradilista') await db.query("SELECT public.delete_resource_with_history('gradilista',$1)", [id]);
          else await db.query('DELETE FROM public.ponude WHERE id=$1', [id]);
          if (replace) await db.query(`INSERT INTO public.${table}(id,company_id,naziv) VALUES ($1,$2,'Druga tvrtka')`, [id, foreign]);
          await assert.rejects(restore(deletion), (e) => e.code === '23503');
          await db.exec('ROLLBACK');
        }
      }
      const replacement = await create({ file: null });
      await assert.rejects(restore(deletion), (e) => e.code === '23505', 'Offer replacement prevents a duplicate VTR');
      await remove(replacement);
      for (const body of ['RETURN NULL;', 'NEW.ugovoreni_iznos := NEW.ugovoreni_iznos+1; RETURN NEW;']) {
        await db.exec(`CREATE FUNCTION public.test_work_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN ${body} END; $$;
          CREATE TRIGGER test_work_insert_guard BEFORE INSERT ON public.ugovoreni_radovi
            FOR EACH ROW EXECUTE FUNCTION public.test_work_insert_guard();`);
        await assert.rejects(restore(deletion), /točan povrat/);
        assert.equal(await snapshot(row), undefined);
        assert.equal((await db.query('SELECT reversed_at FROM private.resource_deletions WHERE id=$1', [deletion])).rows[0].reversed_at, null);
        await db.exec('DROP TRIGGER test_work_insert_guard ON public.ugovoreni_radovi; DROP FUNCTION public.test_work_insert_guard();');
      }
      await restore(deletion);
      assert.deepEqual(await snapshot(row), original);
      assert.deepEqual((await db.query('SELECT to_jsonb(p) data FROM public.ponude p WHERE id=$1', [offer])).rows[0].data, offerBefore, 'Offer itself is never rewound');
      await db.exec('SET ROLE authenticated');
      assert.equal((await db.query('SELECT public.app_document_file_visible($1) visible', [path])).rows[0].visible, true);
      assert.equal((await db.query('SELECT name FROM storage.objects WHERE name=$1', [path])).rows.length, 1);
      assert.equal((await db.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name', [path])).rows.length, 0, 'Live retained files remain immutable');
      await db.exec('RESET ROLE');
      await assert.rejects(restore(deletion), /već vraćeno/);
      const siteBundle = (await db.query("SELECT public.delete_resource_with_history('gradilista',$1) id", [site])).rows[0].id;
      await restore(siteBundle);
      assert.deepEqual(await snapshot(row), original, 'Complete site recovery still restores its works and attachments');
      const manual = await create({ vrsta: 'ugovoreni', gradiliste: null, ponuda: null, file: null });
      const manualBefore = await snapshot(manual);
      const manualDeletion = await remove(manual);
      await restore(manualDeletion);
      assert.deepEqual(await snapshot(manual), manualBefore);
      await db.exec(`CREATE TABLE public.test_work_child(id uuid PRIMARY KEY,work_id uuid REFERENCES public.ugovoreni_radovi(id) ON DELETE CASCADE);
        INSERT INTO public.test_work_child VALUES (gen_random_uuid(),'${manual}');`);
      await assert.rejects(remove(manual), /povezanu tablicu test_work_child/);
      assert.deepEqual(await snapshot(manual), manualBefore);
      await db.exec('DROP TABLE public.test_work_child');
      await db.exec(`CREATE FUNCTION public.test_work_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RETURN NULL; END; $$;
        CREATE TRIGGER test_work_delete_guard BEFORE DELETE ON public.ugovoreni_radovi
          FOR EACH ROW EXECUTE FUNCTION public.test_work_delete_guard();`);
      const count = (await history()).length;
      await assert.rejects(remove(manual), /Brisanje nije provedeno/);
      assert.deepEqual(await snapshot(manual), manualBefore);
      assert.equal((await history()).length, count);
      await db.exec('DROP TRIGGER test_work_delete_guard ON public.ugovoreni_radovi; DROP FUNCTION public.test_work_delete_guard();');
      const aba = await remove(manual);
      await db.query('INSERT INTO public.ugovoreni_radovi SELECT * FROM jsonb_populate_record(NULL::public.ugovoreni_radovi,$1)', [manualBefore]);
      await assert.rejects(restore(aba), (e) => e.code === '40001');
      await remove(manual);
      await assert.rejects(restore(aba), (e) => e.code === '40001');
      const pendingRow = await create({ gradiliste: null, ponuda: null, file: null });
      const pending = await remove(pendingRow);
      await db.query("UPDATE private.resource_deletions SET expires_at=now()-interval '1 second' WHERE id=$1", [pending]);
      assert.ok(!(await history()).some((r) => r.id === pending));
      await assert.rejects(restore(pending), /30 dana/);
      await db.query("UPDATE private.resource_deletions SET expires_at=now()+interval '30 days' WHERE id=$1", [pending]);
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=false,approved=true WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;`);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(remove(pendingRow), (e) => e.code === '42501');
      await assert.rejects(restore(pending), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='gradilista'; SET ROLE authenticated;`);
      await restore(pending);
      const ownDeletion = await remove(pendingRow);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='${foreign}' WHERE id='${other}'; SET ROLE authenticated;`);
      assert.equal((await history()).length, 0);
      await assert.rejects(remove(pendingRow), (e) => e.code === '42501');
      await assert.rejects(restore(ownDeletion), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false);`);
      for (let n = 0; n < 51; n++) await remove(await create({ gradiliste: null, ponuda: null, file: null }));
      const page = await history();
      assert.equal(page.length, 50);
      const cursor = page.at(-1);
      const next = (await db.query('SELECT * FROM public.get_contracted_work_deletions($1,$2)', [cursor.created_at, cursor.id])).rows;
      assert.ok(next.length > 0);
      assert.ok(next.every((r) => !page.some((first) => first.id === r.id)));
      await assert.rejects(db.query('SELECT * FROM public.get_contracted_work_deletions(now(),NULL)'), (e) => e.code === '22023');
      await db.exec('SET ROLE anon');
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(remove(pendingRow), (e) => e.code === '42501');
      await db.exec('RESET ROLE');
    });
    await t.test('contracted work updates undo exact supported fields and reject changed offer/type/file, stale parents and missing attachments', async () => {
      const company = '00000000-0000-0000-0000-000000000001';
      const actor = '00000000-0000-0000-0000-000000000002';
      const other = '00000000-0000-0000-0000-000000000006';
      const foreign = '00000000-0000-0000-0000-000000000005';
      const site = '00000000-0000-0000-0000-000000001201';
      const offer = '00000000-0000-0000-0000-000000001202';
      const work = '00000000-0000-0000-0000-000000001203';
      const path = `gradiliste/${site}/vtr/povijest.pdf`;
      await db.exec(sqlFile('migrations/20261110120000_ugovoreni_radovi_povijest_izmjena.sql'));
      await db.exec(`
        SELECT set_config('request.jwt.claim.sub','${actor}',false);
        INSERT INTO public.gradilista(id,company_id,naziv) VALUES ('${site}','${company}','Izvorno gradiliste');
        INSERT INTO public.ponude(id,company_id,gradiliste_id,naziv) VALUES ('${offer}','${company}','${site}','Izvorna ponuda');
        INSERT INTO storage.objects(bucket_id,name) VALUES ('nalozi-foto','${path}');
        INSERT INTO public.ugovoreni_radovi(id,company_id,gradiliste_id,ponuda_id,naziv,opis,ugovoreni_iznos,
          ostvareni_iznos,status,vrsta,dokument_putanja,dokument_naziv,created_at)
          VALUES ('${work}','${company}','${site}','${offer}','Izvorni rad','Izvorni opis',1234.56,789.12,'u_tijeku',
            'vtr','${path}','Izvorni.pdf','2026-11-04T08:12:34Z');
      `);
      const snapshot = async () => (await db.query('SELECT to_jsonb(r) data FROM public.ugovoreni_radovi r WHERE id=$1', [work])).rows[0]?.data;
      const history = async (before = null) => (await db.query('SELECT * FROM public.get_contracted_work_change_history($1,$2)', [work, before])).rows;
      const restore = (id) => db.query('SELECT public.restore_contracted_work_change($1)', [id]);
      const original = await snapshot();
      const originalOffer = (await db.query('SELECT to_jsonb(p) data FROM public.ponude p WHERE id=$1', [offer])).rows[0].data;
      assert.equal((await history()).length, 0);
      await db.query(`UPDATE public.ugovoreni_radovi SET gradiliste_id=NULL,naziv='Novo',opis=NULL,
        ugovoreni_iznos=78.91,ostvareni_iznos=12.34,status='zavrseno' WHERE id=$1`, [work]);
      const changed = await snapshot();
      const first = (await history())[0];
      assert.equal(typeof first.sequence, 'string');
      assert.deepEqual(first.before_data, original);
      assert.deepEqual(first.after_data, changed);
      assert.equal(first.can_restore, true);
      await db.query("UPDATE public.ugovoreni_radovi SET ugovoreni_iznos=99.99 WHERE id=$1", [work]);
      const second = (await history())[0];
      await assert.rejects(restore(first.id), /noviju promjenu/);
      await restore(second.id);
      assert.deepEqual(await snapshot(), changed);
      for (const replace of [false, true]) {
        await db.exec('BEGIN');
        await db.query("SELECT public.delete_resource_with_history('gradilista',$1)", [site]);
        if (replace) await db.query('INSERT INTO public.gradilista(id,company_id,naziv) VALUES ($1,$2,\'Tuđe\')', [site, foreign]);
        await assert.rejects(restore(first.id), (e) => e.code === '23503');
        await db.exec('ROLLBACK');
      }
      await db.query('DELETE FROM storage.objects WHERE name=$1', [path]);
      await assert.rejects(restore(first.id), /Nedostaje izvorni prilog/);
      assert.deepEqual(await snapshot(), changed);
      await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('nalozi-foto',$1)", [path]);
      await restore(first.id);
      assert.deepEqual(await snapshot(), original);
      assert.deepEqual((await db.query('SELECT to_jsonb(p) data FROM public.ponude p WHERE id=$1', [offer])).rows[0].data, originalOffer);
      await assert.rejects(restore(first.id), /već vraćena/);
      const undo = (await history()).find((r) => r.reverses_id === first.id);
      assert.equal(undo.can_restore, false);
      await assert.rejects(restore(undo.id), /već vraćena/);

      await db.query("UPDATE public.ugovoreni_radovi SET naziv='Prije brisanja' WHERE id=$1", [work]);
      const deletedChange = (await history())[0];
      const deletion = (await db.query('SELECT public.delete_contracted_work_with_history($1) id', [work])).rows[0].id;
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(deletedChange.id), /obrisan/);
      await db.query('SELECT public.restore_resource_deletion($1)', [deletion]);
      await restore(deletedChange.id);
      assert.deepEqual(await snapshot(), original);
      await db.query("UPDATE public.ugovoreni_radovi SET opis='Paket' WHERE id=$1", [work]);
      const parentChange = (await history())[0];
      const parent = (await db.query("SELECT public.delete_resource_with_history('gradilista',$1) id", [site])).rows[0].id;
      await db.query('SELECT public.restore_resource_deletion($1)', [parent]);
      await restore(parentChange.id);
      assert.deepEqual(await snapshot(), original);
      for (const statement of ["ponuda_id=NULL", "vrsta='ugovoreni'", "dokument_naziv='Drugi.pdf'", "dokument_putanja=NULL", "created_at='2026-11-01T10:00:00Z'"]) {
        await db.exec('BEGIN');
        await db.query(`UPDATE public.ugovoreni_radovi SET ugovoreni_iznos=11.11,${statement} WHERE id=$1`, [work]);
        const unsupported = (await history())[0];
        assert.equal(unsupported.can_restore, false);
        await db.exec('SAVEPOINT before_work_undo');
        await assert.rejects(restore(unsupported.id), /nepodržana polja/);
        await db.exec('ROLLBACK TO SAVEPOINT before_work_undo');
        assert.equal((await snapshot()).ugovoreni_iznos, 11.11, 'Mixed unsupported changes do not undo only the money');
        await db.exec('ROLLBACK');
      }
      await db.query("UPDATE public.ugovoreni_radovi SET naziv='ABA' WHERE id=$1", [work]);
      const aba = (await history())[0];
      await db.query('UPDATE public.ugovoreni_radovi SET ugovoreni_iznos=22.22 WHERE id=$1', [work]);
      await db.query('UPDATE public.ugovoreni_radovi SET ugovoreni_iznos=1234.56 WHERE id=$1', [work]);
      await assert.rejects(restore(aba.id), /noviju promjenu/);
      await db.query("UPDATE public.ugovoreni_radovi SET naziv='Za provjeru' WHERE id=$1", [work]);
      const guarded = (await history())[0];
      const guardedBefore = await snapshot();
      await db.exec('BEGIN');
      await db.query('DELETE FROM public.ponude WHERE id=$1', [offer]);
      await assert.rejects(restore(guarded.id), (e) => e.code === '40001', 'Deleting the linked offer creates a newer unsupported detachment');
      await db.exec('ROLLBACK');
      await db.exec('BEGIN; ALTER TABLE public.ugovoreni_radovi DISABLE TRIGGER contracted_work_change_history;');
      await db.query('UPDATE public.ugovoreni_radovi SET ugovoreni_iznos=55.55 WHERE id=$1', [work]);
      await assert.rejects(restore(guarded.id), /naknadno promijenjen/);
      await db.exec('ROLLBACK');
      for (const body of ['RETURN NULL;', 'NEW.ugovoreni_iznos := NEW.ugovoreni_iznos+1; RETURN NEW;']) {
        await db.exec(`CREATE FUNCTION public.test_work_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN ${body} END; $$;
          CREATE TRIGGER test_work_update_guard BEFORE UPDATE ON public.ugovoreni_radovi
            FOR EACH ROW EXECUTE FUNCTION public.test_work_update_guard();`);
        await assert.rejects(restore(guarded.id), /točno vraćanje rada/);
        assert.deepEqual(await snapshot(), guardedBefore);
        assert.equal((await history()).find((r) => r.id === guarded.id).reversed_at, null);
        await db.exec('DROP TRIGGER test_work_update_guard ON public.ugovoreni_radovi; DROP FUNCTION public.test_work_update_guard();');
      }
      await db.query("UPDATE private.business_change_history SET expires_at=now()-interval '1 second' WHERE id=$1", [guarded.id]);
      assert.ok(!(await history()).some((r) => r.id === guarded.id));
      await assert.rejects(restore(guarded.id), /30 dana/);
      await db.query("UPDATE private.business_change_history SET expires_at=now()+interval '30 days' WHERE id=$1", [guarded.id]);
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=false,approved=true WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;`);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(guarded.id), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='gradilista'; SET ROLE authenticated;`);
      await restore(guarded.id);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='${foreign}' WHERE id='${other}'; SET ROLE authenticated;`);
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(first.id), (e) => e.code === '42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false);`);
      const manual = (await db.query(`INSERT INTO public.ugovoreni_radovi(company_id,naziv,ugovoreni_iznos,ostvareni_iznos,status,vrsta)
        VALUES ($1,'Ručni rad',10.12,0,'planirano','ugovoreni') RETURNING id`, [company])).rows[0].id;
      const manualBefore = (await db.query('SELECT to_jsonb(r) data FROM public.ugovoreni_radovi r WHERE id=$1', [manual])).rows[0].data;
      await db.query('UPDATE public.ugovoreni_radovi SET ostvareni_iznos=5.56 WHERE id=$1', [manual]);
      const manualEvent = (await db.query('SELECT * FROM public.get_contracted_work_change_history($1)', [manual])).rows[0];
      await restore(manualEvent.id);
      assert.deepEqual((await db.query('SELECT to_jsonb(r) data FROM public.ugovoreni_radovi r WHERE id=$1', [manual])).rows[0].data, manualBefore);
      for (let n = 0; n < 51; n++) await db.query('UPDATE public.ugovoreni_radovi SET ostvareni_iznos=ostvareni_iznos+0.01 WHERE id=$1', [work]);
      const page = await history();
      assert.equal(page.length, 50);
      const next = await history(page.at(-1).sequence);
      assert.ok(next.length > 0);
      assert.ok(next.every((r) => BigInt(r.sequence) < BigInt(page.at(-1).sequence)));
      const insert = (await db.query("SELECT id FROM private.business_change_history WHERE table_name='ugovoreni_radovi' AND record_id=$1 AND operation='INSERT' AND reverses_id IS NULL ORDER BY sequence LIMIT 1", [work])).rows[0];
      await assert.rejects(restore(insert.id), (e) => e.code === '42501');
      await db.exec('SET ROLE anon');
      await assert.rejects(history(), (e) => e.code === '42501');
      await assert.rejects(restore(first.id), (e) => e.code === '42501');
      await db.exec('RESET ROLE');
    });
    await t.test('task changes project deadlines atomically, keep mobile RLS and preserve historical bundle restores', async () => {
      await db.exec(sqlFile('migrations/20261110130000_zadaci_atomarna_sinkronizacija_rokova.sql'));
      const company = '00000000-0000-0000-0000-000000000001';
      const actor = '00000000-0000-0000-0000-000000000002';
      const other = '00000000-0000-0000-0000-000000000006';
      const site = '00000000-0000-0000-0000-000000001301';
      const secondSite = '00000000-0000-0000-0000-000000001302';
      const task = '00000000-0000-0000-0000-000000001303';
      const contractor = '00000000-0000-0000-0000-000000000107';
      await db.query(`INSERT INTO public.gradilista(id,company_id,naziv) VALUES
        ($1,$3,'Atomarni zadaci'),($2,$3,'Drugo gradilište')`, [site, secondSite, company]);
      await db.query(`INSERT INTO public.gradiliste_zadaci(id,company_id,gradiliste_id,naziv,rok,gotovo,vrsta,kooperant_id)
        VALUES ($1,$2,$3,'Izvorni zadatak','2026-11-09',false,'dodatni',$4)`, [task, company, site, contractor]);
      const deadlines = async () => (await db.query('SELECT to_jsonb(r) data FROM public.rokovi r WHERE zadatak_id=$1 ORDER BY id', [task])).rows.map((r) => r.data);
      const taskData = async () => (await db.query('SELECT to_jsonb(z) data FROM public.gradiliste_zadaci z WHERE id=$1', [task])).rows[0]?.data;
      const state = async () => ({
        task: await taskData(), deadlines: await deadlines(),
        version: (await db.query('SELECT revision::text FROM private.deadline_task_versions WHERE task_id=$1', [task])).rows,
        history: (await db.query("SELECT h.id FROM private.business_change_history h WHERE table_name='rokovi' AND (before_data->>'zadatak_id'=$1 OR after_data->>'zadatak_id'=$1) ORDER BY sequence", [task])).rows,
        contexts: (await db.query('SELECT * FROM private.deadline_sync_context')).rows,
      });
      let linked = await deadlines();
      assert.equal(linked.length, 1, 'INSERT creates its deadline in the same statement');
      const deadlineId = linked[0].id;
      assert.equal(linked[0].opis, 'Dodatni rad');
      assert.equal(linked[0].kooperant_id, contractor);
      await db.query(`UPDATE public.gradiliste_zadaci SET naziv='Novi naziv',rok='2026-11-12',gotovo=true,
        gotovo_at=now(),gradiliste_id=$2,kooperant_id=NULL WHERE id=$1`, [task, secondSite]);
      linked = await deadlines();
      assert.equal(linked[0].id, deadlineId);
      assert.equal(linked[0].naziv, 'Novi naziv');
      assert.equal(linked[0].status, 'zavrsen');
      assert.equal(linked[0].datum, '2026-11-12');
      assert.equal(linked[0].datum_pocetka, '2026-11-12');
      assert.equal(linked[0].datum_zavrsetka, '2026-11-12');
      assert.equal(linked[0].gradiliste_id, secondSite);
      assert.equal(linked[0].kooperant_id, null);
      const stable = await state();
      await db.query('SELECT public.sync_task_deadline($1)', [task]);
      await db.query('SELECT public.sync_task_deadline($1)', [task]);
      await db.query('UPDATE public.gradiliste_zadaci SET naziv=naziv WHERE id=$1', [task]);
      assert.deepEqual(await state(), stable, 'Compatibility calls and identical writes must not advance deadline history or revisions');

      for (const [operation, mode] of [['UPDATE', 'skip'], ['UPDATE', 'mutate'], ['DELETE', 'skip'], ['INSERT', 'skip']]) {
        await db.exec('BEGIN');
        if (operation === 'INSERT') await db.query('UPDATE public.gradiliste_zadaci SET rok=NULL WHERE id=$1', [task]);
        const before = await state();
        await db.exec(`CREATE FUNCTION public.test_atomic_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN ${mode === 'mutate' ? "NEW.naziv := 'Izmjena triggera'; RETURN NEW;" : 'RETURN NULL;'} END; $$;
          CREATE TRIGGER test_atomic_deadline BEFORE ${operation} ON public.rokovi
            FOR EACH ROW EXECUTE FUNCTION public.test_atomic_deadline();
          SAVEPOINT before_task_write;`);
        const statement = operation === 'DELETE' ? 'UPDATE public.gradiliste_zadaci SET rok=NULL WHERE id=$1'
          : operation === 'INSERT' ? "UPDATE public.gradiliste_zadaci SET rok='2026-11-13' WHERE id=$1"
          : "UPDATE public.gradiliste_zadaci SET naziv='Pokušaj izmjene' WHERE id=$1";
        await assert.rejects(db.query(statement, [task]), /rok nije (točno spremljen|uklonjen)/);
        await db.exec('ROLLBACK TO SAVEPOINT before_task_write');
        assert.deepEqual(await state(), before, `${operation}/${mode} must roll back task, deadline, audit, revision and internal context`);
        if (operation === 'INSERT') {
          const rejectedTask = '00000000-0000-0000-0000-000000001304';
          await assert.rejects(db.query(`INSERT INTO public.gradiliste_zadaci(id,company_id,gradiliste_id,naziv,rok,gotovo)
            VALUES ($1,$2,$3,'Neuspjeli unos','2026-11-15',false)`, [rejectedTask, company, site]), /rok nije točno spremljen/);
          await db.exec('ROLLBACK TO SAVEPOINT before_task_write');
          assert.equal((await db.query('SELECT id FROM public.gradiliste_zadaci WHERE id=$1', [rejectedTask])).rows.length, 0,
            'A failed first deadline insert must not leave the newly created task');
        }
        await db.exec('ROLLBACK');
      }
      const foreignContractor = '00000000-0000-0000-0000-000000001305';
      await db.query("INSERT INTO public.kooperanti(id,company_id,naziv) VALUES ($1,'00000000-0000-0000-0000-000000000005','Druga tvrtka')", [foreignContractor]);
      await assert.rejects(db.query('UPDATE public.gradiliste_zadaci SET kooperant_id=$2 WHERE id=$1', [task, foreignContractor]),
        /tvrtk/i);
      await assert.rejects(db.query("UPDATE public.gradiliste_zadaci SET gradiliste_id='00000000-0000-0000-0000-000000001399' WHERE id=$1", [task]),
        (e) => e.code === '23503');
      assert.deepEqual(await state(), stable, 'Invalid parents must not change either task or deadline');

      // The real mobile surface writes tasks directly, without Gradilišta edit or deadline write access.
      await db.exec('BEGIN');
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=false,approved=true WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false,can_view=false WHERE user_id='${other}';
        ALTER TABLE public.gradiliste_zadaci ENABLE ROW LEVEL SECURITY;
        GRANT SELECT,UPDATE ON public.gradiliste_zadaci TO authenticated;
        CREATE POLICY test_mobile_task_read ON public.gradiliste_zadaci FOR SELECT TO authenticated
          USING (id='${task}' AND company_id=public.app_current_company_id() AND auth.uid()='${other}');
        CREATE POLICY test_mobile_task_write ON public.gradiliste_zadaci FOR UPDATE TO authenticated
          USING (id='${task}' AND company_id=public.app_current_company_id() AND auth.uid()='${other}')
          WITH CHECK (id='${task}' AND company_id=public.app_current_company_id() AND auth.uid()='${other}');
        SELECT set_config('request.jwt.claim.sub','${other}',true);
        SET LOCAL ROLE authenticated;`);
      assert.equal((await db.query("SELECT public.app_has_module_permission('gradilista','edit') allowed")).rows[0].allowed, false);
      await db.exec('SAVEPOINT before_private_access');
      await assert.rejects(db.query('SELECT private.project_task_deadline($1)', [task]), (e) => e.code === '42501');
      await db.exec('ROLLBACK TO SAVEPOINT before_private_access');
      assert.equal((await db.query('UPDATE public.gradiliste_zadaci SET gotovo=false,gotovo_at=NULL WHERE id=$1 RETURNING id', [task])).rows.length, 1);
      assert.equal((await db.query("UPDATE public.gradiliste_zadaci SET gotovo=true WHERE id='00000000-0000-0000-0000-000000000203' RETURNING id")).rows.length, 0,
        'Definer trigger must not bypass task RLS on the initiating statement');
      await db.exec('RESET ROLE');
      assert.equal((await deadlines())[0].status, 'otvoren');
      const mobileAudit = (await db.query("SELECT actor_id FROM private.business_change_history WHERE record_id=$1 ORDER BY sequence DESC LIMIT 1", [deadlineId])).rows[0];
      assert.equal(mobileAudit.actor_id, other);
      await db.exec('ROLLBACK');
      assert.deepEqual(await state(), stable);
      await db.exec(`SELECT set_config('request.jwt.claim.sub','${actor}',false)`);

      const deletionCount = (await db.query('SELECT count(*)::int count FROM public.get_deadline_deletions()')).rows[0].count;
      await db.query('UPDATE public.gradiliste_zadaci SET rok=NULL WHERE id=$1', [task]);
      assert.deepEqual(await deadlines(), []);
      assert.equal((await db.query('SELECT count(*)::int count FROM public.get_deadline_deletions()')).rows[0].count, deletionCount);
      await db.query("UPDATE public.gradiliste_zadaci SET rok='2026-11-14' WHERE id=$1", [task]);
      assert.equal((await deadlines()).length, 1);
      await db.query('UPDATE public.gradiliste_zadaci SET gradiliste_id=NULL WHERE id=$1', [task]);
      assert.deepEqual(await deadlines(), [], 'Tasks without a site do not create a site deadline');
      await db.query('UPDATE public.gradiliste_zadaci SET gradiliste_id=$2 WHERE id=$1', [task, secondSite]);

      await db.query("UPDATE public.rokovi SET datum_pocetka='2026-11-01',opis='Povijesni raspon' WHERE zadatak_id=$1", [task]);
      const historical = await deadlines();
      const originalTask = await taskData();
      for (const [table, id] of [['gradiliste_zadaci', task], ['gradilista', secondSite]]) {
        const deleted = (await db.query('SELECT public.delete_resource_with_history($1,$2) id', [table, id])).rows[0].id;
        assert.equal(await taskData(), undefined);
        await db.query('SELECT public.restore_resource_deletion($1)', [deleted]);
        assert.deepEqual(await taskData(), originalTask);
        assert.deepEqual(await deadlines(), historical, 'Restoring a bundle preserves the original deadline identity, period and notes, not a regenerated projection');
      }
      const beforeMetadata = await deadlines();
      await db.query('UPDATE public.gradiliste_zadaci SET gotovo_at=now() WHERE id=$1', [task]);
      assert.deepEqual(await deadlines(), beforeMetadata, 'Metadata-only edits must not reset a restored historical period');
      assert.equal((await db.query('SELECT count(*)::int count FROM private.deadline_sync_context')).rows[0].count, 0);
    });
    await t.test('task update packages restore exact task and deadline states, reject stale groups and enforce atomic rollback', async () => {
      await db.exec(sqlFile('migrations/20261110140000_zadaci_povijest_izmjena.sql'));
      const company='00000000-0000-0000-0000-000000000001';
      const actor='00000000-0000-0000-0000-000000000002';
      const other='00000000-0000-0000-0000-000000000006';
      const site='00000000-0000-0000-0000-000000001401';
      const task='00000000-0000-0000-0000-000000001402';
      await db.query("INSERT INTO public.gradilista(id,company_id,naziv) VALUES ($1,$2,'Povrat zadataka')",[site,company]);
      await db.query(`INSERT INTO public.gradiliste_zadaci(id,company_id,gradiliste_id,naziv,rok,gotovo,vrsta)
        VALUES ($1,$2,$3,'Izvorni zadatak','2026-11-09',false,'dodatni')`,[task,company,site]);
      const snapshot=async()=>({
        task:(await db.query('SELECT to_jsonb(z) data FROM public.gradiliste_zadaci z WHERE id=$1',[task])).rows[0]?.data,
        deadlines:(await db.query('SELECT to_jsonb(r) data FROM public.rokovi r WHERE zadatak_id=$1 ORDER BY id',[task])).rows.map(r=>r.data),
      });
      const history=async(before=null)=>(await db.query('SELECT * FROM public.get_task_change_history($1,$2)',[task,before])).rows;
      const restore=(id)=>db.query('SELECT public.restore_task_change($1)',[id]);
      await db.query("UPDATE public.rokovi SET datum_pocetka='2026-11-01',opis='Izvorni raspon' WHERE zadatak_id=$1",[task]);
      await db.query(`INSERT INTO public.rokovi(company_id,gradiliste_id,zadatak_id,naziv,datum,datum_pocetka,datum_zavrsetka,status,opis)
        VALUES ($1,$2,$3,'Drugi povijesni rok','2026-11-09','2026-11-02','2026-11-09','otvoren','Druga izvorna napomena')`,[company,site,task]);
      const original=await snapshot();
      assert.equal(original.deadlines.length,2);
      await db.query(`UPDATE public.gradiliste_zadaci SET naziv='Novi naziv',rok='2026-11-13',
        gotovo=true,gotovo_at=now(),kooperant_id='00000000-0000-0000-0000-000000000107' WHERE id=$1`,[task]);
      const first=(await history())[0];
      assert.equal(first.can_restore,true);
      assert.deepEqual(first.before_data,original.task);
      assert.deepEqual(first.before_deadlines,original.deadlines);
      const intermediate=await snapshot();
      await db.query('UPDATE public.gradiliste_zadaci SET rok=NULL WHERE id=$1',[task]);
      const second=(await history())[0];
      assert.deepEqual((await snapshot()).deadlines,[]);
      assert.equal((await history()).find(r=>r.id===first.id).can_restore,false);
      await assert.rejects(restore(first.id),e=>e.code==='40001');
      await restore(second.id);
      assert.deepEqual(await snapshot(),intermediate,'Undo restores original deadline identity, not a generated replacement');
      assert.equal((await history()).find(r=>r.id===first.id).can_restore,true);
      await restore(first.id);
      assert.deepEqual(await snapshot(),original,'Consecutive undo restores the historical range and note');
      await assert.rejects(restore(first.id),/već vraćeno/);
      assert.ok(!(await db.query('SELECT * FROM public.get_task_deletions()')).rows.some(r=>r.id===first.id));
      assert.ok(!(await db.query("SELECT * FROM public.get_resource_deletions('gradilista')")).rows.some(r=>r.id===first.id));

      await db.exec('BEGIN');
      await db.query('UPDATE public.gradiliste_zadaci SET rok=NULL WHERE id=$1',[task]);
      const withoutDeadline=await snapshot();
      await db.query("UPDATE public.gradiliste_zadaci SET rok='2026-11-16' WHERE id=$1",[task]);
      const inserted=(await history())[0];
      await db.exec(`CREATE TABLE public.test_unknown_deadline_child(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deadline_id uuid REFERENCES public.rokovi(id) ON DELETE CASCADE);
        INSERT INTO public.test_unknown_deadline_child(deadline_id) SELECT id FROM public.rokovi WHERE zadatak_id='${task}';
        SAVEPOINT before_undo;`);
      await assert.rejects(restore(inserted.id),/test_unknown_deadline_child/);
      await db.exec('ROLLBACK TO SAVEPOINT before_undo');
      assert.equal((await db.query('SELECT count(*)::int count FROM public.test_unknown_deadline_child')).rows[0].count,1);
      const beforeUnknownCascade=await snapshot();
      await assert.rejects(db.query('UPDATE public.gradiliste_zadaci SET rok=NULL WHERE id=$1',[task]),/test_unknown_deadline_child/);
      await db.exec('ROLLBACK TO SAVEPOINT before_undo');
      assert.deepEqual(await snapshot(),beforeUnknownCascade,'Unknown cascades must also block task editing before any child is deleted');
      await db.exec('DROP TABLE public.test_unknown_deadline_child');
      await restore(inserted.id);
      assert.deepEqual(await snapshot(),withoutDeadline,'Undo of a newly generated deadline removes it without removing the task');
      await db.exec('ROLLBACK');

      await db.exec('BEGIN');
      await db.exec(`CREATE FUNCTION public.test_skip_task_package() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RETURN NULL; END; $$;
        CREATE TRIGGER zzzz_test_skip_task_package BEFORE UPDATE ON public.gradiliste_zadaci
          FOR EACH ROW EXECUTE FUNCTION public.test_skip_task_package();
        SAVEPOINT before_write;`);
      await assert.rejects(db.query("UPDATE public.gradiliste_zadaci SET naziv='Preskočeno' WHERE id=$1",[task]),/nije dovršena/);
      await db.exec('ROLLBACK TO SAVEPOINT before_write');
      assert.deepEqual(await snapshot(),original);
      assert.equal((await db.query('SELECT count(*)::int count FROM private.resource_deletions WHERE active')).rows[0].count,0);
      await db.exec('ROLLBACK');

      await db.exec('BEGIN');
      await db.query("UPDATE public.gradiliste_zadaci SET naziv='Zadatak bez datuma',rok=NULL WHERE id=$1",[task]);
      const removal=(await history())[0];
      const noDeadline=await snapshot();
      await db.exec(`CREATE FUNCTION public.test_skip_deadline_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RETURN NULL; END; $$;
        CREATE TRIGGER test_skip_deadline_insert BEFORE INSERT ON public.rokovi
          FOR EACH ROW EXECUTE FUNCTION public.test_skip_deadline_insert();
        SAVEPOINT before_undo;`);
      await assert.rejects(restore(removal.id),/točan povrat/);
      await db.exec('ROLLBACK TO SAVEPOINT before_undo');
      assert.deepEqual(await snapshot(),noDeadline,'Failed deadline reinsertion must not restore only the task');
      await db.exec('ROLLBACK');

      await db.exec('BEGIN');
      await db.query("UPDATE public.gradiliste_zadaci SET kooperant_id='00000000-0000-0000-0000-000000000107' WHERE id=$1",[task]);
      await db.query('UPDATE public.gradiliste_zadaci SET kooperant_id=NULL WHERE id=$1',[task]);
      const detached=(await history())[0];
      await db.query("DELETE FROM public.kooperanti WHERE id='00000000-0000-0000-0000-000000000107'");
      await assert.rejects(restore(detached.id),e=>e.code==='23503');
      await db.exec('ROLLBACK');

      for (const change of [
        "UPDATE public.rokovi SET opis='Drugi opis' WHERE zadatak_id=$1",
        "UPDATE public.rokovi SET opis=opis WHERE zadatak_id=$1",
        `INSERT INTO public.rokovi(company_id,gradiliste_id,zadatak_id,naziv,datum,datum_pocetka,datum_zavrsetka,status)
          VALUES ('${company}','${site}',$1,'Dodatni rok','2026-11-15','2026-11-15','2026-11-15','otvoren')`,
      ]) {
        await db.exec('BEGIN');
        await db.query("UPDATE public.gradiliste_zadaci SET naziv='Nova izmjena' WHERE id=$1",[task]);
        const event=(await history())[0];
        await db.query(change,[task]);
        const before=await snapshot();
        await db.exec('SAVEPOINT before_undo');
        await assert.rejects(restore(event.id),e=>e.code==='40001');
        await db.exec('ROLLBACK TO SAVEPOINT before_undo');
        assert.deepEqual(await snapshot(),before);
        await db.exec('ROLLBACK');
      }
      await db.exec('BEGIN');
      await db.query("UPDATE public.gradiliste_zadaci SET naziv='ABA' WHERE id=$1",[task]);
      const aba=(await history())[0];
      const beforeAba=await snapshot();
      await db.query("UPDATE public.rokovi SET opis='Privremeni opis' WHERE zadatak_id=$1",[task]);
      for (const deadline of beforeAba.deadlines) await db.query('UPDATE public.rokovi SET opis=$2 WHERE id=$1',[deadline.id,deadline.opis]);
      assert.deepEqual(await snapshot(),beforeAba);
      await assert.rejects(restore(aba.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');

      for (const unsupported of ["vrsta='zadatak'","gradiliste_id=NULL","nalog_id='00000000-0000-0000-0000-000000000202'"]) {
        await db.exec('BEGIN');
        await db.query(`UPDATE public.gradiliste_zadaci SET naziv='Miješana izmjena',${unsupported} WHERE id=$1`,[task]);
        const event=(await history())[0];
        assert.equal(event.can_restore,false);
        await assert.rejects(db.query('SELECT public.restore_resource_deletion($1)',[event.id]),/nepodržana polja/);
        await db.exec('ROLLBACK');
      }
      await db.exec('BEGIN');
      await db.exec(`INSERT INTO public.rokovi(id,company_id,gradiliste_id,naziv,datum,datum_pocetka,datum_zavrsetka,status)
        VALUES ('00000000-0000-0000-0000-000000001409','${company}','${site}','Nevezani rok','2026-11-15','2026-11-15','2026-11-15','otvoren');
        CREATE FUNCTION public.test_task_extra_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN UPDATE public.rokovi SET naziv='Dodatna povezana izmjena' WHERE id='00000000-0000-0000-0000-000000001409'; RETURN NEW; END; $$;
        CREATE TRIGGER test_task_extra_deadline AFTER UPDATE ON public.gradiliste_zadaci
          FOR EACH ROW EXECUTE FUNCTION public.test_task_extra_deadline();`);
      await db.query("UPDATE public.gradiliste_zadaci SET naziv='Šira radnja' WHERE id=$1",[task]);
      const wider=(await history())[0];
      assert.equal(wider.can_restore,false,'A deadline without this task must not be treated as part of the task group');
      await assert.rejects(restore(wider.id),/dodatne povezane zapise/);
      await db.exec('ROLLBACK');
      for (const trigger of ['skip','mutate']) {
        await db.exec('BEGIN');
        await db.query("UPDATE public.gradiliste_zadaci SET naziv='Za povrat' WHERE id=$1",[task]);
        const event=(await history())[0];
        const before=await snapshot();
        await db.exec(`CREATE FUNCTION public.test_task_undo_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN ${trigger==='skip'?'RETURN NULL;':"NEW.naziv:='Promijenjeno triggerom'; RETURN NEW;"} END; $$;
          CREATE TRIGGER test_task_undo_deadline BEFORE UPDATE ON public.rokovi
            FOR EACH ROW EXECUTE FUNCTION public.test_task_undo_deadline();
          SAVEPOINT before_undo;`);
        await assert.rejects(restore(event.id),/točan povrat|Završna provjera/);
        await db.exec('ROLLBACK TO SAVEPOINT before_undo');
        assert.deepEqual(await snapshot(),before);
        assert.equal((await history())[0].reversed_at,null);
        await db.exec('ROLLBACK');
      }
      // Restoring a deleted task keeps its data, but conservatively invalidates prior group revisions.
      await db.query("UPDATE public.gradiliste_zadaci SET naziv='Prije brisanja' WHERE id=$1",[task]);
      const pending=(await history())[0];
      const beforeDelete=await snapshot();
      const deleted=(await db.query("SELECT public.delete_resource_with_history('gradiliste_zadaci',$1) id",[task])).rows[0].id;
      await db.query('SELECT public.restore_resource_deletion($1)',[deleted]);
      assert.deepEqual(await snapshot(),beforeDelete);
      await assert.rejects(restore(pending.id),e=>e.code==='40001');
      const packageCount=(await history()).length;
      const siteDeleted=(await db.query("SELECT public.delete_resource_with_history('gradilista',$1) id",[site])).rows[0].id;
      await db.query('SELECT public.restore_resource_deletion($1)',[siteDeleted]);
      assert.deepEqual(await snapshot(),beforeDelete);
      assert.equal((await history()).length,packageCount,'Parent restoration must not create spurious task-update packages');
      await assert.rejects(restore(pending.id),e=>e.code==='40001');
      await db.query("UPDATE public.gradiliste_zadaci SET naziv='Prava i rok' WHERE id=$1",[task]);
      const guarded=(await history())[0];
      await db.query("UPDATE private.resource_deletions SET expires_at=now()-interval '1 second' WHERE id=$1",[guarded.id]);
      assert.ok(!(await history()).some(r=>r.id===guarded.id));
      await assert.rejects(restore(guarded.id),/30 dana/);
      await db.query("UPDATE private.resource_deletions SET expires_at=now()+interval '30 days' WHERE id=$1",[guarded.id]);
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=false,approved=true WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(guarded.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='gradilista'; SET ROLE authenticated;`);
      await restore(guarded.id);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='00000000-0000-0000-0000-000000000005' WHERE id='${other}'; SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(pending.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false);`);
      for(let n=0;n<51;n++) await db.query("UPDATE public.gradiliste_zadaci SET naziv='Stranica '||$2 WHERE id=$1",[task,String(n)]);
      const page=await history();
      assert.equal(page.length,50);
      const next=await history(page.at(-1).sequence);
      assert.ok(next.length>0);
      assert.ok(next.every(r=>BigInt(r.sequence)<BigInt(page.at(-1).sequence)));
      await db.exec('SET ROLE anon');
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(pending.id),e=>e.code==='42501');
      await db.exec('RESET ROLE');
      assert.equal((await db.query('SELECT count(*)::int count FROM private.resource_deletions WHERE active')).rows[0].count,0);
    });
    await t.test('completing a source task removes linked open-order copies with recoverable history', async () => {
      await db.exec('ALTER TABLE public.radni_nalozi_stavke ADD COLUMN IF NOT EXISTS uzeto boolean NOT NULL DEFAULT false');
      await db.exec(sqlFile('migrations/20261110370000_kopirani_zadaci_izvor.sql'));
      await db.exec(sqlFile('migrations/20261110370000_kopirani_zadaci_izvor.sql'));
      const company='00000000-0000-0000-0000-000000000001';
      const site='00000000-0000-0000-0000-000000001701';
      const sourceOrder='00000000-0000-0000-0000-000000001702';
      const targetOrder='00000000-0000-0000-0000-000000001703';
      const secondTargetOrder='00000000-0000-0000-0000-000000001707';
      const source='00000000-0000-0000-0000-000000001704';
      const firstCopy='00000000-0000-0000-0000-000000001705';
      const secondCopy='00000000-0000-0000-0000-000000001706';
      await db.query("SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false)");
      await db.query("INSERT INTO public.gradilista(id,company_id,naziv) VALUES ($1,$2,'Kopirani zadaci')",[site,company]);
      await db.query(`INSERT INTO public.radni_nalozi(id,company_id,broj,naslov,gradiliste_id)
        VALUES ($1,$4,'RN-SOURCE','Izvorni nalog',$5),($2,$4,'RN-COPY','Novi nalog',$5),
          ($3,$4,'RN-COPY-2','Drugi novi nalog',$5)`,
      [sourceOrder,targetOrder,secondTargetOrder,company,site]);
      await db.query(`INSERT INTO public.gradiliste_zadaci(id,company_id,gradiliste_id,nalog_id,naziv,gotovo,vrsta)
        VALUES ($1,$2,$3,$4,'Izvorni dodatni rad',false,'dodatni')`,[source,company,site,sourceOrder]);
      await db.query(`INSERT INTO public.gradiliste_zadaci(id,company_id,gradiliste_id,nalog_id,naziv,gotovo,vrsta,izvor_zadatak_id)
        VALUES ($1,$2,$3,$4,'Kopija dodatnog rada',false,'dodatni',$5),
          ($6,$2,$3,$7,'Druga kopija dodatnog rada',false,'dodatni',$5)`,
      [firstCopy,company,site,targetOrder,source,secondCopy,secondTargetOrder]);

      await db.query('UPDATE public.gradiliste_zadaci SET gotovo=true,gotovo_at=now() WHERE id=$1',[source]);
      assert.equal((await db.query('SELECT count(*)::int count FROM public.gradiliste_zadaci WHERE id = ANY($1::uuid[])',
        [[firstCopy,secondCopy]])).rows[0].count,0);
      assert.equal((await db.query('SELECT gotovo FROM public.gradiliste_zadaci WHERE id=$1',[source])).rows[0].gotovo,true);
      const deletions=(await db.query(`SELECT id,record_id FROM private.resource_deletions
        WHERE table_name='gradiliste_zadaci' AND record_id=ANY($1::uuid[]) AND NOT active ORDER BY record_id`,
      [[firstCopy,secondCopy]])).rows;
      assert.equal(deletions.length,2);
      for (const deletion of deletions) {
        assert.equal((await db.query('SELECT private.resource_deletion_allowed($1) allowed',[deletion.id])).rows[0].allowed,true);
        await db.query('SELECT public.restore_resource_deletion($1)',[deletion.id]);
      }
      assert.equal((await db.query('SELECT count(*)::int count FROM public.gradiliste_zadaci WHERE id = ANY($1::uuid[])',
        [[firstCopy,secondCopy]])).rows[0].count,2,'Recovery may restore copies even though their source is now complete');
      await assert.rejects(db.query(`INSERT INTO public.gradiliste_zadaci(company_id,gradiliste_id,nalog_id,naziv,izvor_zadatak_id)
        VALUES ($1,$2,$3,'Zakašnjela kopija',$4)`,[company,site,targetOrder,source]),/izvorni zadatak nije dostupan|već riješen/i);
      assert.equal((await db.query('SELECT count(*)::int count FROM private.resource_deletions WHERE active')).rows[0].count,0);
    });
    await t.test('completing source material removes linked copies and allows bundle recovery', async () => {
      await db.exec(sqlFile('migrations/20261026074000_material_tool_checkbox_completion.sql'));
      const company='00000000-0000-0000-0000-000000000001';
      const site='00000000-0000-0000-0000-000000001711';
      const sourceOrder='00000000-0000-0000-0000-000000001712';
      const copyOrder='00000000-0000-0000-0000-000000001713';
      const nextOrder='00000000-0000-0000-0000-000000001714';
      const source='00000000-0000-0000-0000-000000001715';
      const copy='00000000-0000-0000-0000-000000001716';
      const nextCopy='00000000-0000-0000-0000-000000001717';
      await db.query("SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false)");
      await db.query("INSERT INTO public.gradilista(id,company_id,naziv) VALUES ($1,$2,'Materijal kopiran')",[site,company]);
      await db.query(`INSERT INTO public.radni_nalozi(id,company_id,broj,naslov,gradiliste_id)
        VALUES ($1,$4,'RN-MAT-SOURCE','Izvorni nalog',$5),($2,$4,'RN-MAT-COPY','Kopija naloga',$5),
          ($3,$4,'RN-MAT-NEXT','Sljedeći nalog',$5)`,
      [sourceOrder,copyOrder,nextOrder,company,site]);
      await db.query(`INSERT INTO public.radni_nalozi_stavke(id,company_id,gradiliste_id,nalog_id,tip,naziv,gotovo,uzeto,preneseno)
        VALUES ($1,$2,$3,$4,'materijal','Boja',false,false,false)`,
      [source,company,site,sourceOrder]);
      await db.query(`INSERT INTO public.radni_nalozi_stavke(id,company_id,gradiliste_id,nalog_id,tip,naziv,gotovo,uzeto,preneseno,izvor_materijal_id)
        VALUES ($1,$2,$3,$4,'materijal','Boja',false,false,false,$5),
          ($6,$2,$3,$7,'materijal','Boja',false,false,false,$1)`,
      [copy,company,site,copyOrder,source,nextCopy,nextOrder]);

      await db.query('UPDATE public.radni_nalozi_stavke SET uzeto=true WHERE id=$1',[source]);
      assert.equal((await db.query('SELECT gotovo,uzeto FROM public.radni_nalozi_stavke WHERE id=$1',[source])).rows[0].gotovo,true);
      assert.equal((await db.query('SELECT count(*)::int count FROM public.radni_nalozi_stavke WHERE id = ANY($1::uuid[])',
        [[copy,nextCopy]])).rows[0].count,0);
      const deletion=(await db.query(`SELECT id FROM private.resource_deletions
        WHERE table_name='radni_nalozi_stavke' AND module='radni_nalozi' AND NOT active
          AND record_id=ANY($1::uuid[])`,[[copy,nextCopy]])).rows[0];
      assert.ok(deletion);
      assert.equal((await db.query('SELECT count(*)::int count FROM private.resource_deletion_rows WHERE deletion_id=$1',
        [deletion.id])).rows[0].count,2);
      assert.equal((await db.query('SELECT private.resource_deletion_allowed($1) allowed',
        [deletion.id])).rows[0].allowed,true);
      await db.query('SELECT public.restore_resource_deletion($1)',[deletion.id]);
      assert.equal((await db.query('SELECT count(*)::int count FROM public.radni_nalozi_stavke WHERE id = ANY($1::uuid[])',
        [[copy,nextCopy]])).rows[0].count,2);
      assert.equal((await db.query('SELECT gotovo FROM public.radni_nalozi_stavke WHERE id=$1',[source])).rows[0].gotovo,true);
    });
    await t.test('completing source tool removes linked copies and allows bundle recovery', async () => {
      const company='00000000-0000-0000-0000-000000000001';
      const site='00000000-0000-0000-0000-000000001721';
      const sourceOrder='00000000-0000-0000-0000-000000001722';
      const copyOrder='00000000-0000-0000-0000-000000001723';
      const nextOrder='00000000-0000-0000-0000-000000001724';
      const source='00000000-0000-0000-0000-000000001725';
      const copy='00000000-0000-0000-0000-000000001726';
      const nextCopy='00000000-0000-0000-0000-000000001727';
      await db.query("SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false)");
      await db.query("INSERT INTO public.gradilista(id,company_id,naziv) VALUES ($1,$2,'Alat kopiran')",[site,company]);
      await db.query(`INSERT INTO public.radni_nalozi(id,company_id,broj,naslov,gradiliste_id)
        VALUES ($1,$4,'RN-TOOL-SOURCE','Izvorni nalog',$5),($2,$4,'RN-TOOL-COPY','Kopija naloga',$5),
          ($3,$4,'RN-TOOL-NEXT','Sljedeći nalog',$5)`,
      [sourceOrder,copyOrder,nextOrder,company,site]);
      await db.query(`INSERT INTO public.radni_nalozi_stavke(id,company_id,gradiliste_id,nalog_id,tip,naziv,gotovo,uzeto,preneseno)
        VALUES ($1,$2,$3,$4,'alat','Bušilica',false,false,false)`,
      [source,company,site,sourceOrder]);
      await db.query(`INSERT INTO public.radni_nalozi_stavke(id,company_id,gradiliste_id,nalog_id,tip,naziv,gotovo,uzeto,preneseno,izvor_alat_id)
        VALUES ($1,$2,$3,$4,'alat','Bušilica',false,false,false,$5),
          ($6,$2,$3,$7,'alat','Bušilica',false,false,false,$1)`,
      [copy,company,site,copyOrder,source,nextCopy,nextOrder]);

      await db.query('UPDATE public.radni_nalozi_stavke SET gotovo=true WHERE id=$1',[source]);
      assert.equal((await db.query('SELECT gotovo,uzeto FROM public.radni_nalozi_stavke WHERE id=$1',[source])).rows[0].gotovo,true);
      assert.equal((await db.query('SELECT count(*)::int count FROM public.radni_nalozi_stavke WHERE id = ANY($1::uuid[])',
        [[copy,nextCopy]])).rows[0].count,0);
      const deletion=(await db.query(`SELECT id FROM private.resource_deletions
        WHERE table_name='radni_nalozi_stavke' AND module='radni_nalozi' AND NOT active
          AND record_id=ANY($1::uuid[])`,[[copy,nextCopy]])).rows[0];
      assert.ok(deletion);
      assert.equal((await db.query('SELECT count(*)::int count FROM private.resource_deletion_rows WHERE deletion_id=$1',
        [deletion.id])).rows[0].count,2);
      assert.equal((await db.query('SELECT private.resource_deletion_allowed($1) allowed',
        [deletion.id])).rows[0].allowed,true);
      await db.query('SELECT public.restore_resource_deletion($1)',[deletion.id]);
      assert.equal((await db.query('SELECT count(*)::int count FROM public.radni_nalozi_stavke WHERE id = ANY($1::uuid[])',
        [[copy,nextCopy]])).rows[0].count,2);
      assert.equal((await db.query('SELECT gotovo FROM public.radni_nalozi_stavke WHERE id=$1',[source])).rows[0].gotovo,true);
    });
    await t.test('order header history restores title description priority and deadline with exact audit and latest-first conflict checks', async () => {
      await db.exec(`ALTER TABLE public.radni_nalozi ADD COLUMN opis text,ADD COLUMN prioritet text DEFAULT 'srednji',
        ADD COLUMN rok date,ADD COLUMN updated_at timestamptz DEFAULT now()`);
      await db.exec(sqlFile('migrations/20261110150000_nalozi_osnovni_podaci_povijest.sql'));
      await db.exec(sqlFile('migrations/20261110270000_nalog_rok_povijest_izmjena.sql'));
      const company='00000000-0000-0000-0000-000000000001';
      const actor='00000000-0000-0000-0000-000000000002';
      const other='00000000-0000-0000-0000-000000000006';
      const order='00000000-0000-0000-0000-000000001501';
      await db.query(`INSERT INTO public.radni_nalozi(id,company_id,broj,naslov,opis,prioritet,status,mobile_status,rok)
        VALUES ($1,$2,'RN-POVRAT','Izvorni naslov','Izvorni opis','srednji','otvoren','nije_poslan','2026-11-09')`,[order,company]);
      const snapshot=async()=>(await db.query('SELECT to_jsonb(n) data FROM public.radni_nalozi n WHERE id=$1',[order])).rows[0]?.data;
      const history=async(before=null)=>(await db.query('SELECT * FROM public.get_order_change_history($1,$2)',[order,before])).rows;
      const restore=(id)=>db.query('SELECT public.restore_order_change($1)',[id]);
      const initial=await snapshot();
      await db.query("UPDATE public.radni_nalozi SET naslov='Novo',opis=NULL,prioritet='hitno' WHERE id=$1",[order]);
      const first=(await history())[0];
      assert.equal(first.can_restore,true);
      await db.query("UPDATE public.radni_nalozi SET opis='Drugi opis' WHERE id=$1",[order]);
      const second=(await history())[0];
      assert.equal((await history()).find(h=>h.id===first.id).can_restore,false);
      await assert.rejects(restore(first.id),e=>e.code==='40001');
      await restore(second.id);
      await restore(first.id);
      assert.deepEqual(await snapshot(),initial);
      await assert.rejects(restore(first.id),e=>e.code==='40001');
      const reversal=(await history()).find(h=>h.reverses_id===first.id);
      assert.ok(reversal);
      assert.equal(reversal.can_restore,false);
      await assert.rejects(restore(reversal.id),e=>e.code==='40001');
      await db.query("UPDATE public.radni_nalozi SET rok='2026-11-20' WHERE id=$1",[order]);
      const deadline=(await history())[0];
      assert.equal(deadline.can_restore,true);
      await restore(deadline.id);
      assert.deepEqual(await snapshot(),initial,'A standalone order deadline change restores exactly');
      for(const field of ["status='zavrsen'","mobile_status='u_tijeku'","broj='RN-DRUGI'"]) {
        await db.exec('BEGIN');
        await db.query(`UPDATE public.radni_nalozi SET naslov='Miješano',${field} WHERE id=$1`,[order]);
        const event=(await history())[0];
        assert.equal(event.can_restore,false);
        const unchanged=await snapshot();
        await db.exec('SAVEPOINT before_undo');
        await assert.rejects(restore(event.id),/zajednički povrat/);
        await db.exec('ROLLBACK TO SAVEPOINT before_undo');
        assert.deepEqual(await snapshot(),unchanged);
        await db.exec('ROLLBACK');
      }
      await db.exec('BEGIN');
      await db.query("UPDATE public.radni_nalozi SET naslov='Za ABA' WHERE id=$1",[order]);
      const aba=(await history())[0];
      await db.query("UPDATE public.radni_nalozi SET status='u_tijeku' WHERE id=$1",[order]);
      await db.query("UPDATE public.radni_nalozi SET status='otvoren' WHERE id=$1",[order]);
      await assert.rejects(restore(aba.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');
      await db.query("UPDATE public.radni_nalozi SET opis='Za povrat nakon brisanja' WHERE id=$1",[order]);
      const beforeDelete=(await history())[0];
      const deletion=(await db.query("SELECT public.delete_resource_with_history('radni_nalozi',$1) id",[order])).rows[0].id;
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(beforeDelete.id),/obrisan/);
      await db.query('SELECT public.restore_resource_deletion($1)',[deletion]);
      await restore(beforeDelete.id);
      assert.deepEqual(await snapshot(),initial,'Whole-order restoration reconnects previous update audit lineage');

      for(const mode of ['skip','mutate','untracked']) {
        await db.exec('BEGIN');
        await db.query("UPDATE public.radni_nalozi SET opis='Pokušaj povrata' WHERE id=$1",[order]);
        const event=(await history())[0];
        const before=await snapshot();
        if(mode==='untracked') {
          await db.exec('ALTER TABLE public.radni_nalozi DISABLE TRIGGER order_change_history');
          await db.query("UPDATE public.radni_nalozi SET prioritet='visoki' WHERE id=$1",[order]);
          await db.exec('ALTER TABLE public.radni_nalozi ENABLE TRIGGER order_change_history; SAVEPOINT before_undo');
          await assert.rejects(restore(event.id),e=>e.code==='40001');
          await db.exec('ROLLBACK TO SAVEPOINT before_undo');
          assert.equal((await snapshot()).prioritet,'visoki');
        } else {
          await db.exec(`CREATE FUNCTION public.test_order_undo() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN ${mode==='skip'?'RETURN NULL;':"NEW.prioritet:='niski'; RETURN NEW;"} END; $$;
            CREATE TRIGGER test_order_undo BEFORE UPDATE ON public.radni_nalozi
              FOR EACH ROW EXECUTE FUNCTION public.test_order_undo();
            SAVEPOINT before_undo;`);
          await assert.rejects(restore(event.id),/točan povrat/);
          await db.exec('ROLLBACK TO SAVEPOINT before_undo');
          assert.deepEqual(await snapshot(),before);
        }
        assert.equal((await history()).find(h=>h.id===event.id).reversed_at,null);
        await db.exec('ROLLBACK');
      }
      await db.query("UPDATE public.radni_nalozi SET opis='Ovlasti' WHERE id=$1",[order]);
      const guarded=(await history())[0];
      await db.query("UPDATE private.business_change_history SET expires_at=now()-interval '1 second' WHERE id=$1",[guarded.id]);
      assert.ok(!(await history()).some(h=>h.id===guarded.id));
      await assert.rejects(restore(guarded.id),/30 dana/);
      await db.query("UPDATE private.business_change_history SET expires_at=now()+interval '30 days' WHERE id=$1",[guarded.id]);
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=false,approved=true WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(guarded.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='radni_nalozi'; SET ROLE authenticated;`);
      await restore(guarded.id);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='00000000-0000-0000-0000-000000000005' WHERE id='${other}'; SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(first.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false)`);
      for(let n=0;n<51;n++)await db.query('UPDATE public.radni_nalozi SET opis=$2 WHERE id=$1',[order,String(n)]);
      const page=await history();
      assert.equal(page.length,50);
      const next=await history(page.at(-1).sequence);
      assert.ok(next.length>0);
      assert.ok(next.every(h=>BigInt(h.sequence)<BigInt(page.at(-1).sequence)));
      const insert=(await db.query("SELECT id FROM private.business_change_history WHERE record_id=$1 AND table_name='radni_nalozi' AND operation='INSERT' ORDER BY sequence LIMIT 1",[order])).rows[0];
      await assert.rejects(restore(insert.id),e=>e.code==='42501');
      await db.exec('SET ROLE anon');
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(first.id),e=>e.code==='42501');
      await db.exec('RESET ROLE');
    });
    await t.test('investor master history restores exact contact and registry fields without rewriting related business records', async () => {
      await db.exec(`ALTER TABLE public.investitori ADD COLUMN oib text,ADD COLUMN adresa text,ADD COLUMN mjesto text,
        ADD COLUMN postanski_broj text,ADD COLUMN kontakt_osoba text,ADD COLUMN telefon text,ADD COLUMN email text,
        ADD COLUMN web text,ADD COLUMN napomena text,ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN updated_at timestamptz DEFAULT now();
        ALTER TABLE public.objekti ADD COLUMN investitor_id uuid REFERENCES public.investitori(id) ON DELETE RESTRICT;
        CREATE TABLE public.test_investor_contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          investitor_id uuid REFERENCES public.investitori(id) ON DELETE CASCADE,ime text,telefon text);
      `);
      await db.exec(sqlFile('migrations/20261110160000_investitori_povijest_izmjena.sql'));
      const company='00000000-0000-0000-0000-000000000001';
      const actor='00000000-0000-0000-0000-000000000002';
      const other='00000000-0000-0000-0000-000000000006';
      const investor='00000000-0000-0000-0000-000000001601';
      const object='00000000-0000-0000-0000-000000001602';
      const invoice='00000000-0000-0000-0000-000000001603';
      await db.query(`INSERT INTO public.investitori(id,company_id,naziv,oib,adresa,mjesto,postanski_broj,kontakt_osoba,
        telefon,email,web,napomena) VALUES ($1,$2,'Izvorni investitor','00000000001','Izvorna 1','Zagreb','10000',
        'Ana Izvorna','012345678','ana@example.test','https://example.test','Izvorna napomena')`,[investor,company]);
      await db.query("INSERT INTO public.objekti(id,company_id,naziv,investitor_id) VALUES ($1,$2,'Izvorni objekt',$3)",[object,company,investor]);
      await db.query(`INSERT INTO public.fakture(id,company_id,investitor_id,broj,kupac,iznos,status)
        VALUES ($1,$2,$3,'INV-HISTORY','Povijesni kupac',1234.56,'izdana')`,[invoice,company,investor]);
      await db.query("INSERT INTO public.test_investor_contacts(investitor_id,ime,telefon) VALUES ($1,'Posebni kontakt','099999')",[investor]);
      const snapshot=async()=>(await db.query('SELECT to_jsonb(i) data FROM public.investitori i WHERE id=$1',[investor])).rows[0]?.data;
      const history=async(before=null)=>(await db.query('SELECT * FROM public.get_investor_change_history($1,$2)',[investor,before])).rows;
      const restore=(id)=>db.query('SELECT public.restore_investor_change($1)',[id]);
      const related=async()=>({
        object:(await db.query('SELECT to_jsonb(o) data FROM public.objekti o WHERE id=$1',[object])).rows,
        invoice:(await db.query('SELECT to_jsonb(f) data FROM public.fakture f WHERE id=$1',[invoice])).rows,
        contacts:(await db.query('SELECT to_jsonb(c) data FROM public.test_investor_contacts c WHERE investitor_id=$1',[investor])).rows,
      });
      const ignoreTime=({updated_at,...row})=>row;
      const original=await snapshot();
      const originalRelated=await related();
      const initialCount=(await db.query("SELECT count(*)::int count FROM private.business_change_history WHERE record_id=$1 AND table_name='investitori'",[investor])).rows[0].count;
      await db.query('UPDATE public.investitori SET updated_at=clock_timestamp() WHERE id=$1',[investor]);
      assert.equal((await db.query("SELECT count(*)::int count FROM private.business_change_history WHERE record_id=$1 AND table_name='investitori'",[investor])).rows[0].count,initialCount);
      await db.query(`UPDATE public.investitori SET naziv='Novo',oib='00000000002',adresa=NULL,mjesto='Split',
        postanski_broj='21000',kontakt_osoba='Ivan',telefon=NULL,email='ivan@example.test',
        web=NULL,napomena='Nova napomena',updated_at=clock_timestamp() WHERE id=$1`,[investor]);
      const first=(await history())[0];
      assert.equal(first.can_restore,true);
      assert.deepEqual(ignoreTime(first.before_data),ignoreTime(original));
      await db.query("UPDATE public.investitori SET napomena='Druga izmjena' WHERE id=$1",[investor]);
      const second=(await history())[0];
      await assert.rejects(restore(first.id),e=>e.code==='40001');
      await restore(second.id);
      await restore(first.id);
      assert.deepEqual(ignoreTime(await snapshot()),ignoreTime(original));
      assert.deepEqual(await related(),originalRelated,'Investor undo must not change invoices, objects or separately stored contacts');
      await assert.rejects(restore(first.id),e=>e.code==='40001');
      const reversal=(await history()).find(h=>h.reverses_id===first.id);
      assert.ok(reversal);
      assert.equal(reversal.can_restore,false);
      await assert.rejects(restore(reversal.id),e=>e.code==='40001');

      await db.exec('BEGIN');
      await db.query("UPDATE public.investitori SET naziv='Miješana izmjena',created_at=created_at+interval '1 day' WHERE id=$1",[investor]);
      const unsupported=(await history())[0];
      assert.equal(unsupported.can_restore,false);
      await assert.rejects(restore(unsupported.id),/nepodržana polja/);
      await db.exec('ROLLBACK');
      await db.exec('BEGIN');
      await db.query("UPDATE public.investitori SET naziv='Za ABA' WHERE id=$1",[investor]);
      const aba=(await history())[0];
      await db.query("UPDATE public.investitori SET mjesto='Privremeno' WHERE id=$1",[investor]);
      await db.query("UPDATE public.investitori SET mjesto='Zagreb' WHERE id=$1",[investor]);
      await assert.rejects(restore(aba.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');
      await db.exec('BEGIN');
      await db.query("UPDATE public.investitori SET naziv='Snimka' WHERE id=$1",[investor]);
      const mismatch=(await history())[0];
      await db.exec('ALTER TABLE public.investitori DISABLE TRIGGER investor_change_history');
      await db.query("UPDATE public.investitori SET telefon='099000' WHERE id=$1",[investor]);
      await db.exec('ALTER TABLE public.investitori ENABLE TRIGGER investor_change_history');
      await assert.rejects(restore(mismatch.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');

      for(const mode of ['skip','mutate','missing-audit']) {
        await db.exec('BEGIN');
        await db.query("UPDATE public.investitori SET naziv='Za povrat' WHERE id=$1",[investor]);
        const event=(await history())[0];
        const before=await snapshot();
        const count=(await db.query('SELECT count(*)::int count FROM private.business_change_history WHERE record_id=$1',[investor])).rows[0].count;
        if(mode==='missing-audit')await db.exec('ALTER TABLE public.investitori DISABLE TRIGGER investor_change_history');
        else await db.exec(`CREATE FUNCTION public.test_investor_undo() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN ${mode==='skip'?'RETURN NULL;':"NEW.email:='changed@example.test'; RETURN NEW;"} END; $$;
          CREATE TRIGGER test_investor_undo BEFORE UPDATE ON public.investitori
            FOR EACH ROW EXECUTE FUNCTION public.test_investor_undo();`);
        await db.exec('SAVEPOINT before_undo');
        await assert.rejects(restore(event.id),mode==='missing-audit'?/nije evidentiran/:/točan povrat/);
        await db.exec('ROLLBACK TO SAVEPOINT before_undo');
        assert.deepEqual(await snapshot(),before);
        assert.equal((await history()).find(h=>h.id===event.id).reversed_at,null);
        assert.equal((await db.query('SELECT count(*)::int count FROM private.business_change_history WHERE record_id=$1',[investor])).rows[0].count,count);
        assert.deepEqual(await related(),originalRelated);
        await db.exec('ROLLBACK');
      }
      await db.exec('BEGIN');
      const permissionBefore=(await db.query('SELECT to_jsonb(p) data FROM public.app_user_permissions p ORDER BY user_id,module')).rows;
      const profilesBefore=(await db.query('SELECT to_jsonb(p) data FROM public.app_profiles p ORDER BY id')).rows;
      await db.query('DELETE FROM public.objekti WHERE id=$1',[object]);
      await db.query("UPDATE public.investitori SET naziv='Prije brisanja' WHERE id=$1",[investor]);
      const deleted=(await history())[0];
      await db.query('DELETE FROM public.investitori WHERE id=$1',[investor]);
      await db.exec('SAVEPOINT after_delete');
      await assert.rejects(history(),e=>e.code==='42501');
      await db.exec('ROLLBACK TO SAVEPOINT after_delete');
      await assert.rejects(restore(deleted.id),/obrisan/);
      await db.exec('ROLLBACK TO SAVEPOINT after_delete');
      assert.equal(await snapshot(),undefined);
      await db.query('INSERT INTO public.investitori SELECT * FROM jsonb_populate_record(NULL::public.investitori,$1)',[deleted.after_data]);
      await db.exec('SAVEPOINT after_reinsert');
      await assert.rejects(restore(deleted.id),e=>e.code==='40001');
      await db.exec('ROLLBACK TO SAVEPOINT after_reinsert');
      assert.deepEqual((await db.query('SELECT to_jsonb(p) data FROM public.app_user_permissions p ORDER BY user_id,module')).rows,permissionBefore);
      assert.deepEqual((await db.query('SELECT to_jsonb(p) data FROM public.app_profiles p ORDER BY id')).rows,profilesBefore);
      await db.exec('ROLLBACK');
      await db.query("UPDATE public.investitori SET napomena='Prava i rok' WHERE id=$1",[investor]);
      const guarded=(await history())[0];
      await db.query("UPDATE private.business_change_history SET expires_at=now()-interval '1 second' WHERE id=$1",[guarded.id]);
      assert.ok(!(await history()).some(h=>h.id===guarded.id));
      await assert.rejects(restore(guarded.id),/30 dana/);
      await db.query("UPDATE private.business_change_history SET expires_at=now()+interval '30 days' WHERE id=$1",[guarded.id]);
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=false,approved=true WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(guarded.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; INSERT INTO public.app_user_permissions(user_id,module,can_view,can_edit) VALUES ('${other}','investitori',true,false); SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(guarded.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='investitori'; SET ROLE authenticated;`);
      await restore(guarded.id);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='00000000-0000-0000-0000-000000000005' WHERE id='${other}'; SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(first.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false)`);
      for(let n=0;n<51;n++)await db.query('UPDATE public.investitori SET napomena=$2 WHERE id=$1',[investor,String(n)]);
      const page=await history();
      assert.equal(page.length,50);
      const next=await history(page.at(-1).sequence);
      assert.ok(next.length>0);
      assert.ok(next.every(h=>BigInt(h.sequence)<BigInt(page.at(-1).sequence)));
      const insert=(await db.query("SELECT id FROM private.business_change_history WHERE record_id=$1 AND table_name='investitori' AND operation='INSERT' ORDER BY sequence LIMIT 1",[investor])).rows[0];
      await assert.rejects(restore(insert.id),e=>e.code==='42501');
      await db.exec('SET ROLE anon');
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(first.id),e=>e.code==='42501');
      await db.exec('RESET ROLE');
      assert.deepEqual(await related(),originalRelated);
    });
    await t.test('object master changes restore exact fields and investor links without altering knowledge, sites or finances', async () => {
      await db.exec(`ALTER TABLE public.objekti ADD COLUMN adresa text,ADD COLUMN mjesto text,ADD COLUMN postanski_broj text,
        ADD COLUMN kontakt_osoba text,ADD COLUMN telefon text,ADD COLUMN napomena text,
        ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN updated_at timestamptz DEFAULT now();
        ALTER TABLE public.objekti ADD CONSTRAINT test_object_name UNIQUE(company_id,investitor_id,naziv);
      `);
      await db.exec(sqlFile('migrations/20261108100000_objekt_znanje.sql'));
      await db.exec(sqlFile('migrations/20261110170000_objekti_povijest_izmjena.sql'));
      const company='00000000-0000-0000-0000-000000000001';
      const foreignCompany='00000000-0000-0000-0000-000000000005';
      const actor='00000000-0000-0000-0000-000000000002';
      const other='00000000-0000-0000-0000-000000000006';
      const object='00000000-0000-0000-0000-000000001701';
      const investor='00000000-0000-0000-0000-000000001702';
      const nextInvestor='00000000-0000-0000-0000-000000001703';
      const site='00000000-0000-0000-0000-000000001704';
      const invoice='00000000-0000-0000-0000-000000001705';
      const duplicate='00000000-0000-0000-0000-000000001706';
      await db.query(`INSERT INTO public.investitori(id,company_id,naziv) VALUES ($1,$3,'Izvorni investitor'),($2,$3,'Drugi investitor')`,[investor,nextInvestor,company]);
      await db.query(`INSERT INTO public.objekti(id,company_id,naziv,investitor_id,adresa,mjesto,postanski_broj,kontakt_osoba,telefon,napomena,znanje)
        VALUES ($1,$2,'Izvorni objekt',$3,'Izvorna 1','Zagreb','10000','Ana',NULL,'Izvorna napomena',
        '[{"id":"knowledge","kategorija":"Materijali","naslov":"Izvorno znanje","opis":"Ne prepisivati"}]')`,[object,company,investor]);
      await db.query(`INSERT INTO public.gradilista(id,company_id,naziv,objekt_id) VALUES ($1,$2,'Povezano gradilište',$3)`,[site,company,object]);
      await db.query(`INSERT INTO public.fakture(id,company_id,investitor_id,gradiliste_id,broj,kupac,iznos,status)
        VALUES ($1,$2,$3,$4,'OBJECT-HISTORY','Povijesni kupac',987.65,'izdana')`,[invoice,company,investor,site]);
      const snapshot=async()=>(await db.query('SELECT to_jsonb(o) data FROM public.objekti o WHERE id=$1',[object])).rows[0]?.data;
      const history=async(before=null)=>(await db.query('SELECT * FROM public.get_object_change_history($1,$2)',[object,before])).rows;
      const restore=id=>db.query('SELECT public.restore_object_change($1)',[id]);
      const related=async()=>({
        site:(await db.query('SELECT to_jsonb(s) data FROM public.gradilista s WHERE id=$1',[site])).rows,
        invoice:(await db.query('SELECT to_jsonb(f) data FROM public.fakture f WHERE id=$1',[invoice])).rows,
        investors:(await db.query('SELECT to_jsonb(i) data FROM public.investitori i WHERE id IN ($1,$2) ORDER BY id',[investor,nextInvestor])).rows,
      });
      const withoutTime=({updated_at,...row})=>row;
      const original=await snapshot();
      const originalRelated=await related();
      const initialCount=(await db.query("SELECT count(*)::int count FROM private.business_change_history WHERE record_id=$1 AND table_name='objekti'",[object])).rows[0].count;
      await db.query('UPDATE public.objekti SET updated_at=clock_timestamp() WHERE id=$1',[object]);
      assert.equal((await db.query("SELECT count(*)::int count FROM private.business_change_history WHERE record_id=$1 AND table_name='objekti'",[object])).rows[0].count,initialCount);
      await db.query(`UPDATE public.objekti SET naziv='Novo',investitor_id=$2,adresa=NULL,mjesto='Split',postanski_broj='21000',
        kontakt_osoba='Ivan',telefon='099111',napomena=NULL WHERE id=$1`,[object,nextInvestor]);
      const first=(await history())[0];
      assert.equal(first.can_restore,true);
      assert.deepEqual(withoutTime(first.before_data),withoutTime(original));
      await db.query("UPDATE public.objekti SET napomena='Druga izmjena' WHERE id=$1",[object]);
      const second=(await history())[0];
      await assert.rejects(restore(first.id),e=>e.code==='40001');
      await restore(second.id);
      await restore(first.id);
      assert.deepEqual(withoutTime(await snapshot()),withoutTime(original));
      assert.deepEqual(await related(),originalRelated);
      await assert.rejects(restore(first.id),e=>e.code==='40001');
      const reversal=(await history()).find(h=>h.reverses_id===first.id);
      assert.ok(reversal);
      assert.equal(reversal.can_restore,false);
      await assert.rejects(restore(reversal.id),e=>e.code==='40001');

      for(const field of ['created_at','znanje']){
        await db.exec('BEGIN');
        await db.query(`UPDATE public.objekti SET naziv='Miješana izmjena',
          ${field==='created_at'?"created_at=created_at+interval '1 day'":`znanje='[{"id":"new","naslov":"Novo znanje"}]'`} WHERE id=$1`,[object]);
        const unsupported=(await history())[0];
        assert.equal(unsupported.can_restore,false);
        await assert.rejects(restore(unsupported.id),/nepodržana polja/);
        await db.exec('ROLLBACK');
      }
      await db.exec('BEGIN');
      await db.query("UPDATE public.objekti SET naziv='Prije znanja' WHERE id=$1",[object]);
      const beforeKnowledge=(await history())[0];
      await db.query(`UPDATE public.objekti SET znanje='[{"id":"new","naslov":"Novo znanje"}]' WHERE id=$1`,[object]);
      assert.equal((await history())[0].can_restore,false);
      await assert.rejects(restore(beforeKnowledge.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');
      await db.exec('BEGIN');
      await db.query("UPDATE public.objekti SET naziv='Za ABA' WHERE id=$1",[object]);
      const aba=(await history())[0];
      await db.query("UPDATE public.objekti SET mjesto='Privremeno' WHERE id=$1",[object]);
      await db.query("UPDATE public.objekti SET mjesto='Zagreb' WHERE id=$1",[object]);
      await assert.rejects(restore(aba.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');
      await db.exec('BEGIN');
      await db.query("UPDATE public.objekti SET naziv='Snimka' WHERE id=$1",[object]);
      const mismatch=(await history())[0];
      await db.exec('ALTER TABLE public.objekti DISABLE TRIGGER object_change_history');
      await db.query("UPDATE public.objekti SET telefon='099000' WHERE id=$1",[object]);
      await db.exec('ALTER TABLE public.objekti ENABLE TRIGGER object_change_history');
      await assert.rejects(restore(mismatch.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');

      for(const mode of ['skip','mutate','missing-audit','unique']){
        await db.exec('BEGIN');
        await db.query("UPDATE public.objekti SET naziv='Za povrat' WHERE id=$1",[object]);
        const event=(await history())[0];
        const before=await snapshot();
        const count=(await db.query("SELECT count(*)::int count FROM private.business_change_history WHERE record_id=$1 AND table_name='objekti'",[object])).rows[0].count;
        if(mode==='missing-audit')await db.exec('ALTER TABLE public.objekti DISABLE TRIGGER object_change_history');
        else if(mode==='unique')await db.query("INSERT INTO public.objekti(id,company_id,naziv,investitor_id) VALUES ($1,$2,'Izvorni objekt',$3)",[duplicate,company,investor]);
        else await db.exec(`CREATE FUNCTION public.test_object_undo() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN ${mode==='skip'?'RETURN NULL;':"NEW.telefon:='changed'; RETURN NEW;"} END; $$;
          CREATE TRIGGER test_object_undo BEFORE UPDATE ON public.objekti
            FOR EACH ROW EXECUTE FUNCTION public.test_object_undo();`);
        await db.exec('SAVEPOINT before_undo');
        await assert.rejects(restore(event.id),mode==='missing-audit'?/nije evidentiran/:mode==='unique'?e=>e.code==='23505':/točan povrat/);
        await db.exec('ROLLBACK TO SAVEPOINT before_undo');
        assert.deepEqual(await snapshot(),before);
        assert.equal((await history()).find(h=>h.id===event.id).reversed_at,null);
        assert.equal((await db.query("SELECT count(*)::int count FROM private.business_change_history WHERE record_id=$1 AND table_name='objekti'",[object])).rows[0].count,count);
        assert.deepEqual(await related(),originalRelated);
        await db.exec('ROLLBACK');
      }
      for(const mode of ['missing','foreign','current-foreign']){
        await db.exec('BEGIN');
        await db.query('UPDATE public.objekti SET investitor_id=$2 WHERE id=$1',[object,nextInvestor]);
        const event=(await history())[0];
        const parent=mode==='current-foreign'?nextInvestor:investor;
        // Release the invoice reference only inside this rolled-back missing-parent fixture.
        await db.query('UPDATE public.fakture SET investitor_id=NULL WHERE id=$1',[invoice]);
        if(mode==='current-foreign')await db.exec('ALTER TABLE public.objekti DROP CONSTRAINT objekti_investitor_id_fkey');
        await db.query('DELETE FROM public.investitori WHERE id=$1',[parent]);
        if(mode!=='missing')await db.query("INSERT INTO public.investitori(id,company_id,naziv) VALUES ($1,$2,'Tuđi investitor')",[parent,foreignCompany]);
        const blocked=(await history()).find(h=>h.id===event.id);
        assert.equal(blocked.can_restore,false);
        assert.match(blocked.blocked_reason,/investitor.*tvrtki/);
        await assert.rejects(restore(event.id),e=>e.code==='40001');
        await db.exec('ROLLBACK');
      }
      await db.exec('BEGIN');
      await db.query('UPDATE public.objekti SET investitor_id=NULL WHERE id=$1',[object]);
      const nullEvent=(await history())[0];
      assert.equal(nullEvent.can_restore,true);
      await restore(nullEvent.id);
      assert.equal((await snapshot()).investitor_id,investor);
      await db.query('UPDATE public.objekti SET investitor_id=NULL WHERE id=$1',[object]);
      await db.query('UPDATE public.objekti SET investitor_id=$2 WHERE id=$1',[object,nextInvestor]);
      const fromNull=(await history())[0];
      await restore(fromNull.id);
      assert.equal((await snapshot()).investitor_id,null,'Legacy unassigned object remains unassigned');
      await db.exec('ROLLBACK');
      await db.exec('BEGIN');
      await db.query("UPDATE public.objekti SET naziv='Prije brisanja' WHERE id=$1",[object]);
      const deleted=(await history())[0];
      await db.query('DELETE FROM public.objekti WHERE id=$1',[object]);
      await db.exec('SAVEPOINT after_delete');
      await assert.rejects(history(),e=>e.code==='42501');
      await db.exec('ROLLBACK TO SAVEPOINT after_delete');
      await assert.rejects(restore(deleted.id),/obrisan/);
      await db.exec('ROLLBACK TO SAVEPOINT after_delete');
      await db.query('INSERT INTO public.objekti SELECT * FROM jsonb_populate_record(NULL::public.objekti,$1)',[deleted.after_data]);
      await db.exec('SAVEPOINT after_reinsert');
      await assert.rejects(restore(deleted.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');

      await db.query("UPDATE public.objekti SET napomena='Prava i rok' WHERE id=$1",[object]);
      const guarded=(await history())[0];
      await db.query("UPDATE private.business_change_history SET expires_at=now()-interval '1 second' WHERE id=$1",[guarded.id]);
      assert.ok(!(await history()).some(h=>h.id===guarded.id));
      await assert.rejects(restore(guarded.id),/30 dana/);
      await db.query("UPDATE private.business_change_history SET expires_at=now()+interval '30 days' WHERE id=$1",[guarded.id]);
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=false,approved=true WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(guarded.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; INSERT INTO public.app_user_permissions(user_id,module,can_view,can_edit) VALUES ('${other}','objekti',true,false); SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(guarded.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='objekti'; SET ROLE authenticated;`);
      await restore(guarded.id);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='${foreignCompany}' WHERE id='${other}'; SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(first.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false)`);
      for(let n=0;n<51;n++)await db.query('UPDATE public.objekti SET napomena=$2 WHERE id=$1',[object,String(n)]);
      const page=await history();
      assert.equal(page.length,50);
      const next=await history(page.at(-1).sequence);
      assert.ok(next.length>0);
      assert.ok(next.every(h=>BigInt(h.sequence)<BigInt(page.at(-1).sequence)));
      const inserted=(await db.query("SELECT id FROM private.business_change_history WHERE record_id=$1 AND table_name='objekti' AND operation='INSERT' ORDER BY sequence LIMIT 1",[object])).rows[0];
      await assert.rejects(restore(inserted.id),e=>e.code==='42501');
      await db.exec('SET ROLE anon');
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(first.id),e=>e.code==='42501');
      await db.exec('RESET ROLE');
      assert.deepEqual(await related(),originalRelated);
    });
    await t.test('cooperator profile history restores all registry fields and timeline color without changing financial or operational rows', async () => {
      await db.exec(`ALTER TABLE public.kooperanti ADD COLUMN djelatnost text,ADD COLUMN oib text,ADD COLUMN iban text,
        ADD COLUMN adresa text,ADD COLUMN mjesto text,ADD COLUMN postanski_broj text,ADD COLUMN kontakt_osoba text,
        ADD COLUMN telefon text,ADD COLUMN email text,ADD COLUMN web text,ADD COLUMN napomena text,
        ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN updated_at timestamptz DEFAULT now();
        ALTER TABLE public.kooperant_angazmani ADD COLUMN kooperant_id uuid REFERENCES public.kooperanti(id) ON DELETE CASCADE;
        CREATE TABLE public.kooperant_dokumenti(id uuid PRIMARY KEY,company_id uuid,
          kooperant_id uuid REFERENCES public.kooperanti(id) ON DELETE CASCADE,vrsta text,naziv text,putanja text);
      `);
      await db.exec(sqlFile('migrations/20261107190000_kooperant_timeline_color.sql'));
      await db.exec(sqlFile('migrations/20261110180000_kooperanti_povijest_izmjena.sql'));
      const company='00000000-0000-0000-0000-000000000001';
      const foreignCompany='00000000-0000-0000-0000-000000000005';
      const actor='00000000-0000-0000-0000-000000000002';
      const other='00000000-0000-0000-0000-000000000006';
      const cooperator='00000000-0000-0000-0000-000000001801';
      const site='00000000-0000-0000-0000-000000001802';
      const cost='00000000-0000-0000-0000-000000001803';
      const document='00000000-0000-0000-0000-000000001804';
      await db.query(`INSERT INTO public.kooperanti(id,company_id,naziv,djelatnost,oib,iban,adresa,mjesto,postanski_broj,
        kontakt_osoba,telefon,email,web,napomena,timeline_color) VALUES ($1,$2,'Izvorni kooperant','Elektro',
        '00000000001','HR0000000000000000000','Izvorna 1','Zagreb','10000','Ana',NULL,'ana@example.test',
        'https://example.test','Izvorna napomena','#112233')`,[cooperator,company]);
      await db.query("INSERT INTO public.gradilista(id,company_id,naziv) VALUES ($1,$2,'Gradilište kooperanta')",[site,company]);
      await db.query(`INSERT INTO public.kooperant_dokumenti(id,company_id,kooperant_id,vrsta,naziv,putanja)
        VALUES ($1,$2,$3,'racun','Izvorni račun','retained/cooperator-invoice.pdf')`,[document,company,cooperator]);
      await db.query(`INSERT INTO public.troskovi(id,company_id,gradiliste_id,kooperant_id,kooperant_racun_id,kategorija,
        opis,iznos,datum,placen) VALUES ($1,$2,$3,$4,$5,'kooperanti','Izvorna stavka',654.32,'2026-11-05',true)`,
        [cost,company,site,cooperator,document]);
      await db.query(`INSERT INTO public.kooperant_angazmani(company_id,gradiliste_id,kooperant_id,dogovoreni_iznos)
        VALUES ($1,$2,$3,1234.56)`,[company,site,cooperator]);
      const snapshot=async()=>(await db.query('SELECT to_jsonb(k) data FROM public.kooperanti k WHERE id=$1',[cooperator])).rows[0]?.data;
      const history=async(before=null)=>(await db.query('SELECT * FROM public.get_cooperator_change_history($1,$2)',[cooperator,before])).rows;
      const restore=id=>db.query('SELECT public.restore_cooperator_change($1)',[id]);
      const related=async()=>({
        site:(await db.query('SELECT to_jsonb(s) data FROM public.gradilista s WHERE id=$1',[site])).rows,
        cost:(await db.query('SELECT to_jsonb(t) data FROM public.troskovi t WHERE id=$1',[cost])).rows,
        document:(await db.query('SELECT to_jsonb(d) data FROM public.kooperant_dokumenti d WHERE id=$1',[document])).rows,
        engagement:(await db.query('SELECT to_jsonb(a) data FROM public.kooperant_angazmani a WHERE kooperant_id=$1',[cooperator])).rows,
      });
      const withoutTime=({updated_at,...row})=>row;
      const original=await snapshot();
      const originalRelated=await related();
      const count=async()=>(await db.query("SELECT count(*)::int count FROM private.business_change_history WHERE record_id=$1 AND table_name='kooperanti'",[cooperator])).rows[0].count;
      const initialCount=await count();
      await db.query('UPDATE public.kooperanti SET updated_at=clock_timestamp() WHERE id=$1',[cooperator]);
      assert.equal(await count(),initialCount);
      await db.query(`UPDATE public.kooperanti SET naziv='Novo',djelatnost=NULL,oib='00000000002',iban=NULL,adresa=NULL,
        mjesto='Split',postanski_broj='21000',kontakt_osoba='Ivan',telefon='099111',email=NULL,web=NULL,napomena=NULL,
        timeline_color='#aabbcc' WHERE id=$1`,[cooperator]);
      const first=(await history())[0];
      assert.equal(first.can_restore,true);
      assert.deepEqual(withoutTime(first.before_data),withoutTime(original));
      await db.query("UPDATE public.kooperanti SET timeline_color=NULL WHERE id=$1",[cooperator]);
      const second=(await history())[0];
      await assert.rejects(restore(first.id),e=>e.code==='40001');
      await restore(second.id);
      assert.equal((await snapshot()).timeline_color,'#aabbcc');
      await restore(first.id);
      assert.deepEqual(withoutTime(await snapshot()),withoutTime(original));
      assert.deepEqual(await related(),originalRelated);
      await assert.rejects(restore(first.id),e=>e.code==='40001');
      const reversal=(await history()).find(h=>h.reverses_id===first.id);
      assert.ok(reversal);
      assert.equal(reversal.can_restore,false);
      await assert.rejects(restore(reversal.id),e=>e.code==='40001');
      for(const color of ['#Ab09Ef','#000000','#FFFFFF',null]){
        await db.exec('BEGIN');
        await db.query('UPDATE public.kooperanti SET timeline_color=$2 WHERE id=$1',[cooperator,color]);
        assert.equal((await snapshot()).timeline_color,color);
        await db.exec('ROLLBACK');
      }
      for(const color of ['#12345','#1234567','123456','#gg0000','#１２３４５６']){
        await assert.rejects(db.query('UPDATE public.kooperanti SET timeline_color=$2 WHERE id=$1',[cooperator,color]),e=>e.code==='23514');
      }
      await db.exec('BEGIN');
      await db.query("UPDATE public.kooperanti SET naziv='Miješana izmjena',created_at=created_at+interval '1 day' WHERE id=$1",[cooperator]);
      const unsupported=(await history())[0];
      assert.equal(unsupported.can_restore,false);
      await assert.rejects(restore(unsupported.id),/nepodržana polja/);
      await db.exec('ROLLBACK');
      await db.exec('BEGIN');
      await db.query("UPDATE public.kooperanti SET naziv='Za ABA' WHERE id=$1",[cooperator]);
      const aba=(await history())[0];
      await db.query("UPDATE public.kooperanti SET iban='HR1111111111111111111' WHERE id=$1",[cooperator]);
      await db.query("UPDATE public.kooperanti SET iban='HR0000000000000000000' WHERE id=$1",[cooperator]);
      await assert.rejects(restore(aba.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');
      await db.exec('BEGIN');
      await db.query("UPDATE public.kooperanti SET naziv='Snimka' WHERE id=$1",[cooperator]);
      const mismatch=(await history())[0];
      await db.exec('ALTER TABLE public.kooperanti DISABLE TRIGGER cooperator_change_history');
      await db.query("UPDATE public.kooperanti SET telefon='099000' WHERE id=$1",[cooperator]);
      await db.exec('ALTER TABLE public.kooperanti ENABLE TRIGGER cooperator_change_history');
      await assert.rejects(restore(mismatch.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');
      for(const mode of ['skip','mutate','missing-audit','constraint']){
        await db.exec('BEGIN');
        await db.query("UPDATE public.kooperanti SET naziv='Za povrat',timeline_color='#aabbcc' WHERE id=$1",[cooperator]);
        const event=(await history())[0];
        const before=await snapshot();
        const countBefore=await count();
        if(mode==='missing-audit')await db.exec('ALTER TABLE public.kooperanti DISABLE TRIGGER cooperator_change_history');
        else if(mode==='constraint')await db.exec(`ALTER TABLE public.kooperanti ADD CONSTRAINT test_old_color CHECK (timeline_color IS DISTINCT FROM '#112233') NOT VALID`);
        else await db.exec(`CREATE FUNCTION public.test_cooperator_undo() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN ${mode==='skip'?'RETURN NULL;':"NEW.iban:='changed'; RETURN NEW;"} END; $$;
          CREATE TRIGGER test_cooperator_undo BEFORE UPDATE ON public.kooperanti
            FOR EACH ROW EXECUTE FUNCTION public.test_cooperator_undo();`);
        await db.exec('SAVEPOINT before_undo');
        await assert.rejects(restore(event.id),mode==='missing-audit'?/nije evidentiran/:mode==='constraint'?e=>e.code==='23514':/točan povrat/);
        await db.exec('ROLLBACK TO SAVEPOINT before_undo');
        assert.deepEqual(await snapshot(),before);
        assert.equal((await history()).find(h=>h.id===event.id).reversed_at,null);
        assert.equal(await count(),countBefore);
        assert.deepEqual(await related(),originalRelated);
        await db.exec('ROLLBACK');
      }
      await db.exec('BEGIN');
      await db.query("UPDATE public.kooperanti SET naziv='Prije brisanja' WHERE id=$1",[cooperator]);
      const deleted=(await history())[0];
      await db.query('DELETE FROM public.kooperanti WHERE id=$1',[cooperator]);
      await db.exec('SAVEPOINT after_delete');
      await assert.rejects(history(),e=>e.code==='42501');
      await db.exec('ROLLBACK TO SAVEPOINT after_delete');
      await assert.rejects(restore(deleted.id),/obrisan/);
      await db.exec('ROLLBACK TO SAVEPOINT after_delete');
      assert.equal(await snapshot(),undefined);
      await db.query('INSERT INTO public.kooperanti SELECT * FROM jsonb_populate_record(NULL::public.kooperanti,$1)',[deleted.after_data]);
      await db.exec('SAVEPOINT after_reinsert');
      await assert.rejects(restore(deleted.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');
      await db.query("UPDATE public.kooperanti SET napomena='Prava i rok' WHERE id=$1",[cooperator]);
      const guarded=(await history())[0];
      await db.query("UPDATE private.business_change_history SET expires_at=now()-interval '1 second' WHERE id=$1",[guarded.id]);
      assert.ok(!(await history()).some(h=>h.id===guarded.id));
      await assert.rejects(restore(guarded.id),/30 dana/);
      await db.query("UPDATE private.business_change_history SET expires_at=now()+interval '30 days' WHERE id=$1",[guarded.id]);
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=false,approved=true WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(guarded.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; INSERT INTO public.app_user_permissions(user_id,module,can_view,can_edit) VALUES ('${other}','kooperanti',true,false); SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(guarded.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='kooperanti'; SET ROLE authenticated;`);
      await restore(guarded.id);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='${foreignCompany}' WHERE id='${other}'; SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(first.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false)`);
      for(let n=0;n<51;n++)await db.query('UPDATE public.kooperanti SET napomena=$2 WHERE id=$1',[cooperator,String(n)]);
      const page=await history();
      assert.equal(page.length,50);
      const next=await history(page.at(-1).sequence);
      assert.ok(next.length>0);
      assert.ok(next.every(h=>BigInt(h.sequence)<BigInt(page.at(-1).sequence)));
      const inserted=(await db.query("SELECT id FROM private.business_change_history WHERE record_id=$1 AND table_name='kooperanti' AND operation='INSERT' ORDER BY sequence LIMIT 1",[cooperator])).rows[0];
      await assert.rejects(restore(inserted.id),e=>e.code==='42501');
      await db.exec('SET ROLE anon');
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(first.id),e=>e.code==='42501');
      await db.exec('RESET ROLE');
      assert.deepEqual(await related(),originalRelated);
    });
    await t.test('engagement history restores exact agreement fields and blocks changed parents, stale events and partial restores', async () => {
      await db.exec(`ALTER TABLE public.kooperant_angazmani
        ADD COLUMN status text DEFAULT 'aktivno' CHECK(status IN ('aktivno','zavrseno','otkazano')),
        ADD COLUMN datum_pocetka date,ADD COLUMN datum_zavrsetka date,ADD COLUMN napomena text,
        ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN updated_at timestamptz DEFAULT now();
        ALTER TABLE public.kooperant_angazmani ADD CONSTRAINT test_agreed_nonnegative CHECK(dogovoreni_iznos IS NULL OR dogovoreni_iznos>=0);
        ALTER TABLE public.kooperant_angazmani ADD CONSTRAINT test_engagement_unique UNIQUE(company_id,kooperant_id,gradiliste_id);
      `);
      await db.exec(sqlFile('migrations/20261110190000_angazmani_povijest_izmjena.sql'));
      const company='00000000-0000-0000-0000-000000000001';
      const foreignCompany='00000000-0000-0000-0000-000000000005';
      const actor='00000000-0000-0000-0000-000000000002';
      const other='00000000-0000-0000-0000-000000000006';
      const engagement='00000000-0000-0000-0000-000000001901';
      const cooperator='00000000-0000-0000-0000-000000001902';
      const site='00000000-0000-0000-0000-000000001903';
      const nextSite='00000000-0000-0000-0000-000000001904';
      const nextCooperator='00000000-0000-0000-0000-000000001905';
      const cost='00000000-0000-0000-0000-000000001906';
      const document='00000000-0000-0000-0000-000000001907';
      await db.query(`INSERT INTO public.kooperanti(id,company_id,naziv) VALUES ($1,$3,'Kooperant angažmana'),($2,$3,'Drugi kooperant')`,[cooperator,nextCooperator,company]);
      await db.query(`INSERT INTO public.gradilista(id,company_id,naziv,status) VALUES ($1,$3,'Izvorno gradilište','zavrseno'),($2,$3,'Drugo gradilište','aktivno')`,[site,nextSite,company]);
      await db.query(`INSERT INTO public.kooperant_angazmani(id,company_id,kooperant_id,gradiliste_id,dogovoreni_iznos,status,datum_pocetka,datum_zavrsetka,napomena)
        VALUES ($1,$2,$3,$4,1234.56,'aktivno','2026-10-01',NULL,'Izvorna napomena')`,[engagement,company,cooperator,site]);
      await db.query(`INSERT INTO public.kooperant_dokumenti(id,company_id,kooperant_id,vrsta,naziv,putanja)
        VALUES ($1,$2,$3,'racun','Račun angažmana','retained/engagement-invoice.pdf')`,[document,company,cooperator]);
      await db.query(`INSERT INTO public.troskovi(id,company_id,gradiliste_id,kooperant_id,kooperant_racun_id,kategorija,
        opis,iznos,datum,placen) VALUES ($1,$2,$3,$4,$5,'kooperanti','Izvorna stavka',654.32,'2026-11-05',true)`,
        [cost,company,site,cooperator,document]);
      const snapshot=async()=>(await db.query('SELECT to_jsonb(a) data FROM public.kooperant_angazmani a WHERE id=$1',[engagement])).rows[0]?.data;
      const history=async(before=null)=>(await db.query('SELECT * FROM public.get_engagement_change_history($1,$2)',[engagement,before])).rows;
      const restore=id=>db.query('SELECT public.restore_engagement_change($1)',[id]);
      const related=async()=>({
        site:(await db.query('SELECT to_jsonb(g) data FROM public.gradilista g WHERE id=$1',[site])).rows,
        cooperator:(await db.query('SELECT to_jsonb(k) data FROM public.kooperanti k WHERE id=$1',[cooperator])).rows,
        cost:(await db.query('SELECT to_jsonb(t) data FROM public.troskovi t WHERE id=$1',[cost])).rows,
        document:(await db.query('SELECT to_jsonb(d) data FROM public.kooperant_dokumenti d WHERE id=$1',[document])).rows,
      });
      const withoutTime=({updated_at,...row})=>row;
      const original=await snapshot();
      const originalRelated=await related();
      const count=async()=>(await db.query("SELECT count(*)::int count FROM private.business_change_history WHERE record_id=$1 AND table_name='kooperant_angazmani'",[engagement])).rows[0].count;
      const initialCount=await count();
      await db.query('UPDATE public.kooperant_angazmani SET updated_at=clock_timestamp() WHERE id=$1',[engagement]);
      assert.equal(await count(),initialCount);
      await db.query(`UPDATE public.kooperant_angazmani SET dogovoreni_iznos=NULL,status='otkazano',datum_pocetka=NULL,
        datum_zavrsetka='2026-11-05',napomena=NULL WHERE id=$1`,[engagement]);
      const first=(await history())[0];
      assert.equal(first.can_restore,true);
      assert.deepEqual(withoutTime(first.before_data),withoutTime(original));
      await db.query("UPDATE public.kooperant_angazmani SET dogovoreni_iznos=0,status='zavrseno' WHERE id=$1",[engagement]);
      const second=(await history())[0];
      await assert.rejects(restore(first.id),e=>e.code==='40001');
      await restore(second.id);
      assert.equal((await snapshot()).dogovoreni_iznos,null);
      await restore(first.id);
      assert.deepEqual(withoutTime(await snapshot()),withoutTime(original));
      assert.deepEqual(await related(),originalRelated,'A stored active engagement never reopens its completed site or rewrites costs');
      await assert.rejects(restore(first.id),e=>e.code==='40001');
      const reversal=(await history()).find(h=>h.reverses_id===first.id);
      assert.ok(reversal);
      assert.equal(reversal.can_restore,false);
      await assert.rejects(restore(reversal.id),e=>e.code==='40001');
      await db.exec('BEGIN');
      await db.query(`INSERT INTO public.kooperant_angazmani(company_id,kooperant_id,gradiliste_id,dogovoreni_iznos,status)
        VALUES ($1,$2,$3,0,'otkazano') ON CONFLICT(company_id,kooperant_id,gradiliste_id)
        DO UPDATE SET dogovoreni_iznos=excluded.dogovoreni_iznos,status=excluded.status`,[company,cooperator,site]);
      const upserted=(await history())[0];
      assert.equal(upserted.operation,'UPDATE');
      assert.equal(upserted.can_restore,true);
      assert.equal((await snapshot()).id,engagement,'Saving an existing pair keeps the engagement identity');
      await restore(upserted.id);
      assert.deepEqual(withoutTime(await snapshot()),withoutTime(original));
      assert.deepEqual(await related(),originalRelated);
      await db.exec('ROLLBACK');
      for(const field of ['kooperant_id','gradiliste_id','created_at']){
        await db.exec('BEGIN');
        await db.query(`UPDATE public.kooperant_angazmani SET napomena='Miješano',
          ${field==='created_at'?"created_at=created_at+interval '1 day'":`${field}=$2`} WHERE id=$1`,
          field==='created_at'?[engagement]:[engagement,field==='kooperant_id'?nextCooperator:nextSite]);
        const unsupported=(await history())[0];
        assert.equal(unsupported.can_restore,false);
        await assert.rejects(restore(unsupported.id),/nepodržana polja/);
        await db.exec('ROLLBACK');
      }
      await db.exec('BEGIN');
      await db.query("UPDATE public.kooperant_angazmani SET napomena='Za ABA' WHERE id=$1",[engagement]);
      const aba=(await history())[0];
      await db.query('UPDATE public.kooperant_angazmani SET dogovoreni_iznos=0 WHERE id=$1',[engagement]);
      await db.query('UPDATE public.kooperant_angazmani SET dogovoreni_iznos=1234.56 WHERE id=$1',[engagement]);
      await assert.rejects(restore(aba.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');
      await db.exec('BEGIN');
      await db.query("UPDATE public.kooperant_angazmani SET napomena='Snimka' WHERE id=$1",[engagement]);
      const mismatch=(await history())[0];
      await db.exec('ALTER TABLE public.kooperant_angazmani DISABLE TRIGGER engagement_change_history');
      await db.query("UPDATE public.kooperant_angazmani SET status='otkazano' WHERE id=$1",[engagement]);
      await db.exec('ALTER TABLE public.kooperant_angazmani ENABLE TRIGGER engagement_change_history');
      await assert.rejects(restore(mismatch.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');
      for(const mode of ['skip','mutate','missing-audit','constraint']){
        await db.exec('BEGIN');
        await db.query("UPDATE public.kooperant_angazmani SET dogovoreni_iznos=0,napomena='Za povrat' WHERE id=$1",[engagement]);
        const event=(await history())[0];
        const before=await snapshot();
        const countBefore=await count();
        if(mode==='missing-audit')await db.exec('ALTER TABLE public.kooperant_angazmani DISABLE TRIGGER engagement_change_history');
        else if(mode==='constraint')await db.exec('ALTER TABLE public.kooperant_angazmani ADD CONSTRAINT test_old_amount CHECK(dogovoreni_iznos=0) NOT VALID');
        else await db.exec(`CREATE FUNCTION public.test_engagement_undo() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN ${mode==='skip'?'RETURN NULL;':"NEW.napomena:='changed'; RETURN NEW;"} END; $$;
          CREATE TRIGGER test_engagement_undo BEFORE UPDATE ON public.kooperant_angazmani
            FOR EACH ROW EXECUTE FUNCTION public.test_engagement_undo();`);
        await db.exec('SAVEPOINT before_undo');
        await assert.rejects(restore(event.id),mode==='missing-audit'?/nije evidentiran/:mode==='constraint'?e=>e.code==='23514':/točan povrat/);
        await db.exec('ROLLBACK TO SAVEPOINT before_undo');
        assert.deepEqual(await snapshot(),before);
        assert.equal((await history()).find(h=>h.id===event.id).reversed_at,null);
        assert.equal(await count(),countBefore);
        assert.deepEqual(await related(),originalRelated);
        await db.exec('ROLLBACK');
      }
      for(const table of ['kooperanti','gradilista']){
        await db.exec('BEGIN');
        await db.query("UPDATE public.kooperant_angazmani SET napomena='Provjera roditelja' WHERE id=$1",[engagement]);
        const event=(await history())[0];
        if(table==='gradilista')await db.exec('ALTER TABLE public.gradilista DISABLE TRIGGER tenant_integrity');
        await db.query(`UPDATE public.${table} SET company_id=$2 WHERE id=$1`,[table==='kooperanti'?cooperator:site,foreignCompany]);
        const blocked=(await history()).find(h=>h.id===event.id);
        assert.equal(blocked.can_restore,false);
        assert.match(blocked.blocked_reason,/tvrtki/);
        await assert.rejects(restore(event.id),e=>e.code==='40001');
        await db.exec('ROLLBACK');
      }
      await db.exec('BEGIN');
      await db.query("UPDATE public.kooperant_angazmani SET napomena='Provjera nedostajućeg kooperanta' WHERE id=$1",[engagement]);
      const missingParent=(await history())[0];
      await db.exec('ALTER TABLE public.kooperant_angazmani DROP CONSTRAINT kooperant_angazmani_kooperant_id_fkey');
      await db.query('DELETE FROM public.kooperanti WHERE id=$1',[cooperator]);
      const missingBlocked=(await history()).find(h=>h.id===missingParent.id);
      assert.equal(missingBlocked.can_restore,false);
      await assert.rejects(restore(missingParent.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');
      await db.exec('BEGIN');
      await db.query('UPDATE public.kooperant_angazmani SET kooperant_id=NULL WHERE id=$1',[engagement]);
      await db.query("UPDATE public.kooperant_angazmani SET napomena='Naslijeđena prazna veza' WHERE id=$1",[engagement]);
      const unbound=(await history())[0];
      assert.equal(unbound.can_restore,false);
      await assert.rejects(restore(unbound.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');
      await db.exec('BEGIN');
      await db.query("UPDATE public.kooperant_angazmani SET napomena='Prije brisanja' WHERE id=$1",[engagement]);
      const deleted=(await history())[0];
      await db.query('DELETE FROM public.kooperant_angazmani WHERE id=$1',[engagement]);
      await db.exec('SAVEPOINT after_delete');
      await assert.rejects(history(),e=>e.code==='42501');
      await db.exec('ROLLBACK TO SAVEPOINT after_delete');
      await assert.rejects(restore(deleted.id),/obrisan/);
      await db.exec('ROLLBACK TO SAVEPOINT after_delete');
      await db.query('INSERT INTO public.kooperant_angazmani SELECT * FROM jsonb_populate_record(NULL::public.kooperant_angazmani,$1)',[deleted.after_data]);
      await db.exec('SAVEPOINT after_reinsert');
      await assert.rejects(restore(deleted.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');

      await db.query("UPDATE public.kooperant_angazmani SET napomena='Prava i rok' WHERE id=$1",[engagement]);
      const guarded=(await history())[0];
      await db.query("UPDATE private.business_change_history SET expires_at=now()-interval '1 second' WHERE id=$1",[guarded.id]);
      assert.ok(!(await history()).some(h=>h.id===guarded.id));
      await assert.rejects(restore(guarded.id),/30 dana/);
      await db.query("UPDATE private.business_change_history SET expires_at=now()+interval '30 days' WHERE id=$1",[guarded.id]);
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=false,approved=true WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}';
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(guarded.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_view=true,can_edit=false WHERE user_id='${other}' AND module='kooperanti'; SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(guarded.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='kooperanti'; SET ROLE authenticated;`);
      await restore(guarded.id);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='${foreignCompany}' WHERE id='${other}'; SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(first.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false)`);
      for(let n=0;n<51;n++)await db.query('UPDATE public.kooperant_angazmani SET napomena=$2 WHERE id=$1',[engagement,String(n)]);
      const page=await history();
      assert.equal(page.length,50);
      const next=await history(page.at(-1).sequence);
      assert.ok(next.length>0);
      assert.ok(next.every(h=>BigInt(h.sequence)<BigInt(page.at(-1).sequence)));
      const inserted=(await db.query("SELECT id FROM private.business_change_history WHERE record_id=$1 AND table_name='kooperant_angazmani' AND operation='INSERT' ORDER BY sequence LIMIT 1",[engagement])).rows[0];
      await assert.rejects(restore(inserted.id),e=>e.code==='42501');
      const wrongTable=(await db.query("SELECT id FROM private.business_change_history WHERE table_name='kooperanti' AND operation='UPDATE' LIMIT 1")).rows[0];
      await assert.rejects(restore(wrongTable.id),e=>e.code==='42501');
      await db.exec('SET ROLE anon');
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(first.id),e=>e.code==='42501');
      await db.exec('RESET ROLE');
      assert.deepEqual(await related(),originalRelated);
    });
    await t.test('catalog undo restores prices and fields atomically with append-only price history and unchanged business snapshots', async () => {
      await db.exec('ALTER TABLE public.gradiliste_stavke ADD COLUMN stavka_id uuid');
      await db.exec(sqlFile('migrations/20261015390000_stavke.sql'));
      await db.exec(`ALTER TABLE public.stavke ADD COLUMN company_id uuid DEFAULT public.app_current_company_id(),ADD COLUMN podgrupa text;
        ALTER TABLE public.stavke_cijene_log ADD COLUMN company_id uuid DEFAULT public.app_current_company_id();
        CREATE TABLE public.test_catalog_offer(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),stavka_id uuid REFERENCES public.stavke(id),opis text,cijena numeric);
      `);
      await db.exec(sqlFile('migrations/20261110200000_stavke_povijest_izmjena.sql'));
      const company='00000000-0000-0000-0000-000000000001';
      const actor='00000000-0000-0000-0000-000000000002';
      const other='00000000-0000-0000-0000-000000000006';
      const catalog='00000000-0000-0000-0000-000000002001';
      const site='00000000-0000-0000-0000-000000001903';
      await db.query(`INSERT INTO public.stavke(id,company_id,sifra,naziv,vrsta_posla,podgrupa,jedinica,cijena,opis)
        VALUES ($1,$2,'A-01','Izvorna stavka','Elektro','Kablovi','m',1234.56,'Izvorni opis')`,[catalog,company]);
      await db.query("INSERT INTO public.test_catalog_offer(stavka_id,opis,cijena) VALUES ($1,'Izvorna stavka',987.65)",[catalog]);
      await db.query("INSERT INTO public.gradiliste_stavke(company_id,gradiliste_id,cijena,kolicina) VALUES ($1,$2,987.65,2)",[company,site]);
      const snapshot=async()=>(await db.query('SELECT to_jsonb(s) data FROM public.stavke s WHERE id=$1',[catalog])).rows[0]?.data;
      const history=async(before=null)=>(await db.query('SELECT * FROM public.get_catalog_change_history($1,$2)',[catalog,before])).rows;
      const restore=id=>db.query('SELECT public.restore_catalog_change($1)',[id]);
      const logs=async()=>(await db.query('SELECT * FROM public.stavke_cijene_log WHERE stavka_id=$1 ORDER BY created_at,id',[catalog])).rows;
      const related=async()=>({
        offers:(await db.query('SELECT to_jsonb(o) data FROM public.test_catalog_offer o WHERE stavka_id=$1',[catalog])).rows,
        sites:(await db.query('SELECT to_jsonb(s) data FROM public.gradiliste_stavke s WHERE gradiliste_id=$1 ORDER BY id',[site])).rows,
      });
      const withoutTime=({updated_at,cijena_promijenjena_at,...row})=>row;
      const original=await snapshot();
      const relatedBefore=await related();
      const initialLogs=await logs();
      assert.equal(initialLogs.length,1);
      assert.equal(initialLogs[0].stara_cijena,null);
      assert.equal(Number(initialLogs[0].nova_cijena),1234.56);
      await db.query(`UPDATE public.stavke SET sifra=NULL,naziv='Novo',vrsta_posla=NULL,podgrupa=NULL,jedinica='kom',
        cijena=0,opis=NULL WHERE id=$1`,[catalog]);
      const first=(await history())[0];
      assert.equal(first.can_restore,true);
      assert.deepEqual(withoutTime(first.before_data),withoutTime(original));
      const changedTime=(await snapshot()).cijena_promijenjena_at;
      assert.ok(changedTime);
      await db.query("UPDATE public.stavke SET opis='Druga izmjena' WHERE id=$1",[catalog]);
      const second=(await history())[0];
      assert.equal((await snapshot()).cijena_promijenjena_at,changedTime);
      assert.equal((await logs()).length,2,'Non-price changes do not append price logs');
      await assert.rejects(restore(first.id),e=>e.code==='40001');
      await restore(second.id);
      await restore(first.id);
      assert.deepEqual(withoutTime(await snapshot()),withoutTime(original));
      assert.ok((await snapshot()).cijena_promijenjena_at>=changedTime,'Undo is a new price change, not backdated');
      const restoredLogs=await logs();
      assert.equal(restoredLogs.length,3);
      assert.deepEqual(restoredLogs[0],initialLogs[0]);
      assert.equal(Number(restoredLogs.at(-1).stara_cijena),0);
      assert.equal(Number(restoredLogs.at(-1).nova_cijena),1234.56);
      assert.deepEqual(await related(),relatedBefore);
      await assert.rejects(restore(first.id),e=>e.code==='40001');
      const reversal=(await history()).find(h=>h.reverses_id===first.id);
      assert.equal(reversal.can_restore,false);
      await assert.rejects(restore(reversal.id),e=>e.code==='40001');
      const beforeNoop=(await history()).length;
      await db.query('UPDATE public.stavke SET updated_at=clock_timestamp() WHERE id=$1',[catalog]);
      assert.equal((await history()).length,beforeNoop);
      for(const mode of ['created','aba','mismatch']){
        await db.exec('BEGIN');
        await db.query(`UPDATE public.stavke SET naziv='Za provjeru'${mode==='created'?",created_at=created_at+interval '1 day'":''} WHERE id=$1`,[catalog]);
        const event=(await history())[0];
        if(mode==='aba'){
          await db.query('UPDATE public.stavke SET cijena=0 WHERE id=$1',[catalog]);
          await db.query('UPDATE public.stavke SET cijena=1234.56 WHERE id=$1',[catalog]);
        }
        if(mode==='mismatch'){
          await db.exec('ALTER TABLE public.stavke DISABLE TRIGGER catalog_change_history');
          await db.query("UPDATE public.stavke SET opis='Skriveno' WHERE id=$1",[catalog]);
          await db.exec('ALTER TABLE public.stavke ENABLE TRIGGER catalog_change_history');
        }
        await assert.rejects(restore(event.id),e=>e.code==='40001');
        await db.exec('ROLLBACK');
      }
      for(const mode of ['skip','mutate','missing-audit','missing-price-log','skip-log','mutate-log']){
        await db.exec('BEGIN');
        await db.query("UPDATE public.stavke SET cijena=0,naziv='Za povrat' WHERE id=$1",[catalog]);
        const event=(await history())[0];
        const before=await snapshot();
        const beforeLogs=await logs();
        if(mode==='missing-audit')await db.exec('ALTER TABLE public.stavke DISABLE TRIGGER catalog_change_history');
        else if(mode==='missing-price-log')await db.exec('ALTER TABLE public.stavke DISABLE TRIGGER catalog_price_log');
        else if(mode==='skip-log'||mode==='mutate-log')await db.exec(`CREATE FUNCTION public.test_price_log() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN ${mode==='skip-log'?'RETURN NULL;':'NEW.nova_cijena:=999; RETURN NEW;'} END; $$;
          CREATE TRIGGER test_price_log BEFORE INSERT ON public.stavke_cijene_log FOR EACH ROW EXECUTE FUNCTION public.test_price_log();`);
        else await db.exec(`CREATE FUNCTION public.test_catalog_undo() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN ${mode==='skip'?'RETURN NULL;':"NEW.opis:='Changed'; RETURN NEW;"} END; $$;
          CREATE TRIGGER test_catalog_undo BEFORE UPDATE ON public.stavke FOR EACH ROW EXECUTE FUNCTION public.test_catalog_undo();`);
        await db.exec('SAVEPOINT before_undo');
        await assert.rejects(restore(event.id));
        await db.exec('ROLLBACK TO SAVEPOINT before_undo');
        assert.deepEqual(await snapshot(),before);
        assert.deepEqual(await logs(),beforeLogs);
        assert.equal((await history()).find(h=>h.id===event.id).reversed_at,null);
        assert.deepEqual(await related(),relatedBefore);
        if(mode==='skip-log'||mode==='mutate-log'){
          await assert.rejects(db.query('UPDATE public.stavke SET cijena=50 WHERE id=$1',[catalog]),/evidentirana/);
          await db.exec('ROLLBACK TO SAVEPOINT before_undo');
          assert.deepEqual(await snapshot(),before,'A normal save also rolls back if price log fails');
        }
        await db.exec('ROLLBACK');
      }
      await db.exec('BEGIN');
      await db.query("UPDATE public.stavke SET naziv='Prije brisanja' WHERE id=$1",[catalog]);
      const deleted=(await history())[0];
      await db.query('DELETE FROM public.test_catalog_offer WHERE stavka_id=$1',[catalog]);
      await db.query('DELETE FROM public.stavke WHERE id=$1',[catalog]);
      await db.exec('SAVEPOINT deleted');
      await assert.rejects(restore(deleted.id),/obrisana/);
      await db.exec('ROLLBACK TO SAVEPOINT deleted');
      await db.query('INSERT INTO public.stavke SELECT * FROM jsonb_populate_record(NULL::public.stavke,$1)',[deleted.after_data]);
      await db.exec('SAVEPOINT inserted');
      await assert.rejects(restore(deleted.id),e=>e.code==='40001');
      await db.exec('ROLLBACK');
      await db.query("UPDATE public.stavke SET opis='Prava i rok' WHERE id=$1",[catalog]);
      const guarded=(await history())[0];
      await db.query("UPDATE private.business_change_history SET expires_at=now()-interval '1 second' WHERE id=$1",[guarded.id]);
      assert.ok(!(await history()).some(h=>h.id===guarded.id));
      await assert.rejects(restore(guarded.id),/30 dana/);
      await db.query("UPDATE private.business_change_history SET expires_at=now()+interval '30 days' WHERE id=$1",[guarded.id]);
      await db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=false,approved=true WHERE id='${other}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${other}';
        INSERT INTO public.app_user_permissions(user_id,module,can_view,can_edit) VALUES ('${other}','stavke',true,false);
        SELECT set_config('request.jwt.claim.sub','${other}',false); SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(guarded.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; UPDATE public.app_user_permissions SET can_edit=true WHERE user_id='${other}' AND module='stavke'; SET ROLE authenticated;`);
      await restore(guarded.id);
      await db.exec(`RESET ROLE; UPDATE public.app_profiles SET company_id='00000000-0000-0000-0000-000000000005' WHERE id='${other}'; SET ROLE authenticated;`);
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(first.id),e=>e.code==='42501');
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${actor}',false)`);
      for(let n=0;n<51;n++)await db.query('UPDATE public.stavke SET opis=$2 WHERE id=$1',[catalog,String(n)]);
      const page=await history();
      assert.equal(page.length,50);
      assert.ok((await history(page.at(-1).sequence)).every(h=>BigInt(h.sequence)<BigInt(page.at(-1).sequence)));
      const inserted=(await db.query("SELECT id FROM private.business_change_history WHERE record_id=$1 AND table_name='stavke' AND operation='INSERT' ORDER BY sequence LIMIT 1",[catalog])).rows[0];
      await assert.rejects(restore(inserted.id),e=>e.code==='42501');
      await db.exec('SET ROLE anon');
      await assert.rejects(history(),e=>e.code==='42501');
      await assert.rejects(restore(first.id),e=>e.code==='42501');
      await db.exec('RESET ROLE');
      assert.deepEqual(await related(),relatedBefore);
    });
    await t.test('cooperator invoice creation and deletion are atomic, retain source files and restore the exact cost group', async () => {
      await db.exec(`ALTER TABLE public.kooperant_dokumenti ADD COLUMN IF NOT EXISTS gradiliste_id uuid;
        ALTER TABLE public.kooperant_dokumenti ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
        GRANT SELECT,INSERT,UPDATE,DELETE ON public.kooperant_dokumenti,public.troskovi TO authenticated;`);
      await db.exec(sqlFile('migrations/20261110210000_kooperant_racuni_povrat.sql'));
      const company='00000000-0000-0000-0000-000000000001';
      const actor='00000000-0000-0000-0000-000000000002';
      const cooperator='00000000-0000-0000-0000-000000002101';
      const site='00000000-0000-0000-0000-000000002102';
      let invoice;
      let invoice2;
      const path=`${company}/${cooperator}/invoice.pdf`;
      const path2=`${company}/${cooperator}/invoice-2.pdf`;
      const path3=`${company}/${cooperator}/invoice-3.pdf`;
      const actorPermissions=async()=>db.exec(`UPDATE public.app_profiles SET company_id='${company}',is_admin=true,approved=true WHERE id='${actor}';
        SELECT set_config('request.jwt.claim.sub','${actor}',false);`);
      await actorPermissions();
      await db.query("INSERT INTO public.kooperanti(id,company_id,naziv) VALUES ($1,$2,'Račun kooperanta')",[cooperator,company]);
      await db.query("INSERT INTO public.gradilista(id,company_id,naziv) VALUES ($1,$2,'Gradilište računa')",[site,company]);
      await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('kooperant-dokumenti',$1),('kooperant-dokumenti',$2),('kooperant-dokumenti',$3)",[path,path2,path3]);
      await db.exec('SET ROLE authenticated');
      const lines=[
        {opis:'Materijal',iznos:125.5,kolicina:2,jedinica:'kom',jedinicna_cijena:62.75},
        {opis:'Dodatni rad',iznos:50,kolicina:null,jedinica:null,jedinicna_cijena:50},
      ];
      const create=(p,items=lines)=>db.query(`SELECT public.create_kooperant_invoice($1,$2,$3,$4,$5,$6,$7,$8,$9)->>'id' id`,
        [cooperator,site,p,'Račun dobavljača.pdf','R-101','2026-11-05',true,'2026-11-05',JSON.stringify(items)]);
      await assert.rejects(create(path,[{...lines[0],iznos:0}]),e=>e.code==='22023');
      assert.equal((await db.query('SELECT count(*)::int n FROM public.kooperant_dokumenti WHERE putanja=$1',[path])).rows[0].n,0);
      const created=(await create(path)).rows[0].id;
      invoice=created;
      assert.ok(invoice);
      const documentSnapshot=async(id)=>(await db.query('SELECT to_jsonb(d) data FROM public.kooperant_dokumenti d WHERE id=$1',[id])).rows[0]?.data;
      const costSnapshots=async(id)=>(await db.query('SELECT to_jsonb(c) data FROM public.troskovi c WHERE kooperant_racun_id=$1 ORDER BY opis,id',[id])).rows.map(row=>row.data);
      const originalDocument=await documentSnapshot(invoice);
      const originalCosts=await costSnapshots(invoice);
      assert.equal(originalCosts.length,2);
      assert.ok(originalCosts.every(cost=>cost.placen && cost.placeno_at==='2026-11-05'));
      const remove=id=>db.query('SELECT public.delete_kooperant_racun_with_history($1,$2)',[cooperator,id]);
      await assert.rejects(db.query('DELETE FROM public.kooperant_dokumenti WHERE id=$1',[invoice]),e=>e.code==='42501');
      await assert.rejects(db.query('DELETE FROM public.troskovi WHERE kooperant_racun_id=$1',[invoice]),e=>e.code==='42501');
      await db.exec(`RESET ROLE;
        CREATE FUNCTION public.test_skip_invoice_cost_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
        CREATE TRIGGER test_skip_invoice_cost_delete BEFORE DELETE ON public.troskovi FOR EACH ROW EXECUTE FUNCTION public.test_skip_invoice_cost_delete();
        SET ROLE authenticated;`);
      await assert.rejects(remove(invoice),/zajedno evidentirani/);
      await db.exec('RESET ROLE; DROP TRIGGER test_skip_invoice_cost_delete ON public.troskovi; DROP FUNCTION public.test_skip_invoice_cost_delete(); SET ROLE authenticated');
      assert.equal((await documentSnapshot(invoice)).id,invoice);
      assert.deepEqual(await costSnapshots(invoice),originalCosts);
      const deletion=(await remove(invoice)).rows[0].delete_kooperant_racun_with_history;
      assert.equal(await documentSnapshot(invoice),undefined);
      assert.deepEqual(await costSnapshots(invoice),[]);
      assert.equal((await db.query('SELECT count(*)::int n FROM storage.objects WHERE bucket_id=$1 AND name=$2',['kooperant-dokumenti',path])).rows[0].n,1);
      assert.equal((await db.query('SELECT public.app_cooperator_invoice_file_retained($1) retained',[path])).rows[0].retained,true);
      await assert.rejects(db.query(`INSERT INTO public.troskovi(company_id,gradiliste_id,kategorija,kooperant_id,kooperant_racun_id,
        opis,iznos,datum) VALUES ($1,$2,'kooperanti',$3,$4,'Orphan',1,'2026-11-05')`,
        [company,site,cooperator,invoice]),e=>e.code==='23503');
      const page=async(beforeTime=null,beforeId=null)=>(await db.query('SELECT * FROM public.get_kooperant_invoice_deletions($1,$2)',[beforeTime,beforeId])).rows;
      const item=(await page()).find(row=>row.id===deletion);
      assert.equal(item.can_restore,true);
      assert.equal(item.affected_rows.kooperant_dokumenti,1);
      assert.equal(item.affected_rows.troskovi,2);
      await db.query('SELECT public.restore_resource_deletion($1)',[deletion]);
      assert.deepEqual(await documentSnapshot(invoice),originalDocument);
      assert.deepEqual(await costSnapshots(invoice),originalCosts);
      assert.equal((await page()).find(row=>row.id===deletion).reversed_at!==null,true);
      assert.equal((await db.query('SELECT public.app_cooperator_invoice_file_retained($1) retained',[path])).rows[0].retained,false);
      await assert.rejects(db.query('SELECT public.restore_resource_deletion($1)',[deletion]),/već vraćeno/);

      const created2=(await create(path2)).rows[0].id;
      invoice2=created2;
      assert.ok(invoice2);
      const deletion2=(await remove(invoice2)).rows[0].delete_kooperant_racun_with_history;
      await db.query("DELETE FROM storage.objects WHERE bucket_id='kooperant-dokumenti' AND name=$1",[path2]);
      const missing=(await page()).find(row=>row.id===deletion2);
      assert.equal(missing.can_restore,false);
      await assert.rejects(db.query('SELECT public.restore_resource_deletion($1)',[deletion2]),/Nedostaje sačuvana datoteka računa/);
      assert.equal(await documentSnapshot(invoice2),undefined);
      assert.deepEqual(await costSnapshots(invoice2),[]);
      assert.equal((await page()).find(row=>row.id===deletion2).reversed_at,null);
      await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('kooperant-dokumenti',$1)",[path2]);
      await db.query('SELECT public.restore_resource_deletion($1)',[deletion2]);
      assert.equal((await documentSnapshot(invoice2)).id,invoice2);
      assert.equal((await costSnapshots(invoice2)).length,2);
      const created3=(await create(path3)).rows[0].id;
      assert.ok(created3);
      invoice=created3;
      const deletion3=(await remove(invoice)).rows[0].delete_kooperant_racun_with_history;
      await db.exec('RESET ROLE');
      await db.exec(`UPDATE public.app_profiles SET is_admin=false WHERE id='${actor}';
        UPDATE public.app_user_permissions SET can_edit=false WHERE user_id='${actor}' AND module='troskovi';
        DELETE FROM public.app_user_permissions WHERE user_id='${actor}' AND module='kooperanti';
        INSERT INTO public.app_user_permissions(user_id,module,can_view,can_edit) VALUES ('${actor}','kooperanti',true,true);`);
      await db.exec('SET ROLE authenticated');
      assert.equal((await page()).find(row=>row.id===deletion3).can_restore,false);
      await assert.rejects(db.query('SELECT public.restore_resource_deletion($1)',[deletion3]),e=>e.code==='42501');
      await db.exec('RESET ROLE');
      await actorPermissions();
      await db.exec('SET ROLE authenticated');
      await db.query('SELECT public.restore_resource_deletion($1)',[deletion3]);
      assert.equal((await costSnapshots(invoice)).length,2);
      await db.exec('RESET ROLE');
    });
  } finally {
    await db.close();
  }
});
