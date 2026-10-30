ALTER TABLE public.troskovi
  ADD COLUMN IF NOT EXISTS broj_racuna text,
  ADD COLUMN IF NOT EXISTS kolicina numeric(14, 3),
  ADD COLUMN IF NOT EXISTS jedinica text,
  ADD COLUMN IF NOT EXISTS jedinicna_cijena numeric(14, 4);

NOTIFY pgrst, 'reload schema';
