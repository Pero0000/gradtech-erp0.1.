CREATE TABLE public.rucne_obavijesti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.tvrtke(id) ON DELETE CASCADE,
  datum date NOT NULL,
  naslov text NOT NULL CHECK (btrim(naslov) <> ''),
  tekst text NOT NULL CHECK (btrim(tekst) <> ''),
  radnik_id uuid REFERENCES public.radnici(id) ON DELETE SET NULL,
  rijeseno_at timestamptz,
  created_by uuid REFERENCES public.app_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rucne_obavijesti_company_datum
  ON public.rucne_obavijesti(company_id, datum)
  WHERE rijeseno_at IS NULL;

ALTER TABLE public.rucne_obavijesti ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rucne_obavijesti FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rucne_obavijesti TO authenticated;

CREATE POLICY tenant_scope ON public.rucne_obavijesti
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = public.app_current_company_id())
  WITH CHECK (company_id = public.app_current_company_id());

CREATE POLICY rucne_obavijesti_select ON public.rucne_obavijesti
  FOR SELECT TO authenticated
  USING (public.app_has_module_permission('obavijesti', 'view'));

CREATE POLICY rucne_obavijesti_insert ON public.rucne_obavijesti
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_module_permission('obavijesti', 'edit'));

CREATE POLICY rucne_obavijesti_update ON public.rucne_obavijesti
  FOR UPDATE TO authenticated
  USING (public.app_has_module_permission('obavijesti', 'edit'))
  WITH CHECK (public.app_has_module_permission('obavijesti', 'edit'));

CREATE POLICY rucne_obavijesti_delete ON public.rucne_obavijesti
  FOR DELETE TO authenticated
  USING (public.app_has_module_permission('obavijesti', 'edit'));

CREATE FUNCTION private.prepare_rucna_obavijest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_company uuid := public.app_current_company_id();
BEGIN
  NEW.company_id := current_company;
  NEW.created_by := auth.uid();
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  IF NEW.radnik_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.radnici
    WHERE id = NEW.radnik_id AND company_id = current_company
  ) THEN
    RAISE EXCEPTION 'Odabrani djelatnik ne pripada trenutnoj tvrtki.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_rucna_obavijest
BEFORE INSERT OR UPDATE ON public.rucne_obavijesti
FOR EACH ROW EXECUTE FUNCTION private.prepare_rucna_obavijest();

REVOKE ALL ON FUNCTION private.prepare_rucna_obavijest() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
