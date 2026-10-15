CREATE TABLE IF NOT EXISTS dnevni_raspored_ostalo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  datum date NOT NULL,
  tekst text,
  radnik_id uuid REFERENCES radnici(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (tekst IS NOT NULL OR radnik_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_dnevni_raspored_ostalo_datum ON dnevni_raspored_ostalo (datum);

ALTER TABLE dnevni_raspored_ostalo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_dnevni_raspored_ostalo" ON dnevni_raspored_ostalo;
DROP POLICY IF EXISTS "anon_insert_dnevni_raspored_ostalo" ON dnevni_raspored_ostalo;
DROP POLICY IF EXISTS "anon_update_dnevni_raspored_ostalo" ON dnevni_raspored_ostalo;
DROP POLICY IF EXISTS "anon_delete_dnevni_raspored_ostalo" ON dnevni_raspored_ostalo;
CREATE POLICY "anon_select_dnevni_raspored_ostalo" ON dnevni_raspored_ostalo FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_dnevni_raspored_ostalo" ON dnevni_raspored_ostalo FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_dnevni_raspored_ostalo" ON dnevni_raspored_ostalo FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_dnevni_raspored_ostalo" ON dnevni_raspored_ostalo FOR DELETE TO anon, authenticated USING (true);
