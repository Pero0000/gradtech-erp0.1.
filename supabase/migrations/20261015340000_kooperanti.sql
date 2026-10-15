-- Baza kooperanata i povezivanje troškova s kooperantom
CREATE TABLE IF NOT EXISTS kooperanti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naziv text NOT NULL,
  djelatnost text,
  oib text,
  iban text,
  adresa text,
  mjesto text,
  postanski_broj text,
  kontakt_osoba text,
  telefon text,
  email text,
  web text,
  napomena text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kooperanti_naziv ON kooperanti(naziv);

ALTER TABLE kooperanti ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_kooperanti" ON kooperanti;
CREATE POLICY "anon_select_kooperanti" ON kooperanti FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_kooperanti" ON kooperanti;
CREATE POLICY "anon_insert_kooperanti" ON kooperanti FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_kooperanti" ON kooperanti;
CREATE POLICY "anon_update_kooperanti" ON kooperanti FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_kooperanti" ON kooperanti;
CREATE POLICY "anon_delete_kooperanti" ON kooperanti FOR DELETE TO anon, authenticated USING (true);

ALTER TABLE troskovi ADD COLUMN IF NOT EXISTS kooperant_id uuid REFERENCES kooperanti(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_troskovi_kooperant ON troskovi(kooperant_id);

ALTER TABLE troskovi DROP CONSTRAINT IF EXISTS troskovi_kategorija_check;
ALTER TABLE troskovi ADD CONSTRAINT troskovi_kategorija_check
  CHECK (kategorija IN ('materijal', 'gorivo', 'put', 'smjestaj', 'kooperanti', 'place', 'oprema', 'direktni', 'ostalo'));

NOTIFY pgrst, 'reload schema';
