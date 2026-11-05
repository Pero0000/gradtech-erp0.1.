CREATE OR REPLACE FUNCTION private.resource_history_module(p_table text, p_row jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_table
    WHEN 'radnici' THEN 'radnici'
    WHEN 'vozila' THEN 'vozila'
    WHEN 'gradilista' THEN 'gradilista'
    WHEN 'rokovi' THEN 'gradilista'
    WHEN 'gradiliste_zadaci' THEN 'gradilista'
    WHEN 'radno_vrijeme' THEN 'radno_vrijeme'
    WHEN 'troskovi' THEN 'troskovi'
    WHEN 'fakture' THEN 'fakture'
    WHEN 'ugovoreni_radovi' THEN 'gradilista'
    WHEN 'oprema' THEN CASE p_row->>'kategorija' WHEN 'alat' THEN 'alat' ELSE 'strojevi' END
    ELSE NULL END;
$$;
CREATE TRIGGER task_change_history AFTER INSERT OR UPDATE OR DELETE ON public.gradiliste_zadaci
  FOR EACH ROW EXECUTE FUNCTION private.capture_resource_change();

CREATE TABLE private.task_update_packages (
  id uuid PRIMARY KEY REFERENCES private.resource_deletions(id) ON DELETE CASCADE,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  before_deadlines jsonb NOT NULL,
  after_deadlines jsonb,
  before_revision bigint,
  after_revision bigint,
  history_sequence bigint NOT NULL
);
ALTER TABLE private.task_update_packages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.task_update_packages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.task_update_packages_sequence_seq FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.task_deadline_snapshot(p_task_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb)
    FROM public.rokovi r WHERE r.zadatak_id = p_task_id;
$$;
REVOKE ALL ON FUNCTION private.task_deadline_snapshot(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.check_task_deadline_recovery_tables()
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE untracked text;
BEGIN
  WITH RECURSIVE affected(oid,cascading) AS (
    SELECT 'public.rokovi'::regclass::oid,true
    UNION SELECT fk.conrelid,fk.confdeltype='c' FROM pg_constraint fk JOIN affected parent ON parent.oid=fk.confrelid
      WHERE parent.cascading AND fk.contype='f' AND fk.confdeltype IN ('c','n','d')
  )
  SELECT c.relname INTO untracked FROM affected JOIN pg_class c USING(oid) JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname<>'public' OR NOT EXISTS (
      SELECT 1 FROM private.resource_recovery_tables t WHERE t.table_name=c.relname
    ) LIMIT 1;
  IF untracked IS NOT NULL THEN
    RAISE EXCEPTION 'Povrat nije pripremljen za povezanu tablicu %. Ništa nije promijenjeno.',untracked;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.check_task_deadline_recovery_tables() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.begin_task_update_package()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE package_id uuid;
BEGIN
  IF (to_jsonb(OLD) - 'updated_at') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'updated_at')
    OR EXISTS (SELECT 1 FROM private.resource_deletions WHERE active AND transaction_id = txid_current()) THEN
    RETURN NEW;
  END IF;
  IF (NEW.rok IS NULL OR NEW.gradiliste_id IS NULL) AND EXISTS (
    SELECT 1 FROM public.rokovi WHERE zadatak_id=OLD.id
  ) THEN PERFORM private.check_task_deadline_recovery_tables(); END IF;
  IF EXISTS (SELECT 1 FROM public.rokovi WHERE zadatak_id=OLD.id AND company_id IS DISTINCT FROM OLD.company_id) THEN
    RAISE EXCEPTION 'Povezani rok pripada drugoj tvrtki. Ništa nije spremljeno.' USING ERRCODE='42501';
  END IF;
  INSERT INTO private.resource_deletions(company_id,module,table_name,record_id,snapshot,actor_name)
    VALUES (OLD.company_id,'gradilista','task_changes',OLD.id,to_jsonb(OLD),
      COALESCE((SELECT email FROM public.app_profiles WHERE id=auth.uid() AND company_id=OLD.company_id),'Korisnik'))
    RETURNING id INTO package_id;
  INSERT INTO private.task_update_packages(id,before_deadlines,before_revision,history_sequence)
    SELECT package_id,private.task_deadline_snapshot(OLD.id),
      (SELECT revision FROM private.deadline_task_versions WHERE task_id=OLD.id),
      COALESCE((SELECT max(sequence) FROM private.business_change_history),0);
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_update_package_begin BEFORE UPDATE ON public.gradiliste_zadaci
  FOR EACH ROW EXECUTE FUNCTION private.begin_task_update_package();

-- A normal task-update package records projection; only deletion/restore packages suppress it.
CREATE OR REPLACE FUNCTION private.sync_changed_task_deadline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.resource_deletions WHERE active AND transaction_id=txid_current()
    AND company_id=NEW.company_id AND (table_name <> 'task_changes' OR restoring)) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(OLD.naziv,OLD.rok,OLD.gotovo,OLD.kooperant_id,OLD.gradiliste_id)
      IS NOT DISTINCT FROM ROW(NEW.naziv,NEW.rok,NEW.gotovo,NEW.kooperant_id,NEW.gradiliste_id) THEN RETURN NEW; END IF;
  END IF;
  PERFORM private.project_task_deadline(NEW.id);
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.finish_task_update_package()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE package_id uuid;
BEGIN
  SELECT id INTO package_id FROM private.resource_deletions WHERE active AND NOT restoring
    AND transaction_id=txid_current() AND table_name='task_changes' AND record_id=NEW.id;
  IF package_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.resource_deletion_rows WHERE deletion_id=package_id
    AND table_name='gradiliste_zadaci' AND row_key=jsonb_build_object('id',NEW.id)
    AND before_data IS NOT NULL AND after_data=to_jsonb(NEW)) THEN
    RAISE EXCEPTION 'Izmjena zadatka nije točno evidentirana. Ništa nije spremljeno.';
  END IF;
  UPDATE private.task_update_packages SET after_deadlines=private.task_deadline_snapshot(NEW.id),
    after_revision=(SELECT revision FROM private.deadline_task_versions WHERE task_id=NEW.id) WHERE id=package_id;
  INSERT INTO private.resource_deletion_events
    SELECT package_id,h.id FROM private.business_change_history h,private.task_update_packages p
    WHERE p.id=package_id AND h.transaction_id=txid_current() AND h.sequence>p.history_sequence;
  UPDATE private.resource_deletions SET active=false WHERE id=package_id;
  RETURN NEW;
