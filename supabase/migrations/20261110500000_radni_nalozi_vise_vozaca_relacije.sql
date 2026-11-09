CREATE TABLE public.radni_nalozi_voznje (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.app_current_company_id()
    REFERENCES public.tvrtke(id) ON DELETE CASCADE,
  nalog_id uuid NOT NULL REFERENCES public.radni_nalozi(id) ON DELETE CASCADE,
  radnik_id uuid NOT NULL REFERENCES public.radnici(id) ON DELETE RESTRICT,
  polaziste text NOT NULL CHECK (btrim(polaziste) <> ''),
  odrediste text NOT NULL CHECK (btrim(odrediste) <> ''),
  redoslijed integer NOT NULL CHECK (redoslijed >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nalog_id, redoslijed)
);

CREATE INDEX radni_nalozi_voznje_worker_idx
  ON public.radni_nalozi_voznje (company_id, radnik_id, nalog_id);

ALTER TABLE public.radni_nalozi_voznje ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.radni_nalozi_voznje FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_mobile_nalog_voznje(p_nalog_id uuid)
RETURNS TABLE (
  id uuid,
  radnik_id uuid,
  polaziste text,
  odrediste text,
  redoslijed integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_mobile_assigned_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dodijeljen prijavljenom djelatniku.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT route.id, route.radnik_id, route.polaziste, route.odrediste, route.redoslijed
  FROM public.radni_nalozi_voznje route
  WHERE route.nalog_id = p_nalog_id
    AND route.company_id = public.app_current_company_id()
  ORDER BY route.redoslijed, route.created_at, route.id;
END;
$$;

CREATE FUNCTION public.mobile_add_nalog_voznja(
  p_nalog_id uuid,
  p_id uuid,
  p_radnik_id uuid,
  p_polaziste text,
  p_odrediste text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  company uuid := public.app_current_company_id();
BEGIN
  IF NOT public.app_mobile_assigned_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dodijeljen prijavljenom djelatniku.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.radni_nalozi
  WHERE id = p_nalog_id AND company_id = company
  FOR UPDATE;
  IF NOT FOUND OR NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan za uređivanje.' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_radnik_id IS NULL
    OR NULLIF(btrim(COALESCE(p_polaziste, '')), '') IS NULL
    OR NULLIF(btrim(COALESCE(p_odrediste, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Svaka relacija mora imati vozača, polazište i odredište.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.radni_nalozi_radnici assignment
    WHERE assignment.nalog_id = p_nalog_id
      AND assignment.radnik_id = p_radnik_id
      AND assignment.company_id = company
  ) THEN
    RAISE EXCEPTION 'Vozač relacije mora biti djelatnik dodijeljen ovom nalogu.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.radni_nalozi_voznje (
    id, company_id, nalog_id, radnik_id, polaziste, odrediste, redoslijed
  )
  SELECT
    p_id, company, p_nalog_id, p_radnik_id, btrim(p_polaziste), btrim(p_odrediste),
    COALESCE(max(route.redoslijed) + 1, 0)
  FROM public.radni_nalozi_voznje route
  WHERE route.nalog_id = p_nalog_id AND route.company_id = company;
END;
$$;

CREATE FUNCTION public.mobile_delete_nalog_voznja(p_nalog_id uuid, p_voznja_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  company uuid := public.app_current_company_id();
  deleted_count integer;
BEGIN
  IF NOT public.app_mobile_assigned_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dodijeljen prijavljenom djelatniku.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.radni_nalozi
  WHERE id = p_nalog_id AND company_id = company
  FOR UPDATE;
  IF NOT FOUND OR NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan za uređivanje.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.radni_nalozi_voznje
  WHERE id = p_voznja_id AND nalog_id = p_nalog_id AND company_id = company;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count = 0 THEN
    RAISE EXCEPTION 'Relacija nije pronađena na ovom nalogu.' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mobile_nalog_voznje(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mobile_add_nalog_voznja(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mobile_delete_nalog_voznja(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_nalog_voznje(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_add_nalog_voznja(uuid, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_delete_nalog_voznja(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
