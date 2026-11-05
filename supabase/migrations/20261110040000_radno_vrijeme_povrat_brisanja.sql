CREATE TABLE private.work_time_order_versions (
  nalog_id uuid PRIMARY KEY,
  revision bigint NOT NULL
);
CREATE TABLE private.work_time_deletion_orders (
  deletion_id uuid PRIMARY KEY REFERENCES private.resource_deletions(id) ON DELETE CASCADE,
  nalog_id uuid NOT NULL,
  revision bigint NOT NULL
);
ALTER TABLE private.work_time_order_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.work_time_deletion_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.work_time_order_versions, private.work_time_deletion_orders FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.guard_work_time_restore()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  operation private.resource_deletions%ROWTYPE;
  expected_revision bigint;
  current_revision bigint;
  target uuid;
  old_data jsonb;
  new_data jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  FOR target IN SELECT DISTINCT value::uuid FROM (
    VALUES (old_data->>'nalog_id'), (new_data->>'nalog_id')
  ) orders(value) WHERE value IS NOT NULL ORDER BY value::uuid LOOP
    PERFORM 1 FROM public.radni_nalozi WHERE id = target FOR UPDATE;
  END LOOP;
  IF TG_TABLE_NAME = 'radno_vrijeme' AND TG_OP = 'INSERT' AND new_data->>'nalog_id' IS NOT NULL THEN
    SELECT * INTO operation FROM private.resource_deletions WHERE active AND restoring
      AND transaction_id = txid_current() AND table_name = 'radno_vrijeme' AND record_id = (new_data->>'id')::uuid;
    IF operation.id IS NOT NULL THEN
      SELECT revision INTO expected_revision FROM private.work_time_deletion_orders
        WHERE deletion_id = operation.id AND nalog_id = NEW.nalog_id;
      SELECT revision INTO current_revision FROM private.work_time_order_versions WHERE nalog_id = NEW.nalog_id;
      IF expected_revision IS NULL OR current_revision IS DISTINCT FROM expected_revision THEN
        RAISE EXCEPTION 'Nalog, ekipa ili sati naloga naknadno su promijenjeni. Povrat sati nije siguran; ništa nije vraćeno.' USING ERRCODE = '40001';
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'radno_vrijeme' AND TG_OP = 'DELETE' AND old_data->>'nalog_id' IS NULL
    AND auth.uid() IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM private.resource_deletions WHERE active AND transaction_id = txid_current()
    ) THEN
    RAISE EXCEPTION 'Zaštićeno brisanje ručnih sati zahtijeva novu verziju aplikacije i delete_work_time_with_history.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE FUNCTION private.capture_work_time_order_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  target uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  FOR target IN SELECT DISTINCT value::uuid FROM (
    VALUES (CASE WHEN TG_TABLE_NAME = 'radni_nalozi' THEN old_data->>'id' ELSE old_data->>'nalog_id' END),
      (CASE WHEN TG_TABLE_NAME = 'radni_nalozi' THEN new_data->>'id' ELSE new_data->>'nalog_id' END)
  ) orders(value) WHERE value IS NOT NULL LOOP
    INSERT INTO private.work_time_order_versions VALUES (target, nextval('private.resource_recovery_revision'))
      ON CONFLICT (nalog_id) DO UPDATE SET revision = EXCLUDED.revision;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER guard_work_time_restore BEFORE INSERT OR UPDATE OR DELETE ON public.radno_vrijeme
  FOR EACH ROW EXECUTE FUNCTION private.guard_work_time_restore();
CREATE TRIGGER guard_work_time_restore BEFORE INSERT OR UPDATE OR DELETE ON public.radni_nalozi_radnici
  FOR EACH ROW EXECUTE FUNCTION private.guard_work_time_restore();
CREATE TRIGGER capture_work_time_order_version AFTER INSERT OR UPDATE OR DELETE ON public.radno_vrijeme
  FOR EACH ROW EXECUTE FUNCTION private.capture_work_time_order_version();
CREATE TRIGGER capture_work_time_order_version AFTER INSERT OR UPDATE OR DELETE ON public.radni_nalozi_radnici
  FOR EACH ROW EXECUTE FUNCTION private.capture_work_time_order_version();
CREATE TRIGGER capture_work_time_order_version AFTER INSERT OR UPDATE OR DELETE ON public.radni_nalozi
  FOR EACH ROW EXECUTE FUNCTION private.capture_work_time_order_version();
