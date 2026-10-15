ALTER TABLE objekti
  ADD COLUMN IF NOT EXISTS adresa text,
  ADD COLUMN IF NOT EXISTS mjesto text,
  ADD COLUMN IF NOT EXISTS postanski_broj text,
  ADD COLUMN IF NOT EXISTS kontakt_osoba text,
  ADD COLUMN IF NOT EXISTS telefon text,
  ADD COLUMN IF NOT EXISTS napomena text;
