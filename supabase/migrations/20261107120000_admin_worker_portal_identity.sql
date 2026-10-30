CREATE OR REPLACE FUNCTION public.app_mobile_radnik_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT profile.radnik_id
  FROM public.app_profiles profile
  JOIN public.radnici worker
    ON worker.id = profile.radnik_id
   AND worker.company_id = profile.company_id
  WHERE profile.id = auth.uid()
    AND profile.approved
    AND profile.company_id = public.app_current_company_id();
$$;

NOTIFY pgrst, 'reload schema';
