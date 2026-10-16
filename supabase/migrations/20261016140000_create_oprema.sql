CREATE TABLE IF NOT EXISTS oprema (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kategorija text NOT NULL CHECK (kategorija IN ('alat', 'stroj')),
  naziv text NOT NULL,
  marka text,
  model text,
  inventarski_broj text,
  serijski_broj text,
  status text NOT NULL DEFAULT 'slobodno' CHECK (status IN ('slobodno', 'na_gradilistu', 'servis', 'neaktivno')),
  stanje text NOT NULL DEFAULT 'dobro' CHECK (stanje IN ('novo', 'dobro', 'osteceno')),
  gradiliste_id uuid REFERENCES gradilista(id) ON DELETE SET NULL,
  kolicina numeric(10,2) NOT NULL DEFAULT 1 CHECK (kolicina > 0),
  datum_nabave date,
  nabavna_vrijednost numeric(12,2) NOT NULL DEFAULT 0,
  radni_sati numeric(12,2) NOT NULL DEFAULT 0,
  servisni_interval_sati numeric(12,2),
  servis_upozorenje_sati numeric(12,2) NOT NULL DEFAULT 20,
  napomena text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oprema_kategorija ON oprema(kategorija);
CREATE INDEX IF NOT EXISTS idx_oprema_gradiliste ON oprema(gradiliste_id);

CREATE TABLE IF NOT EXISTS oprema_dokumenti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oprema_id uuid NOT NULL REFERENCES oprema(id) ON DELETE CASCADE,
  vrsta text NOT NULL DEFAULT 'dokument' CHECK (vrsta IN ('servis', 'atest', 'dokument', 'ostalo')),
  naziv text NOT NULL,
  putanja text,
  datum_od date,
  datum_do date,
  radni_sati numeric(12,2),
  iznos numeric(12,2),
  napomena text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oprema_dokumenti_oprema ON oprema_dokumenti(oprema_id);
CREATE INDEX IF NOT EXISTS idx_oprema_dokumenti_rok ON oprema_dokumenti(datum_do);

ALTER TABLE oprema ENABLE ROW LEVEL SECURITY;
ALTER TABLE oprema_dokumenti ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_oprema" ON oprema;
CREATE POLICY "anon_select_oprema" ON oprema FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_oprema" ON oprema;
CREATE POLICY "anon_insert_oprema" ON oprema FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_oprema" ON oprema;
CREATE POLICY "anon_update_oprema" ON oprema FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_oprema" ON oprema;
CREATE POLICY "anon_delete_oprema" ON oprema FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_oprema_dokumenti" ON oprema_dokumenti;
CREATE POLICY "anon_select_oprema_dokumenti" ON oprema_dokumenti FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_oprema_dokumenti" ON oprema_dokumenti;
CREATE POLICY "anon_insert_oprema_dokumenti" ON oprema_dokumenti FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_oprema_dokumenti" ON oprema_dokumenti;
CREATE POLICY "anon_update_oprema_dokumenti" ON oprema_dokumenti FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_oprema_dokumenti" ON oprema_dokumenti;
CREATE POLICY "anon_delete_oprema_dokumenti" ON oprema_dokumenti FOR DELETE TO anon, authenticated USING (true);

NOTIFY pgrst, 'reload schema';
