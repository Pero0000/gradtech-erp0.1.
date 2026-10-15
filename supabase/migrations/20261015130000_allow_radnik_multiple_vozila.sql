ALTER TABLE dnevni_raspored_radnici
  DROP CONSTRAINT IF EXISTS dnevni_raspored_radnici_datum_radnik_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dnevni_raspored_radnici_datum_vozilo_radnik
  ON dnevni_raspored_radnici (datum, vozilo_id, radnik_id);
