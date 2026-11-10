-- Linked site images must authorize their preview files as well as the originals.
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
        WHERE (document.putanja = name OR document.thumbnail_path = name)
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

DROP POLICY IF EXISTS mobile_worker_storage_select ON storage.objects;
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
          WHERE (document.putanja = name OR document.thumbnail_path = name)
            AND public.app_mobile_assigned_nalog(link.nalog_id)
        )
      )
    )
  );
