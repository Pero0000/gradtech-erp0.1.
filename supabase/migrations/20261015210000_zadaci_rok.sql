ALTER TABLE gradiliste_zadaci ADD COLUMN IF NOT EXISTS rok date;

ALTER TABLE rokovi
  ADD COLUMN IF NOT EXISTS zadatak_id uuid REFERENCES gradiliste_zadaci(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_rokovi_zadatak ON rokovi(zadatak_id);

NOTIFY pgrst, 'reload schema';
