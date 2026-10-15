-- Baza troškovničkih stavki (za buduće ponude)
CREATE TABLE IF NOT EXISTS stavke (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sifra text,
  naziv text NOT NULL,
  vrsta_posla text,
  jedinica text NOT NULL DEFAULT 'm2',
  cijena numeric NOT NULL DEFAULT 0,
  opis text,
  cijena_promijenjena_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stavke_cijene_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stavka_id uuid NOT NULL REFERENCES stavke(id) ON DELETE CASCADE,
  stara_cijena numeric,
  nova_cijena numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gradiliste_stavke (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gradiliste_id uuid NOT NULL REFERENCES gradilista(id) ON DELETE CASCADE,
  stavka_id uuid NOT NULL REFERENCES stavke(id) ON DELETE CASCADE,
  kolicina numeric NOT NULL DEFAULT 1,
  cijena numeric NOT NULL DEFAULT 0,
  napomena text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stavke_log_stavka ON stavke_cijene_log(stavka_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gradiliste_stavke_stavka ON gradiliste_stavke(stavka_id);
CREATE INDEX IF NOT EXISTS idx_gradiliste_stavke_gradiliste ON gradiliste_stavke(gradiliste_id);

ALTER TABLE stavke ENABLE ROW LEVEL SECURITY;
ALTER TABLE stavke_cijene_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE gradiliste_stavke ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stavke', 'stavke_cijene_log', 'gradiliste_stavke'] LOOP
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
