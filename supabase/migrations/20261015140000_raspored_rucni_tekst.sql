ALTER TABLE dnevni_raspored_gradilista ALTER COLUMN gradiliste_id DROP NOT NULL;
ALTER TABLE dnevni_raspored_gradilista ADD COLUMN IF NOT EXISTS tekst text;
