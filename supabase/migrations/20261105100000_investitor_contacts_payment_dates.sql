ALTER TABLE public.fakture
  ADD COLUMN IF NOT EXISTS datum_naplate date;

CREATE TABLE IF NOT EXISTS public.investitor_kontakti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.app_current_company_id()
    REFERENCES public.tvrtke(id) ON DELETE CASCADE,
  investitor_id uuid NOT NULL REFERENCES public.investitori(id) ON DELETE CASCADE,
  uloga text NOT NULL CHECK (btrim(uloga) <> ''),
  ime text NOT NULL CHECK (btrim(ime) <> ''),
  telefon text,
  email text,
  napomena text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investitor_kontakti_investitor_idx
  ON public.investitor_kontakti (company_id, investitor_id, uloga, ime);

ALTER TABLE public.investitor_kontakti ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investitor_kontakti FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investitor_kontakti TO authenticated;

DROP POLICY IF EXISTS investitor_kontakti_tenant_scope ON public.investitor_kontakti;
CREATE POLICY investitor_kontakti_tenant_scope ON public.investitor_kontakti
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = public.app_current_company_id())
  WITH CHECK (
    company_id = public.app_current_company_id()
    AND EXISTS (
      SELECT 1 FROM public.investitori investor
      WHERE investor.id = investitor_id
        AND investor.company_id = public.app_current_company_id()
    )
  );

DROP POLICY IF EXISTS investitor_kontakti_select ON public.investitor_kontakti;
CREATE POLICY investitor_kontakti_select ON public.investitor_kontakti
  FOR SELECT TO authenticated
  USING (public.app_has_module_permission('investitori', 'view'));

DROP POLICY IF EXISTS investitor_kontakti_insert ON public.investitor_kontakti;
CREATE POLICY investitor_kontakti_insert ON public.investitor_kontakti
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_module_permission('investitori', 'edit'));

DROP POLICY IF EXISTS investitor_kontakti_update ON public.investitor_kontakti;
CREATE POLICY investitor_kontakti_update ON public.investitor_kontakti
  FOR UPDATE TO authenticated
  USING (public.app_has_module_permission('investitori', 'edit'))
  WITH CHECK (public.app_has_module_permission('investitori', 'edit'));

DROP POLICY IF EXISTS investitor_kontakti_delete ON public.investitor_kontakti;
CREATE POLICY investitor_kontakti_delete ON public.investitor_kontakti
  FOR DELETE TO authenticated
  USING (public.app_has_module_permission('investitori', 'edit'));
