ALTER TABLE dnevni_raspored_gradilista
  ADD COLUMN IF NOT EXISTS iz_ostalo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gradiliste_potvrdeno boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
