CREATE TABLE private.deadline_task_versions (
  task_id uuid PRIMARY KEY,
  revision bigint NOT NULL
);
CREATE TABLE private.deadline_deletion_tasks (
  deletion_id uuid PRIMARY KEY REFERENCES private.resource_deletions(id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  task_data jsonb NOT NULL,
  task_revision bigint,
  deadlines_revision bigint NOT NULL
);
ALTER TABLE private.deadline_task_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.deadline_deletion_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.deadline_task_versions, private.deadline_deletion_tasks FROM PUBLIC, anon, authenticated;

CREATE TABLE private.deadline_sync_context (
  transaction_id bigint NOT NULL,
  task_id uuid NOT NULL,
  PRIMARY KEY(transaction_id, task_id)
);
ALTER TABLE private.deadline_sync_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.deadline_sync_context FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.guard_deadline_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  target_task_id uuid;
  task_data jsonb;
  task_revision bigint;
  deadlines_revision bigint;
  operation private.resource_deletions%ROWTYPE;
  dependency private.deadline_deletion_tasks%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  -- Serialize synchronization, manual changes and restoration against the same task.
  FOR target_task_id IN SELECT DISTINCT value::uuid FROM (
    VALUES (old_data->>'zadatak_id'), (new_data->>'zadatak_id')
  ) tasks(value) WHERE value IS NOT NULL ORDER BY value::uuid LOOP
    PERFORM 1 FROM public.gradiliste_zadaci WHERE id = target_task_id FOR UPDATE;
  END LOOP;
  SELECT * INTO operation FROM private.resource_deletions
    WHERE active AND transaction_id = txid_current();
  IF TG_OP = 'INSERT' AND operation.restoring AND operation.table_name = 'rokovi'
    AND operation.record_id = NEW.id AND NEW.zadatak_id IS NOT NULL THEN
    SELECT * INTO dependency FROM private.deadline_deletion_tasks WHERE deletion_id = operation.id;
    SELECT to_jsonb(z) INTO task_data FROM public.gradiliste_zadaci z
      WHERE z.id = NEW.zadatak_id AND z.company_id = operation.company_id;
    SELECT revision INTO task_revision FROM private.resource_recovery_versions
      WHERE table_name = 'gradiliste_zadaci' AND row_key = jsonb_build_object('id', NEW.zadatak_id);
    SELECT revision INTO deadlines_revision FROM private.deadline_task_versions WHERE task_id = NEW.zadatak_id;
    IF dependency.deletion_id IS NULL OR task_data IS DISTINCT FROM dependency.task_data
      OR task_revision IS DISTINCT FROM dependency.task_revision
      OR deadlines_revision IS DISTINCT FROM dependency.deadlines_revision THEN
      RAISE EXCEPTION 'Zadatak ili njegovi rokovi naknadno su promijenjeni. Povrat roka nije siguran; ništa nije vraćeno.' USING ERRCODE = '40001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' AND auth.uid() IS NOT NULL AND operation.id IS NULL
    AND NOT (OLD.zadatak_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM private.deadline_sync_context c
      WHERE c.transaction_id = txid_current() AND c.task_id = OLD.zadatak_id
    )) THEN
    RAISE EXCEPTION 'Zaštićeno brisanje roka zahtijeva novu verziju aplikacije i delete_resource_with_history.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE FUNCTION private.capture_deadline_task_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  target uuid;
  operation private.resource_deletions%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  FOR target IN SELECT DISTINCT value::uuid FROM (
    VALUES (old_data->>'zadatak_id'), (new_data->>'zadatak_id')
  ) tasks(value) WHERE value IS NOT NULL LOOP
    INSERT INTO private.deadline_task_versions VALUES (target, nextval('private.resource_recovery_revision'))
      ON CONFLICT (task_id) DO UPDATE SET revision = EXCLUDED.revision;
  END LOOP;
  IF TG_OP = 'DELETE' AND OLD.zadatak_id IS NOT NULL THEN
    SELECT * INTO operation FROM private.resource_deletions WHERE active AND NOT restoring
      AND transaction_id = txid_current() AND table_name = 'rokovi' AND record_id = OLD.id;
    IF operation.id IS NOT NULL THEN
      INSERT INTO private.deadline_deletion_tasks
        SELECT operation.id, z.id, to_jsonb(z), v.revision, d.revision
        FROM public.gradiliste_zadaci z
        JOIN private.deadline_task_versions d ON d.task_id = z.id
        LEFT JOIN private.resource_recovery_versions v ON v.table_name = 'gradiliste_zadaci'
          AND v.row_key = jsonb_build_object('id', z.id)
        WHERE z.id = OLD.zadatak_id AND z.company_id = operation.company_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Nije moguće evidentirati vezu roka sa zadatkom. Ništa nije obrisano.'; END IF;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER guard_deadline_change BEFORE INSERT OR UPDATE OR DELETE ON public.rokovi
  FOR EACH ROW EXECUTE FUNCTION private.guard_deadline_change();
