ALTER TABLE rokovi
  ADD COLUMN IF NOT EXISTS nalog_id uuid REFERENCES radni_nalozi(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_rokovi_nalog ON rokovi(nalog_id);
