import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

function loadApi(supabase) {
  const { outputText } = ts.transpileModule(read('../src/lib/api.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require: (name) => {
      if (name === './supabase') return { supabase };
      if (name === './postavke') return { nocniInterval: () => ({ od: '22:00', do: '06:00' }) };
      if (name === './obracunSati') return {
        minuteSmjene: (from, to) => {
          const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
          const start = minutes(from);
          const end = minutes(to);
          const duration = (end - start + 1440) % 1440;
          let night = 0;
          for (let minute = start; minute < start + duration; minute++) {
            const time = minute % 1440;
            if (time >= 1320 || time < 360) night++;
          }
          return { ukupno: duration, nocne: night };
        },
        nocniIzNapomene: () => 0,
      };
      if (name === './vehicleKmCosts') return { calculateDailyVehicleKmCosts: () => [] };
      return {};
    },
  });
  return module.exports;
}

async function setupDatabase(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE SCHEMA private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('app.worker_id', true), '')::uuid;
    $$;
    CREATE TABLE public.radnici (id uuid PRIMARY KEY, ime text, prezime text);
    CREATE TABLE public.gradilista (id uuid PRIMARY KEY, naziv text);
    CREATE TABLE public.radni_nalozi (
      id uuid PRIMARY KEY, broj text, rok date, datum_kreiranja timestamptz DEFAULT now(),
      gradiliste_id uuid, teren boolean DEFAULT false, mobile_status text, status text,
      bez_izvrsenja boolean DEFAULT false,
      mobile_potvrde text[] DEFAULT '{}', poslovodja_id uuid, mobile_km_na boolean DEFAULT true,
      mobile_napomena_na boolean DEFAULT true, km_pocetak integer, km_kraj integer, napomena text,
      mobile_tasks_confirmed boolean DEFAULT true, enc_stanje numeric,
      mobile_foto_na boolean DEFAULT true, mobile_materijal_na boolean DEFAULT true, mobile_alat_na boolean DEFAULT true
    );
    CREATE TABLE public.radni_nalozi_radnici (
      nalog_id uuid, radnik_id uuid, is_leader boolean DEFAULT false,
      mobile_started_at timestamptz, mobile_finished_at timestamptz,
      vrijeme_od time, vrijeme_do time
    );
    CREATE TABLE public.dnevni_raspored_gradilista (nalog_id uuid, datum date);
    CREATE TABLE public.radni_nalozi_foto (nalog_id uuid, created_at timestamptz);
    CREATE TABLE public.radni_nalozi_stavke (nalog_id uuid, tip text);
    CREATE TABLE public.gradiliste_zadaci (nalog_id uuid, vrsta text);
    CREATE TABLE public.radno_vrijeme (
      nalog_id uuid, radnik_id uuid, gradiliste_id uuid, datum date, sati numeric,
      napomena text, nocni_sati numeric
    );
    CREATE FUNCTION public.app_mobile_radnik_id() RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
    CREATE FUNCTION public.app_mobile_assigned_nalog(p_nalog_id uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.radni_nalozi_radnici
          WHERE nalog_id = p_nalog_id AND radnik_id = public.app_mobile_radnik_id()
        )
      $$;
    CREATE FUNCTION public.app_mobile_leads_nalog(p_nalog_id uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.radni_nalozi_radnici
          WHERE nalog_id = p_nalog_id AND radnik_id = public.app_mobile_radnik_id() AND is_leader
        )
      $$;
    CREATE FUNCTION public.app_mobile_editable_nalog(p_nalog_id uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT public.app_mobile_assigned_nalog(p_nalog_id) AND EXISTS (
          SELECT 1 FROM public.radni_nalozi WHERE id = p_nalog_id
            AND status NOT IN ('zavrsen', 'otkazan')
            AND mobile_status IN ('dodijeljen', 'u_tijeku', 'predan')
        )
      $$;
    CREATE FUNCTION public.get_my_portal_vrijeme() RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.app_has_module_permission(p_module text, p_action text) RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT COALESCE(current_setting('app.allow_nalog_edit', true), 'false') = 'true'
      $$;
    INSERT INTO public.radnici (id, ime, prezime) VALUES
      ('00000000-0000-0000-0000-000000000001', 'Ivan', 'Voditelj'),
      ('00000000-0000-0000-0000-000000000002', 'Marko', 'Radnik');
    INSERT INTO public.gradilista (id, naziv)
      VALUES ('00000000-0000-0000-0000-000000000003', 'Gradilište');
    INSERT INTO public.radni_nalozi (
      id, broj, gradiliste_id, mobile_status, status, poslovodja_id
    ) VALUES (
      '00000000-0000-0000-0000-000000000004', 'RN-1',
      '00000000-0000-0000-0000-000000000003', 'u_tijeku', 'u_tijeku',
      '00000000-0000-0000-0000-000000000001'
    );
    INSERT INTO public.radni_nalozi_radnici (
      nalog_id, radnik_id, is_leader, mobile_started_at, mobile_finished_at, vrijeme_od, vrijeme_do
    ) VALUES
      ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001',true,now(),now(),'08:00','16:00'),
      ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002',false,now(),now(),'08:00','16:00');
    SELECT set_config('app.worker_id', '00000000-0000-0000-0000-000000000001', false);
  `);
  await db.exec(read('../supabase/migrations/20261110440000_nalog_dodatno_radno_vrijeme.sql'));
  await db.exec(read('../supabase/migrations/20261110450000_nalog_dodatno_vrijeme_po_djelatniku.sql'));
  await db.exec(read('../supabase/migrations/20261110460000_zabrana_preklapanja_radnog_vremena.sql'));
  await db.exec(read('../supabase/migrations/20261110470000_obavijest_preklapanja_radnog_vremena.sql'));
  await db.exec(read('../supabase/migrations/20261110480000_obavijest_preklapanja_s_gradilistem.sql'));
  await db.exec(read('../supabase/migrations/20261110540000_nalog_preklapanje_pri_zakljucenju.sql'));
  await db.exec(read('../supabase/migrations/20261110550000_uredivanje_sati_prije_zakljucenja.sql'));
  await db.exec(read('../supabase/migrations/20261110600000_provjera_sati_zakljucenih_naloga.sql'));
  await db.exec(read('../supabase/migrations/20261110630000_portal_predaja_bez_potvrde_strojeva.sql'));
  return db;
}

test('portal submission accepts visible confirmations without machines, including zero-hour workers and assigned non-leaders', async (t) => {
  const db = await setupDatabase(t);
  const orderId = '00000000-0000-0000-0000-000000000004';
  const secondWorker = '00000000-0000-0000-0000-000000000002';
  await db.query(`
    UPDATE public.radni_nalozi SET
      mobile_potvrde = ARRAY['poslovi','foto:na','materijal:na','alat:na','vrijeme','enc:na']
    WHERE id = $1
  `, [orderId]);
  await db.query(`
    UPDATE public.radni_nalozi_radnici
    SET mobile_zero_hours=true, vrijeme_od=NULL, vrijeme_do=NULL,
        mobile_started_at=NULL, mobile_finished_at=NULL
    WHERE nalog_id=$1 AND radnik_id=$2
  `, [orderId, secondWorker]);
  await db.query("SELECT set_config('app.worker_id', $1, false)", [secondWorker]);
  await db.query('SELECT public.mobile_submit_nalog($1)', [orderId]);
  const { rows } = await db.query('SELECT status, mobile_status, mobile_potvrde FROM public.radni_nalozi WHERE id=$1', [orderId]);
  assert.equal(rows[0].status, 'u_tijeku');
  assert.equal(rows[0].mobile_status, 'predan');
  assert.equal(rows[0].mobile_potvrde.some((item) => item.startsWith('strojevi')), false);
  await db.query('SELECT public.mobile_submit_nalog($1)', [orderId]);
});

test('portal submission still checks mandatory visible sections, photos, additional tasks, time, ENC and kilometres', async (t) => {
  const db = await setupDatabase(t);
  const orderId = '00000000-0000-0000-0000-000000000004';
  const confirmations = ['poslovi', 'foto:na', 'materijal:na', 'alat:na', 'vrijeme', 'enc:na', 'km_kraj'];
  await db.query(`
    UPDATE public.radni_nalozi
    SET mobile_potvrde=$1, mobile_km_na=false, km_pocetak=81000, km_kraj=81100 WHERE id=$2
  `, [confirmations, orderId]);
  for (const [missing, message] of [
    ['poslovi', /Potvrdi dio "Poslovi"/],
    ['foto:na', /Potvrdi dio "Fotografije"/],
    ['materijal:na', /Potvrdi dio "Materijal"/],
    ['alat:na', /Potvrdi dio "Alat"/],
    ['vrijeme', /Potvrdi radno vrijeme/],
    ['enc:na', /stanje ENC-a/],
    ['km_kraj', /kilometre povratka/],
  ]) {
    await db.query('UPDATE public.radni_nalozi SET mobile_potvrde=$1 WHERE id=$2',
      [confirmations.filter((item) => item !== missing), orderId]);
    await assert.rejects(db.query('SELECT public.mobile_submit_nalog($1)', [orderId]), message);
    assert.equal((await db.query('SELECT mobile_status FROM public.radni_nalozi WHERE id=$1', [orderId])).rows[0].mobile_status, 'u_tijeku');
  }
  await db.query('UPDATE public.radni_nalozi SET mobile_potvrde=$1 WHERE id=$2',
    [confirmations.map((item) => item === 'foto:na' ? 'foto' : item), orderId]);
  await assert.rejects(db.query('SELECT public.mobile_submit_nalog($1)', [orderId]), /barem jednu fotografiju/);
  await db.query('UPDATE public.radni_nalozi SET mobile_potvrde=$1 WHERE id=$2', [confirmations, orderId]);
  await db.query("INSERT INTO public.gradiliste_zadaci VALUES ($1,'dodatni')", [orderId]);
  await assert.rejects(db.query('SELECT public.mobile_submit_nalog($1)', [orderId]), /Dodatni radovi/);
  await db.query("UPDATE public.radni_nalozi SET mobile_potvrde=array_append(mobile_potvrde,'dodatni:na') WHERE id=$1", [orderId]);
  await db.query('UPDATE public.radni_nalozi_radnici SET mobile_finished_at=NULL WHERE nalog_id=$1', [orderId]);
  await assert.rejects(db.query('SELECT public.mobile_submit_nalog($1)', [orderId]), /Potvrdi radno vrijeme/);
  await db.query('UPDATE public.radni_nalozi_radnici SET mobile_finished_at=now() WHERE nalog_id=$1', [orderId]);
  await db.query('SELECT public.mobile_submit_nalog($1)', [orderId]);
});

test('portal submission rejects unassigned users and closed, cancelled or not-started orders', async (t) => {
  const db = await setupDatabase(t);
  const orderId = '00000000-0000-0000-0000-000000000004';
  await db.query("SELECT set_config('app.worker_id','00000000-0000-0000-0000-000000000099',false)");
  await assert.rejects(db.query('SELECT public.mobile_submit_nalog($1)', [orderId]), /nije dostupan/);
  await db.query("SELECT set_config('app.worker_id','00000000-0000-0000-0000-000000000001',false)");
  for (const status of ['zavrsen', 'otkazan']) {
    await db.query('UPDATE public.radni_nalozi SET status=$1 WHERE id=$2', [status, orderId]);
    await assert.rejects(db.query('SELECT public.mobile_submit_nalog($1)', [orderId]), /nije dostupan/);
  }
  await db.query("UPDATE public.radni_nalozi SET status='u_tijeku', mobile_status='dodijeljen' WHERE id=$1", [orderId]);
  await assert.rejects(db.query('SELECT public.mobile_submit_nalog($1)', [orderId]), /nije spreman/);
});

test('work-order time rejects overlapping shifts across different orders for the same worker', async (t) => {
  const db = await setupDatabase(t);
  const workerId = '00000000-0000-0000-0000-000000000001';
  const secondOrderId = '00000000-0000-0000-0000-000000000008';

  await db.query(
    `INSERT INTO public.radni_nalozi (id, broj, mobile_status, status)
     VALUES ($1, 'RN-2', 'u_tijeku', 'u_tijeku')`,
    [secondOrderId],
  );
  await db.query(
    'INSERT INTO public.radni_nalozi_radnici (nalog_id, radnik_id) VALUES ($1, $2)',
    [secondOrderId, workerId],
  );

  await assert.rejects(
    db.query(
      `UPDATE public.radni_nalozi_radnici
       SET vrijeme_od = '10:00', vrijeme_do = '12:00'
       WHERE nalog_id = $1 AND radnik_id = $2`,
      [secondOrderId, workerId],
    ),
    /Potvrda nije spremljena: radno vrijeme za djelatnika Ivan Voditelj dana \d{2}\.\d{2}\.\d{4} od 08:00 do 16:00 već je upisano na gradilištu „Gradilište” \(nalog RN-1\)/,
  );

  await db.query(
    `UPDATE public.radni_nalozi_radnici
     SET vrijeme_od = '17:00', vrijeme_do = '18:00'
     WHERE nalog_id = $1 AND radnik_id = $2`,
    [secondOrderId, workerId],
  );

  await assert.rejects(db.query(
    `UPDATE public.radni_nalozi_radnici
     SET mobile_extra_time = $1::jsonb
     WHERE nalog_id = $2 AND radnik_id = $3`,
    [JSON.stringify([{
      id: '00000000-0000-0000-0000-000000000009',
      grupa_id: '00000000-0000-0000-0000-000000000009',
      vrijeme_od: '15:00',
      vrijeme_do: '17:00',
      napomena: null,
    }]), secondOrderId, workerId],
  ), /Potvrda nije spremljena.*08:00.*16:00.*RN-1/);

  await db.query(
    `UPDATE public.radni_nalozi_radnici
     SET vrijeme_od = '23:00', vrijeme_do = '01:00'
     WHERE nalog_id = '00000000-0000-0000-0000-000000000004' AND radnik_id = $1`,
    [workerId],
  );
  await db.query(
    `UPDATE public.radni_nalozi
     SET rok = timezone('Europe/Zagreb', now())::date + 1
     WHERE id = $1`,
    [secondOrderId],
  );
  await assert.rejects(db.query(
    `UPDATE public.radni_nalozi_radnici
     SET mobile_extra_time = $1::jsonb
     WHERE nalog_id = $2 AND radnik_id = $3`,
    [JSON.stringify([{
      id: '00000000-0000-0000-0000-00000000000a',
      grupa_id: '00000000-0000-0000-0000-00000000000a',
      vrijeme_od: '00:30',
      vrijeme_do: '01:30',
      napomena: null,
    }]), secondOrderId, workerId],
  ), /Potvrda nije spremljena.*RN-1/);
});

test('work-order cannot be closed when its existing hours overlap another order', async (t) => {
  const db = await setupDatabase(t);
  const workerId = '00000000-0000-0000-0000-000000000001';
  const existingOrderId = '00000000-0000-0000-0000-000000000004';
  const pendingOrderId = '00000000-0000-0000-0000-000000000008';

  await db.exec(`
    UPDATE public.radni_nalozi
    SET rok = '2026-11-07', datum_kreiranja = '2026-11-07 08:00:00+00'
    WHERE id IN ('${existingOrderId}', '${pendingOrderId}');
    UPDATE public.radni_nalozi_radnici
    SET mobile_started_at = NULL
    WHERE nalog_id = '${existingOrderId}' AND radnik_id = '${workerId}';
    ALTER TABLE public.radni_nalozi_radnici DISABLE TRIGGER prevent_worker_work_time_overlap;
  `);
  await db.query(
    `INSERT INTO public.radni_nalozi (id, broj, gradiliste_id, rok, mobile_status, status)
     VALUES ($1, 'RN-2', '00000000-0000-0000-0000-000000000003', '2026-11-07', 'predan', 'u_tijeku')`,
    [pendingOrderId],
  );
  await db.query(
    `INSERT INTO public.radni_nalozi_radnici (nalog_id, radnik_id, vrijeme_od, vrijeme_do)
     VALUES ($1, $2, '10:00', '12:00')`,
    [pendingOrderId, workerId],
  );
  await db.exec('ALTER TABLE public.radni_nalozi_radnici ENABLE TRIGGER prevent_worker_work_time_overlap');

  await assert.rejects(
    db.query(`UPDATE public.radni_nalozi SET status = 'zavrsen' WHERE id = $1`, [pendingOrderId]),
    /Nalog nije zaključen: radno vrijeme za djelatnika Ivan Voditelj dana 07\.11\.2026 od 08:00 do 16:00 već je upisano na gradilištu „Gradilište” \(nalog RN-1\)/,
  );

  const { rows } = await db.query('SELECT status FROM public.radni_nalozi WHERE id = $1', [pendingOrderId]);
  assert.equal(rows[0].status, 'u_tijeku');

  await db.query("SELECT set_config('app.allow_nalog_edit', 'true', false)");
  await db.query(
    `UPDATE public.radni_nalozi_radnici
     SET vrijeme_od = '17:00', vrijeme_do = '18:00'
     WHERE nalog_id = $1 AND radnik_id = $2`,
    [pendingOrderId, workerId],
  );
  await db.query(
    `UPDATE public.radni_nalozi_radnici
     SET vrijeme_od = NULL, vrijeme_do = NULL, mobile_zero_hours = true
     WHERE nalog_id = $1 AND radnik_id = $2`,
    [pendingOrderId, workerId],
  );
  await db.query(`UPDATE public.radni_nalozi SET status = 'zavrsen' WHERE id = $1`, [pendingOrderId]);

  const { rows: closedRows } = await db.query('SELECT status FROM public.radni_nalozi WHERE id = $1', [pendingOrderId]);
  assert.equal(closedRows[0].status, 'zavrsen');
});

test('office edits of closed orders reject overlaps and retain corrections, boundaries and zero hours', async (t) => {
  const db = await setupDatabase(t);
  await db.exec(`
    SELECT set_config('app.allow_nalog_edit', 'true', false);
    UPDATE public.radni_nalozi SET rok = '2026-11-02', status = 'zavrsen';
    INSERT INTO public.radni_nalozi (id, broj, rok, status)
    VALUES ('00000000-0000-0000-0000-000000000008', 'RN-2', '2026-11-02', 'u_tijeku');
    INSERT INTO public.radni_nalozi_radnici (nalog_id, radnik_id, vrijeme_od, vrijeme_do)
    VALUES ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', '16:00', '18:00');
    UPDATE public.radni_nalozi SET status = 'zavrsen' WHERE broj = 'RN-2';
  `);

  await assert.rejects(db.exec(`
    UPDATE public.radni_nalozi_radnici SET vrijeme_od = '10:00', vrijeme_do = '12:00'
    WHERE nalog_id = '00000000-0000-0000-0000-000000000008';
  `), /Potvrda nije spremljena.*RN-1/);
  const { rows } = await db.query(`
    SELECT vrijeme_od, vrijeme_do FROM public.radni_nalozi_radnici
    WHERE nalog_id = '00000000-0000-0000-0000-000000000008'
  `);
  assert.equal(rows[0].vrijeme_od, '16:00:00');
  assert.equal(rows[0].vrijeme_do, '18:00:00');

  await assert.rejects(db.exec(`
    UPDATE public.radni_nalozi_radnici
    SET mobile_extra_time = '[{"vrijeme_od":"15:00","vrijeme_do":"16:00"}]'
    WHERE nalog_id = '00000000-0000-0000-0000-000000000008';
  `), /Potvrda nije spremljena.*RN-1/);
  await assert.rejects(db.exec(`
    INSERT INTO public.radni_nalozi_radnici (nalog_id, radnik_id, vrijeme_od, vrijeme_do)
    VALUES ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000002', '10:00', '12:00');
  `), /Potvrda nije spremljena.*RN-1/);

  await db.exec(`
    UPDATE public.radni_nalozi_radnici
    SET vrijeme_od = '18:00', vrijeme_do = '19:00',
        mobile_extra_time = '[{"vrijeme_od":"20:00","vrijeme_do":"21:00"}]'
    WHERE nalog_id = '00000000-0000-0000-0000-000000000008';
    UPDATE public.radni_nalozi_radnici
    SET vrijeme_od = NULL, vrijeme_do = NULL, mobile_zero_hours = true, mobile_extra_time = '[]'
    WHERE nalog_id = '00000000-0000-0000-0000-000000000008';
    UPDATE public.radni_nalozi SET status = 'u_tijeku' WHERE broj = 'RN-2';
    UPDATE public.radni_nalozi_radnici
    SET vrijeme_od = '10:00', vrijeme_do = '12:00', mobile_zero_hours = false
    WHERE nalog_id = '00000000-0000-0000-0000-000000000008';
  `);
  await assert.rejects(db.exec("UPDATE public.radni_nalozi SET status = 'zavrsen' WHERE broj = 'RN-2'"),
    /Nalog nije zaključen.*RN-1/);
  await db.exec(`
    UPDATE public.radni_nalozi_radnici SET vrijeme_od = '16:00', vrijeme_do = '17:00'
    WHERE nalog_id = '00000000-0000-0000-0000-000000000008';
    UPDATE public.radni_nalozi SET status = 'zavrsen' WHERE broj = 'RN-2';
  `);
});

test('closed orders validate date changes and overnight overlap using the settlement schedule date', async (t) => {
  const db = await setupDatabase(t);
  await db.exec(`
    SELECT set_config('app.allow_nalog_edit', 'true', false);
    UPDATE public.radni_nalozi SET rok = '2026-11-02';
    UPDATE public.radni_nalozi_radnici SET vrijeme_od = '14:00', vrijeme_do = '01:00';
    UPDATE public.radni_nalozi SET status = 'zavrsen';
    INSERT INTO public.radni_nalozi (id, broj, rok, status)
    VALUES ('00000000-0000-0000-0000-000000000008', 'RN-2', '2026-11-04', 'u_tijeku');
    INSERT INTO public.radni_nalozi_radnici (nalog_id, radnik_id, vrijeme_od, vrijeme_do, mobile_started_at)
    VALUES ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001',
            '00:30', '02:00', '2026-12-01 08:00:00+00');
    UPDATE public.radni_nalozi SET status = 'zavrsen' WHERE broj = 'RN-2';
  `);
  await assert.rejects(db.exec("UPDATE public.radni_nalozi SET rok = '2026-11-03' WHERE broj = 'RN-2'"),
    /Nalog nije zaključen.*14:00.*01:00 sljedeći dan.*RN-1/);
  await assert.rejects(db.exec(`
    INSERT INTO public.dnevni_raspored_gradilista (nalog_id, datum)
    VALUES ('00000000-0000-0000-0000-000000000008', '2026-11-03');
  `), /Potvrda nije spremljena.*RN-1/);
  await db.exec(`
    INSERT INTO public.dnevni_raspored_gradilista (nalog_id, datum)
    VALUES ('00000000-0000-0000-0000-000000000008', '2026-11-05');
  `);
  await assert.rejects(db.exec(`
    UPDATE public.dnevni_raspored_gradilista SET datum = '2026-11-03'
    WHERE nalog_id = '00000000-0000-0000-0000-000000000008';
  `), /Potvrda nije spremljena.*RN-1/);
  await db.exec("UPDATE public.radni_nalozi SET rok = '2026-11-03' WHERE broj = 'RN-2'");
  await assert.rejects(db.exec(`
    DELETE FROM public.dnevni_raspored_gradilista
    WHERE nalog_id = '00000000-0000-0000-0000-000000000008';
  `), /Potvrda nije spremljena.*RN-1/);
  const { rows } = await db.query('SELECT datum::text FROM public.dnevni_raspored_gradilista');
  assert.equal(rows[0].datum, '2026-11-05');
});

test('cancellation and completion without execution do not block other hours or allow restoring conflicting hours', async (t) => {
  const db = await setupDatabase(t);
  await db.exec(`
    SELECT set_config('app.allow_nalog_edit', 'true', false);
    UPDATE public.radni_nalozi SET rok = '2026-11-02';
    INSERT INTO public.radni_nalozi (id, broj, rok, status)
    VALUES ('00000000-0000-0000-0000-000000000008', 'RN-2', '2026-11-02', 'u_tijeku');
    INSERT INTO public.radni_nalozi_radnici (nalog_id, radnik_id, vrijeme_od, vrijeme_do)
    VALUES ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', '10:00', '12:00');
    UPDATE public.radni_nalozi SET status = 'zavrsen', bez_izvrsenja = true WHERE broj = 'RN-2';
    UPDATE public.radni_nalozi SET status = 'zavrsen' WHERE broj = 'RN-1';
  `);
  await assert.rejects(db.exec("UPDATE public.radni_nalozi SET bez_izvrsenja = false WHERE broj = 'RN-2'"),
    /Nalog nije zaključen.*RN-1/);
  await db.exec(`
    UPDATE public.radni_nalozi SET status = 'otkazan' WHERE broj = 'RN-1';
    UPDATE public.radni_nalozi SET bez_izvrsenja = false WHERE broj = 'RN-2';
  `);
  await assert.rejects(db.exec("UPDATE public.radni_nalozi SET status = 'zavrsen' WHERE broj = 'RN-1'"),
    /Nalog nije zaključen.*RN-2/);
});

test('legacy overlapping closed orders can be corrected without deleting or reopening them', async (t) => {
  const db = await setupDatabase(t);
  await db.exec(`
    SELECT set_config('app.allow_nalog_edit', 'true', false);
    UPDATE public.radni_nalozi SET rok = '2026-11-02', status = 'zavrsen';
    INSERT INTO public.radni_nalozi (id, broj, rok, status)
    VALUES ('00000000-0000-0000-0000-000000000008', 'RN-2', '2026-11-02', 'zavrsen');
    ALTER TABLE public.radni_nalozi_radnici DISABLE TRIGGER prevent_worker_work_time_overlap;
    INSERT INTO public.radni_nalozi_radnici (nalog_id, radnik_id, vrijeme_od, vrijeme_do)
    VALUES ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', '10:00', '12:00');
    ALTER TABLE public.radni_nalozi_radnici ENABLE TRIGGER prevent_worker_work_time_overlap;
  `);
  await assert.rejects(db.exec("UPDATE public.radni_nalozi SET status = 'zavrsen' WHERE broj = 'RN-2'"),
    /Nalog nije zaključen.*RN-1/);
  await db.exec(`
    UPDATE public.radni_nalozi_radnici SET vrijeme_od = '16:00', vrijeme_do = '18:00'
    WHERE nalog_id = '00000000-0000-0000-0000-000000000008';
    UPDATE public.radni_nalozi SET status = 'zavrsen' WHERE broj = 'RN-2';
  `);
  const { rows } = await db.query("SELECT status FROM public.radni_nalozi ORDER BY broj");
  assert.deepEqual(rows.map((row) => row.status), ['zavrsen', 'zavrsen']);
});

test('the three-site example cannot be closed with either of its overlapping shifts', async (t) => {
  const db = await setupDatabase(t);
  await db.exec(`
    SELECT set_config('app.allow_nalog_edit', 'true', false);
    UPDATE public.radni_nalozi SET broj = 'RN-2026-083', rok = '2026-11-02';
    UPDATE public.radni_nalozi_radnici SET vrijeme_od = '06:00', vrijeme_do = '15:00';
    UPDATE public.radni_nalozi SET status = 'zavrsen';
    INSERT INTO public.radni_nalozi (id, broj, rok, status) VALUES
      ('00000000-0000-0000-0000-000000000008', 'RN-2026-081', '2026-11-02', 'u_tijeku'),
      ('00000000-0000-0000-0000-000000000009', 'RN-2026-084', '2026-11-02', 'u_tijeku');
    INSERT INTO public.radni_nalozi_radnici (nalog_id, radnik_id, vrijeme_od, vrijeme_do) VALUES
      ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', '06:00', '07:00'),
      ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', '14:00', '01:00');
  `);
  for (const number of ['RN-2026-081', 'RN-2026-084']) {
    await assert.rejects(db.query("UPDATE public.radni_nalozi SET status = 'zavrsen' WHERE broj = $1", [number]),
      /Nalog nije zaključen.*06:00.*15:00.*RN-2026-083/);
  }
  await db.exec(`
    UPDATE public.radni_nalozi_radnici SET vrijeme_od = '06:00', vrijeme_do = '06:00'
    WHERE nalog_id = '00000000-0000-0000-0000-000000000008';
    UPDATE public.radni_nalozi SET status = 'zavrsen' WHERE broj = 'RN-2026-081';
    UPDATE public.radni_nalozi_radnici SET vrijeme_od = '15:00'
    WHERE nalog_id = '00000000-0000-0000-0000-000000000009';
    UPDATE public.radni_nalozi SET status = 'zavrsen' WHERE broj = 'RN-2026-084';
  `);
});

test('closing and later editing reject overlapping base and additional segments within one order', async (t) => {
  const db = await setupDatabase(t);
  await db.exec(`
    SELECT set_config('app.allow_nalog_edit', 'true', false);
    UPDATE public.radni_nalozi_radnici
    SET mobile_extra_time = '[{"vrijeme_od":"15:00","vrijeme_do":"17:00"}]'
    WHERE radnik_id = '00000000-0000-0000-0000-000000000001';
  `);
  await assert.rejects(db.exec("UPDATE public.radni_nalozi SET status = 'zavrsen'"),
    /Nalog nije zaključen.*RN-1/);
  await db.exec(`
    UPDATE public.radni_nalozi_radnici
    SET mobile_extra_time = '[{"vrijeme_od":"16:00","vrijeme_do":"17:00"}]'
    WHERE radnik_id = '00000000-0000-0000-0000-000000000001';
    UPDATE public.radni_nalozi SET status = 'zavrsen';
  `);
  await assert.rejects(db.exec(`
    UPDATE public.radni_nalozi_radnici SET vrijeme_do = '16:30'
    WHERE radnik_id = '00000000-0000-0000-0000-000000000001';
  `), /Potvrda nije spremljena.*RN-1/);
  await assert.rejects(db.exec(`
    UPDATE public.radni_nalozi_radnici
    SET mobile_extra_time = '[{"vrijeme_od":"17:00","vrijeme_do":"19:00"},{"vrijeme_od":"18:00","vrijeme_do":"20:00"}]'
    WHERE radnik_id = '00000000-0000-0000-0000-000000000001';
  `), /Potvrda nije spremljena.*RN-1/);
});

test('time editing restores persisted values after rejection and serializes pending saves', async () => {
  const source = read('../src/components/views/NalogIzvrsenje.tsx');
  const handlers = source.slice(source.indexOf('  const saveVrijeme ='), source.indexOf('  const addZadatak ='));
  const { outputText } = ts.transpileModule(handlers, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  for (const persistedChange of [false, true]) {
    const previous = [{ radnik_id: 'worker', vrijeme_od: '16:00', vrijeme_do: '18:00', mobile_zero_hours: false }];
    const persisted = persistedChange
      ? [{ ...previous[0], vrijeme_do: '19:00' }]
      : previous;
    let rows = previous;
    let saving = false;
    let pending;
    let rejectSave;
    let calls = 0;
    const errors = [];
    const context = {
      vremena: previous, nalog: { id: 'order' }, timeSavePending: { current: false },
      setVremena: (value) => { rows = value; },
      setSavingTime: (value) => { saving = value; },
      saveNalogRadnikVrijeme: () => {
        calls++;
        return new Promise((resolve, reject) => { rejectSave = reject; });
      },
      fetchNalogRadnikVrijeme: async () => persisted,
      errText: (reason) => reason.message,
      guard: (action) => {
        pending = action().catch((reason) => errors.push(reason.message));
        return pending;
      },
    };
    vm.createContext(context);
    vm.runInContext(`${outputText}\nthis.changeTime = changeVrijeme; this.changeZero = changeZeroHours;`, context);
    context.changeTime('worker', 'vrijeme_do', '12:00');
    context.changeZero('worker', true);
    assert.equal(calls, 1);
    assert.equal(saving, true);
    assert.equal(context.timeSavePending.current, true);
    rejectSave(new Error(persistedChange ? 'Obračun nije spremljen' : 'Preklapanje sati'));
    await pending;
    await Promise.resolve();
    assert.deepEqual(rows, persisted);
    assert.equal(saving, false);
    assert.equal(context.timeSavePending.current, false);
    assert.equal(errors.length, 1);
    assert.match(errors[0], persistedChange ? /Obračun nije spremljen/ : /Preklapanje sati/);
  }
});

test('work-order additional time accepts workers with zero hours in the base shift', async (t) => {
  const db = await setupDatabase(t);
  const segmentId = '00000000-0000-0000-0000-000000000005';
  const orderId = '00000000-0000-0000-0000-000000000004';
  const firstWorker = '00000000-0000-0000-0000-000000000001';
  const secondWorker = '00000000-0000-0000-0000-000000000002';

  await db.query(
    'SELECT public.mobile_save_nalog_time_entries($1,$2::jsonb,$3::uuid[])',
    [orderId, JSON.stringify([
      { id: segmentId, grupa_id: segmentId, radnik_id: firstWorker, vrijeme_od: '17:00', vrijeme_do: '18:00', napomena: 'Povratak na gradilište' },
      { id: '00000000-0000-0000-0000-000000000007', grupa_id: segmentId, radnik_id: secondWorker, vrijeme_od: '17:00', vrijeme_do: '19:00', napomena: 'Povratak na gradilište' },
    ]), []],
  );
  const { rows } = await db.query(
    'SELECT radnik_id, mobile_extra_time FROM public.radni_nalozi_radnici WHERE nalog_id = $1 ORDER BY radnik_id',
    [orderId],
  );
  assert.deepEqual(rows.map((row) => row.mobile_extra_time[0].vrijeme_do), ['18:00', '19:00']);
  const { rows: firstWorkerPortalRows } = await db.query(
    `SELECT izvor FROM public.get_my_radno_vrijeme(NULL, NULL)
     WHERE nalog_id = $1 AND izvor IN ('nalog', 'dionica')`,
    [orderId],
  );
  assert.deepEqual(firstWorkerPortalRows.map((row) => row.izvor).sort(), ['dionica', 'nalog']);

  await assert.rejects(db.query(
    'SELECT public.mobile_save_nalog_time_entries($1,$2::jsonb,$3::uuid[])',
    [orderId, JSON.stringify([
      { id: segmentId, grupa_id: segmentId, radnik_id: firstWorker, vrijeme_od: '17:00', vrijeme_do: '19:00' },
      { id: '00000000-0000-0000-0000-000000000006', grupa_id: segmentId, radnik_id: firstWorker, vrijeme_od: '18:00', vrijeme_do: '20:00' },
    ]), []],
  ), /ne smiju se preklapati/);

  await db.query(
    'SELECT public.mobile_save_nalog_time_entries($1,$2::jsonb,$3::uuid[])',
    [orderId, JSON.stringify([
      { id: segmentId, grupa_id: segmentId, radnik_id: firstWorker, vrijeme_od: '17:00', vrijeme_do: '18:00', napomena: 'Povratak na gradilište' },
      { id: '00000000-0000-0000-0000-000000000007', grupa_id: segmentId, radnik_id: secondWorker, vrijeme_od: '17:00', vrijeme_do: '19:00', napomena: 'Povratak na gradilište' },
    ]), [secondWorker]],
  );
  const { rows: workerRows } = await db.query(
    'SELECT mobile_zero_hours, vrijeme_od, vrijeme_do, mobile_started_at, mobile_finished_at FROM public.radni_nalozi_radnici WHERE nalog_id = $1 AND radnik_id = $2',
    [orderId, secondWorker],
  );
  assert.equal(workerRows[0].mobile_zero_hours, true);
  assert.equal(workerRows[0].vrijeme_od, null);
  assert.equal(workerRows[0].mobile_started_at, null);
  assert.equal(workerRows[0].mobile_finished_at, null);
  const { rows: savedZeroWorkerTime } = await db.query(
    'SELECT mobile_extra_time FROM public.radni_nalozi_radnici WHERE nalog_id = $1 AND radnik_id = $2',
    [orderId, secondWorker],
  );
  assert.equal(savedZeroWorkerTime[0].mobile_extra_time[0].vrijeme_do, '19:00');

  const { rows: portalRows } = await db.query(
    'SELECT izvor FROM public.get_my_radno_vrijeme(NULL, NULL)',
  );
  assert.deepEqual(portalRows.map((row) => row.izvor).sort(), ['dionica', 'nalog']);
  await db.exec(`SELECT set_config('app.worker_id', '${secondWorker}', false)`);
  const { rows: zeroWorkerRows } = await db.query(
    'SELECT izvor FROM public.get_my_radno_vrijeme(NULL, NULL)',
  );
  assert.deepEqual(zeroWorkerRows.map((row) => row.izvor), ['dionica']);
  await db.exec(`SELECT set_config('app.worker_id', '${firstWorker}', false)`);
  await db.query('SELECT public.mobile_submit_nalog($1, true)', [orderId]);
  const { rows: orderRows } = await db.query(
    'SELECT mobile_status FROM public.radni_nalozi WHERE id = $1',
    [orderId],
  );
  assert.equal(orderRows[0].mobile_status, 'predan');
});

test('work-order settlement adds additional time while omitting only the zero-hour base shift', async () => {
  const calls = [];
  const order = {
    id: 'order', status: 'zavrsen', bez_troska: true, bez_izvrsenja: false,
    rok: '2026-11-05', datum_kreiranja: '2026-11-05T08:00:00Z',
    gradiliste_id: 'site', broj: 'RN-1',
  };
  const assignments = [
    {
      radnik_id: 'worker', vrijeme_od: '08:00', vrijeme_do: '16:00', mobile_zero_hours: false,
      mobile_extra_time: [{ vrijeme_od: '22:00', vrijeme_do: '23:00', napomena: 'Povratak na gradilište' }],
      radnik: { ime: 'Ivan', prezime: 'Radnik', cijena_sata: 10, nocni_dodatak: 50, pravo_nocni: true },
    },
    {
      radnik_id: 'zero', vrijeme_od: null, vrijeme_do: null, mobile_zero_hours: true,
      mobile_extra_time: [{ vrijeme_od: '17:00', vrijeme_do: '19:00', napomena: null }],
      radnik: { ime: 'Marko', prezime: 'Nije radio', cijena_sata: 10, nocni_dodatak: 50 },
    },
  ];
  const supabase = {
    rpc: async (...args) => {
      calls.push(args);
      return { data: null, error: null };
    },
    from: (table) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        single: async () => ({ data: order, error: null }),
        then: (resolve, reject) => {
          const data = table === 'dnevni_raspored_gradilista'
            ? [{ datum: '2026-11-05' }]
            : table === 'radni_nalozi_radnici' ? assignments : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const api = loadApi(supabase);
  await api.syncNalogTroskovi('order', {
    zavrsen: true, bezPotvrdeDjelatnika: false, bezIzvrsenja: false,
  });

  const settlement = calls.find(([name]) => name === 'set_work_order_status_with_settlement');
  assert.ok(settlement);
  assert.deepEqual(JSON.parse(JSON.stringify(settlement[1].p_entries)), [
    {
      radnik_id: 'worker',
      gradiliste_id: null,
      datum: '2026-11-05',
      sati: 9,
      napomena: 'Ostalo: RN-1 (bez troška) · Povratak na gradilište · Noćni rad 1 h',
      nalog_id: 'order',
      nocni_sati: 1,
    },
    {
      radnik_id: 'zero',
      gradiliste_id: null,
      datum: '2026-11-05',
      sati: 2,
      napomena: 'Ostalo: RN-1 (bez troška)',
      nalog_id: 'order',
      nocni_sati: 0,
    },
  ]);
});
