ALTER TABLE public.rokovi
  ADD COLUMN IF NOT EXISTS kooperant_id uuid
  REFERENCES public.kooperanti(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rokovi_kooperant
  ON public.rokovi(kooperant_id);

NOTIFY pgrst, 'reload schema';
