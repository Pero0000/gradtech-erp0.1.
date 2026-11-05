CREATE OR REPLACE FUNCTION private.resource_recovery_module(p_table text, p_data jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_table IN ('gradilista', 'gradiliste_board_layout', 'gradiliste_zadaci', 'gradiliste_dokumenti', 'gradiliste_stavke', 'rokovi', 'ugovoreni_radovi') THEN 'gradilista'
    WHEN p_table = 'fakture' THEN 'fakture'
    WHEN p_table = 'ponude' THEN 'ponude'
    WHEN p_table = 'kooperant_angazmani' THEN 'kooperanti'
    WHEN p_table IN ('radnici', 'radnici_dokumenti', 'radnici_odsustva', 'radnici_povijest', 'radnik_dokument_kategorije') THEN 'radnici'
    WHEN p_table IN ('vozila', 'vozila_dokumenti', 'vozila_gorivo', 'vozila_obavijesti', 'vozila_gorivo_anomalije') THEN 'vozila'
    WHEN p_table = 'oprema' THEN CASE p_data->>'kategorija' WHEN 'alat' THEN 'alat' ELSE 'strojevi' END
    WHEN p_table = 'oprema_dokumenti' THEN 'oprema'
    WHEN p_table IN ('raspored', 'raspored_radnici', 'raspored_vozila', 'dnevni_raspored_gradilista', 'dnevni_raspored_radnici', 'dnevni_raspored_ostalo', 'raspored_objave') THEN 'raspored'
    WHEN p_table = 'radno_vrijeme' THEN 'radno_vrijeme'
    WHEN p_table LIKE 'radni_nalozi%' OR p_table IN ('nalog_gradiliste_dokumenti', 'mobile_work_order_audit') THEN 'radni_nalozi'
    WHEN p_table = 'app_profiles' THEN 'admin'
    WHEN p_table = 'troskovi' THEN 'troskovi'
    ELSE 'unsupported' END;
$$;

-- Reuse retained paths and restrictive Storage policies; references contain no document content.
CREATE TABLE private.resource_file_references (
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  path text NOT NULL,
  company_id uuid NOT NULL,
  PRIMARY KEY (table_name, record_id, path)
);
CREATE INDEX resource_file_references_path ON private.resource_file_references(path, company_id);
ALTER TABLE private.resource_file_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.resource_file_references FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.resource_file_paths(p_table text, p_data jsonb)
RETURNS SETOF text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT DISTINCT value FROM jsonb_each_text(p_data)
    WHERE NULLIF(value, '') IS NOT NULL AND key = ANY(CASE p_table
      WHEN 'gradilista' THEN ARRAY['onedrive_map_file_path']
      WHEN 'ugovoreni_radovi' THEN ARRAY['dokument_putanja']
      WHEN 'gradiliste_dokumenti' THEN ARRAY['putanja', 'thumbnail_path']
      WHEN 'radni_nalozi_foto' THEN ARRAY['putanja', 'thumbnail_path']
      WHEN 'radni_nalozi_dokumenti' THEN ARRAY['putanja']
      ELSE ARRAY[]::text[] END);
$$;
REVOKE ALL ON FUNCTION private.resource_file_paths(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.capture_resource_file_references()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  row_data jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  row_data := COALESCE(new_data, old_data);
  INSERT INTO private.retained_document_files(path, company_id)
    SELECT path, (snapshot->>'company_id')::uuid FROM (VALUES (old_data), (new_data)) data(snapshot)
      CROSS JOIN LATERAL private.resource_file_paths(TG_TABLE_NAME, snapshot) path
    ON CONFLICT (path) DO NOTHING;
  DELETE FROM private.resource_file_references
    WHERE table_name = TG_TABLE_NAME
      AND record_id IN ((row_data->>'id')::uuid, (old_data->>'id')::uuid);
  INSERT INTO private.resource_file_references
    SELECT TG_TABLE_NAME, (new_data->>'id')::uuid, path, (new_data->>'company_id')::uuid
      FROM private.resource_file_paths(TG_TABLE_NAME, new_data) path;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION private.capture_resource_file_references() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['gradilista', 'gradiliste_dokumenti', 'radni_nalozi_dokumenti', 'radni_nalozi_foto', 'ugovoreni_radovi'] LOOP
    EXECUTE format('CREATE TRIGGER resource_file_references AFTER INSERT OR UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION private.capture_resource_file_references()', target);
    EXECUTE format('INSERT INTO private.resource_file_references
      SELECT %L, r.id, path, r.company_id FROM public.%I r
      CROSS JOIN LATERAL private.resource_file_paths(%L, to_jsonb(r)) path', target, target, target);
  END LOOP;
END;
$$;
INSERT INTO private.retained_document_files(path, company_id)
  SELECT DISTINCT path, company_id FROM private.resource_file_references ON CONFLICT (path) DO NOTHING;

CREATE OR REPLACE FUNCTION public.app_document_file_visible(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM private.retained_document_files WHERE path = p_path)
    OR EXISTS (SELECT 1 FROM public.radnici_dokumenti WHERE putanja = p_path AND company_id = public.app_current_company_id())
    OR EXISTS (SELECT 1 FROM public.vozila_dokumenti WHERE putanja = p_path AND company_id = public.app_current_company_id())
    OR EXISTS (SELECT 1 FROM public.oprema_dokumenti WHERE putanja = p_path AND company_id = public.app_current_company_id())
    OR EXISTS (SELECT 1 FROM private.resource_file_references WHERE path = p_path AND company_id = public.app_current_company_id());
$$;

-- Validation runs before restoring each file-bearing row, including thumbnails and site/VTR files.
CREATE FUNCTION private.validate_resource_restore_files()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE path text;
BEGIN
  IF private.resource_restore_snapshot(TG_TABLE_NAME, NEW.id) IS NOT NULL THEN
    FOR path IN SELECT private.resource_file_paths(TG_TABLE_NAME, to_jsonb(NEW)) LOOP
      IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'nalozi-foto' AND o.name = path) THEN
        RAISE EXCEPTION 'Nedostaje prilog %. Ništa nije vraćeno.', path;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_resource_restore_files() FROM PUBLIC, anon, authenticated;
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['gradilista', 'gradiliste_dokumenti', 'radni_nalozi_dokumenti', 'radni_nalozi_foto', 'ugovoreni_radovi'] LOOP
    EXECUTE format('CREATE TRIGGER validate_resource_restore_files BEFORE INSERT OR UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION private.validate_resource_restore_files()', target);
  END LOOP;
END;
$$;

CREATE TRIGGER guard_resource_deletion BEFORE DELETE ON public.gradilista
  FOR EACH ROW EXECUTE FUNCTION private.guard_resource_deletion();

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
  IF p_table NOT IN ('radnici', 'vozila', 'oprema', 'gradilista') THEN RAISE EXCEPTION 'Tablica nije podržana.' USING ERRCODE = '22023'; END IF;
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
  IF p_table = 'gradilista' THEN
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

CREATE OR REPLACE FUNCTION public.get_resource_deletions(p_module text, p_before_time timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, snapshot jsonb, actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, can_restore boolean, affected_rows jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_module NOT IN ('radnici', 'vozila', 'alat', 'strojevi', 'gradilista') OR NOT public.app_has_module_permission(p_module, 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja modula.' USING ERRCODE = '42501';
  END IF;
  IF (p_before_time IS NULL) <> (p_before_id IS NULL) THEN RAISE EXCEPTION 'Nepotpun pokazivač stranice.' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT d.id, d.snapshot, d.actor_name, d.created_at, d.expires_at, d.reversed_at,
    d.reversed_at IS NULL AND private.resource_deletion_allowed(d.id),
    (SELECT jsonb_object_agg(summary.table_name, summary.total) FROM (
      SELECT r.table_name, count(*) total FROM private.resource_deletion_rows r WHERE r.deletion_id = d.id GROUP BY r.table_name
    ) summary)
  FROM private.resource_deletions d WHERE d.company_id = public.app_current_company_id() AND d.module = p_module
    AND NOT d.active AND d.expires_at > now()
    AND (p_before_time IS NULL OR (d.created_at, d.id) < (p_before_time, p_before_id))
    ORDER BY d.created_at DESC, d.id DESC LIMIT 50;
END;
$$;

-- An order must be inserted before its team; only the trusted bundle can prove that future assignment.
CREATE OR REPLACE FUNCTION public.validate_work_order_driver_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.vozac_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi_radnici WHERE nalog_id = NEW.id AND radnik_id = NEW.vozac_id
  ) AND NOT EXISTS (
    SELECT 1 FROM private.resource_deletions d JOIN private.resource_deletion_rows r ON r.deletion_id = d.id
    WHERE d.active AND d.restoring AND d.transaction_id = txid_current() AND d.company_id = NEW.company_id
      AND r.table_name = 'radni_nalozi_radnici'
      AND r.before_data->>'nalog_id' = NEW.id::text AND r.before_data->>'radnik_id' = NEW.vozac_id::text
      AND r.before_data->>'company_id' = NEW.company_id::text
      AND private.resource_restore_snapshot('radni_nalozi', NEW.id)->>'vozac_id' = NEW.vozac_id::text
  ) THEN RAISE EXCEPTION 'Vozač mora biti djelatnik dodijeljen radnom nalogu.'; END IF;
  RETURN NEW;
END;
$$;

-- Table order alone cannot resolve self-references or rows with several independent parents.
CREATE FUNCTION private.resource_recovery_parents_exist(p_table text, p_data jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  relation record;
  predicate text;
  present boolean;
BEGIN
  IF p_data IS NULL THEN RETURN true; END IF;
  FOR relation IN SELECT c.* FROM pg_constraint c
    WHERE c.conrelid = format('public.%I', p_table)::regclass AND c.contype = 'f'
  LOOP
    IF EXISTS (SELECT 1 FROM unnest(relation.conkey) num
      JOIN pg_attribute a ON a.attrelid = relation.conrelid AND a.attnum = num
      WHERE p_data->>a.attname IS NULL) THEN CONTINUE; END IF;
    SELECT string_agg(format('parent.%I = child.%I', parent.attname, child.attname), ' AND ') INTO predicate
      FROM unnest(relation.conkey, relation.confkey) keys(child_num, parent_num)
      JOIN pg_attribute child ON child.attrelid = relation.conrelid AND child.attnum = keys.child_num
      JOIN pg_attribute parent ON parent.attrelid = relation.confrelid AND parent.attnum = keys.parent_num;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s parent, jsonb_populate_record(NULL::public.%I, $1) child WHERE %s)',
      relation.confrelid::regclass, p_table, predicate) INTO present USING p_data;
    IF NOT present THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION private.resource_recovery_parents_exist(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.restore_resource_deletion(p_deletion_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  operation private.resource_deletions%ROWTYPE;
  item private.resource_deletion_rows%ROWTYPE;
  current_data jsonb;
  restored_data jsonb;
  current_revision bigint;
  columns_list text;
  assignments text;
  row_filter text;
  history_sequence bigint;
  original_event record;
  undo_id uuid;
  pending bigint[];
  progressed boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('resource-restore:' || public.app_current_company_id()::text, 0));
  SELECT * INTO operation FROM private.resource_deletions
    WHERE id = p_deletion_id AND company_id = public.app_current_company_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Brisanje nije dostupno u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  IF operation.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Brisanje je već vraćeno.'; END IF;
  IF operation.active OR operation.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Istekao je rok od 30 dana.'; END IF;
  IF NOT private.resource_deletion_allowed(operation.id) THEN RAISE EXCEPTION 'Nedostaju prava za povezane module ili administratorska prava.' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(max(sequence), 0) INTO history_sequence FROM private.business_change_history;
  UPDATE private.resource_deletions SET active = true, restoring = true, transaction_id = txid_current() WHERE id = operation.id;
  SELECT array_agg(sequence ORDER BY sequence) INTO pending FROM private.resource_deletion_rows WHERE deletion_id = operation.id;
  WHILE cardinality(pending) > 0 LOOP
    progressed := false;
    FOR item IN SELECT * FROM private.resource_deletion_rows WHERE sequence = ANY(pending)
      ORDER BY CASE WHEN after_data IS NULL THEN 0 ELSE 1 END, sequence
    LOOP
      IF NOT private.resource_recovery_parents_exist(item.table_name, item.before_data) THEN CONTINUE; END IF;
      SELECT string_agg(format('r.%I IS NOT DISTINCT FROM key.%I', key_column, key_column), ' AND ')
        INTO row_filter FROM private.resource_recovery_tables t, unnest(t.key_columns) key_column WHERE t.table_name = item.table_name;
      EXECUTE format('SELECT to_jsonb(r) FROM public.%I r,
        jsonb_populate_record(NULL::public.%I, $1) key WHERE %s FOR UPDATE OF r', item.table_name, item.table_name, row_filter)
        INTO current_data USING item.row_key;
      SELECT revision INTO current_revision FROM private.resource_recovery_versions
        WHERE table_name = item.table_name AND row_key = item.row_key FOR UPDATE;
      IF item.table_name = 'app_profiles' THEN
        SELECT jsonb_object_agg(key, value) INTO current_data FROM jsonb_each(current_data) WHERE key IN ('id', 'company_id', 'radnik_id');
      END IF;
      IF current_data IS DISTINCT FROM item.after_data OR current_revision IS DISTINCT FROM item.after_revision THEN
        RAISE EXCEPTION 'Povezani zapis u tablici % naknadno je promijenjen. Ništa nije vraćeno.', item.table_name USING ERRCODE = '40001';
      END IF;
      IF item.table_name IN ('radnici_dokumenti', 'vozila_dokumenti', 'oprema_dokumenti') AND item.before_data->>'putanja' IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'nalozi-foto' AND name = item.before_data->>'putanja') THEN
        RAISE EXCEPTION 'Nedostaje prilog dokumenta. Ništa nije vraćeno.';
      END IF;
      SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum),
        string_agg(format('%I = previous.%I', a.attname, a.attname), ', ' ORDER BY a.attnum)
        FILTER (WHERE item.before_data->a.attname IS DISTINCT FROM item.after_data->a.attname)
        INTO columns_list, assignments FROM pg_attribute a
        WHERE a.attrelid = format('public.%I', item.table_name)::regclass AND a.attnum > 0
          AND NOT a.attisdropped AND a.attgenerated = '' AND item.before_data ? a.attname;
      IF item.before_data IS NULL THEN
        EXECUTE format('DELETE FROM public.%I r USING jsonb_populate_record(NULL::public.%I, $1) key WHERE %s',
          item.table_name, item.table_name, row_filter) USING item.row_key;
      ELSIF item.after_data IS NULL THEN
        EXECUTE format('INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)',
          item.table_name, columns_list, columns_list, item.table_name) USING item.before_data;
      ELSE
        EXECUTE format('UPDATE public.%I r SET %s FROM jsonb_populate_record(NULL::public.%I, $1) previous,
          jsonb_populate_record(NULL::public.%I, $2) key WHERE %s', item.table_name, assignments, item.table_name, item.table_name, row_filter)
          USING item.before_data, item.row_key;
      END IF;
      EXECUTE format('SELECT to_jsonb(r) FROM public.%I r, jsonb_populate_record(NULL::public.%I, $1) key WHERE %s',
        item.table_name, item.table_name, row_filter) INTO restored_data USING item.row_key;
      IF item.table_name = 'app_profiles' THEN
        SELECT jsonb_object_agg(key, value) INTO restored_data FROM jsonb_each(restored_data) WHERE key IN ('id', 'company_id', 'radnik_id');
      END IF;
      IF restored_data IS DISTINCT FROM item.before_data THEN
        RAISE EXCEPTION 'Pravila tablice % nisu dopustila točan povrat. Ništa nije vraćeno.', item.table_name;
      END IF;
      UPDATE private.resource_deletion_rows earlier SET after_revision = v.revision
        FROM private.resource_recovery_versions v, private.resource_deletions parent
        WHERE earlier.deletion_id = parent.id AND parent.company_id = operation.company_id
          AND parent.reversed_at IS NULL AND parent.id <> operation.id AND parent.created_at < operation.created_at
          AND earlier.table_name = item.table_name AND earlier.row_key = item.row_key
          AND earlier.after_revision = item.before_revision AND earlier.after_data IS NOT DISTINCT FROM restored_data
          AND v.table_name = item.table_name AND v.row_key = item.row_key;
      pending := array_remove(pending, item.sequence);
      progressed := true;
    END LOOP;
    IF NOT progressed THEN
      RAISE EXCEPTION 'Nedostaje povezani zapis ili postoji kružna veza. Ništa nije vraćeno.' USING ERRCODE = '23503';
    END IF;
  END LOOP;
  FOR item IN SELECT * FROM private.resource_deletion_rows WHERE deletion_id = operation.id LOOP
    SELECT string_agg(format('r.%I IS NOT DISTINCT FROM key.%I', key_column, key_column), ' AND ')
      INTO row_filter FROM private.resource_recovery_tables t, unnest(t.key_columns) key_column WHERE t.table_name = item.table_name;
    EXECUTE format('SELECT to_jsonb(r) FROM public.%I r, jsonb_populate_record(NULL::public.%I, $1) key WHERE %s',
      item.table_name, item.table_name, row_filter) INTO restored_data USING item.row_key;
    IF item.table_name = 'app_profiles' THEN
      SELECT jsonb_object_agg(key, value) INTO restored_data FROM jsonb_each(restored_data) WHERE key IN ('id', 'company_id', 'radnik_id');
    END IF;
    IF restored_data IS DISTINCT FROM item.before_data THEN
      RAISE EXCEPTION 'Završna provjera povezanih podataka u tablici % nije prošla. Ništa nije vraćeno.', item.table_name;
    END IF;
    IF item.table_name = 'radni_nalozi' AND restored_data->>'vozac_id' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.radni_nalozi_radnici WHERE nalog_id = (restored_data->>'id')::uuid
        AND radnik_id = (restored_data->>'vozac_id')::uuid AND company_id = operation.company_id
    ) THEN RAISE EXCEPTION 'Vozač nije obnovljen u ekipi naloga. Ništa nije vraćeno.'; END IF;
  END LOOP;
  FOR original_event IN SELECT h.* FROM private.business_change_history h JOIN private.resource_deletion_events link ON link.history_id = h.id
    WHERE link.deletion_id = operation.id LOOP
    SELECT h.id INTO undo_id FROM private.business_change_history h
      WHERE h.transaction_id = txid_current() AND h.sequence > history_sequence
        AND h.table_name = original_event.table_name AND h.record_id = original_event.record_id
        AND h.before_data IS NOT DISTINCT FROM original_event.after_data AND h.after_data IS NOT DISTINCT FROM original_event.before_data
      ORDER BY h.sequence DESC LIMIT 1;
    UPDATE private.business_change_history SET reversed_at = clock_timestamp(), reversed_by = auth.uid() WHERE id = original_event.id;
    IF undo_id IS NOT NULL THEN UPDATE private.business_change_history SET reverses_id = original_event.id WHERE id = undo_id; END IF;
  END LOOP;
  UPDATE private.resource_deletions SET active = false, restoring = false, reversed_at = clock_timestamp() WHERE id = operation.id;
END;
$$;

NOTIFY pgrst, 'reload schema';