REVOKE ALL ON FUNCTION private.guard_work_time_restore(), private.capture_work_time_order_version() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.replace_work_order_hours(p_nalog_id uuid, p_entries jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  company uuid := public.app_current_company_id();
  expected jsonb;
  actual jsonb;
BEGIN
  IF NOT public.app_has_module_permission('radno_vrijeme', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja radnog vremena.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.radni_nalozi WHERE id = p_nalog_id AND company_id = company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nalog nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'Neispravna evidencija sati naloga.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_entries) entry WHERE jsonb_typeof(entry) <> 'object') THEN
    RAISE EXCEPTION 'Neispravan zapis sati naloga.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_entries) entry
    WHERE entry->>'nalog_id' IS DISTINCT FROM p_nalog_id::text OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(entry) field WHERE field NOT IN
        ('radnik_id', 'gradiliste_id', 'datum', 'sati', 'napomena', 'nalog_id', 'nocni_sati')
    )
  ) THEN RAISE EXCEPTION 'Neispravna veza ili polja sati naloga.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_entries) entry(
    radnik_id uuid, gradiliste_id uuid, datum date, sati numeric, nocni_sati numeric
  ) WHERE entry.datum IS NULL OR entry.sati IS NULL OR entry.sati <= 0
    OR COALESCE(entry.nocni_sati, 0) < 0 OR COALESCE(entry.nocni_sati, 0) > entry.sati
    OR NOT EXISTS (SELECT 1 FROM public.radnici WHERE id = entry.radnik_id AND company_id = company)
    OR (entry.gradiliste_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.gradilista WHERE id = entry.gradiliste_id AND company_id = company
    ))
  ) THEN RAISE EXCEPTION 'Neispravni sati, datum, djelatnik ili gradilište naloga.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_entries) entry GROUP BY entry->>'radnik_id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Djelatnik ne smije imati dvostruke sate u istom obračunu naloga.' USING ERRCODE = '22023';
  END IF;
  -- Replacement and recovery serialize on the order, including empty recalculations.
  DELETE FROM public.radno_vrijeme WHERE nalog_id = p_nalog_id AND company_id = company;
  INSERT INTO public.radno_vrijeme(company_id, nalog_id, radnik_id, gradiliste_id, datum, sati, nocni_sati, napomena)
    SELECT company, p_nalog_id, entry.radnik_id, entry.gradiliste_id, entry.datum, entry.sati, COALESCE(entry.nocni_sati, 0), entry.napomena
    FROM jsonb_populate_recordset(NULL::public.radno_vrijeme, p_entries) entry;
  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.radnik_id), '[]'::jsonb) INTO expected FROM (
    SELECT entry.radnik_id, entry.gradiliste_id, entry.datum, entry.sati, COALESCE(entry.nocni_sati, 0) nocni_sati, entry.napomena
    FROM jsonb_populate_recordset(NULL::public.radno_vrijeme, p_entries) entry
  ) row_data;
  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.radnik_id), '[]'::jsonb) INTO actual FROM (
    SELECT r.radnik_id, r.gradiliste_id, r.datum, r.sati, r.nocni_sati, r.napomena
    FROM public.radno_vrijeme r WHERE r.nalog_id = p_nalog_id AND r.company_id = company
  ) row_data;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Pravila baze nisu dopustila točnu zamjenu sati naloga. Obračun sati je poništen.';
  END IF;
  INSERT INTO private.work_time_order_versions VALUES (p_nalog_id, nextval('private.resource_recovery_revision'))
    ON CONFLICT (nalog_id) DO UPDATE SET revision = EXCLUDED.revision;
END;
$$;

