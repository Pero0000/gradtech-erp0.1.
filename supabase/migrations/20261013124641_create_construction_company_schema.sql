/*
# Schema za građevinsku firmu

1. Nove tablice:
- `gradilista` (gradilišta) - naziv, adresa, status, datum početka, datum završetka, opis
- `radnici` (radnici) - ime, prezime, uloga, telefon, email, status (aktivan/neaktivan)
- `vozila` (vozila) - registracija, marka, model, tip, status (slobodno/zauzeto/servis)
- `raspored` (dnevni raspored) - datum, gradilište, radnici (veza), vozila (veza), napomena

2. Relacije:
- raspored.gradiliste_id → gradilista.id
- raspored_radnici (spojna tablica) → radnici + raspored
- raspored_vozila (spojna tablica) → vozila + raspored

3. Sigurnost:
- RLS omogućen na svim tablicama
- Anon + authenticated pristup (nema prijave, single-tenant aplikacija)
*/

CREATE TABLE IF NOT EXISTS gradilista (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naziv text NOT NULL,
  adresa text,
  status text NOT NULL DEFAULT 'aktivno' CHECK (status IN ('planirano', 'aktivno', 'pauzirano', 'zavrseno')),
  datum_pocetka date,
  datum_zavrsetka date,
  proracun numeric(12,2) DEFAULT 0,
  opis text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS radnici (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ime text NOT NULL,
  prezime text NOT NULL,
  uloga text NOT NULL DEFAULT 'radnik',
  telefon text,
  email text,
  status text NOT NULL DEFAULT 'aktivan' CHECK (status IN ('aktivan', 'neaktivan', 'bolovanje')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vozila (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registracija text UNIQUE NOT NULL,
  marka text NOT NULL,
  model text,
  tip text NOT NULL DEFAULT 'teretno' CHECK (tip IN ('teretno', 'dostavno', 'radno', 'putnicko')),
  status text NOT NULL DEFAULT 'slobodno' CHECK (status IN ('slobodno', 'zauzeto', 'servis')),
  kilometraza integer DEFAULT 0,
  godina_proizvodnje integer,
  napomena text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raspored (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  datum date NOT NULL,
  gradiliste_id uuid REFERENCES gradilista(id) ON DELETE CASCADE,
  napomena text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raspored_radnici (
  raspored_id uuid REFERENCES raspored(id) ON DELETE CASCADE,
  radnik_id uuid REFERENCES radnici(id) ON DELETE CASCADE,
  PRIMARY KEY (raspored_id, radnik_id)
);

CREATE TABLE IF NOT EXISTS raspored_vozila (
  raspored_id uuid REFERENCES raspored(id) ON DELETE CASCADE,
  vozilo_id uuid REFERENCES vozila(id) ON DELETE CASCADE,
  PRIMARY KEY (raspored_id, vozilo_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_raspored_datum ON raspored(datum);
CREATE INDEX IF NOT EXISTS idx_raspored_gradiliste ON raspored(gradiliste_id);
CREATE INDEX IF NOT EXISTS idx_gradilista_status ON gradilista(status);
CREATE INDEX IF NOT EXISTS idx_radnici_status ON radnici(status);
CREATE INDEX IF NOT EXISTS idx_vozila_status ON vozila(status);

-- RLS
ALTER TABLE gradilista ENABLE ROW LEVEL SECURITY;
ALTER TABLE radnici ENABLE ROW LEVEL SECURITY;
ALTER TABLE vozila ENABLE ROW LEVEL SECURITY;
ALTER TABLE raspored ENABLE ROW LEVEL SECURITY;
ALTER TABLE raspored_radnici ENABLE ROW LEVEL SECURITY;
ALTER TABLE raspored_vozila ENABLE ROW LEVEL SECURITY;

-- Policies for gradilista
DROP POLICY IF EXISTS "anon_select_gradilista" ON gradilista;
CREATE POLICY "anon_select_gradilista" ON gradilista FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_gradilista" ON gradilista;
CREATE POLICY "anon_insert_gradilista" ON gradilista FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_gradilista" ON gradilista;
CREATE POLICY "anon_update_gradilista" ON gradilista FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_gradilista" ON gradilista;
CREATE POLICY "anon_delete_gradilista" ON gradilista FOR DELETE TO anon, authenticated USING (true);

-- Policies for radnici
DROP POLICY IF EXISTS "anon_select_radnici" ON radnici;
CREATE POLICY "anon_select_radnici" ON radnici FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_radnici" ON radnici;
CREATE POLICY "anon_insert_radnici" ON radnici FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_radnici" ON radnici;
CREATE POLICY "anon_update_radnici" ON radnici FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_radnici" ON radnici;
CREATE POLICY "anon_delete_radnici" ON radnici FOR DELETE TO anon, authenticated USING (true);

-- Policies for vozila
DROP POLICY IF EXISTS "anon_select_vozila" ON vozila;
CREATE POLICY "anon_select_vozila" ON vozila FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_vozila" ON vozila;
CREATE POLICY "anon_insert_vozila" ON vozila FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_vozila" ON vozila;
CREATE POLICY "anon_update_vozila" ON vozila FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_vozila" ON vozila;
CREATE POLICY "anon_delete_vozila" ON vozila FOR DELETE TO anon, authenticated USING (true);

-- Policies for raspored
DROP POLICY IF EXISTS "anon_select_raspored" ON raspored;
CREATE POLICY "anon_select_raspored" ON raspored FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_raspored" ON raspored;
CREATE POLICY "anon_insert_raspored" ON raspored FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_raspored" ON raspored;
CREATE POLICY "anon_update_raspored" ON raspored FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_raspored" ON raspored;
CREATE POLICY "anon_delete_raspored" ON raspored FOR DELETE TO anon, authenticated USING (true);

-- Policies for raspored_radnici
DROP POLICY IF EXISTS "anon_select_raspored_radnici" ON raspored_radnici;
CREATE POLICY "anon_select_raspored_radnici" ON raspored_radnici FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_raspored_radnici" ON raspored_radnici;
CREATE POLICY "anon_insert_raspored_radnici" ON raspored_radnici FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_raspored_radnici" ON raspored_radnici;
CREATE POLICY "anon_delete_raspored_radnici" ON raspored_radnici FOR DELETE TO anon, authenticated USING (true);

-- Policies for raspored_vozila
DROP POLICY IF EXISTS "anon_select_raspored_vozila" ON raspored_vozila;
CREATE POLICY "anon_select_raspored_vozila" ON raspored_vozila FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_raspored_vozila" ON raspored_vozila;
CREATE POLICY "anon_insert_raspored_vozila" ON raspored_vozila FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_raspored_vozila" ON raspored_vozila;
CREATE POLICY "anon_delete_raspored_vozila" ON raspored_vozila FOR DELETE TO anon, authenticated USING (true);