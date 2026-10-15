ALTER TABLE radni_nalozi ADD COLUMN IF NOT EXISTS napomena text;

NOTIFY pgrst, 'reload schema';