END;
$$;
-- Runs after zzzz_resource_recovery has captured the root task as well as projection changes.
CREATE TRIGGER zzzzz_task_update_package_finish AFTER UPDATE ON public.gradiliste_zadaci
  FOR EACH ROW EXECUTE FUNCTION private.finish_task_update_package();
REVOKE ALL ON FUNCTION private.begin_task_update_package(),private.finish_task_update_package() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.check_task_update_package_finished()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.resource_deletions
    WHERE transaction_id=txid_current() AND active AND NOT restoring AND table_name='task_changes') THEN
    RAISE EXCEPTION 'Izmjena zadatka nije dovršena. Ništa nije spremljeno.';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER task_update_package_check AFTER UPDATE ON public.gradiliste_zadaci
  FOR EACH STATEMENT EXECUTE FUNCTION private.check_task_update_package_finished();
REVOKE ALL ON FUNCTION private.check_task_update_package_finished() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.task_update_blocked(p_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  operation private.resource_deletions%ROWTYPE;
  dependency private.task_update_packages%ROWTYPE;
  item private.resource_deletion_rows%ROWTYPE;
  current_data jsonb;
  current_revision bigint;
BEGIN
  SELECT * INTO operation FROM private.resource_deletions WHERE id=p_id;
  SELECT * INTO dependency FROM private.task_update_packages WHERE id=p_id;
  IF dependency.id IS NULL OR operation.table_name <> 'task_changes' THEN RETURN 'Radnja nije povrat izmjene zadatka.'; END IF;
  IF operation.reversed_at IS NOT NULL THEN RETURN 'Promjena je već vraćena.'; END IF;
  IF dependency.after_deadlines IS NULL THEN RETURN 'Snimka rokova nije potpuna.'; END IF;
  SELECT * INTO item FROM private.resource_deletion_rows WHERE deletion_id=p_id AND table_name='gradiliste_zadaci'
    AND row_key=jsonb_build_object('id',operation.record_id);
  IF item.sequence IS NULL OR item.before_data IS NULL OR item.after_data IS NULL
    OR (item.before_data-ARRAY['naziv','rok','gotovo','gotovo_at','kooperant_id','updated_at'])
      IS DISTINCT FROM (item.after_data-ARRAY['naziv','rok','gotovo','gotovo_at','kooperant_id','updated_at']) THEN
    RETURN 'Promjena sadrži vrstu, vezu gradilišta/naloga ili druga nepodržana polja.';
  END IF;
  IF EXISTS (SELECT 1 FROM private.resource_deletion_rows r WHERE deletion_id=p_id AND NOT COALESCE((
    (r.table_name='gradiliste_zadaci' AND r.row_key=jsonb_build_object('id',operation.record_id))
    OR (r.table_name='rokovi'
      AND (r.before_data IS NULL OR r.before_data->>'zadatak_id'=operation.record_id::text)
      AND (r.after_data IS NULL OR r.after_data->>'zadatak_id'=operation.record_id::text))
  ),false)) THEN RETURN 'Promjena uključuje dodatne povezane zapise. Potreban je zajednički povrat šire radnje.'; END IF;
  SELECT to_jsonb(z) INTO current_data FROM public.gradiliste_zadaci z
    WHERE id=operation.record_id AND company_id=operation.company_id;
  SELECT revision INTO current_revision FROM private.resource_recovery_versions
    WHERE table_name='gradiliste_zadaci' AND row_key=item.row_key;
  IF current_data IS DISTINCT FROM item.after_data OR current_revision IS DISTINCT FROM item.after_revision THEN
    RETURN 'Zadatak ima noviju promjenu ili je obrisan. Najprije provjerite nju.';
  END IF;
  SELECT revision INTO current_revision FROM private.deadline_task_versions WHERE task_id=operation.record_id;
  IF current_revision IS DISTINCT FROM dependency.after_revision
    OR private.task_deadline_snapshot(operation.record_id) IS DISTINCT FROM dependency.after_deadlines THEN
    RETURN 'Rokovi zadatka naknadno su promijenjeni. Ništa nije vraćeno.';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.task_update_blocked(uuid) FROM PUBLIC, anon, authenticated;

-- Enforce the same preflight even if a client calls the generic bundle restore RPC directly.
CREATE FUNCTION private.guard_task_update_restore()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE reason text;
BEGIN
  IF NEW.table_name='task_changes' AND NEW.active AND NEW.restoring AND NOT OLD.restoring THEN
    IF NEW.company_id IS DISTINCT FROM public.app_current_company_id()
      OR NOT private.resource_deletion_allowed(NEW.id) THEN
      RAISE EXCEPTION 'Nedostaje pravo povrata zadatka.' USING ERRCODE='42501';
    END IF;
    PERFORM 1 FROM public.gradiliste_zadaci WHERE id=NEW.record_id FOR UPDATE;
    reason:=private.task_update_blocked(NEW.id);
    IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason USING ERRCODE='40001'; END IF;
    IF EXISTS (SELECT 1 FROM private.resource_deletion_rows
      WHERE deletion_id=NEW.id AND table_name='rokovi' AND before_data IS NULL) THEN
      PERFORM private.check_task_deadline_recovery_tables();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_task_update_restore BEFORE UPDATE ON private.resource_deletions
  FOR EACH ROW EXECUTE FUNCTION private.guard_task_update_restore();
REVOKE ALL ON FUNCTION private.guard_task_update_restore() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.finish_task_update_restore()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE dependency private.task_update_packages%ROWTYPE;
BEGIN
  IF NEW.table_name='task_changes' AND NEW.reversed_at IS NOT NULL AND OLD.reversed_at IS NULL THEN
    SELECT * INTO dependency FROM private.task_update_packages WHERE id=NEW.id;
    IF private.task_deadline_snapshot(NEW.record_id) IS DISTINCT FROM dependency.before_deadlines THEN
      RAISE EXCEPTION 'Završna provjera rokova nije prošla. Ništa nije vraćeno.';
    END IF;
    UPDATE private.task_update_packages earlier SET after_revision=current_version.revision
      FROM private.resource_deletions parent,private.deadline_task_versions current_version
      WHERE earlier.id=parent.id AND parent.record_id=NEW.record_id AND parent.company_id=NEW.company_id
        AND parent.reversed_at IS NULL AND earlier.sequence<dependency.sequence
        AND earlier.after_revision IS NOT DISTINCT FROM dependency.before_revision
        AND earlier.after_deadlines=dependency.before_deadlines AND current_version.task_id=NEW.record_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finish_task_update_restore BEFORE UPDATE ON private.resource_deletions
  FOR EACH ROW EXECUTE FUNCTION private.finish_task_update_restore();
REVOKE ALL ON FUNCTION private.finish_task_update_restore() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_task_change_history(p_record_id uuid,p_before_sequence bigint DEFAULT NULL)
RETURNS TABLE(id uuid,sequence text,operation text,before_data jsonb,after_data jsonb,
  actor_name text,created_at timestamptz,expires_at timestamptz,reversed_at timestamptz,reverses_id uuid,
  can_restore boolean,blocked_reason text,before_deadlines jsonb,after_deadlines jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.app_has_module_permission('gradilista','edit') OR NOT EXISTS (
    SELECT 1 FROM public.gradiliste_zadaci z WHERE z.id=p_record_id AND z.company_id=public.app_current_company_id()
  ) THEN RAISE EXCEPTION 'Zadatak nije dostupan ili nedostaje pravo uređivanja gradilišta.' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT d.id,p.sequence::text,'UPDATE'::text,r.before_data,r.after_data,d.actor_name,
    d.created_at,d.expires_at,d.reversed_at,NULL::uuid,
    reason.message IS NULL AND private.resource_deletion_allowed(d.id),reason.message,p.before_deadlines,p.after_deadlines
    FROM private.resource_deletions d JOIN private.task_update_packages p ON p.id=d.id
    JOIN private.resource_deletion_rows r ON r.deletion_id=d.id AND r.table_name='gradiliste_zadaci'
      AND r.row_key=jsonb_build_object('id',p_record_id)
    CROSS JOIN LATERAL (SELECT private.task_update_blocked(d.id) message) reason
    WHERE d.company_id=public.app_current_company_id() AND d.table_name='task_changes' AND d.record_id=p_record_id
      AND NOT d.active AND d.expires_at>now() AND (p_before_sequence IS NULL OR p.sequence<p_before_sequence)
    ORDER BY p.sequence DESC LIMIT 50;
END;
$$;
CREATE FUNCTION public.restore_task_change(p_history_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.resource_deletions d JOIN private.task_update_packages p ON p.id=d.id
    WHERE d.id=p_history_id AND d.company_id=public.app_current_company_id() AND d.table_name='task_changes') THEN
    RAISE EXCEPTION 'Promjena nije dostupna u vašoj tvrtki.' USING ERRCODE='42501';
  END IF;
  PERFORM public.restore_resource_deletion(p_history_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_task_change_history(uuid,bigint),public.restore_task_change(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_task_change_history(uuid,bigint),public.restore_task_change(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
