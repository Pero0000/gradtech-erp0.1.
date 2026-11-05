CREATE FUNCTION private.guard_contracted_work_recovery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  operation private.resource_deletions%ROWTYPE;
BEGIN
  SELECT * INTO operation FROM private.resource_deletions WHERE active AND transaction_id = txid_current();
  IF TG_OP = 'INSERT' AND operation.restoring AND operation.table_name = 'ugovoreni_radovi' AND operation.record_id = NEW.id THEN
    IF NEW.gradiliste_id IS NOT NULL THEN
      PERFORM 1 FROM public.gradilista WHERE id = NEW.gradiliste_id AND company_id = operation.company_id FOR KEY SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Izvorno gradilište nije dostupno u vašoj tvrtki. Ništa nije vraćeno.' USING ERRCODE = '23503'; END IF;
    END IF;
    IF NEW.ponuda_id IS NOT NULL THEN
      PERFORM 1 FROM public.ponude WHERE id = NEW.ponuda_id AND company_id = operation.company_id FOR KEY SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Izvorna ponuda nije dostupna u vašoj tvrtki. Ništa nije vraćeno.' USING ERRCODE = '23503'; END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' AND auth.uid() IS NOT NULL AND operation.id IS NULL THEN
    RAISE EXCEPTION 'Zaštićeno brisanje ugovorenog/VTR rada zahtijeva novu verziju aplikacije i delete_contracted_work_with_history.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER guard_contracted_work_recovery BEFORE INSERT OR DELETE ON public.ugovoreni_radovi
  FOR EACH ROW EXECUTE FUNCTION private.guard_contracted_work_recovery();
REVOKE ALL ON FUNCTION private.guard_contracted_work_recovery() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.delete_contracted_work_with_history(p_record_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  resource jsonb;
  operation_id uuid;
  history_sequence bigint;
  untracked text;
BEGIN
  IF NOT public.app_has_module_permission('gradilista', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja gradilišta.' USING ERRCODE = '42501';
  END IF;
  SELECT to_jsonb(r) INTO resource FROM public.ugovoreni_radovi r
    WHERE r.id = p_record_id AND r.company_id = public.app_current_company_id() FOR UPDATE;
  IF resource IS NULL THEN RAISE EXCEPTION 'Ugovoreni/VTR rad nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  WITH RECURSIVE affected(oid, cascading) AS (
    SELECT 'public.ugovoreni_radovi'::regclass::oid, true
    UNION SELECT fk.conrelid, fk.confdeltype = 'c' FROM pg_constraint fk JOIN affected parent ON parent.oid = fk.confrelid
      WHERE parent.cascading AND fk.contype = 'f' AND fk.confdeltype IN ('c', 'n', 'd')
  )
  SELECT c.relname INTO untracked FROM affected JOIN pg_class c USING (oid) JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'public' OR NOT EXISTS (SELECT 1 FROM private.resource_recovery_tables WHERE table_name = c.relname) LIMIT 1;
  IF untracked IS NOT NULL THEN RAISE EXCEPTION 'Povrat nije pripremljen za povezanu tablicu %. Ništa nije obrisano.', untracked; END IF;
  SELECT COALESCE(max(sequence), 0) INTO history_sequence FROM private.business_change_history;
  INSERT INTO private.resource_deletions(company_id, module, table_name, record_id, snapshot, actor_name)
    VALUES (public.app_current_company_id(), 'gradilista', 'ugovoreni_radovi', p_record_id, resource,
      COALESCE((SELECT email FROM public.app_profiles WHERE id = auth.uid()), 'Korisnik')) RETURNING id INTO operation_id;
  DELETE FROM public.ugovoreni_radovi WHERE id = p_record_id;
  IF EXISTS (SELECT 1 FROM public.ugovoreni_radovi WHERE id = p_record_id) OR NOT EXISTS (
    SELECT 1 FROM private.resource_deletion_rows WHERE deletion_id = operation_id
      AND table_name = 'ugovoreni_radovi' AND row_key = jsonb_build_object('id', p_record_id) AND after_data IS NULL
  ) THEN RAISE EXCEPTION 'Brisanje nije provedeno i evidentirano. Ništa nije obrisano.'; END IF;
  IF NOT private.resource_deletion_allowed(operation_id) THEN
    RAISE EXCEPTION 'Nedostaju prava uređivanja povezanih modula. Ništa nije obrisano.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO private.resource_deletion_events
    SELECT operation_id, id FROM private.business_change_history WHERE transaction_id = txid_current() AND sequence > history_sequence;
  UPDATE private.resource_deletions SET active = false WHERE id = operation_id;
  RETURN operation_id;
END;
$$;

CREATE FUNCTION public.get_contracted_work_deletions(p_before_time timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, snapshot jsonb, actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, can_restore boolean, affected_rows jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.app_has_module_permission('gradilista', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja gradilišta.' USING ERRCODE = '42501';
  END IF;
  IF (p_before_time IS NULL) <> (p_before_id IS NULL) THEN RAISE EXCEPTION 'Nepotpun pokazivač stranice.' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT d.id, d.snapshot, d.actor_name, d.created_at, d.expires_at, d.reversed_at,
    d.reversed_at IS NULL AND private.resource_deletion_allowed(d.id),
    (SELECT jsonb_object_agg(summary.table_name, summary.total) FROM (
      SELECT r.table_name, count(*) total FROM private.resource_deletion_rows r WHERE r.deletion_id = d.id GROUP BY r.table_name
    ) summary)
  FROM private.resource_deletions d WHERE d.company_id = public.app_current_company_id()
    AND d.module = 'gradilista' AND d.table_name = 'ugovoreni_radovi'
    AND NOT d.active AND d.expires_at > now()
    AND (p_before_time IS NULL OR (d.created_at, d.id) < (p_before_time, p_before_id))
    ORDER BY d.created_at DESC, d.id DESC LIMIT 50;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_contracted_work_with_history(uuid), public.get_contracted_work_deletions(timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_contracted_work_with_history(uuid), public.get_contracted_work_deletions(timestamptz, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
