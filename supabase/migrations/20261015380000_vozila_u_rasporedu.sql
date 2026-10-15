ALTER TABLE vozila ADD COLUMN IF NOT EXISTS u_rasporedu boolean NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';
