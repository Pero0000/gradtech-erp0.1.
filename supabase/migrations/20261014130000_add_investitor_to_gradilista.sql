CREATE TABLE IF NOT EXISTS investitori (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naziv text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE gradilista
  ADD COLUMN IF NOT EXISTS investor text;

CREATE INDEX IF NOT EXISTS idx_gradilista_investor ON gradilista(investor);

ALTER TABLE investitori ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_investitori" ON investitori;
CREATE POLICY "anon_select_investitori" ON investitori FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_investitori" ON investitori;
CREATE POLICY "anon_insert_investitori" ON investitori FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_investitori" ON investitori;
CREATE POLICY "anon_update_investitori" ON investitori FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_investitori" ON investitori;
CREATE POLICY "anon_delete_investitori" ON investitori FOR DELETE TO anon, authenticated USING (true);
