CREATE TABLE public.radnik_kategorije (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.app_current_company_id()
    REFERENCES public.tvrtke(id) ON DELETE CASCADE,
  naziv text NOT NULL CHECK (length(trim(naziv)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX radnik_kategorije_company_name
  ON public.radnik_kategorije (company_id, lower(trim(naziv)));

UPDATE public.radnik_kategorije
SET naziv = 'Radnik'
WHERE lower(trim(naziv)) = 'radnik';

INSERT INTO public.radnik_kategorije (company_id, naziv)
SELECT company.id, 'Radnik'
FROM public.tvrtke company
WHERE NOT EXISTS (
  SELECT 1 FROM public.radnik_kategorije category
  WHERE category.company_id = company.id AND lower(trim(category.naziv)) = 'radnik'
);

UPDATE public.radnici
SET uloga = 'Radnik'
WHERE lower(trim(uloga)) = 'radnik';

WITH existing_worker_categories AS (
  SELECT worker.company_id, min(trim(worker.uloga)) AS naziv
  FROM public.radnici worker
  WHERE worker.company_id IS NOT NULL AND length(trim(worker.uloga)) > 0
  GROUP BY worker.company_id, lower(trim(worker.uloga))
)
INSERT INTO public.radnik_kategorije (company_id, naziv)
SELECT candidate.company_id, candidate.naziv
FROM existing_worker_categories candidate
WHERE NOT EXISTS (
  SELECT 1 FROM public.radnik_kategorije category
  WHERE category.company_id = candidate.company_id
    AND lower(trim(category.naziv)) = lower(trim(candidate.naziv))
);

REVOKE ALL ON TABLE public.radnik_kategorije FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.radnik_kategorije TO authenticated;

ALTER TABLE public.radnik_kategorije ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON public.radnik_kategorije AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (company_id = public.app_current_company_id())
  WITH CHECK (company_id = public.app_current_company_id());

CREATE POLICY radnik_kategorije_select ON public.radnik_kategorije
  FOR SELECT TO authenticated
  USING (public.app_has_module_permission('radnici', 'view'));

CREATE POLICY radnik_kategorije_insert ON public.radnik_kategorije
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_module_permission('radnici', 'edit'));

CREATE OR REPLACE FUNCTION private.validate_radnik_kategorija()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.radnik_kategorije category
    WHERE category.company_id = NEW.company_id
      AND lower(trim(category.naziv)) = lower(trim(NEW.uloga))
  ) THEN
    RAISE EXCEPTION 'Odaberite kategoriju djelatnika s popisa.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_radnik_kategorija
  BEFORE INSERT OR UPDATE OF uloga, company_id ON public.radnici
  FOR EACH ROW EXECUTE FUNCTION private.validate_radnik_kategorija();

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
    IF lower(trim(worker_category)) = 'radnik' AND lower(trim(vehicle_type)) <> 'teretno' THEN
      RAISE EXCEPTION 'Djelatnik kategorije radnik može evidentirati gorivo samo za teretna vozila.'
        USING ERRCODE = '23514';
    END IF;
    NEW.tocio_ime := worker_name;
  END IF;

  RETURN NEW;
END;
$$;

DROP FUNCTION public.get_vozila_gorivo_workers();
CREATE FUNCTION public.get_vozila_gorivo_workers()
RETURNS TABLE (id uuid, ime text, prezime text, uloga text)
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
  SELECT worker.id, worker.ime, worker.prezime, worker.uloga
  FROM public.radnici worker
  WHERE worker.company_id = public.app_current_company_id()
    AND worker.status = 'aktivan'
  ORDER BY worker.prezime, worker.ime;
END;
$$;

REVOKE ALL ON FUNCTION public.get_vozila_gorivo_workers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_vozila_gorivo_workers() TO authenticated;

DROP FUNCTION public.get_mobile_vozila_gorivo_vehicles();
CREATE FUNCTION public.get_mobile_vozila_gorivo_vehicles()
RETURNS TABLE (id uuid, marka text, model text, registracija text, tip text)
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
  SELECT vehicle.id, vehicle.marka, vehicle.model, vehicle.registracija, vehicle.tip
  FROM public.vozila vehicle
  WHERE vehicle.company_id = public.app_current_company_id()
  ORDER BY vehicle.marka, vehicle.model, vehicle.registracija;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mobile_vozila_gorivo_vehicles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_vozila_gorivo_vehicles() TO authenticated;

NOTIFY pgrst, 'reload schema';
