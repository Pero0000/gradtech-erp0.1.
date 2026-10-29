DROP FUNCTION IF EXISTS public.get_mobile_radni_nalozi();

CREATE FUNCTION public.get_mobile_radni_nalozi()
RETURNS TABLE (
  id uuid,
  broj text,
  gradiliste_naziv text,
  gradiliste_adresa text,
  naslov text,
  opis text,
  status text,
  prioritet text,
  rok date,
  mobile_status text,
  poslovodja_id uuid,
  mobile_reviewed_sections text[],
  mobile_started_at timestamptz,
  mobile_finished_at timestamptz,
  vrijeme_od time,
  vrijeme_do time
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    nalog.id,
    nalog.broj,
    gradiliste.naziv,
    gradiliste.adresa,
    nalog.naslov,
    nalog.opis,
    nalog.status,
    nalog.prioritet,
    nalog.rok,
    nalog.mobile_status,
    nalog.poslovodja_id,
    assignment.mobile_reviewed_sections,
    assignment.mobile_started_at,
    assignment.mobile_finished_at,
    assignment.vrijeme_od,
    assignment.vrijeme_do
  FROM public.radni_nalozi nalog
  JOIN public.radni_nalozi_radnici assignment ON assignment.nalog_id = nalog.id
  LEFT JOIN public.gradilista gradiliste ON gradiliste.id = nalog.gradiliste_id
  WHERE nalog.zakljucen_at IS NOT NULL
    AND nalog.status <> 'otkazan'
    AND assignment.radnik_id = public.app_mobile_radnik_id()
    AND public.app_mobile_radnik_id() IS NOT NULL
  ORDER BY nalog.rok NULLS LAST, nalog.datum_kreiranja DESC;
$$;

REVOKE ALL ON FUNCTION public.get_mobile_radni_nalozi() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_radni_nalozi() TO authenticated;

NOTIFY pgrst, 'reload schema';
