CREATE OR REPLACE FUNCTION public.get_mobile_nalog_team(p_nalog_id uuid)
RETURNS TABLE (
  radnik_id uuid,
  ime text,
  prezime text,
  mobile_started_at timestamptz,
  mobile_finished_at timestamptz,
  vrijeme_od time,
  vrijeme_do time
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_mobile_assigned_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dodijeljen prijavljenom djelatniku.';
  END IF;

  RETURN QUERY
  SELECT
    worker.id,
    worker.ime,
    worker.prezime,
    assignment.mobile_started_at,
    assignment.mobile_finished_at,
    assignment.vrijeme_od,
    assignment.vrijeme_do
  FROM public.radni_nalozi_radnici assignment
  JOIN public.radnici worker ON worker.id = assignment.radnik_id
  WHERE assignment.nalog_id = p_nalog_id
  ORDER BY worker.prezime, worker.ime;
END;
$$;

CREATE OR REPLACE FUNCTION public.mobile_start_worker_time(
  p_nalog_id uuid,
  p_radnik_id uuid,
  p_reviewed_sections text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  worker_id uuid := public.app_mobile_radnik_id();
  required_sections text[] := ARRAY['upute', 'zadaci', 'materijal', 'alat', 'dokumenti'];
  start_time time := timezone('Europe/Zagreb', now())::time;
BEGIN
  IF worker_id IS NULL OR NOT public.app_mobile_assigned_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dodijeljen prijavljenom djelatniku.';
  END IF;
  IF NOT (COALESCE(p_reviewed_sections, ARRAY[]::text[]) @> required_sections) THEN
    RAISE EXCEPTION 'Prije početka potvrdi pregled svih dijelova naloga.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND radnik_id = p_radnik_id
  ) THEN
    RAISE EXCEPTION 'Odabrani djelatnik nije dodijeljen ovom nalogu.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi
    WHERE id = p_nalog_id AND mobile_status IN ('dodijeljen', 'u_tijeku')
  ) THEN
    RAISE EXCEPTION 'Nalog više nije dostupan za unos radnog vremena.';
  END IF;

  UPDATE public.radni_nalozi_radnici
  SET mobile_reviewed_sections = p_reviewed_sections
  WHERE nalog_id = p_nalog_id AND radnik_id = worker_id;

  UPDATE public.radni_nalozi_radnici
  SET mobile_reviewed_sections = p_reviewed_sections,
      mobile_started_at = now(),
      vrijeme_od = start_time
  WHERE nalog_id = p_nalog_id
    AND radnik_id = p_radnik_id
    AND mobile_started_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Početak vremena za odabranog djelatnika već je evidentiran.';
  END IF;

  UPDATE public.radni_nalozi
  SET mobile_status = 'u_tijeku', status = 'u_tijeku'
  WHERE id = p_nalog_id AND mobile_status IN ('dodijeljen', 'u_tijeku');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nalog više nije dostupan za unos radnog vremena.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mobile_finish_worker_time(p_nalog_id uuid, p_radnik_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  worker_id uuid := public.app_mobile_radnik_id();
  finish_time time := timezone('Europe/Zagreb', now())::time;
BEGIN
  IF worker_id IS NULL OR NOT public.app_mobile_assigned_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dodijeljen prijavljenom djelatniku.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND radnik_id = p_radnik_id
  ) THEN
    RAISE EXCEPTION 'Odabrani djelatnik nije dodijeljen ovom nalogu.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi
    WHERE id = p_nalog_id AND mobile_status = 'u_tijeku'
  ) THEN
    RAISE EXCEPTION 'Nalog više nije u tijeku.';
  END IF;

  UPDATE public.radni_nalozi_radnici
  SET mobile_finished_at = now(),
      vrijeme_do = finish_time
  WHERE nalog_id = p_nalog_id
    AND radnik_id = p_radnik_id
    AND mobile_started_at IS NOT NULL
    AND mobile_finished_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vrijeme za odabranog djelatnika nije započeto ili je već završeno.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mobile_save_worker_time(
  p_nalog_id uuid,
  p_radnik_id uuid,
  p_vrijeme_od time,
  p_vrijeme_do time,
  p_reviewed_sections text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  worker_id uuid := public.app_mobile_radnik_id();
  required_sections text[] := ARRAY['upute', 'zadaci', 'materijal', 'alat', 'dokumenti'];
BEGIN
  IF worker_id IS NULL OR NOT public.app_mobile_assigned_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dodijeljen prijavljenom djelatniku.';
  END IF;
  IF p_vrijeme_od IS NULL THEN
    RAISE EXCEPTION 'Unesi vrijeme početka rada.';
  END IF;
  IF NOT (COALESCE(p_reviewed_sections, ARRAY[]::text[]) @> required_sections) THEN
    RAISE EXCEPTION 'Prije spremanja potvrdi pregled svih dijelova naloga.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND radnik_id = p_radnik_id
  ) THEN
    RAISE EXCEPTION 'Odabrani djelatnik nije dodijeljen ovom nalogu.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi
    WHERE id = p_nalog_id AND mobile_status IN ('dodijeljen', 'u_tijeku')
  ) THEN
    RAISE EXCEPTION 'Nalog više nije dostupan za unos radnog vremena.';
  END IF;

  UPDATE public.radni_nalozi_radnici
  SET mobile_reviewed_sections = p_reviewed_sections
  WHERE nalog_id = p_nalog_id AND radnik_id = worker_id;

  UPDATE public.radni_nalozi_radnici
  SET mobile_reviewed_sections = p_reviewed_sections,
      mobile_started_at = COALESCE(mobile_started_at, now()),
      mobile_finished_at = CASE
        WHEN p_vrijeme_do IS NULL THEN NULL
        ELSE COALESCE(mobile_finished_at, now())
      END,
      vrijeme_od = p_vrijeme_od,
      vrijeme_do = p_vrijeme_do
  WHERE nalog_id = p_nalog_id AND radnik_id = p_radnik_id;

  UPDATE public.radni_nalozi
  SET mobile_status = 'u_tijeku', status = 'u_tijeku'
  WHERE id = p_nalog_id AND mobile_status IN ('dodijeljen', 'u_tijeku');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nalog više nije dostupan za unos radnog vremena.';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.mobile_submit_nalog(uuid);

