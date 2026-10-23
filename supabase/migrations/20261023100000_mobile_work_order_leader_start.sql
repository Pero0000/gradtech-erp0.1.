CREATE OR REPLACE FUNCTION public.app_mobile_editable_nalog(p_nalog_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.app_mobile_assigned_nalog(p_nalog_id)
    AND EXISTS (
      SELECT 1
      FROM public.radni_nalozi nalog
      WHERE nalog.id = p_nalog_id
        AND (
          nalog.mobile_status = 'u_tijeku'
          OR (nalog.mobile_status = 'dodijeljen' AND public.app_mobile_leads_nalog(p_nalog_id))
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.mobile_start_nalog(p_nalog_id uuid, p_reviewed_sections text[])
RETURNS time
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  worker_id uuid := public.app_mobile_radnik_id();
  start_time time := timezone('Europe/Zagreb', now())::time;
  required_sections text[] := ARRAY['upute', 'zadaci', 'materijal', 'alat', 'dokumenti'];
BEGIN
  IF worker_id IS NULL OR NOT public.app_mobile_leads_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Samo dodijeljeni poslovođa može potvrditi i pokrenuti gradilište.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi
    WHERE id = p_nalog_id AND mobile_status IN ('dodijeljen', 'u_tijeku')
  ) THEN
    RAISE EXCEPTION 'Nalog više nije dostupan za početak rada.';
  END IF;
  IF NOT (COALESCE(p_reviewed_sections, ARRAY[]::text[]) @> required_sections) THEN
    RAISE EXCEPTION 'Prije početka potvrdi pregled svih dijelova naloga.';
  END IF;

  SELECT vrijeme_od INTO start_time
  FROM public.radni_nalozi_radnici
  WHERE nalog_id = p_nalog_id AND radnik_id = worker_id AND mobile_started_at IS NOT NULL;
  IF FOUND THEN
    RETURN start_time;
  END IF;
  start_time := timezone('Europe/Zagreb', now())::time;

  UPDATE public.radni_nalozi_radnici
  SET mobile_reviewed_sections = required_sections,
      mobile_started_at = COALESCE(mobile_started_at, now()),
      vrijeme_od = COALESCE(vrijeme_od, start_time)
  WHERE nalog_id = p_nalog_id AND radnik_id = worker_id;

  UPDATE public.radni_nalozi
  SET mobile_status = 'u_tijeku', status = 'u_tijeku'
  WHERE id = p_nalog_id AND mobile_status IN ('dodijeljen', 'u_tijeku');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nalog više nije dostupan za početak rada.';
  END IF;

  RETURN start_time;
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
  is_leader boolean := public.app_mobile_leads_nalog(p_nalog_id);
  order_status text;
  required_sections text[] := ARRAY['upute', 'zadaci', 'materijal', 'alat', 'dokumenti'];
  start_time time := timezone('Europe/Zagreb', now())::time;
BEGIN
  IF worker_id IS NULL OR NOT public.app_mobile_assigned_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan prijavljenom djelatniku.';
  END IF;

  SELECT mobile_status INTO order_status
  FROM public.radni_nalozi
  WHERE id = p_nalog_id;
  IF order_status NOT IN ('dodijeljen', 'u_tijeku') THEN
    RAISE EXCEPTION 'Nalog više nije dostupan za početak rada.';
  END IF;
  IF order_status = 'dodijeljen' AND NOT is_leader THEN
    RAISE EXCEPTION 'Samo poslovođa može potvrditi i pokrenuti gradilište.';
  END IF;
  IF NOT is_leader AND p_radnik_id <> worker_id THEN
    RAISE EXCEPTION 'Djelatnik može pokrenuti samo vlastito radno vrijeme.';
  END IF;
  IF is_leader AND NOT (COALESCE(p_reviewed_sections, ARRAY[]::text[]) @> required_sections) THEN
    RAISE EXCEPTION 'Poslovođa mora potvrditi pregled svih dijelova naloga prije početka rada.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND radnik_id = p_radnik_id
  ) THEN
    RAISE EXCEPTION 'Odabrani djelatnik nije dodijeljen ovom nalogu.';
  END IF;

  IF is_leader THEN
    UPDATE public.radni_nalozi_radnici
    SET mobile_reviewed_sections = p_reviewed_sections
    WHERE nalog_id = p_nalog_id AND radnik_id = worker_id;
  END IF;

  UPDATE public.radni_nalozi_radnici
  SET mobile_started_at = COALESCE(mobile_started_at, now()),
      vrijeme_od = COALESCE(vrijeme_od, start_time)
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
    RAISE EXCEPTION 'Nalog više nije dostupan za početak rada.';
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
  is_leader boolean := public.app_mobile_leads_nalog(p_nalog_id);
  required_sections text[] := ARRAY['upute', 'zadaci', 'materijal', 'alat', 'dokumenti'];
BEGIN
  IF worker_id IS NULL OR NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan za uređivanje.';
  END IF;
  IF NOT is_leader AND p_radnik_id <> worker_id THEN
    RAISE EXCEPTION 'Djelatnik može uređivati samo vlastito radno vrijeme.';
  END IF;
  IF p_vrijeme_od IS NULL THEN
    RAISE EXCEPTION 'Unesi vrijeme početka rada.';
  END IF;
  IF is_leader AND NOT (COALESCE(p_reviewed_sections, ARRAY[]::text[]) @> required_sections) THEN
    RAISE EXCEPTION 'Poslovođa mora potvrditi pregled svih dijelova naloga prije spremanja vremena.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND radnik_id = p_radnik_id
  ) THEN
    RAISE EXCEPTION 'Odabrani djelatnik nije dodijeljen ovom nalogu.';
  END IF;

  IF is_leader THEN
    UPDATE public.radni_nalozi_radnici
    SET mobile_reviewed_sections = p_reviewed_sections
    WHERE nalog_id = p_nalog_id AND radnik_id = worker_id;
  END IF;

  UPDATE public.radni_nalozi_radnici
  SET mobile_started_at = COALESCE(mobile_started_at, now()),
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

REVOKE ALL ON FUNCTION public.mobile_start_nalog(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_start_nalog(uuid, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.mobile_start_worker_time(uuid, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_start_worker_time(uuid, uuid, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.mobile_save_worker_time(uuid, uuid, time, time, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_save_worker_time(uuid, uuid, time, time, text[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
