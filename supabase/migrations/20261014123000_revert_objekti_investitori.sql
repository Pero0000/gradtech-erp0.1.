ALTER TABLE gradilista
  DROP COLUMN IF EXISTS objekt_id,
  DROP COLUMN IF EXISTS investitor_id,
  DROP COLUMN IF EXISTS objekt,
  DROP COLUMN IF EXISTS investitor,
  DROP COLUMN IF EXISTS voditelj_gradilista,
  DROP COLUMN IF EXISTS ugovorena_vrijednost,
  DROP COLUMN IF EXISTS predvidena_marza,
  DROP COLUMN IF EXISTS stvarni_pocetak,
  DROP COLUMN IF EXISTS stvarni_zavrsetak;

DROP TABLE IF EXISTS objekti;
DROP TABLE IF EXISTS investitori;
