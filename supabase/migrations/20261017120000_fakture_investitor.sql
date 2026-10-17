ALTER TABLE public.fakture
  ADD COLUMN IF NOT EXISTS investitor_id uuid REFERENCES public.investitori(id) ON DELETE SET NULL;

UPDATE public.fakture AS invoice
SET investitor_id = COALESCE(
  (
    SELECT object.investitor_id
    FROM public.gradilista AS site
    JOIN public.objekti AS object ON object.id = site.objekt_id
    WHERE site.id = invoice.gradiliste_id
  ),
  (
    SELECT investor.id
    FROM public.investitori AS investor
    WHERE lower(btrim(investor.naziv)) = lower(btrim(invoice.kupac))
    ORDER BY investor.created_at
    LIMIT 1
  )
)
WHERE invoice.investitor_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_fakture_investitor ON public.fakture(investitor_id);