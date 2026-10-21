-- Djelatnici u Portalu djelatnika / mobilnoj aplikaciji ne smiju dodavati radne zadatke;
-- smiju dopisivati samo dodatne radove. Označavanje završenosti radnih zadataka ostaje dopušteno.
DROP POLICY IF EXISTS worker_portal_tasks_insert_dodatni ON public.gradiliste_zadaci;
CREATE POLICY worker_portal_tasks_insert_dodatni ON public.gradiliste_zadaci
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.app_is_worker_portal() OR vrsta = 'dodatni');

CREATE OR REPLACE FUNCTION public.app_guard_worker_portal_zadatak()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.app_is_worker_portal()
    AND (
      NEW.vrsta IS DISTINCT FROM OLD.vrsta
      OR (OLD.vrsta <> 'dodatni' AND NEW.naziv IS DISTINCT FROM OLD.naziv)
    ) THEN
    RAISE EXCEPTION 'Djelatnik ne može mijenjati radne zadatke, samo ih označiti kao obavljene.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.app_guard_worker_portal_zadatak() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_guard_worker_portal_zadatak ON public.gradiliste_zadaci;
CREATE TRIGGER trg_guard_worker_portal_zadatak
BEFORE UPDATE ON public.gradiliste_zadaci
FOR EACH ROW EXECUTE FUNCTION public.app_guard_worker_portal_zadatak();

NOTIFY pgrst, 'reload schema';
