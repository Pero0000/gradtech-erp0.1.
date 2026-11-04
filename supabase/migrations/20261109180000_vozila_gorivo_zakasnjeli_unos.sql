CREATE OR REPLACE FUNCTION private.validate_vozila_gorivo_kilometraza()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  vehicle_company uuid;
BEGIN
  SELECT vehicle.company_id
  INTO vehicle_company
  FROM public.vozila vehicle
  WHERE vehicle.id = NEW.vozilo_id
  FOR UPDATE;

  IF vehicle_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Vozilo mora pripadati istoj tvrtki kao zapis goriva.'
      USING ERRCODE = '23514';
  END IF;

  -- Late fuel entries retain their historical reading; the sync trigger only raises the vehicle odometer.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_vozila_gorivo_kilometraza() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
