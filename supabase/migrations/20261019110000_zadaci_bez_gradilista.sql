-- Radni zadaci mogu se upisati izravno na radni nalog, i kad nalog nema gradilište (popis "Ostalo").
ALTER TABLE gradiliste_zadaci
  ALTER COLUMN gradiliste_id DROP NOT NULL;

-- Zadatak bez gradilišta postoji samo uz svoj nalog pa se briše zajedno s nalogom.
CREATE OR REPLACE FUNCTION public.obrisi_zadatke_naloga_bez_gradilista()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.gradiliste_zadaci WHERE nalog_id = OLD.id AND gradiliste_id IS NULL;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_obrisi_zadatke_naloga_bez_gradilista ON radni_nalozi;
CREATE TRIGGER trg_obrisi_zadatke_naloga_bez_gradilista
BEFORE DELETE ON radni_nalozi
FOR EACH ROW EXECUTE FUNCTION public.obrisi_zadatke_naloga_bez_gradilista();

NOTIFY pgrst, 'reload schema';
