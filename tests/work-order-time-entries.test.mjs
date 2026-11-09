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
      mobile_potvrde text[] DEFAULT '{}', poslovodja_id uuid, mobile_km_na boolean DEFAULT true,
      mobile_napomena_na boolean DEFAULT true, km_pocetak integer, km_kraj integer, napomena text,
      mobile_tasks_confirmed boolean DEFAULT true,
      mobile_foto_na boolean DEFAULT true, mobile_materijal_na boolean DEFAULT true, mobile_alat_na boolean DEFAULT true
    );
    CREATE TABLE public.radni_nalozi_radnici (
      nalog_id uuid, radnik_id uuid, is_leader boolean DEFAULT false,
      mobile_started_at timestamptz, mobile_finished_at timestamptz,
      vrijeme_od time, vrijeme_do time
    );
    CREATE TABLE public.radni_nalozi_foto (nalog_id uuid, created_at timestamptz);
    CREATE TABLE public.radni_nalozi_stavke (nalog_id uuid, tip text);
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
    CREATE FUNCTION public.get_my_portal_vrijeme() RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT true $$;
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
  return db;
}

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
