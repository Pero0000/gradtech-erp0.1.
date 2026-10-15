ALTER TABLE dnevni_raspored_gradilista
  ADD COLUMN IF NOT EXISTS nalog_id uuid REFERENCES radni_nalozi(id) ON DELETE SET NULL;
