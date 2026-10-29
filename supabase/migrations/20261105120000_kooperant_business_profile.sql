ALTER TABLE public.troskovi
  ADD COLUMN IF NOT EXISTS placen boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS placeno_at date;

CREATE TABLE IF NOT EXISTS public.kooperant_angazmani (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.app_current_company_id()
    REFERENCES public.tvrtke(id) ON DELETE CASCADE,
  kooperant_id uuid NOT NULL REFERENCES public.kooperanti(id) ON DELETE CASCADE,
  gradiliste_id uuid NOT NULL REFERENCES public.gradilista(id) ON DELETE CASCADE,
  dogovoreni_iznos numeric(12,2) CHECK (dogovoreni_iznos IS NULL OR dogovoreni_iznos >= 0),
  status text NOT NULL DEFAULT 'aktivno' CHECK (status IN ('aktivno', 'zavrseno', 'otkazano')),
  datum_pocetka date,
  datum_zavrsetka date,
  napomena text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, kooperant_id, gradiliste_id)
);

INSERT INTO public.kooperant_angazmani (
  company_id, kooperant_id, gradiliste_id, status, datum_pocetka, created_at, updated_at
)
SELECT cost.company_id, cost.kooperant_id, cost.gradiliste_id,
  CASE WHEN site.status = 'aktivno' THEN 'aktivno' ELSE 'zavrseno' END,
  min(cost.datum), min(cost.created_at), min(cost.created_at)
FROM public.troskovi cost
JOIN public.gradilista site ON site.id = cost.gradiliste_id AND site.company_id = cost.company_id
WHERE cost.kooperant_id IS NOT NULL AND cost.gradiliste_id IS NOT NULL
  AND cost.company_id IS NOT NULL
GROUP BY cost.company_id, cost.kooperant_id, cost.gradiliste_id, site.status
ON CONFLICT (company_id, kooperant_id, gradiliste_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS kooperant_angazmani_kooperant_idx
  ON public.kooperant_angazmani (company_id, kooperant_id, status);
CREATE INDEX IF NOT EXISTS kooperant_angazmani_gradiliste_idx
  ON public.kooperant_angazmani (company_id, gradiliste_id);

CREATE TABLE IF NOT EXISTS public.kooperant_dokumenti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.app_current_company_id()
    REFERENCES public.tvrtke(id) ON DELETE CASCADE,
  kooperant_id uuid NOT NULL REFERENCES public.kooperanti(id) ON DELETE CASCADE,
  vrsta text NOT NULL CHECK (vrsta IN ('ugovor', 'licenca', 'atest', 'osiguranje', 'ponuda', 'racun')),
  naziv text NOT NULL CHECK (btrim(naziv) <> ''),
  putanja text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kooperant_dokumenti_kooperant_idx
  ON public.kooperant_dokumenti (company_id, kooperant_id, vrsta, created_at DESC);

ALTER TABLE public.kooperant_angazmani ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kooperant_dokumenti ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kooperant_angazmani, public.kooperant_dokumenti FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kooperant_angazmani, public.kooperant_dokumenti TO authenticated;

DROP POLICY IF EXISTS kooperant_angazmani_tenant_scope ON public.kooperant_angazmani;
CREATE POLICY kooperant_angazmani_tenant_scope ON public.kooperant_angazmani
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = public.app_current_company_id()
    AND EXISTS (SELECT 1 FROM public.kooperanti k WHERE k.id = kooperant_id AND k.company_id = public.app_current_company_id())
    AND EXISTS (SELECT 1 FROM public.gradilista g WHERE g.id = gradiliste_id AND g.company_id = public.app_current_company_id())
  )
  WITH CHECK (
    company_id = public.app_current_company_id()
    AND EXISTS (SELECT 1 FROM public.kooperanti k WHERE k.id = kooperant_id AND k.company_id = public.app_current_company_id())
    AND EXISTS (SELECT 1 FROM public.gradilista g WHERE g.id = gradiliste_id AND g.company_id = public.app_current_company_id())
  );
DROP POLICY IF EXISTS kooperant_angazmani_select ON public.kooperant_angazmani;
CREATE POLICY kooperant_angazmani_select ON public.kooperant_angazmani
  FOR SELECT TO authenticated USING (public.app_has_module_permission('kooperanti', 'view'));
