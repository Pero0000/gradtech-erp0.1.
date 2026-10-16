CREATE TABLE IF NOT EXISTS public.mobile_work_order_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nalog_id uuid NOT NULL REFERENCES public.radni_nalozi(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_radnik_id uuid REFERENCES public.radnici(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mobile_work_order_audit_nalog_created_idx
  ON public.mobile_work_order_audit (nalog_id, created_at DESC, id DESC);

ALTER TABLE public.mobile_work_order_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mobile_work_order_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mobile_work_order_audit TO authenticated;

CREATE POLICY mobile_work_order_audit_read ON public.mobile_work_order_audit
  FOR SELECT TO authenticated
  USING (public.app_has_module_permission('radni_nalozi', 'view'));

CREATE OR REPLACE FUNCTION public.get_mobile_worker_display_name()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(btrim(concat_ws(' ', worker.ime, worker.prezime)), '')
  FROM public.app_profiles profile
  JOIN public.radnici worker ON worker.id = profile.radnik_id
  WHERE profile.id = auth.uid()
    AND profile.approved
    AND NOT profile.is_admin;
$$;

CREATE OR REPLACE FUNCTION public.write_mobile_work_order_audit(
  p_nalog_id uuid,
  p_action text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_radnik uuid;
  actor_label text;
BEGIN
  IF p_nalog_id IS NULL THEN
    RETURN;
  END IF;

  SELECT profile.radnik_id,
         NULLIF(btrim(concat_ws(' ', worker.ime, worker.prezime)), '')
  INTO actor_radnik, actor_label
  FROM public.app_profiles profile
  LEFT JOIN public.radnici worker ON worker.id = profile.radnik_id
  WHERE profile.id = actor_id;

  INSERT INTO public.mobile_work_order_audit (nalog_id, actor_user_id, actor_radnik_id, actor_name, action, details)
  VALUES (
    p_nalog_id,
    actor_id,
    actor_radnik,
    COALESCE(actor_label, 'Korisnik'),
    p_action,
    COALESCE(p_details, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_mobile_work_order_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed_fields jsonb;
  action_label text;
  order_id uuid;
  target_worker_name text;
BEGIN
  IF TG_TABLE_NAME = 'radni_nalozi_radnici' THEN
    order_id := COALESCE(NEW.nalog_id, OLD.nalog_id);
    SELECT NULLIF(btrim(concat_ws(' ', ime, prezime)), '')
    INTO target_worker_name
    FROM public.radnici
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.radnik_id ELSE NEW.radnik_id END;
    IF TG_OP = 'INSERT' THEN
      PERFORM public.write_mobile_work_order_audit(order_id, 'worker_assigned', jsonb_build_object('radnik', target_worker_name));
    ELSIF TG_OP = 'DELETE' THEN
      PERFORM public.write_mobile_work_order_audit(order_id, 'worker_unassigned', jsonb_build_object('radnik', target_worker_name));
    ELSE
      IF OLD.vrijeme_od IS DISTINCT FROM NEW.vrijeme_od OR OLD.vrijeme_do IS DISTINCT FROM NEW.vrijeme_do THEN
        PERFORM public.write_mobile_work_order_audit(order_id, 'worker_time_updated', jsonb_build_object(
          'radnik', target_worker_name,
          'old_start', OLD.vrijeme_od,
          'new_start', NEW.vrijeme_od,
          'old_finish', OLD.vrijeme_do,
          'new_finish', NEW.vrijeme_do
        ));
      END IF;
      IF OLD.mobile_started_at IS DISTINCT FROM NEW.mobile_started_at THEN
        PERFORM public.write_mobile_work_order_audit(order_id, 'worker_started', jsonb_build_object('radnik', target_worker_name));
      END IF;
      IF OLD.mobile_finished_at IS DISTINCT FROM NEW.mobile_finished_at THEN
        PERFORM public.write_mobile_work_order_audit(order_id, 'worker_finished', jsonb_build_object('radnik', target_worker_name));
      END IF;
      IF OLD.mobile_reviewed_sections IS DISTINCT FROM NEW.mobile_reviewed_sections THEN
        PERFORM public.write_mobile_work_order_audit(order_id, 'order_reviewed', jsonb_build_object('radnik', target_worker_name));
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'radni_nalozi' THEN
    order_id := COALESCE(NEW.id, OLD.id);
    changed_fields := '{}'::jsonb;
    IF OLD.km_pocetak IS DISTINCT FROM NEW.km_pocetak THEN changed_fields := changed_fields || jsonb_build_object('km_pocetak', NEW.km_pocetak); END IF;
    IF OLD.km_kraj IS DISTINCT FROM NEW.km_kraj THEN changed_fields := changed_fields || jsonb_build_object('km_kraj', NEW.km_kraj); END IF;
    IF OLD.napomena IS DISTINCT FROM NEW.napomena THEN changed_fields := changed_fields || jsonb_build_object('napomena', NEW.napomena); END IF;
    IF OLD.mobile_km_na IS DISTINCT FROM NEW.mobile_km_na THEN changed_fields := changed_fields || jsonb_build_object('mobile_km_na', NEW.mobile_km_na); END IF;
    IF OLD.mobile_napomena_na IS DISTINCT FROM NEW.mobile_napomena_na THEN changed_fields := changed_fields || jsonb_build_object('mobile_napomena_na', NEW.mobile_napomena_na); END IF;
    IF OLD.mobile_tasks_confirmed IS DISTINCT FROM NEW.mobile_tasks_confirmed THEN changed_fields := changed_fields || jsonb_build_object('mobile_tasks_confirmed', NEW.mobile_tasks_confirmed); END IF;
    IF OLD.mobile_foto_na IS DISTINCT FROM NEW.mobile_foto_na THEN changed_fields := changed_fields || jsonb_build_object('mobile_foto_na', NEW.mobile_foto_na); END IF;
    IF OLD.mobile_materijal_na IS DISTINCT FROM NEW.mobile_materijal_na THEN changed_fields := changed_fields || jsonb_build_object('mobile_materijal_na', NEW.mobile_materijal_na); END IF;
    IF OLD.mobile_alat_na IS DISTINCT FROM NEW.mobile_alat_na THEN changed_fields := changed_fields || jsonb_build_object('mobile_alat_na', NEW.mobile_alat_na); END IF;

    IF OLD.mobile_status IS DISTINCT FROM NEW.mobile_status THEN
      action_label := CASE NEW.mobile_status
        WHEN 'u_tijeku' THEN 'order_started'
        WHEN 'predan' THEN 'order_submitted'
        WHEN 'odobren' THEN 'order_approved'
        ELSE 'order_status_changed'
      END;
      PERFORM public.write_mobile_work_order_audit(order_id, action_label, jsonb_build_object('old_status', OLD.mobile_status, 'new_status', NEW.mobile_status));
    END IF;
    IF changed_fields <> '{}'::jsonb THEN
      PERFORM public.write_mobile_work_order_audit(order_id, 'report_updated', changed_fields);
    END IF;
  ELSIF TG_TABLE_NAME = 'radni_nalozi_stavke' THEN
    order_id := COALESCE(NEW.nalog_id, OLD.nalog_id);
    IF TG_OP = 'INSERT' THEN
      PERFORM public.write_mobile_work_order_audit(order_id, 'item_added', jsonb_build_object('tip', NEW.tip, 'naziv', NEW.naziv));
    ELSIF TG_OP = 'DELETE' THEN
      PERFORM public.write_mobile_work_order_audit(order_id, 'item_removed', jsonb_build_object('tip', OLD.tip, 'naziv', OLD.naziv));
    ELSIF OLD.gotovo IS DISTINCT FROM NEW.gotovo THEN
      PERFORM public.write_mobile_work_order_audit(order_id, 'item_checked', jsonb_build_object('tip', NEW.tip, 'naziv', NEW.naziv, 'gotovo', NEW.gotovo));
    ELSE
      PERFORM public.write_mobile_work_order_audit(order_id, 'item_updated', jsonb_build_object('tip', NEW.tip, 'naziv', NEW.naziv));
    END IF;
  ELSIF TG_TABLE_NAME = 'radni_nalozi_foto' THEN
    order_id := COALESCE(NEW.nalog_id, OLD.nalog_id);
    IF TG_OP = 'DELETE' THEN
      PERFORM public.write_mobile_work_order_audit(order_id, 'photo_removed', jsonb_build_object('naziv', OLD.naziv));
    ELSE
      PERFORM public.write_mobile_work_order_audit(order_id, 'photo_added', jsonb_build_object('naziv', NEW.naziv));
    END IF;
  ELSIF TG_TABLE_NAME = 'radni_nalozi_dokumenti' THEN
    order_id := COALESCE(NEW.nalog_id, OLD.nalog_id);
    IF TG_OP = 'DELETE' THEN
      PERFORM public.write_mobile_work_order_audit(order_id, 'document_removed', jsonb_build_object('naziv', OLD.naziv));
    ELSE
      PERFORM public.write_mobile_work_order_audit(order_id, 'document_added', jsonb_build_object('naziv', NEW.naziv));
    END IF;
  ELSIF TG_TABLE_NAME = 'gradiliste_zadaci' THEN
    order_id := COALESCE(NEW.nalog_id, OLD.nalog_id);
    IF order_id IS NOT NULL THEN
      IF TG_OP = 'INSERT' THEN
        PERFORM public.write_mobile_work_order_audit(order_id, 'task_added', jsonb_build_object('naziv', NEW.naziv));
      ELSIF TG_OP = 'DELETE' THEN
        PERFORM public.write_mobile_work_order_audit(order_id, 'task_removed', jsonb_build_object('naziv', OLD.naziv));
      ELSIF OLD.gotovo IS DISTINCT FROM NEW.gotovo THEN
        PERFORM public.write_mobile_work_order_audit(order_id, 'task_checked', jsonb_build_object('naziv', NEW.naziv, 'gotovo', NEW.gotovo));
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mobile_audit_assignment_changes
AFTER INSERT OR UPDATE OR DELETE ON public.radni_nalozi_radnici
FOR EACH ROW EXECUTE FUNCTION public.audit_mobile_work_order_change();

CREATE TRIGGER mobile_audit_order_changes
AFTER UPDATE ON public.radni_nalozi
FOR EACH ROW EXECUTE FUNCTION public.audit_mobile_work_order_change();

CREATE TRIGGER mobile_audit_item_changes
AFTER INSERT OR UPDATE OR DELETE ON public.radni_nalozi_stavke
FOR EACH ROW EXECUTE FUNCTION public.audit_mobile_work_order_change();

CREATE TRIGGER mobile_audit_photo_changes
AFTER INSERT OR DELETE ON public.radni_nalozi_foto
FOR EACH ROW EXECUTE FUNCTION public.audit_mobile_work_order_change();

CREATE TRIGGER mobile_audit_document_changes
AFTER INSERT OR DELETE ON public.radni_nalozi_dokumenti
FOR EACH ROW EXECUTE FUNCTION public.audit_mobile_work_order_change();

CREATE TRIGGER mobile_audit_task_changes
AFTER INSERT OR UPDATE OR DELETE ON public.gradiliste_zadaci
FOR EACH ROW EXECUTE FUNCTION public.audit_mobile_work_order_change();

CREATE OR REPLACE FUNCTION public.get_mobile_work_order_audit(p_nalog_id uuid)
RETURNS TABLE (
  id bigint,
  actor_name text,
  action text,
  details jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'view') THEN
    RAISE EXCEPTION 'Nemate pravo pregleda povijesti radnog naloga.';
  END IF;

  RETURN QUERY
  SELECT audit.id, audit.actor_name, audit.action, audit.details, audit.created_at
  FROM public.mobile_work_order_audit audit
  WHERE audit.nalog_id = p_nalog_id
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.get_mobile_worker_display_name() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.write_mobile_work_order_audit(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_mobile_work_order_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_mobile_work_order_audit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_work_order_audit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mobile_worker_display_name() TO authenticated;

NOTIFY pgrst, 'reload schema';
