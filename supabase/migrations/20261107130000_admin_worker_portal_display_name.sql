CREATE OR REPLACE FUNCTION public.get_mobile_worker_display_name()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(btrim(concat_ws(' ', worker.ime, worker.prezime)), '')
  FROM public.app_profiles profile
  JOIN public.radnici worker
    ON worker.id = profile.radnik_id
   AND worker.company_id = profile.company_id
  WHERE profile.id = auth.uid()
    AND profile.approved
    AND profile.company_id = public.app_current_company_id();
$$;

NOTIFY pgrst, 'reload schema';
