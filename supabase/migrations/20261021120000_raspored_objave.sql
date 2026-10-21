-- Poslani (objavljeni) dnevni raspored: ured gumbom "Pošalji raspored" sprema kopiju
-- rasporeda vozila, gradilišta i ekipa za jedan dan, a svi odobreni korisnici tvrtke
-- (uključujući radnike u Radničkom portalu) je mogu samo pregledati.

CREATE TABLE IF NOT EXISTS public.raspored_objave (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.app_current_company_id() REFERENCES public.tvrtke(id) ON DELETE CASCADE,
  datum date NOT NULL,
  podaci jsonb NOT NULL DEFAULT '{}'::jsonb,
  poslano_at timestamptz NOT NULL DEFAULT now(),
  poslao uuid DEFAULT auth.uid(),
  UNIQUE (company_id, datum)
);

ALTER TABLE public.raspored_objave ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.raspored_objave FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.raspored_objave TO authenticated;

DROP POLICY IF EXISTS tenant_scope ON public.raspored_objave;
CREATE POLICY tenant_scope ON public.raspored_objave AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = public.app_current_company_id())
  WITH CHECK (company_id = public.app_current_company_id());

DROP POLICY IF EXISTS raspored_objave_select ON public.raspored_objave;
CREATE POLICY raspored_objave_select ON public.raspored_objave
  FOR SELECT TO authenticated
  USING (public.app_is_approved());

DROP POLICY IF EXISTS raspored_objave_insert ON public.raspored_objave;
CREATE POLICY raspored_objave_insert ON public.raspored_objave
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_module_permission('raspored', 'edit') AND poslao = auth.uid());

DROP POLICY IF EXISTS raspored_objave_update ON public.raspored_objave;
CREATE POLICY raspored_objave_update ON public.raspored_objave
  FOR UPDATE TO authenticated
  USING (public.app_has_module_permission('raspored', 'edit'))
  WITH CHECK (public.app_has_module_permission('raspored', 'edit') AND poslao = auth.uid());

CREATE INDEX IF NOT EXISTS raspored_objave_company_datum ON public.raspored_objave (company_id, datum DESC);

NOTIFY pgrst, 'reload schema';
