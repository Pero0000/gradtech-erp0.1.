ALTER TABLE public.radnik_kategorije
  ADD COLUMN dozvoljeni_tipovi_vozila text[];

UPDATE public.radnik_kategorije category
SET dozvoljeni_tipovi_vozila = ARRAY(
  SELECT vehicle_type.naziv
  FROM public.vozila_tipovi vehicle_type
  WHERE vehicle_type.company_id = category.company_id
    AND lower(trim(vehicle_type.naziv)) = 'teretno'
  LIMIT 1
)
WHERE lower(trim(category.naziv)) = 'radnik';

GRANT SELECT, INSERT, UPDATE ON TABLE public.radnik_kategorije TO authenticated;

CREATE POLICY radnik_kategorije_update ON public.radnik_kategorije
  FOR UPDATE TO authenticated
  USING (public.app_has_module_permission('radnici', 'edit'))
  WITH CHECK (public.app_has_module_permission('radnici', 'edit'));

CREATE OR REPLACE FUNCTION private.validate_radnik_kategorija_vehicle_types()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.dozvoljeni_tipovi_vozila IS NULL THEN
    RETURN NEW;
  END IF;

  IF cardinality(NEW.dozvoljeni_tipovi_vozila) = 0 THEN
    RAISE EXCEPTION 'Odaberite barem jedan dopušteni tip vozila ili isključite ograničenje.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.dozvoljeni_tipovi_vozila) AS selected_type(naziv)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.vozila_tipovi vehicle_type
      WHERE vehicle_type.company_id = NEW.company_id
        AND lower(trim(vehicle_type.naziv)) = lower(trim(selected_type.naziv))
    )
  ) THEN
    RAISE EXCEPTION 'Dopušteni tip vozila mora biti odabran iz tipova vaše tvrtke.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_radnik_kategorija_vehicle_types
  BEFORE INSERT OR UPDATE OF company_id, dozvoljeni_tipovi_vozila
  ON public.radnik_kategorije
  FOR EACH ROW EXECUTE FUNCTION private.validate_radnik_kategorija_vehicle_types();

CREATE OR REPLACE FUNCTION private.validate_vozila_gorivo_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  vehicle_company uuid;
  vehicle_type text;
  worker_company uuid;
  worker_name text;
  worker_category text;
  allowed_vehicle_types text[];
  recovery_snapshot jsonb;
BEGIN
  SELECT company_id, tip INTO vehicle_company, vehicle_type
  FROM public.vozila
  WHERE id = NEW.vozilo_id;

  IF vehicle_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Vozilo mora pripadati istoj tvrtki kao zapis goriva.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.tocio_radnik_id IS NOT NULL THEN
    SELECT company_id, concat_ws(' ', ime, prezime), uloga
    INTO worker_company, worker_name, worker_category
    FROM public.radnici
    WHERE id = NEW.tocio_radnik_id;

    IF worker_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Djelatnik mora pripadati istoj tvrtki kao zapis goriva.'
        USING ERRCODE = '23514';
    END IF;

    SELECT category.dozvoljeni_tipovi_vozila
    INTO allowed_vehicle_types
    FROM public.radnik_kategorije category
    WHERE category.company_id = worker_company
      AND lower(trim(category.naziv)) = lower(trim(worker_category));

    recovery_snapshot := private.resource_restore_snapshot('vozila_gorivo', NEW.id);
    IF allowed_vehicle_types IS NOT NULL
      AND recovery_snapshot IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(allowed_vehicle_types) AS allowed_type(naziv)
        WHERE lower(trim(allowed_type.naziv)) = lower(trim(vehicle_type))
      ) THEN
      RAISE EXCEPTION 'Kategorija djelatnika nema dopuštenje za odabrani tip vozila.'
        USING ERRCODE = '23514';
    END IF;

    IF recovery_snapshot IS NOT NULL AND recovery_snapshot->>'tocio_radnik_id' = NEW.tocio_radnik_id::text THEN
      NEW.tocio_ime := recovery_snapshot->>'tocio_ime';
    ELSE
      NEW.tocio_ime := worker_name;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP FUNCTION public.get_vozila_gorivo_workers();
CREATE FUNCTION public.get_vozila_gorivo_workers()
RETURNS TABLE (
  id uuid,
  ime text,
  prezime text,
  uloga text,
  dozvoljeni_tipovi_vozila text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (
    public.app_has_module_permission('vozila', 'view')
    OR public.app_mobile_radnik_id() IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Nemate pristup popisu djelatnika za unos goriva.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT worker.id, worker.ime, worker.prezime, worker.uloga, category.dozvoljeni_tipovi_vozila
  FROM public.radnici worker
  LEFT JOIN public.radnik_kategorije category
    ON category.company_id = worker.company_id
    AND lower(trim(category.naziv)) = lower(trim(worker.uloga))
  WHERE worker.company_id = public.app_current_company_id()
    AND worker.status = 'aktivan'
  ORDER BY worker.prezime, worker.ime;
END;
$$;

CREATE FUNCTION public.get_radnik_gorivo_vehicle_types()
RETURNS TABLE (naziv text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_has_module_permission('radnici', 'view') THEN
    RAISE EXCEPTION 'Nemate pristup postavkama kategorija djelatnika.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT vehicle_type.naziv
  FROM public.vozila_tipovi vehicle_type
  WHERE vehicle_type.company_id = public.app_current_company_id()
  ORDER BY vehicle_type.naziv;
END;
$$;

DROP FUNCTION public.get_mobile_vozila_gorivo_vehicles();
CREATE FUNCTION public.get_mobile_vozila_gorivo_vehicles(p_radnik_id uuid)
RETURNS TABLE (id uuid, marka text, model text, registracija text, tip text, kilometraza integer)
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
    vehicle.kilometraza::integer
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

REVOKE ALL ON FUNCTION private.validate_radnik_kategorija_vehicle_types() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_vozila_gorivo_workers() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_radnik_gorivo_vehicle_types() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_mobile_vozila_gorivo_vehicles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_vozila_gorivo_workers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_radnik_gorivo_vehicle_types() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mobile_vozila_gorivo_vehicles(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
