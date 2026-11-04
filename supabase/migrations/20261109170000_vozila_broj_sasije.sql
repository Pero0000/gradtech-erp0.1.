ALTER TABLE public.vozila
  ADD COLUMN IF NOT EXISTS broj_sasije text;

NOTIFY pgrst, 'reload schema';
