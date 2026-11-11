CREATE OR REPLACE FUNCTION public.get_rekapitulacija_sazeci(p_gradiliste_ids uuid[])
RETURNS TABLE (
  gradiliste_id uuid,
  direktni numeric,
  kategorije jsonb,
  sati numeric,
  rad_po_satnici numeric,
  sati_bez_satnice numeric,
  fakture numeric,
  placeno numeric,
  ugovoreno numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH sites AS MATERIALIZED (
    SELECT g.id
    FROM public.gradilista g
    WHERE g.id = ANY(p_gradiliste_ids)
      AND g.company_id = public.app_current_company_id()
  ),
  cost_categories AS (
    SELECT t.gradiliste_id, t.kategorija, sum(t.iznos)::numeric AS iznos
    FROM public.troskovi t JOIN sites s ON s.id = t.gradiliste_id
    GROUP BY t.gradiliste_id, t.kategorija
  ),
  costs AS (
    SELECT c.gradiliste_id, sum(c.iznos) AS direktni,
      jsonb_object_agg(c.kategorija, c.iznos) AS kategorije
    FROM cost_categories c
    GROUP BY c.gradiliste_id
  ),
  hours AS (
    SELECT rv.gradiliste_id,
      sum(rv.sati)::numeric AS sati,
      sum(rv.sati * r.cijena_sata)::numeric AS rad_po_satnici,
      sum(CASE WHEN r.cijena_sata IS NULL THEN rv.sati ELSE 0 END)::numeric AS sati_bez_satnice
    FROM public.radno_vrijeme rv JOIN sites s ON s.id = rv.gradiliste_id
    LEFT JOIN public.radnici r ON r.id = rv.radnik_id
    GROUP BY rv.gradiliste_id
  ),
  invoice_amounts AS (
    SELECT f.gradiliste_id, f.status,
      CASE WHEN f.rabat_smjer = 'oduzmi'
        THEN f.iznos - coalesce(f.rabat, 0)
        ELSE f.iznos + coalesce(f.rabat, 0)
      END AS iznos
    FROM public.fakture f JOIN sites s ON s.id = f.gradiliste_id
  ),
  invoices AS (
    SELECT f.gradiliste_id, sum(f.iznos)::numeric AS fakture,
      sum(CASE WHEN f.status = 'placena' THEN f.iznos ELSE 0 END)::numeric AS placeno
    FROM invoice_amounts f
    GROUP BY f.gradiliste_id
  ),
  contracts AS (
    SELECT u.gradiliste_id, sum(u.ugovoreni_iznos)::numeric AS ugovoreno
    FROM public.ugovoreni_radovi u JOIN sites s ON s.id = u.gradiliste_id
    GROUP BY u.gradiliste_id
  )
  SELECT s.id,
    coalesce(c.direktni, 0), coalesce(c.kategorije, '{}'::jsonb),
    coalesce(h.sati, 0), coalesce(h.rad_po_satnici, 0), coalesce(h.sati_bez_satnice, 0),
    coalesce(f.fakture, 0), coalesce(f.placeno, 0), coalesce(u.ugovoreno, 0)
  FROM sites s
  LEFT JOIN costs c ON c.gradiliste_id = s.id
  LEFT JOIN hours h ON h.gradiliste_id = s.id
  LEFT JOIN invoices f ON f.gradiliste_id = s.id
  LEFT JOIN contracts u ON u.gradiliste_id = s.id
  ORDER BY s.id;
$$;

REVOKE ALL ON FUNCTION public.get_rekapitulacija_sazeci(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rekapitulacija_sazeci(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
