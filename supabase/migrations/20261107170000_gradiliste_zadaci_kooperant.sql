ALTER TABLE public.gradiliste_zadaci
  ADD COLUMN IF NOT EXISTS kooperant_id uuid
  REFERENCES public.kooperanti(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gradiliste_zadaci_kooperant
  ON public.gradiliste_zadaci(kooperant_id);

NOTIFY pgrst, 'reload schema';
