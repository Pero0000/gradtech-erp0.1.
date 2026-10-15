/*
# Dodatne tablice: troškovi, radno vrijeme, radni nalozi

1. Nove tablice:
- `troskovi` - troškovi po gradilištu (materijal, gorivo, plaće, ostalo)
- `radno_vrijeme` - evidencija radnog vremena radnika po gradilištu i datumu
- `radni_nalozi` - radni nalozi s statusom, opisom, dodijeljenim radnicima

2. Relacije:
- troskovi.gradiliste_id → gradilista.id
- radno_vrijeme.gradiliste_id → gradilista.id
- radno_vrijeme.radnik_id → radnici.id
- radni_nalozi.gradiliste_id → gradilista.id
- radni_nalozi_radnici (spojevi) → radni_nalozi + radnici

3. Sigurnost:
- RLS omogućen na svim novim tablicama
- Anon + authenticated pristup (single-tenant)
*/

CREATE TABLE IF NOT EXISTS troskovi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gradiliste_id uuid REFERENCES gradilista(id) ON DELETE CASCADE,
  kategorija text NOT NULL DEFAULT 'materijal' CHECK (kategorija IN ('materijal', 'gorivo', 'place', 'oprema', 'ostalo')),
  opis text NOT NULL,
  iznos numeric(12,2) NOT NULL DEFAULT 0,
  datum date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radno_vrijeme (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radnik_id uuid REFERENCES radnici(id) ON DELETE CASCADE,
  gradiliste_id uuid REFERENCES gradilista(id) ON DELETE CASCADE,
  datum date NOT NULL DEFAULT CURRENT_DATE,
  sati numeric(4,1) NOT NULL DEFAULT 8,
  napomena text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radni_nalozi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broj text UNIQUE NOT NULL,
  gradiliste_id uuid REFERENCES gradilista(id) ON DELETE CASCADE,
  naslov text NOT NULL,
  opis text,
  status text NOT NULL DEFAULT 'otvoren' CHECK (status IN ('otvoren', 'u_tijeku', 'zavrsen', 'otkazan')),
  prioritet text NOT NULL DEFAULT 'srednji' CHECK (prioritet IN ('niski', 'srednji', 'visoki', 'hitno')),
  datum_kreiranja date NOT NULL DEFAULT CURRENT_DATE,
  rok date,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radni_nalozi_radnici (
  nalog_id uuid REFERENCES radni_nalozi(id) ON DELETE CASCADE,
  radnik_id uuid REFERENCES radnici(id) ON DELETE CASCADE,
  PRIMARY KEY (nalog_id, radnik_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_troskovi_gradiliste ON troskovi(gradiliste_id);
CREATE INDEX IF NOT EXISTS idx_troskovi_datum ON troskovi(datum);
CREATE INDEX IF NOT EXISTS idx_troskovi_kategorija ON troskovi(kategorija);
CREATE INDEX IF NOT EXISTS idx_radno_vrijeme_radnik ON radno_vrijeme(radnik_id);
CREATE INDEX IF NOT EXISTS idx_radno_vrijeme_gradiliste ON radno_vrijeme(gradiliste_id);
CREATE INDEX IF NOT EXISTS idx_radno_vrijeme_datum ON radno_vrijeme(datum);
CREATE INDEX IF NOT EXISTS idx_radni_nalozi_gradiliste ON radni_nalozi(gradiliste_id);
CREATE INDEX IF NOT EXISTS idx_radni_nalozi_status ON radni_nalozi(status);
CREATE INDEX IF NOT EXISTS idx_radni_nalozi_broj ON radni_nalozi(broj);

-- RLS
ALTER TABLE troskovi ENABLE ROW LEVEL SECURITY;
ALTER TABLE radno_vrijeme ENABLE ROW LEVEL SECURITY;
ALTER TABLE radni_nalozi ENABLE ROW LEVEL SECURITY;
ALTER TABLE radni_nalozi_radnici ENABLE ROW LEVEL SECURITY;

-- Policies for troskovi
DROP POLICY IF EXISTS "anon_select_troskovi" ON troskovi;
CREATE POLICY "anon_select_troskovi" ON troskovi FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_troskovi" ON troskovi;
CREATE POLICY "anon_insert_troskovi" ON troskovi FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_troskovi" ON troskovi;
CREATE POLICY "anon_update_troskovi" ON troskovi FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_troskovi" ON troskovi;
CREATE POLICY "anon_delete_troskovi" ON troskovi FOR DELETE TO anon, authenticated USING (true);

-- Policies for radno_vrijeme
DROP POLICY IF EXISTS "anon_select_radno_vrijeme" ON radno_vrijeme;
CREATE POLICY "anon_select_radno_vrijeme" ON radno_vrijeme FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_radno_vrijeme" ON radno_vrijeme;
CREATE POLICY "anon_insert_radno_vrijeme" ON radno_vrijeme FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_radno_vrijeme" ON radno_vrijeme;
CREATE POLICY "anon_update_radno_vrijeme" ON radno_vrijeme FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_radno_vrijeme" ON radno_vrijeme;
CREATE POLICY "anon_delete_radno_vrijeme" ON radno_vrijeme FOR DELETE TO anon, authenticated USING (true);

-- Policies for radni_nalozi
DROP POLICY IF EXISTS "anon_select_radni_nalozi" ON radni_nalozi;
CREATE POLICY "anon_select_radni_nalozi" ON radni_nalozi FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_radni_nalozi" ON radni_nalozi;
CREATE POLICY "anon_insert_radni_nalozi" ON radni_nalozi FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_radni_nalozi" ON radni_nalozi;
CREATE POLICY "anon_update_radni_nalozi" ON radni_nalozi FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_radni_nalozi" ON radni_nalozi;
CREATE POLICY "anon_delete_radni_nalozi" ON radni_nalozi FOR DELETE TO anon, authenticated USING (true);

-- Policies for radni_nalozi_radnici
DROP POLICY IF EXISTS "anon_select_radni_nalozi_radnici" ON radni_nalozi_radnici;
CREATE POLICY "anon_select_radni_nalozi_radnici" ON radni_nalozi_radnici FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_radni_nalozi_radnici" ON radni_nalozi_radnici;
CREATE POLICY "anon_insert_radni_nalozi_radnici" ON radni_nalozi_radnici FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_radni_nalozi_radnici" ON radni_nalozi_radnici;
CREATE POLICY "anon_delete_radni_nalozi_radnici" ON radni_nalozi_radnici FOR DELETE TO anon, authenticated USING (true);