BEGIN;

-- Stavka mora zadržati vezu s gradilištem i kada se naknadno dodijeli nalogu.
CREATE OR REPLACE FUNCTION public.radni_nalozi_stavke_set_gradiliste()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.gradiliste_id IS NULL AND NEW.nalog_id IS NOT NULL THEN
    SELECT n.gradiliste_id INTO NEW.gradiliste_id
    FROM public.radni_nalozi n
    WHERE n.id = NEW.nalog_id AND n.company_id = NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_radni_nalozi_stavke_gradiliste ON public.radni_nalozi_stavke;
CREATE TRIGGER trg_radni_nalozi_stavke_gradiliste
  BEFORE INSERT OR UPDATE OF nalog_id, gradiliste_id ON public.radni_nalozi_stavke
  FOR EACH ROW EXECUTE FUNCTION public.radni_nalozi_stavke_set_gradiliste();

UPDATE public.radni_nalozi_stavke s
SET gradiliste_id = n.gradiliste_id
FROM public.radni_nalozi n
WHERE s.nalog_id = n.id
  AND s.company_id = n.company_id
  AND s.gradiliste_id IS NULL
  AND n.gradiliste_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;
