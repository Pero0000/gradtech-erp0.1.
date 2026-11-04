UPDATE public.vozila vehicle
SET kilometraza = fuel.latest_kilometraza,
    updated_at = now()
FROM (
  SELECT company_id, vozilo_id, MAX(kilometraza) AS latest_kilometraza
  FROM public.vozila_gorivo
  GROUP BY company_id, vozilo_id
) fuel
WHERE vehicle.id = fuel.vozilo_id
  AND vehicle.company_id = fuel.company_id
  AND COALESCE(vehicle.kilometraza, 0) < fuel.latest_kilometraza;

CREATE OR REPLACE FUNCTION private.validate_vozila_gorivo_kilometraza()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  vehicle_company uuid;
  vehicle_kilometraza integer;
BEGIN
  SELECT vehicle.company_id, vehicle.kilometraza
  INTO vehicle_company, vehicle_kilometraza
  FROM public.vozila vehicle
  WHERE vehicle.id = NEW.vozilo_id
  FOR UPDATE;

  IF vehicle_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Vozilo mora pripadati istoj tvrtki kao zapis goriva.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.kilometraza < COALESCE(vehicle_kilometraza, 0) THEN
    RAISE EXCEPTION 'Unesena kilometraža (% km) manja je od trenutne kilometraže vozila (% km). Provjerite stanje kilometara.',
      NEW.kilometraza, vehicle_kilometraza
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      NEW.kilometraza IS DISTINCT FROM OLD.kilometraza
      OR NEW.vozilo_id IS DISTINCT FROM OLD.vozilo_id
    )
    AND NEW.kilometraza < COALESCE(vehicle_kilometraza, 0) THEN
    RAISE EXCEPTION 'Unesena kilometraža (% km) manja je od trenutne kilometraže vozila (% km). Provjerite stanje kilometara.',
      NEW.kilometraza, vehicle_kilometraza
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_vozila_gorivo_kilometraza
  BEFORE INSERT OR UPDATE OF vozilo_id, kilometraza
  ON public.vozila_gorivo
  FOR EACH ROW EXECUTE FUNCTION private.validate_vozila_gorivo_kilometraza();

CREATE OR REPLACE FUNCTION private.sync_vozilo_kilometraza_from_gorivo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.vozila vehicle
  SET kilometraza = NEW.kilometraza,
      updated_at = now()
  WHERE vehicle.id = NEW.vozilo_id
    AND vehicle.company_id = NEW.company_id
    AND COALESCE(vehicle.kilometraza, 0) < NEW.kilometraza;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_vozilo_kilometraza_from_gorivo
  AFTER INSERT OR UPDATE OF vozilo_id, kilometraza
  ON public.vozila_gorivo
  FOR EACH ROW EXECUTE FUNCTION private.sync_vozilo_kilometraza_from_gorivo();

DROP FUNCTION public.get_mobile_vozila_gorivo_vehicles();
CREATE FUNCTION public.get_mobile_vozila_gorivo_vehicles()
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
  SELECT vehicle.id, vehicle.marka, vehicle.model, vehicle.registracija, vehicle.tip, vehicle.kilometraza
  FROM public.vozila vehicle
  WHERE vehicle.company_id = public.app_current_company_id()
  ORDER BY vehicle.marka, vehicle.model, vehicle.registracija;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_vozila_gorivo_kilometraza() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_vozilo_kilometraza_from_gorivo() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_mobile_vozila_gorivo_vehicles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_vozila_gorivo_vehicles() TO authenticated;

NOTIFY pgrst, 'reload schema';
