CREATE TABLE IF NOT EXISTS investitori (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naziv text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS objekti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naziv text NOT NULL UNIQUE,
  investitor_id uuid REFERENCES investitori(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE gradilista
  ADD COLUMN IF NOT EXISTS investor text,
  ADD COLUMN IF NOT EXISTS objekt text,
  ADD COLUMN IF NOT EXISTS voditelj_gradilista text,
  ADD COLUMN IF NOT EXISTS ugovorena_vrijednost numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS predvidena_marza numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stvarni_pocetak date,
  ADD COLUMN IF NOT EXISTS stvarni_zavrsetak date;

CREATE INDEX IF NOT EXISTS idx_gradilista_investor ON gradilista(investor);
CREATE INDEX IF NOT EXISTS idx_gradilista_objekt ON gradilista(objekt);
CREATE INDEX IF NOT EXISTS idx_gradilista_voditelj_gradilista ON gradilista(voditelj_gradilista);
CREATE INDEX IF NOT EXISTS idx_objekti_investitor_id ON objekti(investitor_id);

ALTER TABLE objekti ENABLE ROW LEVEL SECURITY;
ALTER TABLE investitori ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_investitori" ON investitori;
CREATE POLICY "anon_select_investitori" ON investitori FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_investitori" ON investitori;
CREATE POLICY "anon_insert_investitori" ON investitori FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_investitori" ON investitori;
CREATE POLICY "anon_update_investitori" ON investitori FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_investitori" ON investitori;
CREATE POLICY "anon_delete_investitori" ON investitori FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_objekti" ON objekti;
CREATE POLICY "anon_select_objekti" ON objekti FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_objekti" ON objekti;
CREATE POLICY "anon_insert_objekti" ON objekti FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_objekti" ON objekti;
CREATE POLICY "anon_update_objekti" ON objekti FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_objekti" ON objekti;
CREATE POLICY "anon_delete_objekti" ON objekti FOR DELETE TO anon, authenticated USING (true);
