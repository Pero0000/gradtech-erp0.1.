ALTER TABLE vozila ADD COLUMN IF NOT EXISTS nosivost_kg numeric;
ALTER TABLE vozila ADD COLUMN IF NOT EXISTS masa_kg numeric;

NOTIFY pgrst, 'reload schema';
