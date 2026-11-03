CREATE TABLE public.vozila_gorivo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.app_current_company_id() REFERENCES public.tvrtke(id),
  vozilo_id uuid NOT NULL REFERENCES public.vozila(id) ON DELETE CASCADE,
  datum date NOT NULL DEFAULT CURRENT_DATE,
  litara numeric(10, 2) NOT NULL CHECK (litara > 0),
  kilometraza integer NOT NULL CHECK (kilometraza >= 0),
  tocio_radnik_id uuid REFERENCES public.radnici(id) ON DELETE SET NULL,
  tocio_ime text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.vozila_gorivo FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vozila_gorivo TO authenticated;

CREATE INDEX vozila_gorivo_company_vehicle_km
  ON public.vozila_gorivo (company_id, vozilo_id, kilometraza);

ALTER TABLE public.vozila_gorivo ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON public.vozila_gorivo AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (company_id = public.app_current_company_id())
  WITH CHECK (company_id = public.app_current_company_id());

CREATE POLICY vozila_gorivo_select ON public.vozila_gorivo
  FOR SELECT TO authenticated
  USING (
    public.app_has_module_permission('vozila', 'view')
    OR created_by = auth.uid()
  );

CREATE POLICY vozila_gorivo_insert ON public.vozila_gorivo
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_module_permission('vozila', 'edit'));

CREATE POLICY vozila_gorivo_update ON public.vozila_gorivo
  FOR UPDATE TO authenticated
  USING (public.app_has_module_permission('vozila', 'edit'))
  WITH CHECK (public.app_has_module_permission('vozila', 'edit'));

CREATE POLICY vozila_gorivo_delete ON public.vozila_gorivo
  FOR DELETE TO authenticated
  USING (public.app_has_module_permission('vozila', 'edit'));

CREATE OR REPLACE FUNCTION private.validate_vozila_gorivo_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  vehicle_company uuid;
  worker_company uuid;
  worker_name text;
BEGIN
  SELECT company_id INTO vehicle_company
  FROM public.vozila
  WHERE id = NEW.vozilo_id;

  IF vehicle_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Vozilo mora pripadati istoj tvrtki kao zapis goriva.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.tocio_radnik_id IS NOT NULL THEN
    SELECT company_id, concat_ws(' ', ime, prezime)
    INTO worker_company, worker_name
    FROM public.radnici
    WHERE id = NEW.tocio_radnik_id;

    IF worker_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Djelatnik mora pripadati istoj tvrtki kao zapis goriva.'
        USING ERRCODE = '23514';
    END IF;
    NEW.tocio_ime := worker_name;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_vozila_gorivo_workers()
RETURNS TABLE (id uuid, ime text, prezime text)
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
  SELECT worker.id, worker.ime, worker.prezime
  FROM public.radnici worker
  WHERE worker.company_id = public.app_current_company_id()
    AND worker.status = 'aktivan'
  ORDER BY worker.prezime, worker.ime;
END;
$$;

CREATE TRIGGER validate_vozila_gorivo_company
  BEFORE INSERT OR UPDATE OF company_id, vozilo_id, tocio_radnik_id
  ON public.vozila_gorivo
  FOR EACH ROW EXECUTE FUNCTION private.validate_vozila_gorivo_company();

CREATE OR REPLACE FUNCTION public.get_mobile_vozila_gorivo_vehicles()
RETURNS TABLE (id uuid, marka text, model text, registracija text)
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
  SELECT vehicle.id, vehicle.marka, vehicle.model, vehicle.registracija
  FROM public.vozila vehicle
  WHERE vehicle.company_id = public.app_current_company_id()
  ORDER BY vehicle.marka, vehicle.model, vehicle.registracija;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_mobile_vozila_gorivo(
  p_vozilo_id uuid,
  p_datum date,
  p_litara numeric,
  p_kilometraza integer,
  p_tocio_radnik_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  worker_name text;
  entry_id uuid;
BEGIN
  IF public.app_mobile_radnik_id() IS NULL THEN
    RAISE EXCEPTION 'Mobilni unos goriva dostupan je samo povezanom djelatniku.'
      USING ERRCODE = '42501';
  END IF;
  IF p_litara IS NULL OR p_litara <= 0 OR p_kilometraza IS NULL OR p_kilometraza < 0 OR p_datum IS NULL THEN
    RAISE EXCEPTION 'Unesite datum, količinu goriva veću od nule i valjanu kilometražu.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vozila
    WHERE id = p_vozilo_id AND company_id = public.app_current_company_id()
  ) THEN
    RAISE EXCEPTION 'Odabrano vozilo nije dostupno u vašoj tvrtki.'
      USING ERRCODE = '42501';
  END IF;

  SELECT concat_ws(' ', worker.ime, worker.prezime)
  INTO worker_name
  FROM public.radnici worker
  WHERE worker.id = p_tocio_radnik_id
    AND worker.company_id = public.app_current_company_id()
    AND worker.status = 'aktivan';

  IF worker_name IS NULL THEN
    RAISE EXCEPTION 'Odaberite aktivnog djelatnika koji je točio.';
  END IF;

  INSERT INTO public.vozila_gorivo (
    company_id, vozilo_id, datum, litara, kilometraza,
    tocio_radnik_id, tocio_ime, created_by
  )
  VALUES (
    public.app_current_company_id(), p_vozilo_id, p_datum, p_litara, p_kilometraza,
    p_tocio_radnik_id, worker_name, auth.uid()
  )
  RETURNING id INTO entry_id;

  RETURN entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mobile_vozila_gorivo_vehicles() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_vozila_gorivo_workers() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_mobile_vozila_gorivo(uuid, date, numeric, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_vozila_gorivo_vehicles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vozila_gorivo_workers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_mobile_vozila_gorivo(uuid, date, numeric, integer, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
