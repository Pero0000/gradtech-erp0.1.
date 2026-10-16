ALTER TABLE ugovoreni_radovi
  ADD COLUMN IF NOT EXISTS opis text;

NOTIFY pgrst, 'reload schema';
