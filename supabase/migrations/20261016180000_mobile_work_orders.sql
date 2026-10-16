ALTER TABLE public.app_profiles
  ADD COLUMN IF NOT EXISTS radnik_id uuid REFERENCES public.radnici(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS app_profiles_radnik_id_unique
  ON public.app_profiles (radnik_id)
  WHERE radnik_id IS NOT NULL;

GRANT UPDATE (radnik_id) ON public.app_profiles TO authenticated;

ALTER TABLE public.radni_nalozi
  ADD COLUMN IF NOT EXISTS mobile_status text NOT NULL DEFAULT 'nije_poslan'
    CHECK (mobile_status IN ('nije_poslan', 'dodijeljen', 'u_tijeku', 'predan', 'odobren')),
  ADD COLUMN IF NOT EXISTS mobile_tasks_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mobile_km_na boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mobile_napomena_na boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mobile_foto_na boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mobile_materijal_na boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mobile_alat_na boolean NOT NULL DEFAULT false;

ALTER TABLE public.radni_nalozi_radnici
  ADD COLUMN IF NOT EXISTS mobile_reviewed_sections text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mobile_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS mobile_finished_at timestamptz;

UPDATE public.radni_nalozi
SET mobile_status = CASE WHEN status = 'zavrsen' THEN 'odobren' ELSE 'dodijeljen' END
WHERE zakljucen_at IS NOT NULL AND mobile_status = 'nije_poslan';

CREATE TABLE IF NOT EXISTS public.app_push_tokens (
  user_id uuid NOT NULL REFERENCES public.app_profiles(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token)
);

ALTER TABLE public.app_push_tokens ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_push_tokens TO authenticated;
REVOKE ALL ON public.app_push_tokens FROM anon;

CREATE POLICY app_push_tokens_select ON public.app_push_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.app_is_admin());
CREATE POLICY app_push_tokens_insert ON public.app_push_tokens
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.app_is_approved());
CREATE POLICY app_push_tokens_update ON public.app_push_tokens
  FOR UPDATE TO authenticated USING (user_id = auth.uid() AND public.app_is_approved())
  WITH CHECK (user_id = auth.uid() AND public.app_is_approved());
CREATE POLICY app_push_tokens_delete ON public.app_push_tokens
  FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.app_is_admin());

CREATE OR REPLACE FUNCTION public.app_mobile_radnik_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT radnik_id
  FROM public.app_profiles
  WHERE id = auth.uid() AND approved AND NOT is_admin AND radnik_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.app_mobile_assigned_nalog(p_nalog_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.app_mobile_radnik_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.radni_nalozi_radnici assignment
      JOIN public.radni_nalozi nalog ON nalog.id = assignment.nalog_id
      WHERE assignment.nalog_id = p_nalog_id
        AND assignment.radnik_id = public.app_mobile_radnik_id()
        AND nalog.zakljucen_at IS NOT NULL
        AND nalog.status <> 'otkazan'
    );
$$;

CREATE OR REPLACE FUNCTION public.app_mobile_leads_nalog(p_nalog_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.app_mobile_assigned_nalog(p_nalog_id)
    AND EXISTS (
      SELECT 1 FROM public.radni_nalozi nalog
      WHERE nalog.id = p_nalog_id
        AND nalog.poslovodja_id = public.app_mobile_radnik_id()
    );
$$;

CREATE POLICY mobile_worker_orders_select ON public.radni_nalozi
  FOR SELECT TO authenticated USING (public.app_mobile_assigned_nalog(id));
CREATE POLICY mobile_worker_orders_scope ON public.radni_nalozi
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.app_is_admin()
    OR public.app_mobile_radnik_id() IS NULL
    OR public.app_mobile_assigned_nalog(id)
  );
CREATE POLICY mobile_worker_orders_update_scope ON public.radni_nalozi
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.app_is_admin() OR public.app_mobile_radnik_id() IS NULL)
  WITH CHECK (public.app_is_admin() OR public.app_mobile_radnik_id() IS NULL);

CREATE POLICY mobile_worker_assignment_select ON public.radni_nalozi_radnici
  FOR SELECT TO authenticated USING (public.app_mobile_assigned_nalog(nalog_id));
