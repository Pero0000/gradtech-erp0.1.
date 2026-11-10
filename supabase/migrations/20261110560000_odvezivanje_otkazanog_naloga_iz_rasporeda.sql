CREATE OR REPLACE FUNCTION private.detach_cancelled_work_order_from_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF NEW.status = 'otkazan' AND OLD.status IS DISTINCT FROM 'otkazan' THEN
    UPDATE public.dnevni_raspored_gradilista
    SET nalog_id = NULL
    WHERE nalog_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER detach_cancelled_work_order_from_schedule
  AFTER UPDATE OF status ON public.radni_nalozi
  FOR EACH ROW
  EXECUTE FUNCTION private.detach_cancelled_work_order_from_schedule();

REVOKE ALL ON FUNCTION private.detach_cancelled_work_order_from_schedule() FROM PUBLIC, anon, authenticated;
