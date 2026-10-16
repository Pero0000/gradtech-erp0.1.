ALTER TABLE ugovoreni_radovi
  ADD COLUMN IF NOT EXISTS vrsta text NOT NULL DEFAULT 'ugovoreni'
    CHECK (vrsta IN ('ugovoreni', 'vtr')),
  ADD COLUMN IF NOT EXISTS ponuda_id uuid REFERENCES ponude(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dokument_putanja text,
  ADD COLUMN IF NOT EXISTS dokument_naziv text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ugovoreni_radovi_ponuda_vtr
  ON ugovoreni_radovi(ponuda_id)
  WHERE ponuda_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
