ALTER TABLE public.radni_nalozi
  ADD COLUMN IF NOT EXISTS bez_izvrsenja boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