DROP POLICY IF EXISTS kooperant_angazmani_insert ON public.kooperant_angazmani;
CREATE POLICY kooperant_angazmani_insert ON public.kooperant_angazmani
  FOR INSERT TO authenticated WITH CHECK (public.app_has_module_permission('kooperanti', 'edit'));
DROP POLICY IF EXISTS kooperant_angazmani_update ON public.kooperant_angazmani;
CREATE POLICY kooperant_angazmani_update ON public.kooperant_angazmani
  FOR UPDATE TO authenticated
  USING (public.app_has_module_permission('kooperanti', 'edit'))
  WITH CHECK (public.app_has_module_permission('kooperanti', 'edit'));
DROP POLICY IF EXISTS kooperant_angazmani_delete ON public.kooperant_angazmani;
CREATE POLICY kooperant_angazmani_delete ON public.kooperant_angazmani
  FOR DELETE TO authenticated USING (public.app_has_module_permission('kooperanti', 'edit'));

DROP POLICY IF EXISTS kooperant_dokumenti_tenant_scope ON public.kooperant_dokumenti;
CREATE POLICY kooperant_dokumenti_tenant_scope ON public.kooperant_dokumenti
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    company_id = public.app_current_company_id()
    AND EXISTS (SELECT 1 FROM public.kooperanti k WHERE k.id = kooperant_id AND k.company_id = public.app_current_company_id())
  )
  WITH CHECK (
    company_id = public.app_current_company_id()
    AND EXISTS (SELECT 1 FROM public.kooperanti k WHERE k.id = kooperant_id AND k.company_id = public.app_current_company_id())
  );
DROP POLICY IF EXISTS kooperant_dokumenti_select ON public.kooperant_dokumenti;
CREATE POLICY kooperant_dokumenti_select ON public.kooperant_dokumenti
  FOR SELECT TO authenticated USING (public.app_has_module_permission('kooperanti', 'view'));
DROP POLICY IF EXISTS kooperant_dokumenti_insert ON public.kooperant_dokumenti;
CREATE POLICY kooperant_dokumenti_insert ON public.kooperant_dokumenti
  FOR INSERT TO authenticated WITH CHECK (public.app_has_module_permission('kooperanti', 'edit'));
DROP POLICY IF EXISTS kooperant_dokumenti_delete ON public.kooperant_dokumenti;
CREATE POLICY kooperant_dokumenti_delete ON public.kooperant_dokumenti
  FOR DELETE TO authenticated USING (public.app_has_module_permission('kooperanti', 'edit'));

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('kooperant-dokumenti', 'kooperant-dokumenti', false, 20971520)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 20971520;

DROP POLICY IF EXISTS kooperant_files_select ON storage.objects;
CREATE POLICY kooperant_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'kooperant-dokumenti'
    AND split_part(name, '/', 1) = public.app_current_company_id()::text
    AND EXISTS (
      SELECT 1 FROM public.kooperanti k
      WHERE k.id::text = split_part(name, '/', 2)
        AND k.company_id = public.app_current_company_id()
        AND public.app_has_module_permission('kooperanti', 'view')
    )
  );
DROP POLICY IF EXISTS kooperant_files_insert ON storage.objects;
CREATE POLICY kooperant_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'kooperant-dokumenti'
    AND split_part(name, '/', 1) = public.app_current_company_id()::text
    AND EXISTS (
      SELECT 1 FROM public.kooperanti k
      WHERE k.id::text = split_part(name, '/', 2)
        AND k.company_id = public.app_current_company_id()
        AND public.app_has_module_permission('kooperanti', 'edit')
    )
  );
DROP POLICY IF EXISTS kooperant_files_delete ON storage.objects;
CREATE POLICY kooperant_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'kooperant-dokumenti'
    AND split_part(name, '/', 1) = public.app_current_company_id()::text
    AND EXISTS (
      SELECT 1 FROM public.kooperanti k
      WHERE k.id::text = split_part(name, '/', 2)
        AND k.company_id = public.app_current_company_id()
        AND public.app_has_module_permission('kooperanti', 'edit')
    )
  );

NOTIFY pgrst, 'reload schema';