CREATE TRIGGER capture_deadline_task_version AFTER INSERT OR UPDATE OR DELETE ON public.rokovi
  FOR EACH ROW EXECUTE FUNCTION private.capture_deadline_task_version();
REVOKE ALL ON FUNCTION private.guard_deadline_change(), private.capture_deadline_task_version() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.sync_task_deadline(p_task_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  task public.gradiliste_zadaci%ROWTYPE;
BEGIN
  IF NOT public.app_has_module_permission('gradilista', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja gradilišta.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO task FROM public.gradiliste_zadaci
    WHERE id = p_task_id AND company_id = public.app_current_company_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zadatak nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  IF task.rok IS NULL OR task.gradiliste_id IS NULL THEN
    INSERT INTO private.deadline_sync_context VALUES (txid_current(), task.id);
    DELETE FROM public.rokovi WHERE zadatak_id = task.id AND company_id = task.company_id;
    DELETE FROM private.deadline_sync_context WHERE transaction_id = txid_current() AND task_id = task.id;
  ELSE
    UPDATE public.rokovi SET naziv = task.naziv, datum = task.rok, datum_pocetka = task.rok,
      datum_zavrsetka = task.rok, kooperant_id = task.kooperant_id,
      status = CASE WHEN task.gotovo THEN 'zavrsen' ELSE 'otvoren' END
      WHERE zadatak_id = task.id AND company_id = task.company_id;
    IF NOT FOUND THEN
      INSERT INTO public.rokovi(company_id, gradiliste_id, zadatak_id, naziv, datum, datum_pocetka,
        datum_zavrsetka, kooperant_id, status, opis)
      VALUES (task.company_id, task.gradiliste_id, task.id, task.naziv, task.rok, task.rok, task.rok,
        task.kooperant_id, CASE WHEN task.gotovo THEN 'zavrsen' ELSE 'otvoren' END,
        CASE WHEN task.vrsta = 'dodatni' THEN 'Dodatni rad' ELSE 'Radni zadatak' END);
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_task_deadline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_task_deadline(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_resource_with_history(p_table text, p_record_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  resource jsonb;
  operation_id uuid;
  required_module text;
  history_sequence bigint;
  untracked text;
  missing_file text;
BEGIN
  IF p_table NOT IN ('radnici', 'vozila', 'oprema', 'gradilista', 'radni_nalozi', 'gradiliste_zadaci', 'rokovi') THEN
    RAISE EXCEPTION 'Tablica nije podržana.' USING ERRCODE = '22023';
  END IF;
  IF p_table = 'rokovi' THEN
    PERFORM 1 FROM public.gradiliste_zadaci WHERE id = (
      SELECT zadatak_id FROM public.rokovi WHERE id = p_record_id AND company_id = public.app_current_company_id()
    ) FOR UPDATE;
  END IF;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id = $1 AND company_id = $2 FOR UPDATE', p_table)
    INTO resource USING p_record_id, public.app_current_company_id();
  IF resource IS NULL THEN RAISE EXCEPTION 'Resurs nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  required_module := private.resource_recovery_module(p_table, resource);
  IF NOT public.app_has_module_permission(required_module, 'edit') THEN RAISE EXCEPTION 'Nedostaje pravo uređivanja resursa.' USING ERRCODE = '42501'; END IF;
  WITH RECURSIVE affected(oid, cascading) AS (
    SELECT format('public.%I', p_table)::regclass::oid, true
    UNION SELECT fk.conrelid, fk.confdeltype = 'c' FROM pg_constraint fk JOIN affected parent ON parent.oid = fk.confrelid
      WHERE parent.cascading AND fk.contype = 'f' AND fk.confdeltype IN ('c', 'n', 'd')
  )
  SELECT c.relname INTO untracked FROM affected JOIN pg_class c USING (oid) JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'public' OR NOT EXISTS (SELECT 1 FROM private.resource_recovery_tables WHERE table_name = c.relname) LIMIT 1;
  IF untracked IS NOT NULL THEN RAISE EXCEPTION 'Povrat nije pripremljen za povezanu tablicu %. Ništa nije obrisano.', untracked; END IF;
  SELECT COALESCE(max(sequence), 0) INTO history_sequence FROM private.business_change_history;
  INSERT INTO private.resource_deletions(company_id, module, table_name, record_id, snapshot, actor_name)
    VALUES (public.app_current_company_id(), required_module, p_table, p_record_id, resource,
      COALESCE((SELECT email FROM public.app_profiles WHERE id = auth.uid()), 'Korisnik')) RETURNING id INTO operation_id;
  IF p_table = 'gradilista' THEN
    UPDATE public.gradiliste_board_layout layout SET columns = (
      SELECT jsonb_agg(COALESCE((
        SELECT jsonb_agg(entry.value ORDER BY entry.position)
          FROM jsonb_array_elements(col.value) WITH ORDINALITY entry(value, position)
          WHERE entry.value <> to_jsonb(p_record_id::text)
      ), '[]'::jsonb) ORDER BY col.position)
      FROM jsonb_array_elements(layout.columns) WITH ORDINALITY col(value, position)
    ), updated_at = clock_timestamp()
    WHERE layout.company_id = public.app_current_company_id()
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(layout.columns) col(value)
        CROSS JOIN LATERAL jsonb_array_elements(col.value) entry(value)
        WHERE entry.value = to_jsonb(p_record_id::text));
  END IF;
  EXECUTE format('DELETE FROM public.%I WHERE id = $1', p_table) USING p_record_id;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id = $1', p_table) INTO resource USING p_record_id;
  IF resource IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM private.resource_deletion_rows WHERE deletion_id = operation_id
      AND table_name = p_table AND row_key = jsonb_build_object('id', p_record_id) AND after_data IS NULL
  ) THEN RAISE EXCEPTION 'Brisanje nije provedeno i evidentirano. Radnja je poništena.'; END IF;
  IF NOT private.resource_deletion_allowed(operation_id) THEN
    RAISE EXCEPTION 'Za ovu radnju potrebna su prava uređivanja svih povezanih modula, a za vezu korisničkog računa administrator. Ništa nije obrisano.' USING ERRCODE = '42501';
  END IF;
  IF p_table IN ('gradilista', 'radni_nalozi', 'gradiliste_zadaci', 'rokovi') THEN
    SELECT path INTO missing_file FROM private.resource_deletion_rows r
      CROSS JOIN LATERAL private.resource_file_paths(r.table_name, r.before_data) path
      WHERE r.deletion_id = operation_id AND NOT EXISTS (
        SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'nalozi-foto' AND o.name = path
      ) LIMIT 1;
    IF missing_file IS NOT NULL THEN
      RAISE EXCEPTION 'Nedostaje prilog %. Zaštićeno brisanje nije moguće. Ništa nije obrisano.', missing_file;
    END IF;
  END IF;
  INSERT INTO private.resource_deletion_events
    SELECT operation_id, id FROM private.business_change_history WHERE transaction_id = txid_current() AND sequence > history_sequence;
  UPDATE private.resource_deletions SET active = false WHERE id = operation_id;
  RETURN operation_id;
END;
$$;

CREATE FUNCTION public.get_deadline_deletions(
  p_before_time timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL
)
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
    AND d.module = 'gradilista' AND d.table_name = 'rokovi'
    AND NOT d.active AND d.expires_at > now()
    AND (p_before_time IS NULL OR (d.created_at, d.id) < (p_before_time, p_before_id))
    ORDER BY d.created_at DESC, d.id DESC LIMIT 50;
END;
$$;
REVOKE ALL ON FUNCTION public.get_deadline_deletions(timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_deadline_deletions(timestamptz, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