CREATE POLICY mobile_worker_assignment_scope ON public.radni_nalozi_radnici
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.app_is_admin()
    OR public.app_mobile_radnik_id() IS NULL
    OR public.app_mobile_assigned_nalog(nalog_id)
  );
CREATE POLICY mobile_worker_assignment_update_scope ON public.radni_nalozi_radnici
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.app_is_admin() OR public.app_mobile_radnik_id() IS NULL)
  WITH CHECK (public.app_is_admin() OR public.app_mobile_radnik_id() IS NULL);

CREATE POLICY mobile_worker_stavke_select ON public.radni_nalozi_stavke
  FOR SELECT TO authenticated USING (public.app_mobile_assigned_nalog(nalog_id));
CREATE POLICY mobile_worker_stavke_insert ON public.radni_nalozi_stavke
  FOR INSERT TO authenticated WITH CHECK (public.app_mobile_leads_nalog(nalog_id));
CREATE POLICY mobile_worker_stavke_update ON public.radni_nalozi_stavke
  FOR UPDATE TO authenticated
  USING (public.app_mobile_leads_nalog(nalog_id))
  WITH CHECK (public.app_mobile_leads_nalog(nalog_id));
CREATE POLICY mobile_worker_stavke_delete ON public.radni_nalozi_stavke
  FOR DELETE TO authenticated USING (public.app_mobile_leads_nalog(nalog_id));
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
    OR public.app_mobile_leads_nalog(nalog_id)
  );

CREATE POLICY mobile_worker_tasks_select ON public.gradiliste_zadaci
  FOR SELECT TO authenticated USING (nalog_id IS NOT NULL AND public.app_mobile_assigned_nalog(nalog_id));
CREATE POLICY mobile_worker_tasks_update ON public.gradiliste_zadaci
  FOR UPDATE TO authenticated
  USING (nalog_id IS NOT NULL AND public.app_mobile_leads_nalog(nalog_id))
  WITH CHECK (nalog_id IS NOT NULL AND public.app_mobile_leads_nalog(nalog_id));
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
    OR (nalog_id IS NOT NULL AND public.app_mobile_leads_nalog(nalog_id))
  );

CREATE POLICY mobile_worker_foto_select ON public.radni_nalozi_foto
  FOR SELECT TO authenticated USING (public.app_mobile_assigned_nalog(nalog_id));
CREATE POLICY mobile_worker_foto_insert ON public.radni_nalozi_foto
  FOR INSERT TO authenticated WITH CHECK (public.app_mobile_leads_nalog(nalog_id));
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
    OR public.app_mobile_leads_nalog(nalog_id)
  );

CREATE POLICY mobile_worker_documents_select ON public.radni_nalozi_dokumenti
  FOR SELECT TO authenticated USING (public.app_mobile_assigned_nalog(nalog_id));
CREATE POLICY mobile_worker_documents_scope ON public.radni_nalozi_dokumenti
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.app_is_admin()
    OR public.app_mobile_radnik_id() IS NULL
    OR public.app_mobile_assigned_nalog(nalog_id)
  );

CREATE POLICY mobile_worker_linked_docs_select ON public.nalog_gradiliste_dokumenti
  FOR SELECT TO authenticated USING (public.app_mobile_assigned_nalog(nalog_id));
CREATE POLICY mobile_worker_linked_docs_scope ON public.nalog_gradiliste_dokumenti
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.app_is_admin()
    OR public.app_mobile_radnik_id() IS NULL
    OR public.app_mobile_assigned_nalog(nalog_id)
  );

CREATE POLICY mobile_worker_site_documents_select ON public.gradiliste_dokumenti
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.nalog_gradiliste_dokumenti link
      WHERE link.dokument_id = id
        AND public.app_mobile_assigned_nalog(link.nalog_id)
    )
  );
CREATE POLICY mobile_worker_site_documents_scope ON public.gradiliste_dokumenti
  AS RESTRICTIVE FOR SELECT TO authenticated USING (
    public.app_is_admin()
    OR public.app_mobile_radnik_id() IS NULL
    OR EXISTS (
      SELECT 1 FROM public.nalog_gradiliste_dokumenti link
      WHERE link.dokument_id = id
        AND public.app_mobile_assigned_nalog(link.nalog_id)
    )
  );

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
        THEN public.app_mobile_leads_nalog(split_part(name, '/', 1)::uuid)
      ELSE false
    END
  );
