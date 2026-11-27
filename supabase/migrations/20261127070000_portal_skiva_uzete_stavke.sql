CREATE OR REPLACE FUNCTION public.sync_material_tool_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tip IN ('materijal', 'alat') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.gotovo := COALESCE(NEW.gotovo, false) OR COALESCE(NEW.uzeto, false);
    ELSIF NEW.gotovo IS DISTINCT FROM OLD.gotovo OR NEW.uzeto IS DISTINCT FROM OLD.uzeto THEN
      NEW.gotovo := COALESCE(NEW.gotovo, false) OR COALESCE(NEW.uzeto, false);
    END IF;
    NEW.uzeto := NEW.gotovo;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_material_tool_completion ON public.radni_nalozi_stavke;
CREATE TRIGGER sync_material_tool_completion
  BEFORE INSERT OR UPDATE OF gotovo, uzeto ON public.radni_nalozi_stavke
  FOR EACH ROW EXECUTE FUNCTION public.sync_material_tool_completion();

UPDATE public.radni_nalozi_stavke
SET gotovo = true,
    uzeto = true
WHERE tip IN ('materijal', 'alat')
  AND (gotovo OR uzeto)
  AND (NOT gotovo OR NOT uzeto);

ALTER TABLE public.radni_nalozi_stavke
  DROP CONSTRAINT IF EXISTS radni_nalozi_stavke_materijal_alat_completion_check;

ALTER TABLE public.radni_nalozi_stavke
  ADD CONSTRAINT radni_nalozi_stavke_materijal_alat_completion_check
  CHECK (
    tip NOT IN ('materijal', 'alat')
    OR gotovo = uzeto
  );

NOTIFY pgrst, 'reload schema';
