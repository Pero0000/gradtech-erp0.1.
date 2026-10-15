-- Povijest promjena plaća/cijena radnika
CREATE TABLE IF NOT EXISTS radnici_povijest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radnik_id uuid NOT NULL REFERENCES radnici(id) ON DELETE CASCADE,
  polje text NOT NULL,
  stara_vrijednost text,
  nova_vrijednost text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_radnici_povijest_radnik ON radnici_povijest(radnik_id, created_at DESC);

ALTER TABLE radnici_povijest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_radnici_povijest" ON radnici_povijest;
CREATE POLICY "anon_select_radnici_povijest" ON radnici_povijest FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_radnici_povijest" ON radnici_povijest;
CREATE POLICY "anon_insert_radnici_povijest" ON radnici_povijest FOR INSERT TO anon, authenticated WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
