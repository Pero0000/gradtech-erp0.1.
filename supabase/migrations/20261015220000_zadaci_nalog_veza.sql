ALTER TABLE gradiliste_zadaci
  ADD COLUMN IF NOT EXISTS nalog_id uuid REFERENCES radni_nalozi(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gradiliste_zadaci_nalog ON gradiliste_zadaci(nalog_id);

NOTIFY pgrst, 'reload schema';
