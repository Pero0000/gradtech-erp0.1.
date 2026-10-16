ALTER TABLE public.gradilista
  ADD COLUMN IF NOT EXISTS onedrive_map_link text;

NOTIFY pgrst, 'reload schema';
