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
        (
          public.app_is_worker_portal()
          AND p_action = 'view'
          AND p_module IN ('alat', 'strojevi')
        )
        OR (
          NOT public.app_is_worker_portal()
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
        )
      )
    );
$$;

NOTIFY pgrst, 'reload schema';
