-- Postavke upozorenja za servis vozila
ALTER TABLE vozila ADD COLUMN IF NOT EXISTS servis_interval_km integer;
ALTER TABLE vozila ADD COLUMN IF NOT EXISTS servis_interval_mjeseci integer;
ALTER TABLE vozila ADD COLUMN IF NOT EXISTS servis_upozorenje_km integer NOT NULL DEFAULT 1000;
ALTER TABLE vozila ADD COLUMN IF NOT EXISTS servis_upozorenje_dana integer NOT NULL DEFAULT 30;

NOTIFY pgrst, 'reload schema';
