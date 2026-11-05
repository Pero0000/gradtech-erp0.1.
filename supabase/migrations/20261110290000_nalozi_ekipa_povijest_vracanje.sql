CREATE TABLE IF NOT EXISTS private.work_order_team_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  company_id uuid NOT NULL,
  nalog_id uuid NOT NULL,
  radnik_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'DELETE')),
  before_data jsonb,
  after_data jsonb,
  actor_id uuid,
  actor_name text NOT NULL,
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '30 days',
  reverses_id uuid,
  reversed_at timestamptz,
  reversed_by uuid
);
CREATE INDEX IF NOT EXISTS work_order_team_change_history_order
  ON private.work_order_team_change_history(company_id, nalog_id, sequence DESC);
CREATE INDEX IF NOT EXISTS work_order_team_change_history_worker
  ON private.work_order_team_change_history(company_id, nalog_id, radnik_id, sequence DESC);
ALTER TABLE private.work_order_team_change_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.work_order_team_change_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.work_order_team_change_history_sequence_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.capture_work_order_team_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  row_data jsonb;
  actor text;
BEGIN
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi n
    WHERE n.id = OLD.nalog_id AND n.company_id = OLD.company_id
  ) THEN
    RETURN OLD;
  END IF;
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  SELECT profile.email INTO actor FROM public.app_profiles profile
    WHERE profile.id = auth.uid() AND profile.company_id = (row_data->>'company_id')::uuid;
  INSERT INTO private.work_order_team_change_history(
    company_id, nalog_id, radnik_id, operation, before_data, after_data, actor_id, actor_name
  ) VALUES (
    (row_data->>'company_id')::uuid, (row_data->>'nalog_id')::uuid, (row_data->>'radnik_id')::uuid,
    TG_OP, CASE WHEN TG_OP = 'DELETE' THEN row_data END,
    CASE WHEN TG_OP = 'INSERT' THEN row_data END, auth.uid(), COALESCE(actor, 'Korisnik')
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS work_order_team_change_history ON public.radni_nalozi_radnici;
CREATE TRIGGER work_order_team_change_history
  AFTER INSERT OR DELETE ON public.radni_nalozi_radnici
  FOR EACH ROW EXECUTE FUNCTION private.capture_work_order_team_change();
REVOKE ALL ON FUNCTION private.capture_work_order_team_change() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.work_order_team_change_blocked(p_event private.work_order_team_change_history)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  order_row public.radni_nalozi%ROWTYPE;
  current_assignment jsonb;
  expected_assignment jsonb;
BEGIN
  IF p_event.expires_at <= clock_timestamp() THEN RETURN 'Istekao je rok od 30 dana.'; END IF;
  IF p_event.reversed_at IS NOT NULL OR p_event.reverses_id IS NOT NULL THEN RETURN 'Promjena je već vraćena.'; END IF;
  SELECT * INTO order_row FROM public.radni_nalozi n
    WHERE n.id = p_event.nalog_id AND n.company_id = p_event.company_id;
  IF NOT FOUND THEN RETURN 'Radni nalog nije dostupan. Najprije vratite cijelo brisanje naloga.'; END IF;
  IF order_row.status IN ('u_tijeku', 'zavrsen', 'otkazan')
    OR order_row.mobile_status IN ('u_tijeku', 'predan', 'odobren') THEN
    RETURN 'Nalog je započet ili zaključen; povrat ekipe nije siguran.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.radni_nalozi_radnici assignment
      WHERE assignment.nalog_id = p_event.nalog_id
        AND (assignment.mobile_started_at IS NOT NULL OR assignment.mobile_finished_at IS NOT NULL))
    OR EXISTS (SELECT 1 FROM public.radno_vrijeme hours WHERE hours.nalog_id = p_event.nalog_id) THEN
    RETURN 'Nalog ima početak rada ili evidentirane sate; prvo uskladite izvršenje.';
  END IF;
  IF EXISTS (SELECT 1 FROM private.work_order_team_change_history newer
    WHERE newer.company_id = p_event.company_id AND newer.nalog_id = p_event.nalog_id
      AND newer.radnik_id = p_event.radnik_id AND newer.sequence > p_event.sequence
      AND newer.reversed_at IS NULL AND newer.reverses_id IS NULL) THEN
    RETURN 'Dodjela ima noviju promjenu. Vraćajte najnoviju promjenu prvo.';
  END IF;
  SELECT to_jsonb(assignment) INTO current_assignment FROM public.radni_nalozi_radnici assignment
    WHERE assignment.nalog_id = p_event.nalog_id AND assignment.radnik_id = p_event.radnik_id;
  IF p_event.operation = 'INSERT' THEN
    expected_assignment := p_event.after_data;
    IF current_assignment IS DISTINCT FROM expected_assignment THEN
      RETURN 'Dodjela je naknadno promijenjena ili uklonjena.';
    END IF;
  ELSIF current_assignment IS NOT NULL THEN
    RETURN 'Dodjela je naknadno vraćena ili zamijenjena.';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.work_order_team_change_blocked(private.work_order_team_change_history) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_work_order_team_change_history(p_nalog_id uuid, p_before_sequence bigint DEFAULT NULL)
