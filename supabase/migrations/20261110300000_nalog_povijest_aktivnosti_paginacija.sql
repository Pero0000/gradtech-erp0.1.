DROP FUNCTION IF EXISTS public.get_mobile_work_order_audit(uuid);

CREATE OR REPLACE FUNCTION public.get_mobile_work_order_audit(
  p_nalog_id uuid,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id bigint DEFAULT NULL
)
RETURNS TABLE (
  id text,
  actor_name text,
  action text,
  details jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_company uuid := public.app_current_company_id();
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'view') THEN
    RAISE EXCEPTION 'Nemate pravo pregleda povijesti radnog naloga.' USING ERRCODE = '42501';
  END IF;
  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'Nepotpun pokazivač stranice povijesti naloga.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi order_row
    WHERE order_row.id = p_nalog_id AND order_row.company_id = current_company
  ) THEN
    RAISE EXCEPTION 'Radni nalog nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT audit.id::text, audit.actor_name, audit.action, audit.details, audit.created_at
  FROM public.mobile_work_order_audit audit
  JOIN public.radni_nalozi order_row ON order_row.id = audit.nalog_id
  WHERE audit.nalog_id = p_nalog_id
    AND order_row.company_id = current_company
    AND (
      p_before_created_at IS NULL
      OR (audit.created_at, audit.id) < (p_before_created_at, p_before_id)
    )
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mobile_work_order_audit(uuid, timestamptz, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_work_order_audit(uuid, timestamptz, bigint) TO authenticated;
NOTIFY pgrst, 'reload schema';
