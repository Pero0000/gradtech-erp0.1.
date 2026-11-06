CREATE OR REPLACE FUNCTION public.get_mobile_vozila_gorivo_vehicles()
RETURNS TABLE (id uuid, marka text, model text, registracija text, tip text, kilometraza integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.app_mobile_radnik_id() IS NULL THEN
    RAISE EXCEPTION 'Mobilni unos goriva dostupan je samo povezanom djelatniku.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT vehicle.id, vehicle.marka, vehicle.model, vehicle.registracija, vehicle.tip,
    vehicle.kilometraza::integer
  FROM public.vozila vehicle
  WHERE vehicle.company_id = public.app_current_company_id()
  ORDER BY vehicle.marka, vehicle.model, vehicle.registracija;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mobile_vozila_gorivo_vehicles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_vozila_gorivo_vehicles() TO authenticated;

NOTIFY pgrst, 'reload schema';
