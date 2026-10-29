ALTER TABLE public.radnici
  ADD COLUMN IF NOT EXISTS godisnji_dani_pravo integer NOT NULL DEFAULT 20
  CHECK (godisnji_dani_pravo >= 0);

NOTIFY pgrst, 'reload schema';
