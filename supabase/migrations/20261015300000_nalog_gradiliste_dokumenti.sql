-- Dokumenti i slike s radnog naloga spremaju se i na gradilište; na nalogu se biraju koji se prikazuju.
CREATE TABLE IF NOT EXISTS nalog_gradiliste_dokumenti (
  nalog_id uuid NOT NULL REFERENCES radni_nalozi(id) ON DELETE CASCADE,
  dokument_id uuid NOT NULL REFERENCES gradiliste_dokumenti(id) ON DELETE CASCADE,
  PRIMARY KEY (nalog_id, dokument_id)
);

ALTER TABLE nalog_gradiliste_dokumenti ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_nalog_gradiliste_dokumenti" ON nalog_gradiliste_dokumenti;
CREATE POLICY "anon_select_nalog_gradiliste_dokumenti" ON nalog_gradiliste_dokumenti FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_nalog_gradiliste_dokumenti" ON nalog_gradiliste_dokumenti;
CREATE POLICY "anon_insert_nalog_gradiliste_dokumenti" ON nalog_gradiliste_dokumenti FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_nalog_gradiliste_dokumenti" ON nalog_gradiliste_dokumenti;
CREATE POLICY "anon_delete_nalog_gradiliste_dokumenti" ON nalog_gradiliste_dokumenti FOR DELETE TO anon, authenticated USING (true);

-- Postojeći dokumenti i slike s naloga prenose se na gradilište (ista datoteka)
INSERT INTO gradiliste_dokumenti (gradiliste_id, vrsta, putanja, naziv, velicina)
SELECT n.gradiliste_id, 'dokument', d.putanja, d.naziv, d.velicina
FROM radni_nalozi_dokumenti d
JOIN radni_nalozi n ON n.id = d.nalog_id
WHERE n.gradiliste_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM gradiliste_dokumenti g WHERE g.putanja = d.putanja);

INSERT INTO gradiliste_dokumenti (gradiliste_id, vrsta, putanja, naziv)
SELECT n.gradiliste_id, 'slika', f.putanja, COALESCE(f.naziv, 'slika')
FROM radni_nalozi_foto f
JOIN radni_nalozi n ON n.id = f.nalog_id
WHERE n.gradiliste_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM gradiliste_dokumenti g WHERE g.putanja = f.putanja);

NOTIFY pgrst, 'reload schema';
