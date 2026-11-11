import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import vm from 'node:vm';
import ts from 'typescript';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('unlock, change team and republish updates portal access atomically without recreating the order', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA private;
    CREATE FUNCTION public.app_current_company_id() RETURNS uuid LANGUAGE sql AS $$ SELECT '${id(1)}'::uuid $$;
    CREATE FUNCTION public.app_mobile_radnik_id() RETURNS uuid LANGUAGE sql AS $$
      SELECT NULLIF(current_setting('app.worker', true),'')::uuid
    $$;
    CREATE FUNCTION public.app_has_module_permission(text,text) RETURNS boolean LANGUAGE sql AS $$
      SELECT COALESCE(current_setting('app.edit',true),'true')='true'
    $$;
    CREATE TABLE public.radnici(id uuid PRIMARY KEY, company_id uuid);
    CREATE TABLE public.gradilista(id uuid PRIMARY KEY, company_id uuid, naziv text, adresa text);
    CREATE TABLE public.radni_nalozi(
      id uuid PRIMARY KEY, company_id uuid DEFAULT public.app_current_company_id(),
      broj text, gradiliste_id uuid, naslov text, opis text, status text, prioritet text,
      rok date, poslovodja_id uuid, vozac_id uuid, zakljucen_at timestamptz,
      mobile_status text, bez_izvrsenja boolean DEFAULT false, datum_kreiranja timestamptz DEFAULT now()
    );
    CREATE TABLE public.radni_nalozi_radnici(
      nalog_id uuid REFERENCES public.radni_nalozi(id), radnik_id uuid REFERENCES public.radnici(id),
      company_id uuid DEFAULT public.app_current_company_id(),
      mobile_started_at timestamptz, mobile_finished_at timestamptz,
      mobile_reviewed_sections text[] DEFAULT '{}', vrijeme_od time, vrijeme_do time,
      PRIMARY KEY(nalog_id,radnik_id)
    );
    CREATE TABLE public.radno_vrijeme(nalog_id uuid);
    CREATE FUNCTION public.get_mobile_radni_nalozi() RETURNS void LANGUAGE sql AS $$ SELECT $$;
    INSERT INTO public.radnici VALUES ('${id(2)}','${id(1)}'),('${id(3)}','${id(1)}'),
      ('${id(4)}','${id(1)}'),('${id(9)}','${id(8)}');
    INSERT INTO public.radni_nalozi (id,broj,naslov,status,mobile_status,prioritet,poslovodja_id,vozac_id,zakljucen_at)
    VALUES ('${id(5)}','RN-1','Rad','otvoren','dodijeljen','srednji','${id(2)}','${id(2)}',now());
    INSERT INTO public.radni_nalozi_radnici(nalog_id,radnik_id)
    VALUES ('${id(5)}','${id(2)}'),('${id(5)}','${id(3)}');
  `);
  await db.exec(read('../supabase/migrations/20261110670000_nalog_ekipa_ponovno_slanje.sql'));
  const save = (workers, locked) => db.query(
    'SELECT public.save_work_order_preparation($1,NULL,$2,NULL,$3,$4,NULL,$5,$6)',
    [id(5), 'Ažurirani nalog', 'otvoren', 'srednji', workers, locked],
  );
  const portal = async (worker) => {
    await db.query("SELECT set_config('app.worker',$1,false)", [worker]);
    return (await db.query('SELECT * FROM public.get_mobile_radni_nalozi()')).rows;
  };
  const originalPublication = (await portal(id(2)))[0].zakljucen_at;
  const originalTeam = (await db.query('SELECT radnik_id FROM public.radni_nalozi_radnici ORDER BY radnik_id')).rows;
  await db.exec(`
    GRANT SELECT ON public.radnici, public.gradilista, public.radno_vrijeme TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.radni_nalozi, public.radni_nalozi_radnici TO authenticated;
    ALTER TABLE public.radni_nalozi ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.radni_nalozi_radnici ENABLE ROW LEVEL SECURITY;
    CREATE POLICY order_read ON public.radni_nalozi FOR SELECT TO authenticated USING (true);
    CREATE POLICY order_update ON public.radni_nalozi FOR UPDATE TO authenticated USING (true);
    CREATE POLICY team_read ON public.radni_nalozi_radnici FOR SELECT TO authenticated USING (true);
    CREATE POLICY team_insert ON public.radni_nalozi_radnici FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY team_update ON public.radni_nalozi_radnici FOR UPDATE TO authenticated USING (true);
    SET ROLE authenticated;
  `);
  await assert.rejects(save([id(3), id(4)], null), /Ekipa nije spremljena/);
  await db.exec('RESET ROLE');
  assert.deepEqual((await db.query('SELECT radnik_id FROM public.radni_nalozi_radnici ORDER BY radnik_id')).rows, originalTeam);
  await db.exec(`
    CREATE POLICY team_delete ON public.radni_nalozi_radnici FOR DELETE TO authenticated USING (true);
    DROP POLICY order_update ON public.radni_nalozi;
    SET ROLE authenticated;
  `);
  await assert.rejects(save([id(3), id(4)], null), /Nalog nije dostupan/);
  await db.exec('RESET ROLE');
  assert.deepEqual((await db.query('SELECT radnik_id FROM public.radni_nalozi_radnici ORDER BY radnik_id')).rows, originalTeam);
  await save([id(2), id(3)], false);
  assert.equal((await portal(id(2))).length, 0);
  await save([id(3), id(4)], null);
  await assert.rejects(save([id(3), id(4)], true), /odaberi dodijeljenog poslovođu/);
  await db.exec(`UPDATE public.radni_nalozi SET poslovodja_id='${id(3)}'`);
  await save([id(3), id(4)], true);
  assert.equal((await portal(id(2))).length, 0, 'removed worker loses access');
  for (const worker of [id(3), id(4)]) {
    const orders = await portal(worker);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].id, id(5));
    assert.equal(orders[0].naslov, 'Ažurirani nalog');
    assert.equal(orders[0].poslovodja_id, id(3));
    assert.notEqual(orders[0].zakljucen_at.getTime(), originalPublication.getTime());
  }
  assert.equal((await db.query('SELECT vozac_id FROM public.radni_nalozi')).rows[0].vozac_id, null);
  const previousPublication = (await portal(id(3)))[0].zakljucen_at;
  await save([id(3)], null);
  assert.equal((await portal(id(4))).length, 0);
  assert.notEqual((await portal(id(3)))[0].zakljucen_at.getTime(), previousPublication.getTime(),
    'editing an already sent, unstarted team also invalidates cached portal details');
  await save([id(3), id(4)], null);
  const team = async () => (await db.query('SELECT radnik_id FROM public.radni_nalozi_radnici ORDER BY radnik_id')).rows;
  const before = await team();
  await assert.rejects(save([id(4), id(9)], true), /djelatnik nije dostupan/);
  assert.deepEqual(await team(), before);
  await db.exec("SELECT set_config('app.edit','false',false)");
  await assert.rejects(save([id(4)], true), /Nedostaje pravo/);
  await db.exec("SELECT set_config('app.edit','true',false)");
  await db.exec(`UPDATE public.radni_nalozi_radnici SET mobile_started_at=now() WHERE radnik_id='${id(3)}'`);
  await assert.rejects(save([id(4)], false), /nakon početka rada/);
  assert.deepEqual(await team(), before);
  await db.exec('UPDATE public.radni_nalozi_radnici SET mobile_started_at=NULL');
  await db.exec(`INSERT INTO public.radno_vrijeme VALUES ('${id(5)}')`);
  await assert.rejects(save([id(4)], true), /evidentiranja sati/);
  await db.exec('DELETE FROM public.radno_vrijeme');
  await db.exec(`CREATE FUNCTION public.reject_test_publication() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Test publication failure'; END $$;
    CREATE TRIGGER reject_test_publication BEFORE UPDATE ON public.radni_nalozi
    FOR EACH ROW EXECUTE FUNCTION public.reject_test_publication();
  `);
  await assert.rejects(save([id(4)], true), /Test publication failure/);
  assert.deepEqual(await team(), before, 'failed publication rolls back membership edits');
});

test('reopening a saved draft never re-adds a removed worker who is still assigned to the vehicle', async () => {
  const schedule = read('../src/components/views/RasporedView.tsx');
  const handler = schedule.slice(schedule.indexOf('const openExistingNalog = async'), schedule.indexOf('const closeNalog ='));
  let form;
  const context = {
    fetchRadniNalozi: async () => [{
      id: 'order', radnici: [{ id: 'retained' }, { id: 'added' }],
      zakljucen_at: null, status: 'otvoren', gradiliste_id: 'site',
    }],
    workerAssignments: [{ vozilo_id: 'car', radnik_id: 'removed' }, { vozilo_id: 'car', radnik_id: 'retained' }],
    siteAssignments: [{ id: 'assignment', vozilo_id: 'car' }],
    fetchGradilisteZadaci: async () => [],
    setNalogForm: (value) => { form = value; },
    setError: (message) => { assert.equal(message, null); },
    setNoviMaterijal: () => {}, setNoviAlat: () => {}, setNoviZadatak: () => {},
    prazniNoviZadaci: {}, errMsg: (reason) => reason.message,
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`${handler}\nthis.open = openExistingNalog;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  await context.open('assignment', 'order');
  assert.deepEqual(Array.from(form.radnik_ids), ['retained', 'added']);
  assert.deepEqual(Array.from(form.radnik_options).sort(), ['added', 'removed', 'retained']);
});

test('portal refresh tracks publication changes and rejects stale detail responses', () => {
  const portal = read('../src/components/mobile/MobileWorkOrdersView.tsx');
  assert.match(portal, /\[selectedId, selectedPublication, loadDetails\]/);
  assert.match(portal, /selectedIdRef.current !== order.id/);
});
