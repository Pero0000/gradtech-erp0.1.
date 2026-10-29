ALTER TABLE public.troskovi
  ADD COLUMN IF NOT EXISTS kooperant_racun_id uuid;

CREATE INDEX IF NOT EXISTS troskovi_kooperant_racun_idx
  ON public.troskovi (company_id, kooperant_id, kooperant_racun_id)
  WHERE kooperant_racun_id IS NOT NULL;

ALTER TABLE public.kooperant_dokumenti
  ADD COLUMN IF NOT EXISTS gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS kooperant_dokumenti_tenant_scope ON public.kooperant_dokumenti;
CREATE POLICY kooperant_dokumenti_tenant_scope ON public.kooperant_dokumenti
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = public.app_current_company_id()
    AND EXISTS (
      SELECT 1 FROM public.kooperanti k
      WHERE k.id = kooperant_id AND k.company_id = public.app_current_company_id()
    )
    AND (
      gradiliste_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.gradilista g
        WHERE g.id = gradiliste_id AND g.company_id = public.app_current_company_id()
      )
    )
  )
  WITH CHECK (
    company_id = public.app_current_company_id()
    AND EXISTS (
      SELECT 1 FROM public.kooperanti k
      WHERE k.id = kooperant_id AND k.company_id = public.app_current_company_id()
    )
    AND (
      gradiliste_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.gradilista g
        WHERE g.id = gradiliste_id AND g.company_id = public.app_current_company_id()
      )
    )
  );

DROP POLICY IF EXISTS kooperant_dokumenti_update ON public.kooperant_dokumenti;
CREATE POLICY kooperant_dokumenti_update ON public.kooperant_dokumenti
  FOR UPDATE TO authenticated
  USING (public.app_has_module_permission('kooperanti', 'edit'))
  WITH CHECK (public.app_has_module_permission('kooperanti', 'edit'));

NOTIFY pgrst, 'reload schema';
