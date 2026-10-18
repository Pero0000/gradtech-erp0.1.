ALTER TABLE public.radni_nalozi
  ADD COLUMN IF NOT EXISTS vozac_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'radni_nalozi_vozac_assignment_fk'
      AND conrelid = 'public.radni_nalozi'::regclass
  ) THEN
    ALTER TABLE public.radni_nalozi
      DROP CONSTRAINT radni_nalozi_vozac_assignment_fk;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'radni_nalozi_vozac_id_fkey'
      AND conrelid = 'public.radni_nalozi'::regclass
  ) THEN
    ALTER TABLE public.radni_nalozi
      ADD CONSTRAINT radni_nalozi_vozac_id_fkey
      FOREIGN KEY (vozac_id)
      REFERENCES public.radnici (id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_work_order_driver_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.vozac_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.radni_nalozi_radnici assignment
       WHERE assignment.nalog_id = NEW.id
         AND assignment.radnik_id = NEW.vozac_id
     ) THEN
    RAISE EXCEPTION 'Vozač mora biti djelatnik dodijeljen radnom nalogu.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_work_order_driver_assignment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS validate_work_order_driver_assignment ON public.radni_nalozi;
CREATE TRIGGER validate_work_order_driver_assignment
  BEFORE INSERT OR UPDATE OF vozac_id ON public.radni_nalozi
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_work_order_driver_assignment();

CREATE OR REPLACE FUNCTION public.clear_work_order_driver_on_unassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.radni_nalozi
  SET vozac_id = NULL
  WHERE id = OLD.nalog_id
    AND vozac_id = OLD.radnik_id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_work_order_driver_on_unassignment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clear_work_order_driver_on_unassignment
  ON public.radni_nalozi_radnici;
CREATE TRIGGER clear_work_order_driver_on_unassignment
  BEFORE DELETE ON public.radni_nalozi_radnici
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_work_order_driver_on_unassignment();

CREATE OR REPLACE FUNCTION public.mobile_set_nalog_vozac(
  p_nalog_id uuid,
  p_vozac_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dodijeljen prijavljenom djelatniku ili se više ne može uređivati.';
  END IF;

  IF p_vozac_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.radni_nalozi_radnici assignment
       WHERE assignment.nalog_id = p_nalog_id
         AND assignment.radnik_id = p_vozac_id
     ) THEN
    RAISE EXCEPTION 'Vozač mora biti djelatnik dodijeljen radnom nalogu.';
  END IF;

  UPDATE public.radni_nalozi
  SET vozac_id = p_vozac_id
  WHERE id = p_nalog_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mobile_set_nalog_vozac(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_set_nalog_vozac(uuid, uuid) TO authenticated;
