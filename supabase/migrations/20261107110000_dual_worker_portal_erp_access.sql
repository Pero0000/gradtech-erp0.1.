-- ERP-bound workers retain mobile identity, but their assigned ERP permissions
-- must not be restricted to assigned work orders.
DROP POLICY IF EXISTS mobile_worker_orders_scope ON public.radni_nalozi;
CREATE POLICY mobile_worker_orders_scope ON public.radni_nalozi
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT public.app_is_worker_portal()
    OR public.app_mobile_assigned_nalog(id)
  );

DROP POLICY IF EXISTS mobile_worker_orders_update_scope ON public.radni_nalozi;
CREATE POLICY mobile_worker_orders_update_scope ON public.radni_nalozi
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.app_is_worker_portal())
  WITH CHECK (NOT public.app_is_worker_portal());

DROP POLICY IF EXISTS mobile_worker_assignment_scope ON public.radni_nalozi_radnici;
CREATE POLICY mobile_worker_assignment_scope ON public.radni_nalozi_radnici
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT public.app_is_worker_portal()
    OR public.app_mobile_assigned_nalog(nalog_id)
  );

DROP POLICY IF EXISTS mobile_worker_assignment_update_scope ON public.radni_nalozi_radnici;
CREATE POLICY mobile_worker_assignment_update_scope ON public.radni_nalozi_radnici
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.app_is_worker_portal())
  WITH CHECK (NOT public.app_is_worker_portal());

DROP POLICY IF EXISTS mobile_worker_stavke_scope ON public.radni_nalozi_stavke;
CREATE POLICY mobile_worker_stavke_scope ON public.radni_nalozi_stavke
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT public.app_is_worker_portal()
    OR public.app_mobile_assigned_nalog(nalog_id)
  )
  WITH CHECK (
    NOT public.app_is_worker_portal()
    OR public.app_mobile_editable_nalog(nalog_id)
  );

DROP POLICY IF EXISTS mobile_worker_tasks_scope ON public.gradiliste_zadaci;
CREATE POLICY mobile_worker_tasks_scope ON public.gradiliste_zadaci
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT public.app_is_worker_portal()
    OR (nalog_id IS NOT NULL AND public.app_mobile_assigned_nalog(nalog_id))
  )
  WITH CHECK (
    NOT public.app_is_worker_portal()
    OR (nalog_id IS NOT NULL AND public.app_mobile_editable_nalog(nalog_id))
  );

DROP POLICY IF EXISTS mobile_worker_foto_scope ON public.radni_nalozi_foto;
CREATE POLICY mobile_worker_foto_scope ON public.radni_nalozi_foto
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT public.app_is_worker_portal()
    OR public.app_mobile_assigned_nalog(nalog_id)
  )
  WITH CHECK (
    NOT public.app_is_worker_portal()
    OR public.app_mobile_editable_nalog(nalog_id)
  );

DROP POLICY IF EXISTS mobile_worker_documents_scope ON public.radni_nalozi_dokumenti;
CREATE POLICY mobile_worker_documents_scope ON public.radni_nalozi_dokumenti
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT public.app_is_worker_portal()
    OR public.app_mobile_assigned_nalog(nalog_id)
  );

DROP POLICY IF EXISTS mobile_worker_linked_docs_scope ON public.nalog_gradiliste_dokumenti;
CREATE POLICY mobile_worker_linked_docs_scope ON public.nalog_gradiliste_dokumenti
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT public.app_is_worker_portal()
    OR public.app_mobile_assigned_nalog(nalog_id)
  );

DROP POLICY IF EXISTS mobile_worker_site_documents_scope ON public.gradiliste_dokumenti;
CREATE POLICY mobile_worker_site_documents_scope ON public.gradiliste_dokumenti
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT public.app_is_worker_portal()
    OR EXISTS (
      SELECT 1
      FROM public.nalog_gradiliste_dokumenti link
      WHERE link.dokument_id = id
        AND public.app_mobile_assigned_nalog(link.nalog_id)
    )
  );

DROP POLICY IF EXISTS mobile_worker_storage_scope ON storage.objects;
CREATE POLICY mobile_worker_storage_scope ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    bucket_id <> 'nalozi-foto'
    OR NOT public.app_is_worker_portal()
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
    OR NOT public.app_is_worker_portal()
    OR CASE
      WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.app_mobile_editable_nalog(split_part(name, '/', 1)::uuid)
      ELSE false
    END
  );

NOTIFY pgrst, 'reload schema';
