-- Worker Portal: korisnici koji nisu administratori, voditelji ni vlasnici platforme
-- vide samo svoje radne naloge, zadatke, radno vrijeme i dokumente.

ALTER TABLE public.app_profiles
  ADD COLUMN IF NOT EXISTS is_voditelj boolean NOT NULL DEFAULT false;

-- Postojeći uredski računi (nisu povezani s radnikom, a imaju neko pravo) postaju voditelji.
UPDATE public.app_profiles profile
SET is_voditelj = true
WHERE profile.radnik_id IS NULL
  AND NOT profile.is_admin
  AND NOT profile.is_voditelj
  AND EXISTS (
    SELECT 1 FROM public.app_user_permissions permission
    WHERE permission.user_id = profile.id AND (permission.can_view OR permission.can_edit)
  );

GRANT UPDATE (is_voditelj) ON public.app_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.app_is_worker_portal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_profiles profile
    WHERE profile.id = auth.uid()
      AND profile.company_id = public.app_current_company_id()
      AND NOT profile.is_admin
      AND NOT profile.is_voditelj
      AND NOT profile.is_platform_owner
  );
$$;
REVOKE ALL ON FUNCTION public.app_is_worker_portal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_is_worker_portal() TO authenticated;

-- Radnik u portalu nema pristup ERP modulima. Dodijeljeni nalozi dostupni su mu kroz
-- postojeće mobile_worker_* politike i RPC-ove; jedino smije čitati alat i strojeve
-- kako bi ih mogao odabrati na nalogu.
CREATE OR REPLACE FUNCTION public.app_has_module_permission(p_module text, p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.app_is_admin()
    OR (
      public.app_is_approved()
      AND (
        NOT public.app_is_worker_portal()
        OR (p_action = 'view' AND p_module IN ('alat', 'strojevi'))
      )
      AND EXISTS (
        SELECT 1
        FROM public.app_user_permissions permission
        WHERE permission.user_id = auth.uid()
          AND permission.module = p_module
          AND (
            (p_action = 'view' AND (permission.can_view OR permission.can_edit))
            OR (p_action = 'edit' AND permission.can_edit)
          )
      )
    );
$$;

-- Moje radno vrijeme: vrijeme s dodijeljenih naloga i ručni unosi radnog vremena.
CREATE OR REPLACE FUNCTION public.get_my_radno_vrijeme(p_od date, p_do date)
RETURNS TABLE (
  izvor text,
  nalog_id uuid,
  nalog_broj text,
  gradiliste_naziv text,
  datum date,
  vrijeme_od time,
  vrijeme_do time,
  sati numeric,
  napomena text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT public.app_mobile_radnik_id() AS radnik_id)
  SELECT * FROM (
    SELECT
      'nalog'::text,
      nalog.id,
      nalog.broj,
      site.naziv,
      COALESCE(timezone('Europe/Zagreb', assignment.mobile_started_at)::date, nalog.rok, nalog.datum_kreiranja),
      assignment.vrijeme_od,
      assignment.vrijeme_do,
      CASE
        WHEN assignment.vrijeme_od IS NOT NULL AND assignment.vrijeme_do IS NOT NULL
          THEN round((extract(epoch FROM (assignment.vrijeme_do - assignment.vrijeme_od)) / 3600.0)::numeric, 1)
        ELSE NULL
      END,
      NULL::text
    FROM me
    JOIN public.radni_nalozi_radnici assignment ON assignment.radnik_id = me.radnik_id
    JOIN public.radni_nalozi nalog ON nalog.id = assignment.nalog_id
    LEFT JOIN public.gradilista site ON site.id = nalog.gradiliste_id
    WHERE assignment.vrijeme_od IS NOT NULL OR assignment.mobile_started_at IS NOT NULL
    UNION ALL
    SELECT
      'evidencija'::text,
      entry.nalog_id,
      nalog.broj,
      site.naziv,
      entry.datum,
      NULL::time,
      NULL::time,
      entry.sati,
      entry.napomena
    FROM me
    JOIN public.radno_vrijeme entry ON entry.radnik_id = me.radnik_id
    LEFT JOIN public.radni_nalozi nalog ON nalog.id = entry.nalog_id
    LEFT JOIN public.gradilista site ON site.id = entry.gradiliste_id
    -- Vrijeme s naloga već je prikazano iz dodjele naloga.
    WHERE entry.nalog_id IS NULL
  ) entries (izvor, nalog_id, nalog_broj, gradiliste_naziv, datum, vrijeme_od, vrijeme_do, sati, napomena)
  WHERE (p_od IS NULL OR entries.datum >= p_od)
    AND (p_do IS NULL OR entries.datum <= p_do)
  ORDER BY entries.datum DESC, entries.nalog_broj;
$$;
REVOKE ALL ON FUNCTION public.get_my_radno_vrijeme(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_radno_vrijeme(date, date) TO authenticated;

-- Moji dokumenti: radnik čita samo vlastite osobne dokumente.
DROP POLICY IF EXISTS worker_portal_own_documents_select ON public.radnici_dokumenti;
CREATE POLICY worker_portal_own_documents_select ON public.radnici_dokumenti
  FOR SELECT TO authenticated
  USING (radnik_id = public.app_mobile_radnik_id());

DROP POLICY IF EXISTS mobile_worker_storage_scope ON storage.objects;
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
    OR (
      split_part(name, '/', 1) = 'radnici'
      AND split_part(name, '/', 2) = public.app_mobile_radnik_id()::text
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

DROP POLICY IF EXISTS worker_portal_own_files_select ON storage.objects;
CREATE POLICY worker_portal_own_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'nalozi-foto'
    AND split_part(name, '/', 1) = 'radnici'
    AND split_part(name, '/', 2) = public.app_mobile_radnik_id()::text
  );

NOTIFY pgrst, 'reload schema';
