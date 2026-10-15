CREATE TABLE IF NOT EXISTS radni_nalozi_stavke (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nalog_id uuid NOT NULL REFERENCES radni_nalozi(id) ON DELETE CASCADE,
  tip text NOT NULL CHECK (tip IN ('materijal', 'alat')),
  naziv text NOT NULL,
  gotovo boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_radni_nalozi_stavke_nalog ON radni_nalozi_stavke(nalog_id);

ALTER TABLE radni_nalozi_stavke ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_radni_nalozi_stavke" ON radni_nalozi_stavke;
CREATE POLICY "anon_select_radni_nalozi_stavke" ON radni_nalozi_stavke FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_radni_nalozi_stavke" ON radni_nalozi_stavke;
CREATE POLICY "anon_insert_radni_nalozi_stavke" ON radni_nalozi_stavke FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_radni_nalozi_stavke" ON radni_nalozi_stavke;
CREATE POLICY "anon_update_radni_nalozi_stavke" ON radni_nalozi_stavke FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_radni_nalozi_stavke" ON radni_nalozi_stavke;
CREATE POLICY "anon_delete_radni_nalozi_stavke" ON radni_nalozi_stavke FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS radni_nalozi_dokumenti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nalog_id uuid NOT NULL REFERENCES radni_nalozi(id) ON DELETE CASCADE,
  putanja text NOT NULL,
  naziv text NOT NULL,
  velicina bigint,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_radni_nalozi_dokumenti_nalog ON radni_nalozi_dokumenti(nalog_id);

ALTER TABLE radni_nalozi_dokumenti ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_radni_nalozi_dokumenti" ON radni_nalozi_dokumenti;
CREATE POLICY "anon_select_radni_nalozi_dokumenti" ON radni_nalozi_dokumenti FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_radni_nalozi_dokumenti" ON radni_nalozi_dokumenti;
CREATE POLICY "anon_insert_radni_nalozi_dokumenti" ON radni_nalozi_dokumenti FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_radni_nalozi_dokumenti" ON radni_nalozi_dokumenti;
CREATE POLICY "anon_delete_radni_nalozi_dokumenti" ON radni_nalozi_dokumenti FOR DELETE TO anon, authenticated USING (true);

NOTIFY pgrst, 'reload schema';
