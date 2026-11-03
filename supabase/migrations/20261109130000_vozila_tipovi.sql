CREATE TABLE public.vozila_tipovi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.app_current_company_id()
    REFERENCES public.tvrtke(id) ON DELETE CASCADE,
  naziv text NOT NULL CHECK (length(trim(naziv)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vozila_tipovi_company_name
  ON public.vozila_tipovi (company_id, lower(trim(naziv)));

INSERT INTO public.vozila_tipovi (company_id, naziv)
SELECT company.id, built_in.naziv
FROM public.tvrtke company
CROSS JOIN (VALUES ('Teretno'), ('Dostavno'), ('Radno'), ('Putničko')) AS built_in(naziv)
WHERE NOT EXISTS (
  SELECT 1 FROM public.vozila_tipovi vehicle_type
  WHERE vehicle_type.company_id = company.id
    AND lower(trim(vehicle_type.naziv)) = lower(trim(built_in.naziv))
);

WITH existing_vehicle_types AS (
  SELECT vehicle.company_id, min(trim(vehicle.tip)) AS naziv
  FROM public.vozila vehicle
  WHERE vehicle.company_id IS NOT NULL AND length(trim(vehicle.tip)) > 0
  GROUP BY vehicle.company_id, lower(trim(vehicle.tip))
)
INSERT INTO public.vozila_tipovi (company_id, naziv)
SELECT candidate.company_id, candidate.naziv
FROM existing_vehicle_types candidate
WHERE NOT EXISTS (
  SELECT 1 FROM public.vozila_tipovi vehicle_type
  WHERE vehicle_type.company_id = candidate.company_id
    AND lower(trim(vehicle_type.naziv)) = lower(trim(candidate.naziv))
);

REVOKE ALL ON TABLE public.vozila_tipovi FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.vozila_tipovi TO authenticated;

ALTER TABLE public.vozila_tipovi ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON public.vozila_tipovi AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (company_id = public.app_current_company_id())
  WITH CHECK (company_id = public.app_current_company_id());

CREATE POLICY vozila_tipovi_select ON public.vozila_tipovi
  FOR SELECT TO authenticated
  USING (public.app_has_module_permission('vozila', 'view'));

CREATE POLICY vozila_tipovi_insert ON public.vozila_tipovi
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_module_permission('vozila', 'edit'));

ALTER TABLE public.vozila DROP CONSTRAINT IF EXISTS vozila_tip_check;

CREATE OR REPLACE FUNCTION private.validate_vozilo_tip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.vozila_tipovi vehicle_type
    WHERE vehicle_type.company_id = NEW.company_id
      AND lower(trim(vehicle_type.naziv)) = lower(trim(NEW.tip))
  ) THEN
    RAISE EXCEPTION 'Odaberite tip vozila s popisa.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_vozilo_tip
  BEFORE INSERT OR UPDATE OF tip, company_id ON public.vozila
  FOR EACH ROW EXECUTE FUNCTION private.validate_vozilo_tip();

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
      RAISE EXCEPTION 'Djelatnik kategorije Radnik može evidentirati gorivo samo za teretna vozila.'
        USING ERRCODE = '23514';
    END IF;
    NEW.tocio_ime := worker_name;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
