CREATE OR REPLACE FUNCTION private.guard_work_order_team_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  target_order_id uuid;
  order_status text;
  mobile_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.nalog_id IS NOT DISTINCT FROM NEW.nalog_id
    AND OLD.radnik_id IS NOT DISTINCT FROM NEW.radnik_id THEN
    RETURN NEW;
  END IF;
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  target_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.nalog_id ELSE NEW.nalog_id END;
  SELECT n.status, n.mobile_status INTO order_status, mobile_status
    FROM public.radni_nalozi n WHERE n.id = target_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF order_status IN ('u_tijeku', 'zavrsen', 'otkazan')
    OR mobile_status IN ('u_tijeku', 'predan', 'odobren')
    OR EXISTS (SELECT 1 FROM public.radni_nalozi_radnici assignment
      WHERE assignment.nalog_id = target_order_id
        AND (assignment.mobile_started_at IS NOT NULL OR assignment.mobile_finished_at IS NOT NULL))
    OR EXISTS (SELECT 1 FROM public.radno_vrijeme hours WHERE hours.nalog_id = target_order_id) THEN
    RAISE EXCEPTION 'Ekipa se ne može mijenjati nakon početka rada ili evidentiranja sati. Najprije uskladite izvršenje naloga.'
      USING ERRCODE = '40001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS guard_work_order_team_insert ON public.radni_nalozi_radnici;
DROP TRIGGER IF EXISTS guard_work_order_team_delete ON public.radni_nalozi_radnici;
DROP TRIGGER IF EXISTS guard_work_order_team_membership_update ON public.radni_nalozi_radnici;

CREATE TRIGGER guard_work_order_team_insert
  BEFORE INSERT ON public.radni_nalozi_radnici
  FOR EACH ROW EXECUTE FUNCTION private.guard_work_order_team_membership();
CREATE TRIGGER guard_work_order_team_delete
  BEFORE DELETE ON public.radni_nalozi_radnici
  FOR EACH ROW EXECUTE FUNCTION private.guard_work_order_team_membership();
CREATE TRIGGER guard_work_order_team_membership_update
  BEFORE UPDATE OF nalog_id, radnik_id ON public.radni_nalozi_radnici
  FOR EACH ROW EXECUTE FUNCTION private.guard_work_order_team_membership();
REVOKE ALL ON FUNCTION private.guard_work_order_team_membership() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