CREATE FUNCTION public.delete_work_time_with_history(p_record_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  resource jsonb;
  operation_id uuid;
  history_sequence bigint;
  untracked text;
BEGIN
  IF NOT public.app_has_module_permission('radno_vrijeme', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja radnog vremena.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.radni_nalozi WHERE id = (
    SELECT nalog_id FROM public.radno_vrijeme WHERE id = p_record_id AND company_id = public.app_current_company_id()
  ) FOR UPDATE;
  SELECT to_jsonb(r) INTO resource FROM public.radno_vrijeme r
    WHERE r.id = p_record_id AND r.company_id = public.app_current_company_id() FOR UPDATE;
  IF resource IS NULL THEN RAISE EXCEPTION 'Radno vrijeme nije dostupno u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  WITH RECURSIVE affected(oid, cascading) AS (
    SELECT 'public.radno_vrijeme'::regclass::oid, true
    UNION SELECT fk.conrelid, fk.confdeltype = 'c' FROM pg_constraint fk JOIN affected parent ON parent.oid = fk.confrelid
      WHERE parent.cascading AND fk.contype = 'f' AND fk.confdeltype IN ('c', 'n', 'd')
  )
  SELECT c.relname INTO untracked FROM affected JOIN pg_class c USING (oid) JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'public' OR NOT EXISTS (SELECT 1 FROM private.resource_recovery_tables WHERE table_name = c.relname) LIMIT 1;
  IF untracked IS NOT NULL THEN RAISE EXCEPTION 'Povrat nije pripremljen za povezanu tablicu %. Ništa nije obrisano.', untracked; END IF;
  SELECT COALESCE(max(sequence), 0) INTO history_sequence FROM private.business_change_history;
  INSERT INTO private.resource_deletions(company_id, module, table_name, record_id, snapshot, actor_name)
    VALUES (public.app_current_company_id(), 'radno_vrijeme', 'radno_vrijeme', p_record_id, resource,
      COALESCE((SELECT email FROM public.app_profiles WHERE id = auth.uid()), 'Korisnik')) RETURNING id INTO operation_id;
  DELETE FROM public.radno_vrijeme WHERE id = p_record_id;
  IF EXISTS (SELECT 1 FROM public.radno_vrijeme WHERE id = p_record_id) OR NOT EXISTS (
    SELECT 1 FROM private.resource_deletion_rows WHERE deletion_id = operation_id
      AND table_name = 'radno_vrijeme' AND row_key = jsonb_build_object('id', p_record_id) AND after_data IS NULL
  ) THEN RAISE EXCEPTION 'Brisanje nije provedeno i evidentirano. Ništa nije obrisano.'; END IF;
  IF NOT private.resource_deletion_allowed(operation_id) THEN
    RAISE EXCEPTION 'Nedostaju prava uređivanja povezanih modula. Ništa nije obrisano.' USING ERRCODE = '42501';
  END IF;
  IF resource->>'nalog_id' IS NOT NULL THEN
    INSERT INTO private.work_time_deletion_orders
      SELECT operation_id, nalog_id, revision FROM private.work_time_order_versions
      WHERE nalog_id = (resource->>'nalog_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Veza sati s nalogom nije evidentirana. Ništa nije obrisano.'; END IF;
  END IF;
  INSERT INTO private.resource_deletion_events
    SELECT operation_id, id FROM private.business_change_history WHERE transaction_id = txid_current() AND sequence > history_sequence;
  UPDATE private.resource_deletions SET active = false WHERE id = operation_id;
  RETURN operation_id;
END;
$$;

CREATE FUNCTION public.get_work_time_deletions(p_before_time timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, snapshot jsonb, actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, can_restore boolean, affected_rows jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.app_has_module_permission('radno_vrijeme', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja radnog vremena.' USING ERRCODE = '42501';
  END IF;
  IF (p_before_time IS NULL) <> (p_before_id IS NULL) THEN RAISE EXCEPTION 'Nepotpun pokazivač stranice.' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT d.id, d.snapshot, d.actor_name, d.created_at, d.expires_at, d.reversed_at,
    d.reversed_at IS NULL AND private.resource_deletion_allowed(d.id) AND (
      d.snapshot->>'nalog_id' IS NULL OR EXISTS (
        SELECT 1 FROM private.work_time_deletion_orders dependency
          JOIN private.work_time_order_versions current_version USING (nalog_id)
        WHERE dependency.deletion_id = d.id AND dependency.revision = current_version.revision
      )
    ),
    (SELECT jsonb_object_agg(summary.table_name, summary.total) FROM (
      SELECT r.table_name, count(*) total FROM private.resource_deletion_rows r WHERE r.deletion_id = d.id GROUP BY r.table_name
    ) summary)
  FROM private.resource_deletions d WHERE d.company_id = public.app_current_company_id()
    AND d.module = 'radno_vrijeme' AND d.table_name = 'radno_vrijeme'
    AND NOT d.active AND d.expires_at > now()
    AND (p_before_time IS NULL OR (d.created_at, d.id) < (p_before_time, p_before_id))
    ORDER BY d.created_at DESC, d.id DESC LIMIT 50;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_work_time_with_history(uuid), public.get_work_time_deletions(timestamptz, uuid), public.replace_work_order_hours(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_work_time_with_history(uuid), public.get_work_time_deletions(timestamptz, uuid), public.replace_work_order_hours(uuid, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
