ALTER TABLE gradilista
  ADD COLUMN IF NOT EXISTS objekt text,
  ADD COLUMN IF NOT EXISTS investitor text,
  ADD COLUMN IF NOT EXISTS voditelj_gradilista text,
  ADD COLUMN IF NOT EXISTS ugovorena_vrijednost numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS predvidena_marza numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stvarni_pocetak date,
  ADD COLUMN IF NOT EXISTS stvarni_zavrsetak date;
