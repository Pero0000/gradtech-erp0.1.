-- Podgrupe vrsta radova, opcionalni prikaz popusta i prijenos porezne obveze na ponudi
ALTER TABLE stavke ADD COLUMN IF NOT EXISTS podgrupa text;
ALTER TABLE ponude_stavke ADD COLUMN IF NOT EXISTS vrsta_posla text;
ALTER TABLE ponude_stavke ADD COLUMN IF NOT EXISTS podgrupa text;
ALTER TABLE ponude ADD COLUMN IF NOT EXISTS prikazi_popust boolean NOT NULL DEFAULT true;
ALTER TABLE ponude ADD COLUMN IF NOT EXISTS prijenos_porezne_obveze boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
