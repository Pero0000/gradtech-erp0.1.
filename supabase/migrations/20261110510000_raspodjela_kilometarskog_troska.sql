CREATE TABLE public.dnevni_kilometarski_udjeli (
  company_id uuid NOT NULL REFERENCES public.tvrtke(id) ON DELETE CASCADE,
  datum date NOT NULL,
  vozilo_id uuid NOT NULL REFERENCES public.vozila(id) ON DELETE CASCADE,
  gradiliste_id uuid NOT NULL REFERENCES public.gradilista(id) ON DELETE CASCADE,
  postotak numeric(5, 2) NOT NULL CHECK (postotak >= 0 AND postotak <= 100),
  PRIMARY KEY (company_id, datum, vozilo_id, gradiliste_id)
);

ALTER TABLE public.dnevni_kilometarski_udjeli ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dnevni_kilometarski_udjeli FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.invalidate_daily_vehicle_km_allocations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.gradiliste_id IS NOT NULL THEN
      DELETE FROM public.dnevni_kilometarski_udjeli
        WHERE company_id = OLD.company_id AND datum = OLD.datum AND vozilo_id = OLD.vozilo_id;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.gradiliste_id IS NOT NULL THEN
      DELETE FROM public.dnevni_kilometarski_udjeli
        WHERE company_id = NEW.company_id AND datum = NEW.datum AND vozilo_id = NEW.vozilo_id;
    END IF;
    RETURN NEW;
  END IF;

  IF (OLD.company_id, OLD.datum, OLD.vozilo_id, OLD.gradiliste_id)
    IS DISTINCT FROM (NEW.company_id, NEW.datum, NEW.vozilo_id, NEW.gradiliste_id) THEN
    IF OLD.gradiliste_id IS NOT NULL THEN
      DELETE FROM public.dnevni_kilometarski_udjeli
        WHERE company_id = OLD.company_id AND datum = OLD.datum AND vozilo_id = OLD.vozilo_id;
    END IF;
    IF NEW.gradiliste_id IS NOT NULL THEN
      DELETE FROM public.dnevni_kilometarski_udjeli
        WHERE company_id = NEW.company_id AND datum = NEW.datum AND vozilo_id = NEW.vozilo_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invalidate_daily_vehicle_km_allocations
AFTER INSERT OR DELETE OR UPDATE OF company_id, datum, vozilo_id, gradiliste_id
ON public.dnevni_raspored_gradilista
FOR EACH ROW EXECUTE FUNCTION private.invalidate_daily_vehicle_km_allocations();

CREATE FUNCTION public.get_daily_vehicle_km_allocations(p_datum date)
RETURNS TABLE (vozilo_id uuid, gradiliste_id uuid, postotak numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'view')
    OR NOT public.app_has_module_permission('troskovi', 'view') THEN
    RAISE EXCEPTION 'Za pregled raspodjele kilometara potrebna su prava pregleda naloga i troškova.' USING ERRCODE = '42501';
  END IF;
  IF p_datum IS NULL THEN
    RAISE EXCEPTION 'Datum raspodjele kilometara nije valjan.' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT allocation.vozilo_id, allocation.gradiliste_id, allocation.postotak
    FROM public.dnevni_kilometarski_udjeli allocation
    WHERE allocation.company_id = public.app_current_company_id()
      AND allocation.datum = p_datum;
END;
$$;

CREATE FUNCTION public.save_daily_vehicle_km_allocations(
  p_datum date,
  p_vozilo_id uuid,
  p_allocations jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  company uuid := public.app_current_company_id();
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit')
    OR NOT public.app_has_module_permission('troskovi', 'edit') THEN
    RAISE EXCEPTION 'Za izmjenu raspodjele kilometara potrebna su prava uređivanja naloga i troškova.' USING ERRCODE = '42501';
  END IF;
  IF p_datum IS NULL OR p_vozilo_id IS NULL OR p_allocations IS NULL
    OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'Podaci raspodjele kilometara nisu valjani.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vozila vehicle
    WHERE vehicle.id = p_vozilo_id AND vehicle.company_id = company
  ) THEN
    RAISE EXCEPTION 'Vozilo ne pripada aktivnoj tvrtki.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) item WHERE jsonb_typeof(item) <> 'object')
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_allocations) item
      WHERE EXISTS (SELECT 1 FROM jsonb_object_keys(
        CASE WHEN jsonb_typeof(item) = 'object' THEN item ELSE '{}'::jsonb END
      ) field
        WHERE field NOT IN ('gradiliste_id', 'postotak'))
        OR NOT (item ? 'gradiliste_id' AND item ? 'postotak')
    ) THEN
    RAISE EXCEPTION 'Stavka raspodjele kilometara ima neispravna polja.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_allocations) entry(gradiliste_id uuid, postotak numeric)
    WHERE entry.gradiliste_id IS NULL OR entry.postotak IS NULL
      OR entry.postotak < 0 OR entry.postotak > 100
      OR entry.postotak <> round(entry.postotak, 2)
      OR NOT EXISTS (
        SELECT 1 FROM public.gradilista site
        WHERE site.id = entry.gradiliste_id AND site.company_id = company
      )
  ) OR EXISTS (
    SELECT entry.gradiliste_id
    FROM jsonb_to_recordset(p_allocations) entry(gradiliste_id uuid, postotak numeric)
    GROUP BY entry.gradiliste_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Postoci moraju biti valjani, a svako gradilište navedeno samo jednom.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_allocations) > 0 AND (
    (SELECT COALESCE(sum(entry.postotak), 0)
      FROM jsonb_to_recordset(p_allocations) entry(gradiliste_id uuid, postotak numeric)) <> 100
    OR EXISTS (
      SELECT assignment.gradiliste_id
      FROM public.dnevni_raspored_gradilista assignment
      WHERE assignment.company_id = company AND assignment.datum = p_datum
        AND assignment.vozilo_id = p_vozilo_id AND assignment.gradiliste_id IS NOT NULL
      EXCEPT
      SELECT entry.gradiliste_id
      FROM jsonb_to_recordset(p_allocations) entry(gradiliste_id uuid, postotak numeric)
    )
    OR EXISTS (
      SELECT entry.gradiliste_id
      FROM jsonb_to_recordset(p_allocations) entry(gradiliste_id uuid, postotak numeric)
      EXCEPT
      SELECT assignment.gradiliste_id
      FROM public.dnevni_raspored_gradilista assignment
      WHERE assignment.company_id = company AND assignment.datum = p_datum
        AND assignment.vozilo_id = p_vozilo_id AND assignment.gradiliste_id IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'Postoci moraju ukupno iznositi 100 %% i odgovarati gradilištima iz dnevnog rasporeda.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('daily-vehicle-km:' || company::text || ':' || p_datum::text, 0));
  DELETE FROM public.dnevni_kilometarski_udjeli
    WHERE company_id = company AND datum = p_datum AND vozilo_id = p_vozilo_id;
  INSERT INTO public.dnevni_kilometarski_udjeli (company_id, datum, vozilo_id, gradiliste_id, postotak)
    SELECT company, p_datum, p_vozilo_id, entry.gradiliste_id, entry.postotak
    FROM jsonb_to_recordset(p_allocations) entry(gradiliste_id uuid, postotak numeric);
END;
$$;

REVOKE ALL ON FUNCTION private.invalidate_daily_vehicle_km_allocations(),
  public.get_daily_vehicle_km_allocations(date),
  public.save_daily_vehicle_km_allocations(date, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.invalidate_daily_vehicle_km_allocations() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_vehicle_km_allocations(date),
  public.save_daily_vehicle_km_allocations(date, uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
