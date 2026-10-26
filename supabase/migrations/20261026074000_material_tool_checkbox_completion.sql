BEGIN;

CREATE OR REPLACE FUNCTION public.sync_material_tool_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tip IN ('materijal', 'alat') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.gotovo := COALESCE(NEW.gotovo, false) OR COALESCE(NEW.uzeto, false);
    ELSIF NEW.gotovo IS NOT DISTINCT FROM OLD.gotovo
      AND NEW.uzeto IS DISTINCT FROM OLD.uzeto THEN
      NEW.gotovo := COALESCE(NEW.uzeto, false);
    END IF;
    NEW.uzeto := NEW.gotovo;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_material_tool_completion
  BEFORE INSERT OR UPDATE OF gotovo, uzeto ON public.radni_nalozi_stavke
  FOR EACH ROW EXECUTE FUNCTION public.sync_material_tool_completion();

-- Ranije oznake preuzimanja postaju riješene stavke; čuva se postojeća evidencija.
UPDATE public.radni_nalozi_stavke
SET gotovo = COALESCE(gotovo, false) OR COALESCE(uzeto, false),
    uzeto = COALESCE(gotovo, false) OR COALESCE(uzeto, false)
WHERE tip IN ('materijal', 'alat')
  AND gotovo IS DISTINCT FROM uzeto;

NOTIFY pgrst, 'reload schema';
COMMIT;
