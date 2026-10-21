-- Run as the database owner, never from the browser. The migration already runs this
-- backfill atomically; rerunning this script does not move records between companies.
BEGIN;
DO $$
DECLARE
  initial_company uuid;
BEGIN
  SELECT id INTO STRICT initial_company FROM public.tvrtke WHERE oib = '29191529726';
  PERFORM private.assign_existing_data(initial_company);
END;
$$;
SELECT company.id, company.naziv,
  (SELECT count(*) FROM public.app_profiles WHERE company_id = company.id) AS korisnici,
  (SELECT count(*) FROM public.radnici WHERE company_id = company.id) AS djelatnici,
  (SELECT count(*) FROM public.gradilista WHERE company_id = company.id) AS gradilista,
  (SELECT count(*) FROM public.radni_nalozi WHERE company_id = company.id) AS nalozi
FROM public.tvrtke company WHERE company.oib = '29191529726';
COMMIT;
