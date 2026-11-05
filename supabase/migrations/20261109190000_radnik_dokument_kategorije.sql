CREATE TABLE public.radnik_dokument_kategorije (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.app_current_company_id()
    REFERENCES public.tvrtke(id) ON DELETE CASCADE,
  naziv text NOT NULL CHECK (length(trim(naziv)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lower(trim(naziv)) NOT IN (
    'liječnički pregled', 'atest', 'zaštita na radu', 'osposobljavanje', 'ostalo'
  ))
);

CREATE UNIQUE INDEX radnik_dokument_kategorije_company_name
  ON public.radnik_dokument_kategorije (company_id, lower(trim(naziv)));

REVOKE ALL ON TABLE public.radnik_dokument_kategorije FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.radnik_dokument_kategorije TO authenticated;
ALTER TABLE public.radnik_dokument_kategorije ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON public.radnik_dokument_kategorije AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (company_id = public.app_current_company_id())
  WITH CHECK (company_id = public.app_current_company_id());

CREATE POLICY radnik_dokument_kategorije_select ON public.radnik_dokument_kategorije
  FOR SELECT TO authenticated
  USING (public.app_has_module_permission('radnici', 'view'));

CREATE POLICY radnik_dokument_kategorije_insert ON public.radnik_dokument_kategorije
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_module_permission('radnici', 'edit'));

CREATE OR REPLACE FUNCTION private.set_radnik_dokument_category_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  category_name text;
BEGIN
  category_name := CASE NEW.vrsta
    WHEN 'lijecnicki' THEN 'Liječnički pregled'
    WHEN 'atest' THEN 'Atest'
    WHEN 'zastita_na_radu' THEN 'Zaštita na radu'
    WHEN 'osposobljavanje' THEN 'Osposobljavanje'
    WHEN 'ostalo' THEN 'Ostalo'
    ELSE NULL
  END;
  IF category_name IS NULL THEN
    SELECT category.naziv INTO category_name
    FROM public.radnik_dokument_kategorije category
    WHERE 'custom:' || category.id::text = NEW.vrsta
      AND category.company_id = NEW.company_id;
  END IF;
  IF category_name IS NULL THEN
    RAISE EXCEPTION 'Odaberite kategoriju dokumenta iz svoje tvrtke.'
      USING ERRCODE = '23514';
  END IF;
  NEW.naziv := category_name;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_radnik_dokument_category_name
  BEFORE INSERT OR UPDATE OF vrsta, company_id ON public.radnici_dokumenti
  FOR EACH ROW EXECUTE FUNCTION private.set_radnik_dokument_category_name();

REVOKE ALL ON FUNCTION private.set_radnik_dokument_category_name() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
