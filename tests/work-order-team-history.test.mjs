import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const guardMigration = readFileSync(new URL(
  '../supabase/migrations/20261110280000_zastita_ekipe_naloga_u_radu.sql',
  import.meta.url,
), 'utf8');
const historyMigration = readFileSync(new URL(
  '../supabase/migrations/20261110290000_nalozi_ekipa_povijest_vracanje.sql',
  import.meta.url,
), 'utf8');

const companyId = '00000000-0000-0000-0000-000000000001';
const userId = '00000000-0000-0000-0000-000000000002';
const orderId = '00000000-0000-0000-0000-000000000003';
const workerId = '00000000-0000-0000-0000-000000000004';

async function setup(t) {
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
    CREATE TABLE public.tvrtke (id uuid PRIMARY KEY, aktivna boolean NOT NULL);
    CREATE TABLE public.app_profiles (id uuid PRIMARY KEY, email text, company_id uuid, approved boolean);
    CREATE TABLE public.app_user_permissions (user_id uuid, module text, can_edit boolean);
    CREATE FUNCTION public.app_current_company_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT profile.company_id FROM public.app_profiles profile
        JOIN public.tvrtke company ON company.id = profile.company_id
        WHERE profile.id = auth.uid() AND profile.approved AND company.aktivna
      $$;
    CREATE FUNCTION public.app_has_module_permission(p_module text, p_action text) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.app_profiles profile
          JOIN public.app_user_permissions permission ON permission.user_id = profile.id
          WHERE profile.id = auth.uid() AND profile.approved
            AND profile.company_id = public.app_current_company_id()
            AND permission.module = p_module AND permission.can_edit
        )
      $$;
    CREATE TABLE public.radni_nalozi (
      id uuid PRIMARY KEY, company_id uuid NOT NULL, status text NOT NULL, mobile_status text NOT NULL
    );
    CREATE TABLE public.radni_nalozi_radnici (
      nalog_id uuid NOT NULL REFERENCES public.radni_nalozi(id) ON DELETE CASCADE,
      radnik_id uuid NOT NULL, company_id uuid NOT NULL,
      mobile_started_at timestamptz, mobile_finished_at timestamptz,
      vrijeme_od time, vrijeme_do time, PRIMARY KEY(nalog_id,radnik_id)
    );
    CREATE TABLE public.radno_vrijeme (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nalog_id uuid REFERENCES public.radni_nalozi(id), sati numeric
    );
    CREATE TABLE private.business_change_history (id uuid, expires_at timestamptz);
    INSERT INTO public.tvrtke VALUES ('${companyId}', true);
    INSERT INTO public.app_profiles VALUES ('${userId}', 'editor@example.test', '${companyId}', true);
    INSERT INTO public.app_user_permissions VALUES ('${userId}', 'radni_nalozi', true);
    INSERT INTO public.radni_nalozi VALUES ('${orderId}', '${companyId}', 'otvoren', 'dodijeljen');
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.radni_nalozi, public.radni_nalozi_radnici, public.radno_vrijeme TO authenticated;
    SELECT set_config('request.jwt.claim.sub', '${userId}', false);
  `);
  await db.exec(guardMigration);
  await db.exec(historyMigration);
  await db.exec(historyMigration);
  await db.exec(readFileSync(new URL(
    '../supabase/migrations/20261110690000_poslovne_greske_bez_serialization_retry.sql',
    import.meta.url,
  ), 'utf8'));
  await db.exec('SET ROLE authenticated');
  return db;
}

test('work-order team assignment history restores insertions and deletions latest-first', async (t) => {
  const db = await setup(t);
  await db.query(
    'INSERT INTO public.radni_nalozi_radnici(nalog_id,radnik_id,company_id) VALUES ($1,$2,$3)',
    [orderId, workerId, companyId],
  );
  let history = (await db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId])).rows;
  assert.equal(history.length, 1);
  assert.equal(history[0].operation, 'INSERT');
  assert.equal(history[0].can_restore, true);

  await db.query('SELECT public.restore_work_order_team_change($1)', [history[0].id]);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.radni_nalozi_radnici WHERE nalog_id=$1', [orderId])).rows[0].count, 0);
  history = (await db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId])).rows;
  const originalInsert = history.find((event) => event.operation === 'INSERT' && event.reverses_id === null);
  assert.equal(originalInsert.reversed_at !== null, true);
  assert.equal(originalInsert.can_restore, false);
  assert.equal(history.find((event) => event.reverses_id === originalInsert.id)?.operation, 'DELETE');

  await db.query(
    'INSERT INTO public.radni_nalozi_radnici(nalog_id,radnik_id,company_id) VALUES ($1,$2,$3)',
    [orderId, workerId, companyId],
  );
  await db.query('DELETE FROM public.radni_nalozi_radnici WHERE nalog_id=$1 AND radnik_id=$2', [orderId, workerId]);
  history = (await db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId])).rows;
  assert.equal(history[0].operation, 'DELETE');
  assert.equal(history[0].can_restore, true);
  await db.query('SELECT public.restore_work_order_team_change($1)', [history[0].id]);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public.radni_nalozi_radnici WHERE nalog_id=$1 AND radnik_id=$2', [orderId, workerId])).rows[0].count, 1);
});

test('work-order team restore rejects stale assignments and unsafe execution states', async (t) => {
  const db = await setup(t);
  await db.query(
    'INSERT INTO public.radni_nalozi_radnici(nalog_id,radnik_id,company_id) VALUES ($1,$2,$3)',
    [orderId, workerId, companyId],
  );
  let history = (await db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId])).rows;
  await db.query('DELETE FROM public.radni_nalozi_radnici WHERE nalog_id=$1 AND radnik_id=$2', [orderId, workerId]);
  await db.query(
    'INSERT INTO public.radni_nalozi_radnici(nalog_id,radnik_id,company_id) VALUES ($1,$2,$3)',
    [orderId, workerId, companyId],
  );
  const afterSecondInsert = (await db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId])).rows;
  assert.equal(afterSecondInsert[2].can_restore, false);
  assert.match(afterSecondInsert[2].blocked_reason, /noviju promjenu/);
  await assert.rejects(
    db.query('SELECT public.restore_work_order_team_change($1)', [history[0].id]),
    /Dodjela ima noviju promjenu/,
  );

  await db.query('DELETE FROM public.radni_nalozi_radnici WHERE nalog_id=$1 AND radnik_id=$2', [orderId, workerId]);
  await db.query("UPDATE public.radni_nalozi SET status='u_tijeku' WHERE id=$1", [orderId]);
  history = (await db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId])).rows;
  assert.equal(history[0].can_restore, false);
  await assert.rejects(
    db.query('SELECT public.restore_work_order_team_change($1)', [history[0].id]),
    /Nalog je započet ili zaključen/,
  );
});

test('work-order team history enforces company and permission boundaries and expires cleanly', async (t) => {
  const db = await setup(t);
  await db.query(
    'INSERT INTO public.radni_nalozi_radnici(nalog_id,radnik_id,company_id) VALUES ($1,$2,$3)',
    [orderId, workerId, companyId],
  );
  const history = (await db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId])).rows[0];
  await db.exec('RESET ROLE');
  await db.exec("INSERT INTO public.tvrtke VALUES ('00000000-0000-0000-0000-000000000009', true)");
  await db.exec("UPDATE public.app_profiles SET company_id='00000000-0000-0000-0000-000000000009' WHERE id='" + userId + "'");
  await db.exec('SET ROLE authenticated');
  await assert.rejects(
    db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId]),
    /Radni nalog nije dostupan u vašoj tvrtki/,
  );

  await db.exec('RESET ROLE');
  await db.exec("UPDATE public.app_profiles SET company_id='" + companyId + "' WHERE id='" + userId + "'");
  await db.exec(`UPDATE private.work_order_team_change_history SET expires_at = now() - interval '1 second' WHERE id='${history.id}'`);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(
    db.query('SELECT public.restore_work_order_team_change($1)', [history.id]),
    /Istekao je rok od 30 dana/,
  );
  await db.exec('RESET ROLE');
  await db.query('SELECT private.prune_business_change_history()');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM private.work_order_team_change_history')).rows[0].count, 0);

  await db.exec("DELETE FROM public.app_user_permissions WHERE user_id='" + userId + "'");
  await db.exec('SET ROLE authenticated');
  await assert.rejects(
    db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId]),
    /Nedostaje pravo uređivanja radnih naloga/,
  );
  await assert.rejects(
    db.query('SELECT public.restore_work_order_team_change($1)', [history.id]),
    /Nedostaje pravo uređivanja radnih naloga/,
  );
});

test('work-order team history blocks mobile execution and recorded hours', async (t) => {
  const db = await setup(t);
  await db.query(
    'INSERT INTO public.radni_nalozi_radnici(nalog_id,radnik_id,company_id) VALUES ($1,$2,$3)',
    [orderId, workerId, companyId],
  );
  const event = (await db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId])).rows[0];
  await db.query(
    'UPDATE public.radni_nalozi_radnici SET mobile_finished_at=now() WHERE nalog_id=$1 AND radnik_id=$2',
    [orderId, workerId],
  );
  let latest = (await db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId])).rows[0];
  assert.equal(latest.can_restore, false);
  assert.match(latest.blocked_reason, /početak rada ili evidentirane sate/);
  await assert.rejects(
    db.query('SELECT public.restore_work_order_team_change($1)', [event.id]),
    /Nalog ima početak rada ili evidentirane sate/,
  );

  await db.query(
    'UPDATE public.radni_nalozi_radnici SET mobile_finished_at=NULL WHERE nalog_id=$1 AND radnik_id=$2',
    [orderId, workerId],
  );
  await db.query('INSERT INTO public.radno_vrijeme(nalog_id,sati) VALUES ($1,8)', [orderId]);
  latest = (await db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId])).rows[0];
  assert.equal(latest.can_restore, false);
  await assert.rejects(
    db.query('SELECT public.restore_work_order_team_change($1)', [event.id]),
    /Nalog ima početak rada ili evidentirane sate/,
  );
});

test('work-order team restore rolls back when its audit reversal is not captured', async (t) => {
  const db = await setup(t);
  await db.query(
    'INSERT INTO public.radni_nalozi_radnici(nalog_id,radnik_id,company_id) VALUES ($1,$2,$3)',
    [orderId, workerId, companyId],
  );
  const event = (await db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId])).rows[0];
  await db.exec('RESET ROLE');
  await db.exec('DROP TRIGGER work_order_team_change_history ON public.radni_nalozi_radnici');
  await db.exec('SET ROLE authenticated');
  await assert.rejects(
    db.query('SELECT public.restore_work_order_team_change($1)', [event.id]),
    /Povrat dodjele nije evidentiran/,
  );
  assert.equal((await db.query(
    'SELECT count(*)::int AS count FROM public.radni_nalozi_radnici WHERE nalog_id=$1 AND radnik_id=$2',
    [orderId, workerId],
  )).rows[0].count, 1);
  const current = (await db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId])).rows[0];
  assert.equal(current.reversed_at, null);
});

test('work-order team history pages use a stable sequence cursor and cascades stay out of user history', async (t) => {
  const db = await setup(t);
  for (let index = 0; index < 55; index++) {
    const worker = `00000000-0000-0000-0001-${String(index + 1).padStart(12, '0')}`;
    await db.query(
      'INSERT INTO public.radni_nalozi_radnici(nalog_id,radnik_id,company_id) VALUES ($1,$2,$3)',
      [orderId, worker, companyId],
    );
  }
  const firstPage = (await db.query('SELECT * FROM public.get_work_order_team_change_history($1)', [orderId])).rows;
  assert.equal(firstPage.length, 50);
  const secondPage = (await db.query(
    'SELECT * FROM public.get_work_order_team_change_history($1,$2)',
    [orderId, firstPage.at(-1).sequence],
  )).rows;
  assert.equal(secondPage.length, 5);
  assert.ok(BigInt(firstPage.at(-1).sequence) > BigInt(secondPage[0].sequence));

  await db.exec('RESET ROLE');
  const historyCount = Number((await db.query(
    'SELECT count(*)::int AS count FROM private.work_order_team_change_history WHERE nalog_id=$1',
    [orderId],
  )).rows[0].count);
  await db.exec('SET ROLE authenticated');
  await db.query('DELETE FROM public.radni_nalozi WHERE id=$1', [orderId]);
  await db.exec('RESET ROLE');
  assert.equal(Number((await db.query(
    'SELECT count(*)::int AS count FROM private.work_order_team_change_history WHERE nalog_id=$1',
    [orderId],
  )).rows[0].count), historyCount, 'cascaded assignments must not create user-level delete history');
});
