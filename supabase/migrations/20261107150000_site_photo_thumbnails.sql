ALTER TABLE public.gradiliste_dokumenti
  ADD COLUMN IF NOT EXISTS thumbnail_path text;

ALTER TABLE public.radni_nalozi_foto
  ADD COLUMN IF NOT EXISTS thumbnail_path text;

NOTIFY pgrst, 'reload schema';
