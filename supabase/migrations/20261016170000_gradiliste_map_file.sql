ALTER TABLE public.gradilista
  ADD COLUMN IF NOT EXISTS onedrive_map_file_path text,
  ADD COLUMN IF NOT EXISTS onedrive_map_file_name text;

NOTIFY pgrst, 'reload schema';