CREATE FUNCTION public.mobile_submit_nalog(p_nalog_id uuid, p_leader_confirmed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_mobile_leads_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Samo dodijeljeni poslovođa može predati nalog.';
  END IF;
  IF p_leader_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'Poslovođa mora potvrditi pregled vremena ekipe i završnog izvještaja.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND (mobile_started_at IS NULL OR mobile_finished_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'Svi djelatnici moraju imati evidentiran početak i završetak vremena prije predaje naloga.';
  END IF;

  PERFORM 1 FROM public.radni_nalozi nalog
  WHERE nalog.id = p_nalog_id
    AND nalog.mobile_status = 'u_tijeku'
    AND (nalog.mobile_km_na OR (nalog.km_pocetak IS NOT NULL AND nalog.km_kraj IS NOT NULL AND nalog.km_kraj >= nalog.km_pocetak))
    AND (nalog.mobile_napomena_na OR NULLIF(btrim(COALESCE(nalog.napomena, '')), '') IS NOT NULL)
    AND nalog.mobile_tasks_confirmed
    AND (nalog.mobile_foto_na OR EXISTS (
      SELECT 1
      FROM public.radni_nalozi_foto photo
      JOIN public.radni_nalozi_radnici leader
        ON leader.nalog_id = photo.nalog_id
        AND leader.radnik_id = nalog.poslovodja_id
      WHERE photo.nalog_id = p_nalog_id
        AND photo.created_at >= leader.mobile_started_at
    ))
    AND (nalog.mobile_materijal_na OR EXISTS (
      SELECT 1 FROM public.radni_nalozi_stavke WHERE nalog_id = p_nalog_id AND tip = 'materijal'
    ))
    AND (nalog.mobile_alat_na OR EXISTS (
      SELECT 1 FROM public.radni_nalozi_stavke WHERE nalog_id = p_nalog_id AND tip = 'alat'
    ));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nedostaju obavezni podaci. Provjeri vrijeme ekipe, kilometre, napomenu, zadatke, fotografije, materijal i alat.';
  END IF;

  UPDATE public.radni_nalozi SET mobile_status = 'predan' WHERE id = p_nalog_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mobile_nalog_team(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mobile_start_worker_time(uuid, uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mobile_finish_worker_time(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mobile_save_worker_time(uuid, uuid, time, time, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mobile_submit_nalog(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_nalog_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_start_worker_time(uuid, uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_finish_worker_time(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_save_worker_time(uuid, uuid, time, time, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_submit_nalog(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
