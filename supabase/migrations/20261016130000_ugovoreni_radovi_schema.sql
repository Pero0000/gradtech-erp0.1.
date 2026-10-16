ALTER TABLE ugovoreni_radovi
  ADD COLUMN IF NOT EXISTS gradiliste_id uuid REFERENCES gradilista(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS naziv text,
  ADD COLUMN IF NOT EXISTS opis text,
  ADD COLUMN IF NOT EXISTS ugovoreni_iznos numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ostvareni_iznos numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planirano',
  ADD COLUMN IF NOT EXISTS vrsta text NOT NULL DEFAULT 'ugovoreni',
  ADD COLUMN IF NOT EXISTS ponuda_id uuid REFERENCES ponude(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dokument_putanja text,
  ADD COLUMN IF NOT EXISTS dokument_naziv text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

UPDATE ugovoreni_radovi
SET naziv = 'Ugovoreni rad'
WHERE naziv IS NULL;

ALTER TABLE ugovoreni_radovi
  ALTER COLUMN naziv SET NOT NULL;

NOTIFY pgrst, 'reload schema';
