-- Integration test: run as postgres in a test database after all migrations.
-- Supabase Auth/storage schemas must exist. All fixtures are rolled back.
BEGIN;

CREATE FUNCTION pg_temp.assert_true(condition boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %', label; END IF;
END;
$$;
CREATE FUNCTION pg_temp.assert_denied(statement text, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    RETURN;
  END;
  RAISE EXCEPTION 'FAILED: % unexpectedly succeeded', label;
END;
$$;

INSERT INTO public.tvrtke(id,naziv,oib,adresa)
VALUES ('20000000-0000-0000-0000-000000000002','Tenant B','00000000002','Test');
INSERT INTO public.company_invitations(company_id,email,is_admin,created_by)
SELECT '20000000-0000-0000-0000-000000000002', entry.email, entry.admin, owner.id
FROM (VALUES ('tenant-b-admin@example.test',true), ('tenant-b-worker@example.test',false),
  ('tenant-b-viewer@example.test',false)) entry(email,admin)
CROSS JOIN public.app_profiles owner WHERE lower(owner.email) = 'ivan.pericak@gmail.com';
INSERT INTO auth.users(id,email,invited_at)
VALUES
  ('10000000-0000-0000-0000-000000000002','tenant-b-admin@example.test',now()),
  ('10000000-0000-0000-0000-000000000003','tenant-b-worker@example.test',now()),
  ('10000000-0000-0000-0000-000000000004','tenant-b-viewer@example.test',now());
INSERT INTO public.gradilista(id,company_id,naziv)
VALUES ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','B site');
INSERT INTO public.radnici(id,company_id,ime,prezime)
VALUES ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','B','Worker');
UPDATE public.app_profiles SET radnik_id = '40000000-0000-0000-0000-000000000002'
WHERE id = '10000000-0000-0000-0000-000000000003';
INSERT INTO public.radni_nalozi(id,company_id,broj,naslov,gradiliste_id,zakljucen_at,mobile_status)
VALUES ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',
  'RN-2026-007','B order','30000000-0000-0000-0000-000000000002',now(),'dodijeljen');
INSERT INTO public.radni_nalozi_radnici(company_id,nalog_id,radnik_id)
VALUES ('20000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002');
INSERT INTO public.oprema(id,company_id,kategorija,naziv)
VALUES ('60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','alat','B tool');
INSERT INTO storage.objects(bucket_id,name)
VALUES ('nalozi-foto','50000000-0000-0000-0000-000000000002/photo.jpg');

SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM public.app_profiles WHERE lower(email)='ivan.pericak@gmail.com'),true);
SELECT set_config('test.initial_company',(SELECT company_id::text FROM public.app_profiles WHERE lower(email)='ivan.pericak@gmail.com'),true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.app_is_platform_owner(), 'owner role');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.tvrtke) >= 2, 'owner sees company registry');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.gradilista WHERE naziv='B site'), 'owner cannot see B business data');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.app_profiles WHERE email='tenant-b-admin@example.test'), 'owner cannot see B profiles');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM storage.objects WHERE name LIKE '50000000-0000-0000-0000-000000000002/%'), 'owner cannot see B files');
SELECT pg_temp.assert_denied($s$ SELECT * FROM public.get_nalog_radnici_imena(ARRAY['50000000-0000-0000-0000-000000000002']::uuid[]) $s$, 'names RPC tenant gate');
SELECT pg_temp.assert_denied($s$ SELECT public.mobile_start_nalog('50000000-0000-0000-0000-000000000002','{}') $s$, 'mobile RPC tenant gate');
SELECT pg_temp.assert_denied($s$ INSERT INTO public.gradilista(company_id,naziv) VALUES ('20000000-0000-0000-0000-000000000002','Attack') $s$, 'cross company insert');
SELECT pg_temp.assert_denied($s$ INSERT INTO public.radni_nalozi(broj,naslov,gradiliste_id) VALUES ('TEST-CROSS','Attack','30000000-0000-0000-0000-000000000002') $s$, 'cross company foreign key');
SELECT pg_temp.assert_denied($s$ SELECT * FROM private.get_nalog_radnici_imena('{}') $s$, 'private implementation not callable');
SELECT pg_temp.assert_denied($s$ UPDATE public.app_profiles SET is_platform_owner=true WHERE id=auth.uid() $s$, 'owner flag not writable');
SELECT pg_temp.assert_denied($s$ UPDATE public.app_profiles SET radnik_id='40000000-0000-0000-0000-000000000002' WHERE id=auth.uid() $s$, 'profile cannot link foreign company worker');
SELECT pg_temp.assert_denied($s$ INSERT INTO storage.objects(bucket_id,name) VALUES ('nalozi-foto','50000000-0000-0000-0000-000000000002/attack.jpg') $s$, 'cross company upload');
WITH changed AS (
  UPDATE public.gradilista SET naziv='Attack' WHERE id='30000000-0000-0000-0000-000000000002' RETURNING id
) SELECT pg_temp.assert_true(count(*)=0, 'cross company update affects zero rows') FROM changed;
WITH deleted AS (
  DELETE FROM public.radni_nalozi WHERE id='50000000-0000-0000-0000-000000000002' RETURNING id
) SELECT pg_temp.assert_true(count(*)=0, 'cross company delete affects zero rows') FROM deleted;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.app_is_admin() AND NOT public.app_is_platform_owner(), 'B admin not platform owner');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.tvrtke)=1, 'B admin sees own company only');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.gradilista)=1, 'B sees own site only');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.radnici)=1, 'B sees own worker only');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.app_profiles)=3, 'B sees own profiles only');
SELECT pg_temp.assert_true((SELECT count(*) FROM storage.objects)=1, 'B can see own file');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.get_nalog_radnici_imena(ARRAY['50000000-0000-0000-0000-000000000002']::uuid[]))=1, 'own names RPC');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.get_mobile_work_order_audit('50000000-0000-0000-0000-000000000002'))>=1, 'own audit RPC');
INSERT INTO public.gradiliste_board_layout(id,columns) VALUES(true,'[[],[],[]]')
ON CONFLICT(company_id,id) DO UPDATE SET columns=excluded.columns;
INSERT INTO public.ponude_postavke(id,podaci) VALUES(1,'{"izvodac":"Tenant B"}')
ON CONFLICT(company_id,id) DO UPDATE SET podaci=excluded.podaci;
SELECT pg_temp.assert_true(public.next_company_number('ponuda',2026)=1, 'independent B offer numbering');
SELECT pg_temp.assert_true(public.next_company_number('ponuda',2026)=2, 'atomic counter increments');
SELECT pg_temp.assert_true(public.next_company_number('nalog',2026)=8, 'manually entered numbers are respected');
INSERT INTO public.radnici(ime,prezime) SELECT 'Worker ' || number, 'Unlimited' FROM generate_series(1,1101) number;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.radnici)=1102, 'no 1000-worker company quota');
SELECT pg_temp.assert_denied($s$ UPDATE public.gradilista SET company_id=current_setting('test.initial_company')::uuid WHERE id='30000000-0000-0000-0000-000000000002' $s$, 'immutable company');
RESET ROLE;

-- A normal approved account without module permissions must still see no business data.
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.gradilista), 'module permissions preserved');
SELECT pg_temp.assert_denied($s$ SELECT public.next_company_number('ponuda',2026) $s$, 'no numbering without edit permission');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) FROM public.get_mobile_radni_nalozi())=1, 'mobile sees assigned own company order');
SELECT pg_temp.assert_true((SELECT count(*) FROM public.get_mobile_nalog_team('50000000-0000-0000-0000-000000000002'))=1, 'team RPC still works');
RESET ROLE;

SELECT pg_temp.assert_denied($s$ INSERT INTO auth.users(id,email) VALUES ('10000000-0000-0000-0000-000000000099','self-signup@example.test') $s$, 'signup without invitation');
UPDATE public.tvrtke SET aktivna=false WHERE id='20000000-0000-0000-0000-000000000002';
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.app_current_company_id() IS NULL, 'disabled company has no active scope');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.gradilista), 'disabled admin cannot see data');
SELECT pg_temp.assert_denied($s$ SELECT * FROM public.get_nalog_radnici_imena(ARRAY['50000000-0000-0000-0000-000000000002']::uuid[]) $s$, 'disabled company RPC gate');
RESET ROLE;
ROLLBACK;