CREATE POLICY mobile_worker_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'nalozi-foto'
    AND (
      CASE
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
  );
CREATE POLICY mobile_worker_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'nalozi-foto'
    AND CASE
    WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.app_mobile_leads_nalog(split_part(name, '/', 1)::uuid)
    ELSE false
    END
  );

CREATE OR REPLACE FUNCTION public.get_mobile_radni_nalozi()
RETURNS TABLE (
  id uuid,
  broj text,
  gradiliste_naziv text,
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
  IF worker_id IS NULL OR NOT public.app_mobile_assigned_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dodijeljen prijavljenom djelatniku.';
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

CREATE OR REPLACE FUNCTION public.mobile_finish_shift(p_nalog_id uuid)
RETURNS time
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
    SELECT 1 FROM public.radni_nalozi
    WHERE id = p_nalog_id AND mobile_status = 'u_tijeku'
  ) THEN
    RAISE EXCEPTION 'Nalog više nije u tijeku.';
  END IF;

  UPDATE public.radni_nalozi_radnici
  SET mobile_finished_at = now(),
      vrijeme_do = finish_time
  WHERE nalog_id = p_nalog_id
    AND radnik_id = worker_id
    AND mobile_started_at IS NOT NULL
    AND mobile_finished_at IS NULL;
  IF NOT FOUND THEN
    SELECT vrijeme_do INTO finish_time
    FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id
      AND radnik_id = worker_id
      AND mobile_finished_at IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Nalog nije započet ili je već nedostupan.';
    END IF;
  END IF;
  RETURN finish_time;
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
  worker_id uuid := public.app_mobile_radnik_id();
BEGIN
  IF worker_id IS NULL OR NOT public.app_mobile_leads_nalog(p_nalog_id) THEN
  RAISE EXCEPTION 'Samo dodijeljeni poslovođa može spremati završni izvještaj.';
  END IF;
  UPDATE public.radni_nalozi
  SET km_pocetak = CASE WHEN p_km_na THEN NULL ELSE p_km_pocetak END,
    km_kraj = CASE WHEN p_km_na THEN NULL ELSE p_km_kraj END,
    napomena = CASE WHEN p_napomena_na THEN NULL ELSE NULLIF(btrim(COALESCE(p_napomena, '')), '') END,
    mobile_tasks_confirmed = p_tasks_confirmed,
    mobile_km_na = p_km_na,
    mobile_napomena_na = p_napomena_na,
    mobile_foto_na = p_foto_na,
    mobile_materijal_na = p_materijal_na,
    mobile_alat_na = p_alat_na,
    mobile_status = 'u_tijeku'
  WHERE id = p_nalog_id AND mobile_status = 'u_tijeku';
  IF NOT FOUND THEN
  RAISE EXCEPTION 'Nalog nije u tijeku.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mobile_submit_nalog(p_nalog_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_mobile_leads_nalog(p_nalog_id) THEN
  RAISE EXCEPTION 'Samo dodijeljeni poslovođa može predati nalog.';
  END IF;
  IF EXISTS (
  SELECT 1 FROM public.radni_nalozi_radnici
  WHERE nalog_id = p_nalog_id AND (mobile_started_at IS NULL OR mobile_finished_at IS NULL)
  ) THEN
  RAISE EXCEPTION 'Svi djelatnici moraju pokrenuti i završiti svoje vrijeme prije predaje naloga.';
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

REVOKE ALL ON FUNCTION public.app_mobile_radnik_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_mobile_assigned_nalog(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_mobile_leads_nalog(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_mobile_radni_nalozi() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mobile_start_nalog(uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mobile_finish_shift(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mobile_save_nalog_report(uuid, integer, integer, boolean, text, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mobile_submit_nalog(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_mobile_radnik_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_mobile_assigned_nalog(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_mobile_leads_nalog(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mobile_radni_nalozi() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_start_nalog(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_finish_shift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_save_nalog_report(uuid, integer, integer, boolean, text, boolean, boolean, boolean, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_submit_nalog(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