RETURNS TABLE(
  id uuid, sequence text, operation text, before_data jsonb, after_data jsonb,
  actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, reverses_id uuid, can_restore boolean, blocked_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja radnih naloga.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.radni_nalozi n
    WHERE n.id = p_nalog_id AND n.company_id = public.app_current_company_id()) THEN
    RAISE EXCEPTION 'Radni nalog nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT h.id, h.sequence::text, h.operation, h.before_data, h.after_data,
    h.actor_name, h.created_at, h.expires_at, h.reversed_at, h.reverses_id,
    reason.message IS NULL, reason.message
  FROM private.work_order_team_change_history h
  CROSS JOIN LATERAL (SELECT private.work_order_team_change_blocked(h) message) reason
  WHERE h.company_id = public.app_current_company_id() AND h.nalog_id = p_nalog_id
    AND h.expires_at > now() AND (p_before_sequence IS NULL OR h.sequence < p_before_sequence)
  ORDER BY h.sequence DESC LIMIT 50;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_work_order_team_change(p_history_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  event private.work_order_team_change_history%ROWTYPE;
  order_row public.radni_nalozi%ROWTYPE;
  reason text;
  last_sequence bigint;
  reversal_id uuid;
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja radnih naloga.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO event FROM private.work_order_team_change_history h
    WHERE h.id = p_history_id AND h.company_id = public.app_current_company_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Promjena ekipe nije dostupna u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO order_row FROM public.radni_nalozi n
    WHERE n.id = event.nalog_id AND n.company_id = event.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Radni nalog više nije dostupan.' USING ERRCODE = '40001'; END IF;
  SELECT * INTO event FROM private.work_order_team_change_history h WHERE h.id = p_history_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Promjena ekipe nije dostupna.' USING ERRCODE = '42501'; END IF;
  reason := private.work_order_team_change_blocked(event);
  IF reason IS NOT NULL THEN RAISE EXCEPTION '% Ništa nije vraćeno.', reason USING ERRCODE = '40001'; END IF;
  SELECT COALESCE(max(sequence), 0) INTO last_sequence FROM private.work_order_team_change_history
    WHERE company_id = event.company_id AND nalog_id = event.nalog_id AND radnik_id = event.radnik_id;
  IF event.operation = 'INSERT' THEN
    DELETE FROM public.radni_nalozi_radnici
      WHERE nalog_id = event.nalog_id AND radnik_id = event.radnik_id;
  ELSE
    INSERT INTO public.radni_nalozi_radnici
      SELECT (jsonb_populate_record(NULL::public.radni_nalozi_radnici, event.before_data)).*;
  END IF;
  SELECT h.id INTO reversal_id FROM private.work_order_team_change_history h
    WHERE h.company_id = event.company_id AND h.nalog_id = event.nalog_id AND h.radnik_id = event.radnik_id
      AND h.transaction_id = txid_current() AND h.sequence > last_sequence
      AND h.operation <> event.operation AND h.reverses_id IS NULL
      AND (
        (event.operation = 'INSERT' AND h.before_data IS NOT DISTINCT FROM event.after_data AND h.after_data IS NULL)
        OR (event.operation = 'DELETE' AND h.after_data IS NOT DISTINCT FROM event.before_data AND h.before_data IS NULL)
      )
    ORDER BY h.sequence DESC LIMIT 1;
  IF reversal_id IS NULL THEN RAISE EXCEPTION 'Povrat dodjele nije evidentiran. Ništa nije vraćeno.'; END IF;
  UPDATE private.work_order_team_change_history SET reverses_id = event.id WHERE id = reversal_id;
  UPDATE private.work_order_team_change_history
    SET reversed_at = clock_timestamp(), reversed_by = auth.uid() WHERE id = event.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_work_order_team_change_history(uuid, bigint),
  public.restore_work_order_team_change(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_work_order_team_change_history(uuid, bigint),
  public.restore_work_order_team_change(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.prune_business_change_history()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM private.business_change_history WHERE expires_at <= clock_timestamp();
  DELETE FROM private.work_order_team_change_history WHERE expires_at <= clock_timestamp();
$$;
REVOKE ALL ON FUNCTION private.prune_business_change_history() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
