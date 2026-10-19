-- Ime i prezime radnika na radnim nalozima koje korisnik smije vidjeti.
-- Korisnik s pravom na radne naloge, ali bez prava na modul Radnici, ne vidi tablicu radnici
-- (satnice, osobni podaci), pa mu se vraćaju samo imena radnika dodijeljenih tim nalozima.
CREATE OR REPLACE FUNCTION public.get_nalog_radnici_imena(p_nalog_ids uuid[])
RETURNS TABLE (nalog_id uuid, radnik_id uuid, ime text, prezime text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT assignment.nalog_id, radnik.id, radnik.ime::text, radnik.prezime::text
  FROM public.radni_nalozi_radnici assignment
  JOIN public.radnici radnik ON radnik.id = assignment.radnik_id
  WHERE assignment.nalog_id = ANY(COALESCE(p_nalog_ids, ARRAY[]::uuid[]))
    AND (
      public.app_is_admin()
      OR public.app_mobile_assigned_nalog(assignment.nalog_id)
      OR (public.app_mobile_radnik_id() IS NULL AND public.app_has_module_permission('radni_nalozi', 'view'))
    );
$$;

REVOKE ALL ON FUNCTION public.get_nalog_radnici_imena(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_nalog_radnici_imena(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
