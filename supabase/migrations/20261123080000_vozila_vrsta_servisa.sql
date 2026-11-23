ALTER TABLE public.vozila_dokumenti
  ADD COLUMN IF NOT EXISTS servis_vrsta text;

UPDATE public.vozila_dokumenti
SET servis_vrsta = 'redovni'
WHERE vrsta = 'servis'
  AND servis_vrsta IS NULL;

ALTER TABLE public.vozila_dokumenti
  DROP CONSTRAINT IF EXISTS vozila_dokumenti_servis_vrsta_check;

ALTER TABLE public.vozila_dokumenti
  ADD CONSTRAINT vozila_dokumenti_servis_vrsta_check
  CHECK (
    (vrsta <> 'servis' AND servis_vrsta IS NULL)
    OR (vrsta = 'servis' AND servis_vrsta IN ('redovni', 'izvanredni'))
  );

CREATE INDEX IF NOT EXISTS idx_vozila_dokumenti_redovni_servis
  ON public.vozila_dokumenti (vozilo_id, datum_od)
  WHERE vrsta = 'servis' AND servis_vrsta = 'redovni';

NOTIFY pgrst, 'reload schema';
