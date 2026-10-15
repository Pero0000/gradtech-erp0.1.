/*
# Dodatne tablice: rokovi, fakture, ugovoreni radovi + cijena sata radnicima

1. Nove tablice:
- `rokovi` - ključni rokovi projekta po gradilištu
- `fakture` - izdane fakture po gradilištu
- `ugovoreni_radovi` - ugovoreni radovi po gradilištu (opis, iznos, status)

2. Izmjene:
- `radnici` - novi stupac `cijena_sata` (numeric, default 0) - satnica radnika
- Koristi se za automatsko računanje troška rada u rekapitulaciji

3. Sigurnost:
- RLS omogućen na svim novim tablicama
- Anon + authenticated pristup (single-tenant)
*/

ALTER TABLE radnici ADD COLUMN IF NOT EXISTS cijena_sata numeric(8,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS rokovi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gradiliste_id uuid REFERENCES gradilista(id) ON DELETE CASCADE,
  naziv text NOT NULL,
  datum date NOT NULL,
  status text NOT NULL DEFAULT 'otvoren' CHECK (status IN ('otvoren', 'zavrsen', 'prekoracen')),
  opis text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fakture (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gradiliste_id uuid REFERENCES gradilista(id) ON DELETE CASCADE,
  broj text NOT NULL,
  kupac text,
  iznos numeric(12,2) NOT NULL DEFAULT 0,
  datum_izdavanja date NOT NULL DEFAULT CURRENT_DATE,
  datum_dospjecja date,
  status text NOT NULL DEFAULT 'izdana' CHECK (status IN ('izdana', 'placena', 'nep placena')),
  opis text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ugovoreni_radovi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gradiliste_id uuid REFERENCES gradilista(id) ON DELETE CASCADE,
  naziv text NOT NULL,
  opis text,
  ugovoreni_iznos numeric(12,2) NOT NULL DEFAULT 0,
  ostvareni_iznos numeric(12,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'planirano' CHECK (status IN ('planirano', 'u_tijeku', 'zavrseno')),
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rokovi_gradiliste ON rokovi(gradiliste_id);
CREATE INDEX IF NOT EXISTS idx_rokovi_datum ON rokovi(datum);
CREATE INDEX IF NOT EXISTS idx_fakture_gradiliste ON fakture(gradiliste_id);
CREATE INDEX IF NOT EXISTS idx_fakture_status ON fakture(status);
CREATE INDEX IF NOT EXISTS idx_ugovoreni_radovi_gradiliste ON ugovoreni_radovi(gradiliste_id);

-- RLS
ALTER TABLE rokovi ENABLE ROW LEVEL SECURITY;
ALTER TABLE fakture ENABLE ROW LEVEL SECURITY;
ALTER TABLE ugovoreni_radovi ENABLE ROW LEVEL SECURITY;

-- Policies for rokovi
DROP POLICY IF EXISTS "anon_select_rokovi" ON rokovi;
CREATE POLICY "anon_select_rokovi" ON rokovi FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_rokovi" ON rokovi;
CREATE POLICY "anon_insert_rokovi" ON rokovi FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_rokovi" ON rokovi;
CREATE POLICY "anon_update_rokovi" ON rokovi FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_rokovi" ON rokovi;
CREATE POLICY "anon_delete_rokovi" ON rokovi FOR DELETE TO anon, authenticated USING (true);

-- Policies for fakture
DROP POLICY IF EXISTS "anon_select_fakture" ON fakture;
CREATE POLICY "anon_select_fakture" ON fakture FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_fakture" ON fakture;
CREATE POLICY "anon_insert_fakture" ON fakture FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_fakture" ON fakture;
CREATE POLICY "anon_update_fakture" ON fakture FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_fakture" ON fakture;
CREATE POLICY "anon_delete_fakture" ON fakture FOR DELETE TO anon, authenticated USING (true);

-- Policies for ugovoreni_radovi
DROP POLICY IF EXISTS "anon_select_ugovoreni_radovi" ON ugovoreni_radovi;
CREATE POLICY "anon_select_ugovoreni_radovi" ON ugovoreni_radovi FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_ugovoreni_radovi" ON ugovoreni_radovi;
CREATE POLICY "anon_insert_ugovoreni_radovi" ON ugovoreni_radovi FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_ugovoreni_radovi" ON ugovoreni_radovi;
CREATE POLICY "anon_update_ugovoreni_radovi" ON ugovoreni_radovi FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_ugovoreni_radovi" ON ugovoreni_radovi;
CREATE POLICY "anon_delete_ugovoreni_radovi" ON ugovoreni_radovi FOR DELETE TO anon, authenticated USING (true);