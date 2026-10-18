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
        AND nalog.mobile_status IN ('dodijeljen', 'u_tijeku')
    );
$$;

REVOKE ALL ON FUNCTION public.app_mobile_editable_nalog(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_mobile_editable_nalog(uuid) TO authenticated;

DROP POLICY IF EXISTS mobile_worker_stavke_insert ON public.radni_nalozi_stavke;
DROP POLICY IF EXISTS mobile_worker_stavke_update ON public.radni_nalozi_stavke;
DROP POLICY IF EXISTS mobile_worker_stavke_delete ON public.radni_nalozi_stavke;
DROP POLICY IF EXISTS mobile_worker_stavke_scope ON public.radni_nalozi_stavke;

CREATE POLICY mobile_worker_stavke_insert ON public.radni_nalozi_stavke
  FOR INSERT TO authenticated
  WITH CHECK (public.app_mobile_editable_nalog(nalog_id));
CREATE POLICY mobile_worker_stavke_update ON public.radni_nalozi_stavke
  FOR UPDATE TO authenticated
  USING (public.app_mobile_editable_nalog(nalog_id))
  WITH CHECK (public.app_mobile_editable_nalog(nalog_id));
CREATE POLICY mobile_worker_stavke_delete ON public.radni_nalozi_stavke
  FOR DELETE TO authenticated
  USING (public.app_mobile_editable_nalog(nalog_id));
CREATE POLICY mobile_worker_stavke_scope ON public.radni_nalozi_stavke
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.app_is_admin()
    OR public.app_mobile_radnik_id() IS NULL
    OR public.app_mobile_assigned_nalog(nalog_id)
  )
  WITH CHECK (
    public.app_is_admin()
    OR public.app_mobile_radnik_id() IS NULL
    OR public.app_mobile_editable_nalog(nalog_id)
  );

DROP POLICY IF EXISTS mobile_worker_tasks_insert ON public.gradiliste_zadaci;
DROP POLICY IF EXISTS mobile_worker_tasks_update ON public.gradiliste_zadaci;
DROP POLICY IF EXISTS mobile_worker_tasks_scope ON public.gradiliste_zadaci;

CREATE POLICY mobile_worker_tasks_insert ON public.gradiliste_zadaci
  FOR INSERT TO authenticated
  WITH CHECK (nalog_id IS NOT NULL AND public.app_mobile_editable_nalog(nalog_id));
CREATE POLICY mobile_worker_tasks_update ON public.gradiliste_zadaci
  FOR UPDATE TO authenticated
  USING (nalog_id IS NOT NULL AND public.app_mobile_editable_nalog(nalog_id))
  WITH CHECK (nalog_id IS NOT NULL AND public.app_mobile_editable_nalog(nalog_id));
CREATE POLICY mobile_worker_tasks_scope ON public.gradiliste_zadaci
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.app_is_admin()
    OR public.app_mobile_radnik_id() IS NULL
    OR (nalog_id IS NOT NULL AND public.app_mobile_assigned_nalog(nalog_id))
  )
  WITH CHECK (
    public.app_is_admin()
    OR public.app_mobile_radnik_id() IS NULL
    OR (nalog_id IS NOT NULL AND public.app_mobile_editable_nalog(nalog_id))
  );

DROP POLICY IF EXISTS mobile_worker_foto_insert ON public.radni_nalozi_foto;
DROP POLICY IF EXISTS mobile_worker_foto_scope ON public.radni_nalozi_foto;

CREATE POLICY mobile_worker_foto_insert ON public.radni_nalozi_foto
  FOR INSERT TO authenticated
  WITH CHECK (public.app_mobile_editable_nalog(nalog_id));
CREATE POLICY mobile_worker_foto_scope ON public.radni_nalozi_foto
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.app_is_admin()
    OR public.app_mobile_radnik_id() IS NULL
    OR public.app_mobile_assigned_nalog(nalog_id)
  )
  WITH CHECK (
    public.app_is_admin()
    OR public.app_mobile_radnik_id() IS NULL
    OR public.app_mobile_editable_nalog(nalog_id)
  );

