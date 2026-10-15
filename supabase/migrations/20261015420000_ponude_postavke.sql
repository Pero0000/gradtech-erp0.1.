-- Postavke ponude (izvođač, logo, potpis, napomene...) dijele se između svih preglednika i računala
CREATE TABLE IF NOT EXISTS ponude_postavke (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  podaci jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ponude_postavke ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_ponude_postavke" ON ponude_postavke;
CREATE POLICY "anon_select_ponude_postavke" ON ponude_postavke FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_ponude_postavke" ON ponude_postavke;
CREATE POLICY "anon_insert_ponude_postavke" ON ponude_postavke FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_ponude_postavke" ON ponude_postavke;
CREATE POLICY "anon_update_ponude_postavke" ON ponude_postavke FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
