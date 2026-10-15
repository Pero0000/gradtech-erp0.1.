-- ENC oznaka vozila i dokumenti/servisi vozila s rokovima
ALTER TABLE vozila ADD COLUMN IF NOT EXISTS enc_broj text;

CREATE TABLE IF NOT EXISTS vozila_dokumenti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vozilo_id uuid NOT NULL REFERENCES vozila(id) ON DELETE CASCADE,
  vrsta text NOT NULL DEFAULT 'ostalo',
  naziv text NOT NULL,
  putanja text,
  datum_od date,
  datum_do date,
  iznos numeric,
  km integer,
  napomena text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vozila_dokumenti_vozilo ON vozila_dokumenti(vozilo_id);
CREATE INDEX IF NOT EXISTS idx_vozila_dokumenti_do ON vozila_dokumenti(datum_do);

ALTER TABLE vozila_dokumenti ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_vozila_dokumenti" ON vozila_dokumenti;
CREATE POLICY "anon_select_vozila_dokumenti" ON vozila_dokumenti FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_vozila_dokumenti" ON vozila_dokumenti;
CREATE POLICY "anon_insert_vozila_dokumenti" ON vozila_dokumenti FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_vozila_dokumenti" ON vozila_dokumenti;
CREATE POLICY "anon_update_vozila_dokumenti" ON vozila_dokumenti FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_vozila_dokumenti" ON vozila_dokumenti;
CREATE POLICY "anon_delete_vozila_dokumenti" ON vozila_dokumenti FOR DELETE TO anon, authenticated USING (true);

NOTIFY pgrst, 'reload schema';
