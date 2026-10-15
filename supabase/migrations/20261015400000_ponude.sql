-- Ponude (troškovnici) sa stavkama; potvrđena ponuda se može pretvoriti u planirano gradilište
CREATE TABLE IF NOT EXISTS ponude (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  godina integer NOT NULL,
  redni_broj integer NOT NULL,
  naslov text NOT NULL,
  investitor_id uuid REFERENCES investitori(id) ON DELETE SET NULL,
  objekt_id uuid REFERENCES objekti(id) ON DELETE SET NULL,
  adresa_radova text,
  datum date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'nepotvrdena' CHECK (status IN ('nepotvrdena', 'potvrdena', 'odbijena')),
  popust numeric NOT NULL DEFAULT 0,
  pdv numeric NOT NULL DEFAULT 25,
  napomene text,
  gradiliste_id uuid REFERENCES gradilista(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (godina, redni_broj)
);

CREATE TABLE IF NOT EXISTS ponude_stavke (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ponuda_id uuid NOT NULL REFERENCES ponude(id) ON DELETE CASCADE,
  stavka_id uuid REFERENCES stavke(id) ON DELETE SET NULL,
  redoslijed integer NOT NULL DEFAULT 0,
  opis text NOT NULL,
  jedinica text NOT NULL DEFAULT 'm2',
  kolicina numeric NOT NULL DEFAULT 1,
  cijena numeric NOT NULL DEFAULT 0,
  popust numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ponude_stavke_ponuda ON ponude_stavke(ponuda_id, redoslijed);
CREATE INDEX IF NOT EXISTS idx_ponude_stavke_stavka ON ponude_stavke(stavka_id);

ALTER TABLE ponude ENABLE ROW LEVEL SECURITY;
ALTER TABLE ponude_stavke ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ponude', 'ponude_stavke'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "anon_select_%1$s" ON %1$s', t);
    EXECUTE format('CREATE POLICY "anon_select_%1$s" ON %1$s FOR SELECT TO anon, authenticated USING (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "anon_insert_%1$s" ON %1$s', t);
    EXECUTE format('CREATE POLICY "anon_insert_%1$s" ON %1$s FOR INSERT TO anon, authenticated WITH CHECK (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "anon_update_%1$s" ON %1$s', t);
    EXECUTE format('CREATE POLICY "anon_update_%1$s" ON %1$s FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "anon_delete_%1$s" ON %1$s', t);
    EXECUTE format('CREATE POLICY "anon_delete_%1$s" ON %1$s FOR DELETE TO anon, authenticated USING (true)', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
