ALTER TABLE public.vozila
  ADD COLUMN gorivo_pin text
  CHECK (gorivo_pin IS NULL OR gorivo_pin ~ '^[0-9]+$');

DROP FUNCTION public.get_mobile_vozila_gorivo_vehicles(uuid);
CREATE FUNCTION public.get_mobile_vozila_gorivo_vehicles(p_radnik_id uuid)
RETURNS TABLE (
  id uuid, marka text, model text, registracija text, tip text,
  kilometraza integer, gorivo_pin text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  worker_category text;
  allowed_vehicle_types text[];
BEGIN
  IF public.app_mobile_radnik_id() IS NULL THEN
    RAISE EXCEPTION 'Mobilni unos goriva dostupan je samo povezanom djelatniku.'
      USING ERRCODE = '42501';
  END IF;

  SELECT worker.uloga, category.dozvoljeni_tipovi_vozila
  INTO worker_category, allowed_vehicle_types
  FROM public.radnici worker
  LEFT JOIN public.radnik_kategorije category
    ON category.company_id = worker.company_id
    AND lower(trim(category.naziv)) = lower(trim(worker.uloga))
  WHERE worker.id = p_radnik_id
    AND worker.company_id = public.app_current_company_id()
    AND worker.status = 'aktivan';

  IF worker_category IS NULL THEN
    RAISE EXCEPTION 'Odaberite aktivnog djelatnika iz svoje tvrtke.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT vehicle.id, vehicle.marka, vehicle.model, vehicle.registracija, vehicle.tip,
    vehicle.kilometraza::integer, vehicle.gorivo_pin
  FROM public.vozila vehicle
  WHERE vehicle.company_id = public.app_current_company_id()
    AND (
      allowed_vehicle_types IS NULL
      OR EXISTS (
        SELECT 1
        FROM unnest(allowed_vehicle_types) AS allowed_type(naziv)
        WHERE lower(trim(allowed_type.naziv)) = lower(trim(vehicle.tip))
      )
    )
  ORDER BY vehicle.marka, vehicle.model, vehicle.registracija;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mobile_vozila_gorivo_vehicles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_vozila_gorivo_vehicles(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
