ALTER TABLE vozila ADD COLUMN IF NOT EXISTS cijena_km numeric NOT NULL DEFAULT 0;

ALTER TABLE troskovi ADD COLUMN IF NOT EXISTS nalog_id uuid REFERENCES radni_nalozi(id) ON DELETE CASCADE;
ALTER TABLE radno_vrijeme ADD COLUMN IF NOT EXISTS nalog_id uuid REFERENCES radni_nalozi(id) ON DELETE CASCADE;

ALTER TABLE radni_nalozi_stavke ADD COLUMN IF NOT EXISTS preneseno boolean NOT NULL DEFAULT false;
ALTER TABLE radni_nalozi_stavke ADD COLUMN IF NOT EXISTS izvor_id uuid REFERENCES radni_nalozi_stavke(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_troskovi_nalog ON troskovi(nalog_id);
CREATE INDEX IF NOT EXISTS idx_radno_vrijeme_nalog ON radno_vrijeme(nalog_id);

NOTIFY pgrst, 'reload schema';
