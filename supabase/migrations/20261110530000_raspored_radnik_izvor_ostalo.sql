ALTER TABLE public.dnevni_raspored_radnici
  ADD COLUMN IF NOT EXISTS iz_ostalo boolean NOT NULL DEFAULT false;
