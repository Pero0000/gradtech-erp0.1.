-- Dodatne cijene radnika (po danu / po satu) i bonusi
ALTER TABLE radnici ADD COLUMN IF NOT EXISTS cijena_praznik numeric NOT NULL DEFAULT 0;
ALTER TABLE radnici ADD COLUMN IF NOT EXISTS cijena_godisnji numeric NOT NULL DEFAULT 0;
ALTER TABLE radnici ADD COLUMN IF NOT EXISTS cijena_bolovanje numeric NOT NULL DEFAULT 0;
ALTER TABLE radnici ADD COLUMN IF NOT EXISTS cijena_put_sat numeric NOT NULL DEFAULT 0;
-- [{ "naziv": "...", "iznos": 0, "tip": "pausalno" | "komad" | "dan" | "sat" }, ...] (3 rubrike)
ALTER TABLE radnici ADD COLUMN IF NOT EXISTS bonusi jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Dokumenti radnika s rokom valjanosti (liječnički, atesti, zaštita na radu...)
CREATE TABLE IF NOT EXISTS radnici_dokumenti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radnik_id uuid NOT NULL REFERENCES radnici(id) ON DELETE CASCADE,
  vrsta text NOT NULL DEFAULT 'ostalo',
  naziv text NOT NULL,
  putanja text,
  datum_od date,
  datum_do date,
  napomena text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_radnici_dokumenti_radnik ON radnici_dokumenti(radnik_id);
CREATE INDEX IF NOT EXISTS idx_radnici_dokumenti_do ON radnici_dokumenti(datum_do);

ALTER TABLE radnici_dokumenti ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_radnici_dokumenti" ON radnici_dokumenti;
CREATE POLICY "anon_select_radnici_dokumenti" ON radnici_dokumenti FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_radnici_dokumenti" ON radnici_dokumenti;
CREATE POLICY "anon_insert_radnici_dokumenti" ON radnici_dokumenti FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_radnici_dokumenti" ON radnici_dokumenti;
CREATE POLICY "anon_update_radnici_dokumenti" ON radnici_dokumenti FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_radnici_dokumenti" ON radnici_dokumenti;
CREATE POLICY "anon_delete_radnici_dokumenti" ON radnici_dokumenti FOR DELETE TO anon, authenticated USING (true);

NOTIFY pgrst, 'reload schema';
