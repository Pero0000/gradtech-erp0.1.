ALTER TABLE radni_nalozi
  ADD COLUMN IF NOT EXISTS km_pocetak integer,
  ADD COLUMN IF NOT EXISTS km_kraj integer,
  ADD COLUMN IF NOT EXISTS materijal_dalje text,
  ADD COLUMN IF NOT EXISTS alat_dalje text;

ALTER TABLE radni_nalozi_radnici
  ADD COLUMN IF NOT EXISTS vrijeme_od time,
  ADD COLUMN IF NOT EXISTS vrijeme_do time;

DROP POLICY IF EXISTS "anon_update_radni_nalozi_radnici" ON radni_nalozi_radnici;
CREATE POLICY "anon_update_radni_nalozi_radnici" ON radni_nalozi_radnici FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS radni_nalozi_foto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nalog_id uuid NOT NULL REFERENCES radni_nalozi(id) ON DELETE CASCADE,
  putanja text NOT NULL,
  naziv text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_radni_nalozi_foto_nalog ON radni_nalozi_foto(nalog_id);

ALTER TABLE radni_nalozi_foto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_radni_nalozi_foto" ON radni_nalozi_foto;
CREATE POLICY "anon_select_radni_nalozi_foto" ON radni_nalozi_foto FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_radni_nalozi_foto" ON radni_nalozi_foto;
CREATE POLICY "anon_insert_radni_nalozi_foto" ON radni_nalozi_foto FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_radni_nalozi_foto" ON radni_nalozi_foto;
CREATE POLICY "anon_delete_radni_nalozi_foto" ON radni_nalozi_foto FOR DELETE TO anon, authenticated USING (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('nalozi-foto', 'nalozi-foto', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "nalozi_foto_select" ON storage.objects;
CREATE POLICY "nalozi_foto_select" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'nalozi-foto');
DROP POLICY IF EXISTS "nalozi_foto_insert" ON storage.objects;
CREATE POLICY "nalozi_foto_insert" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'nalozi-foto');
DROP POLICY IF EXISTS "nalozi_foto_delete" ON storage.objects;
CREATE POLICY "nalozi_foto_delete" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'nalozi-foto');

NOTIFY pgrst, 'reload schema';
