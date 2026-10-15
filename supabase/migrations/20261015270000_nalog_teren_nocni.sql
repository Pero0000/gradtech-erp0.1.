ALTER TABLE radni_nalozi ADD COLUMN IF NOT EXISTS teren boolean NOT NULL DEFAULT false;
ALTER TABLE radnici ADD COLUMN IF NOT EXISTS nocni_dodatak numeric NOT NULL DEFAULT 30;
ALTER TABLE radnici ADD COLUMN IF NOT EXISTS teren_dnevnica numeric NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
