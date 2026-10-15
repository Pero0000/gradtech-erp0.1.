ALTER TABLE investitori
  ADD COLUMN IF NOT EXISTS oib text,
  ADD COLUMN IF NOT EXISTS adresa text,
  ADD COLUMN IF NOT EXISTS mjesto text,
  ADD COLUMN IF NOT EXISTS postanski_broj text,
  ADD COLUMN IF NOT EXISTS kontakt_osoba text,
  ADD COLUMN IF NOT EXISTS telefon text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS web text,
  ADD COLUMN IF NOT EXISTS napomena text;

ALTER TABLE objekti
  DROP CONSTRAINT IF EXISTS objekti_investitor_id_fkey;

ALTER TABLE objekti
  ADD CONSTRAINT objekti_investitor_id_fkey
  FOREIGN KEY (investitor_id) REFERENCES investitori(id) ON DELETE RESTRICT;
