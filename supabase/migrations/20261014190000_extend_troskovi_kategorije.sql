ALTER TABLE public.troskovi
  DROP CONSTRAINT IF EXISTS troskovi_kategorija_check;

ALTER TABLE public.troskovi
  ADD CONSTRAINT troskovi_kategorija_check
  CHECK (kategorija IN ('materijal', 'gorivo', 'put', 'smjestaj', 'kooperanti', 'place', 'oprema', 'ostalo'));

NOTIFY pgrst, 'reload schema';