DROP POLICY IF EXISTS mobile_worker_storage_scope ON storage.objects;
DROP POLICY IF EXISTS mobile_worker_storage_insert ON storage.objects;

CREATE POLICY mobile_worker_storage_scope ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    bucket_id <> 'nalozi-foto'
    OR public.app_is_admin()
    OR public.app_mobile_radnik_id() IS NULL
    OR CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.app_mobile_assigned_nalog(split_part(name, '/', 1)::uuid)
      ELSE false
    END
    OR (
      split_part(name, '/', 1) = 'gradiliste'
      AND EXISTS (
        SELECT 1
        FROM public.gradiliste_dokumenti document
        JOIN public.nalog_gradiliste_dokumenti link ON link.dokument_id = document.id
        WHERE document.putanja = name
          AND public.app_mobile_assigned_nalog(link.nalog_id)
      )
    )
  )
  WITH CHECK (
    bucket_id <> 'nalozi-foto'
    OR public.app_is_admin()
    OR public.app_mobile_radnik_id() IS NULL
    OR CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.app_mobile_editable_nalog(split_part(name, '/', 1)::uuid)
      ELSE false
    END
  );
CREATE POLICY mobile_worker_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'nalozi-foto'
    AND CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.app_mobile_editable_nalog(split_part(name, '/', 1)::uuid)
      ELSE false
    END
  );

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
  required_sections text[] := ARRAY['upute', 'zadaci', 'materijal', 'alat', 'dokumenti'];
  start_time time := timezone('Europe/Zagreb', now())::time;
BEGIN
  IF worker_id IS NULL OR NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan za uređivanje.';
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
  SET mobile_started_at = now(),
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

CREATE OR REPLACE FUNCTION public.mobile_save_nalog_report(
  p_nalog_id uuid,
  p_km_pocetak integer,
  p_km_kraj integer,
  p_km_na boolean,
  p_napomena text,
  p_napomena_na boolean,
  p_tasks_confirmed boolean,
  p_foto_na boolean,
  p_materijal_na boolean,
  p_alat_na boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_leader boolean := public.app_mobile_leads_nalog(p_nalog_id);
BEGIN
  IF NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan za uređivanje.';
  END IF;

  UPDATE public.radni_nalozi
  SET km_pocetak = CASE WHEN is_leader AND p_km_na THEN NULL ELSE p_km_pocetak END,
    km_kraj = CASE WHEN is_leader AND p_km_na THEN NULL ELSE p_km_kraj END,
    napomena = NULLIF(btrim(COALESCE(p_napomena, '')), ''),
    mobile_tasks_confirmed = CASE WHEN is_leader THEN p_tasks_confirmed ELSE mobile_tasks_confirmed END,
    mobile_km_na = CASE WHEN is_leader THEN p_km_na ELSE mobile_km_na END,
    mobile_napomena_na = CASE WHEN is_leader THEN p_napomena_na ELSE mobile_napomena_na END,
    mobile_foto_na = CASE WHEN is_leader THEN p_foto_na ELSE mobile_foto_na END,
    mobile_materijal_na = CASE WHEN is_leader THEN p_materijal_na ELSE mobile_materijal_na END,
    mobile_alat_na = CASE WHEN is_leader THEN p_alat_na ELSE mobile_alat_na END
  WHERE id = p_nalog_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mobile_save_nalog_report(uuid, integer, integer, boolean, text, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_save_nalog_report(uuid, integer, integer, boolean, text, boolean, boolean, boolean, boolean, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.mobile_start_worker_time(uuid, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_start_worker_time(uuid, uuid, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.mobile_save_worker_time(uuid, uuid, time, time, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_save_worker_time(uuid, uuid, time, time, text[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
