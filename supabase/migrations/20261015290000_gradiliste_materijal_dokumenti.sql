-- Materijal i alat vezan uz gradilište (nalog_id je prazan dok stavka čeka idući radni nalog)
ALTER TABLE radni_nalozi_stavke ALTER COLUMN nalog_id DROP NOT NULL;
ALTER TABLE radni_nalozi_stavke ADD COLUMN IF NOT EXISTS gradiliste_id uuid REFERENCES gradilista(id) ON DELETE CASCADE;

UPDATE radni_nalozi_stavke s
SET gradiliste_id = n.gradiliste_id
FROM radni_nalozi n
WHERE s.nalog_id = n.id AND s.gradiliste_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_radni_nalozi_stavke_gradiliste ON radni_nalozi_stavke(gradiliste_id);

CREATE OR REPLACE FUNCTION radni_nalozi_stavke_set_gradiliste() RETURNS trigger AS $$
BEGIN
  IF NEW.gradiliste_id IS NULL AND NEW.nalog_id IS NOT NULL THEN
    SELECT gradiliste_id INTO NEW.gradiliste_id FROM radni_nalozi WHERE id = NEW.nalog_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_radni_nalozi_stavke_gradiliste ON radni_nalozi_stavke;
CREATE TRIGGER trg_radni_nalozi_stavke_gradiliste
  BEFORE INSERT ON radni_nalozi_stavke
  FOR EACH ROW EXECUTE FUNCTION radni_nalozi_stavke_set_gradiliste();

-- Dokumenti i slike gradilišta
CREATE TABLE IF NOT EXISTS gradiliste_dokumenti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gradiliste_id uuid NOT NULL REFERENCES gradilista(id) ON DELETE CASCADE,
  vrsta text NOT NULL DEFAULT 'dokument' CHECK (vrsta IN ('dokument', 'slika')),
  putanja text NOT NULL,
  naziv text NOT NULL,
  velicina bigint,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gradiliste_dokumenti_gradiliste ON gradiliste_dokumenti(gradiliste_id);

ALTER TABLE gradiliste_dokumenti ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_gradiliste_dokumenti" ON gradiliste_dokumenti;
CREATE POLICY "anon_select_gradiliste_dokumenti" ON gradiliste_dokumenti FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_gradiliste_dokumenti" ON gradiliste_dokumenti;
CREATE POLICY "anon_insert_gradiliste_dokumenti" ON gradiliste_dokumenti FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_gradiliste_dokumenti" ON gradiliste_dokumenti;
CREATE POLICY "anon_delete_gradiliste_dokumenti" ON gradiliste_dokumenti FOR DELETE TO anon, authenticated USING (true);

NOTIFY pgrst, 'reload schema';
