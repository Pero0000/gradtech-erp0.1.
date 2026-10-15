CREATE TABLE IF NOT EXISTS gradiliste_zadaci (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gradiliste_id uuid NOT NULL REFERENCES gradilista(id) ON DELETE CASCADE,
  naziv text NOT NULL,
  gotovo boolean NOT NULL DEFAULT false,
  gotovo_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gradiliste_zadaci_gradiliste ON gradiliste_zadaci(gradiliste_id);

ALTER TABLE gradiliste_zadaci ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_gradiliste_zadaci" ON gradiliste_zadaci;
CREATE POLICY "anon_select_gradiliste_zadaci" ON gradiliste_zadaci FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_gradiliste_zadaci" ON gradiliste_zadaci;
CREATE POLICY "anon_insert_gradiliste_zadaci" ON gradiliste_zadaci FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_gradiliste_zadaci" ON gradiliste_zadaci;
CREATE POLICY "anon_update_gradiliste_zadaci" ON gradiliste_zadaci FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_gradiliste_zadaci" ON gradiliste_zadaci;
CREATE POLICY "anon_delete_gradiliste_zadaci" ON gradiliste_zadaci FOR DELETE TO anon, authenticated USING (true);

NOTIFY pgrst, 'reload schema';
