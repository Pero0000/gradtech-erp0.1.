CREATE TABLE IF NOT EXISTS investitori (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naziv text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS objekti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investitor_id uuid REFERENCES investitori(id) ON DELETE CASCADE,
  naziv text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE objekti
  ADD COLUMN IF NOT EXISTS investitor_id uuid REFERENCES investitori(id) ON DELETE CASCADE;

ALTER TABLE gradilista
  ADD COLUMN IF NOT EXISTS objekt_id uuid REFERENCES objekti(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voditelj_gradilista text,
  ADD COLUMN IF NOT EXISTS ugovorena_vrijednost numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS predvidena_marza numeric(12,2) DEFAULT 0;

ALTER TABLE objekti
  DROP CONSTRAINT IF EXISTS objekti_naziv_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_objekti_investitor_naziv
  ON objekti(investitor_id, naziv);

INSERT INTO investitori (naziv)
SELECT DISTINCT vrijednost
FROM (
  SELECT NULLIF(BTRIM(investor), '') AS vrijednost FROM gradilista
  UNION ALL
  SELECT NULLIF(BTRIM(investitor), '') AS vrijednost FROM gradilista
) AS legacy_investitori
WHERE vrijednost IS NOT NULL
ON CONFLICT (naziv) DO NOTHING;

INSERT INTO objekti (investitor_id, naziv)
SELECT DISTINCT investitori.id, NULLIF(BTRIM(gradilista.objekt), '')
FROM gradilista
LEFT JOIN investitori
  ON investitori.naziv = COALESCE(
    NULLIF(BTRIM(gradilista.investor), ''),
    NULLIF(BTRIM(gradilista.investitor), '')
  )
WHERE NULLIF(BTRIM(gradilista.objekt), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM objekti
    WHERE objekti.investitor_id IS NOT DISTINCT FROM investitori.id
      AND objekti.naziv = NULLIF(BTRIM(gradilista.objekt), '')
  );

UPDATE gradilista
SET objekt_id = objekti.id
FROM objekti
LEFT JOIN investitori
  ON investitori.id = objekti.investitor_id
WHERE gradilista.objekt_id IS NULL
  AND objekti.naziv = NULLIF(BTRIM(gradilista.objekt), '')
  AND investitori.naziv IS NOT DISTINCT FROM COALESCE(
    NULLIF(BTRIM(gradilista.investor), ''),
    NULLIF(BTRIM(gradilista.investitor), '')
  );

CREATE INDEX IF NOT EXISTS idx_gradilista_objekt_id ON gradilista(objekt_id);
CREATE INDEX IF NOT EXISTS idx_objekti_investitor_id ON objekti(investitor_id);

ALTER TABLE investitori ENABLE ROW LEVEL SECURITY;
ALTER TABLE objekti ENABLE ROW LEVEL SECURITY;

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
