CREATE TABLE public.vozila_obavijesti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.app_current_company_id() REFERENCES public.tvrtke(id),
  vozilo_id uuid NOT NULL REFERENCES public.vozila(id) ON DELETE CASCADE,
  prijavio_radnik_id uuid REFERENCES public.radnici(id) ON DELETE SET NULL,
  prijavio_ime text NOT NULL,
  vrsta text NOT NULL CHECK (vrsta IN ('kvar', 'upozorenje', 'ostalo')),
  opis text NOT NULL CHECK (length(trim(opis)) > 0),
  datum date NOT NULL DEFAULT CURRENT_DATE,
  rijeseno_at timestamptz,
  rijesio uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.vozila_obavijesti FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.vozila_obavijesti TO authenticated;

CREATE INDEX vozila_obavijesti_open_company_date
  ON public.vozila_obavijesti (company_id, datum DESC)
  WHERE rijeseno_at IS NULL;

ALTER TABLE public.vozila_obavijesti ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON public.vozila_obavijesti AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (company_id = public.app_current_company_id())
  WITH CHECK (company_id = public.app_current_company_id());

CREATE POLICY vozila_obavijesti_select ON public.vozila_obavijesti
  FOR SELECT TO authenticated
  USING (
    public.app_has_module_permission('obavijesti', 'view')
    OR created_by = auth.uid()
  );

CREATE OR REPLACE FUNCTION private.validate_vozila_obavijest_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  vehicle_company uuid;
  worker_company uuid;
BEGIN
  SELECT company_id INTO vehicle_company
  FROM public.vozila
  WHERE id = NEW.vozilo_id;
  IF vehicle_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Vozilo mora pripadati istoj tvrtki kao prijava.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.prijavio_radnik_id IS NOT NULL THEN
    SELECT company_id INTO worker_company
    FROM public.radnici
    WHERE id = NEW.prijavio_radnik_id;
    IF worker_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Djelatnik mora pripadati istoj tvrtki kao prijava.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_vozila_obavijest_company
  BEFORE INSERT OR UPDATE OF company_id, vozilo_id, prijavio_radnik_id
  ON public.vozila_obavijesti
  FOR EACH ROW EXECUTE FUNCTION private.validate_vozila_obavijest_company();

CREATE OR REPLACE FUNCTION public.get_mobile_vozila_obavijest_vehicles()
RETURNS TABLE (id uuid, marka text, model text, registracija text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.app_mobile_radnik_id() IS NULL THEN
    RAISE EXCEPTION 'Prijava kvarova dostupna je samo povezanom djelatniku.'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT vehicle.id, vehicle.marka, vehicle.model, vehicle.registracija
  FROM public.vozila vehicle
  WHERE vehicle.company_id = public.app_current_company_id()
  ORDER BY vehicle.marka, vehicle.model, vehicle.registracija;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_mobile_vozila_obavijest(
  p_vozilo_id uuid,
  p_vrsta text,
  p_opis text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  worker_id uuid;
  worker_name text;
  entry_id uuid;
BEGIN
  worker_id := public.app_mobile_radnik_id();
  IF worker_id IS NULL THEN
    RAISE EXCEPTION 'Prijava kvarova dostupna je samo povezanom djelatniku.'
      USING ERRCODE = '42501';
  END IF;
  IF p_vrsta IS NULL OR p_vrsta NOT IN ('kvar', 'upozorenje', 'ostalo')
    OR length(trim(COALESCE(p_opis, ''))) = 0 OR length(trim(p_opis)) > 2000 THEN
    RAISE EXCEPTION 'Odaberite vrstu prijave i upišite opis.';
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
  WHERE worker.id = worker_id
    AND worker.company_id = public.app_current_company_id();

  INSERT INTO public.vozila_obavijesti (
    company_id, vozilo_id, prijavio_radnik_id, prijavio_ime,
    vrsta, opis, created_by
  )
  VALUES (
    public.app_current_company_id(), p_vozilo_id, worker_id, worker_name,
    p_vrsta, trim(p_opis), auth.uid()
  )
  RETURNING id INTO entry_id;
  RETURN entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_vozila_obavijest(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_has_module_permission('vozila', 'edit') THEN
    RAISE EXCEPTION 'Nemate pravo označiti prijavu vozila riješenom.'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.vozila_obavijesti
  SET rijeseno_at = now(), rijesio = auth.uid(), updated_at = now()
  WHERE id = p_id
    AND company_id = public.app_current_company_id()
    AND rijeseno_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aktivna prijava vozila nije pronađena.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mobile_vozila_obavijest_vehicles() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_mobile_vozila_obavijest(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_vozila_obavijest(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_vozila_obavijest_vehicles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_mobile_vozila_obavijest(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_vozila_obavijest(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
