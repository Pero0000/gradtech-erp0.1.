CREATE TABLE IF NOT EXISTS dnevni_raspored_gradilista (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  datum date NOT NULL,
  vozilo_id uuid NOT NULL REFERENCES vozila(id) ON DELETE CASCADE,
  gradiliste_id uuid NOT NULL REFERENCES gradilista(id) ON DELETE CASCADE,
  vrijeme text NOT NULL DEFAULT '6:00h-16:00h',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (datum, vozilo_id, gradiliste_id)
);

CREATE TABLE IF NOT EXISTS dnevni_raspored_radnici (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  datum date NOT NULL,
  vozilo_id uuid NOT NULL REFERENCES vozila(id) ON DELETE CASCADE,
  radnik_id uuid NOT NULL REFERENCES radnici(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (datum, radnik_id)
);

CREATE INDEX IF NOT EXISTS idx_dnevni_raspored_gradilista_datum ON dnevni_raspored_gradilista (datum);
CREATE INDEX IF NOT EXISTS idx_dnevni_raspored_radnici_datum ON dnevni_raspored_radnici (datum);

ALTER TABLE dnevni_raspored_gradilista ENABLE ROW LEVEL SECURITY;
ALTER TABLE dnevni_raspored_radnici ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_dnevni_raspored_gradilista" ON dnevni_raspored_gradilista;
DROP POLICY IF EXISTS "anon_insert_dnevni_raspored_gradilista" ON dnevni_raspored_gradilista;
DROP POLICY IF EXISTS "anon_update_dnevni_raspored_gradilista" ON dnevni_raspored_gradilista;
DROP POLICY IF EXISTS "anon_delete_dnevni_raspored_gradilista" ON dnevni_raspored_gradilista;
CREATE POLICY "anon_select_dnevni_raspored_gradilista" ON dnevni_raspored_gradilista FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_dnevni_raspored_gradilista" ON dnevni_raspored_gradilista FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_dnevni_raspored_gradilista" ON dnevni_raspored_gradilista FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_dnevni_raspored_gradilista" ON dnevni_raspored_gradilista FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_dnevni_raspored_radnici" ON dnevni_raspored_radnici;
DROP POLICY IF EXISTS "anon_insert_dnevni_raspored_radnici" ON dnevni_raspored_radnici;
DROP POLICY IF EXISTS "anon_update_dnevni_raspored_radnici" ON dnevni_raspored_radnici;
DROP POLICY IF EXISTS "anon_delete_dnevni_raspored_radnici" ON dnevni_raspored_radnici;
CREATE POLICY "anon_select_dnevni_raspored_radnici" ON dnevni_raspored_radnici FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_dnevni_raspored_radnici" ON dnevni_raspored_radnici FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_dnevni_raspored_radnici" ON dnevni_raspored_radnici FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_dnevni_raspored_radnici" ON dnevni_raspored_radnici FOR DELETE TO anon, authenticated USING (true);
