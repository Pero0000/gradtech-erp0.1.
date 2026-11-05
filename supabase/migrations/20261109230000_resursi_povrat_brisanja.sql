CREATE TABLE private.resource_recovery_tables (
  table_name text PRIMARY KEY,
  key_columns text[] NOT NULL
);
CREATE SEQUENCE private.resource_recovery_revision;
CREATE TABLE private.resource_recovery_versions (
  table_name text NOT NULL,
  row_key jsonb NOT NULL,
  revision bigint NOT NULL,
  PRIMARY KEY (table_name, row_key)
);
CREATE TABLE private.resource_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  module text NOT NULL,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '30 days',
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  active boolean NOT NULL DEFAULT true,
  restoring boolean NOT NULL DEFAULT false,
  reversed_at timestamptz
);
CREATE UNIQUE INDEX resource_deletions_active_transaction ON private.resource_deletions(transaction_id) WHERE active;
CREATE INDEX resource_deletions_company_module ON private.resource_deletions(company_id, module, created_at DESC, id DESC);
CREATE TABLE private.resource_deletion_rows (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deletion_id uuid NOT NULL REFERENCES private.resource_deletions(id) ON DELETE CASCADE,
  table_name text NOT NULL REFERENCES private.resource_recovery_tables(table_name),
  row_key jsonb NOT NULL,
  before_data jsonb,
  after_data jsonb,
  before_revision bigint,
  after_revision bigint NOT NULL,
  UNIQUE (deletion_id, table_name, row_key)
);
CREATE TABLE private.resource_deletion_events (
  deletion_id uuid NOT NULL REFERENCES private.resource_deletions(id) ON DELETE CASCADE,
  history_id uuid NOT NULL,
  PRIMARY KEY (deletion_id, history_id)
);
ALTER TABLE private.resource_recovery_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.resource_recovery_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.resource_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.resource_deletion_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.resource_deletion_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.resource_recovery_tables, private.resource_recovery_versions,
  private.resource_deletions, private.resource_deletion_rows, private.resource_deletion_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.resource_recovery_revision FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.resource_recovery_module(p_table text, p_data jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
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

CREATE FUNCTION private.capture_resource_recovery_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  row_data jsonb;
  row_identity jsonb;
  previous_revision bigint;
  current_revision bigint;
  operation private.resource_deletions%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  IF old_data IS NOT DISTINCT FROM new_data THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT * INTO operation FROM private.resource_deletions WHERE active AND transaction_id = txid_current();
  -- Account recovery here reconnects a worker only; it never snapshots/restores roles, tokens or approval.
  IF TG_TABLE_NAME = 'app_profiles' THEN
    IF old_data->'radnik_id' IS NOT DISTINCT FROM new_data->'radnik_id' THEN RETURN COALESCE(NEW, OLD); END IF;
    IF operation.id IS NOT NULL AND (
      TG_OP <> 'UPDATE' OR (old_data - 'radnik_id') IS DISTINCT FROM (new_data - 'radnik_id')
    ) THEN RAISE EXCEPTION 'Brisanje je promijenilo račun ili prava. Radnja je poništena.'; END IF;
    SELECT jsonb_object_agg(key, value) INTO old_data FROM jsonb_each(old_data) WHERE key IN ('id', 'company_id', 'radnik_id');
    SELECT jsonb_object_agg(key, value) INTO new_data FROM jsonb_each(new_data) WHERE key IN ('id', 'company_id', 'radnik_id');
  END IF;
  row_data := COALESCE(new_data, old_data);
  SELECT jsonb_object_agg(key, row_data->key) INTO row_identity
    FROM private.resource_recovery_tables definition, unnest(definition.key_columns) key
    WHERE definition.table_name = TG_TABLE_NAME;
  SELECT revision INTO previous_revision FROM private.resource_recovery_versions
    WHERE table_name = TG_TABLE_NAME AND row_key = row_identity FOR UPDATE;
  current_revision := nextval('private.resource_recovery_revision');
  INSERT INTO private.resource_recovery_versions VALUES (TG_TABLE_NAME, row_identity, current_revision)
    ON CONFLICT (table_name, row_key) DO UPDATE SET revision = EXCLUDED.revision;
  IF operation.id IS NOT NULL AND NOT operation.restoring THEN
    IF (row_data->>'company_id')::uuid IS DISTINCT FROM operation.company_id THEN
      RAISE EXCEPTION 'Brisanje bi promijenilo podatke druge tvrtke. Radnja je poništena.' USING ERRCODE = '42501';
    END IF;
    -- Audit entries stay append-only; only changes to an existing audit row (e.g. actor FK) are restored.
    IF TG_TABLE_NAME <> 'mobile_work_order_audit' OR TG_OP <> 'INSERT' THEN
      INSERT INTO private.resource_deletion_rows (
        deletion_id, table_name, row_key, before_data, after_data, before_revision, after_revision
      ) VALUES (operation.id, TG_TABLE_NAME, row_identity, old_data, new_data, previous_revision, current_revision)
      ON CONFLICT (deletion_id, table_name, row_key) DO UPDATE
        SET after_data = EXCLUDED.after_data, after_revision = EXCLUDED.after_revision;
    END IF;
  ELSIF operation.id IS NOT NULL AND operation.restoring
    AND NOT (TG_TABLE_NAME = 'mobile_work_order_audit' AND TG_OP = 'INSERT')
    AND NOT EXISTS (
      SELECT 1 FROM private.resource_deletion_rows WHERE deletion_id = operation.id
        AND table_name = TG_TABLE_NAME AND row_key = row_identity
    ) THEN
    RAISE EXCEPTION 'Povrat bi promijenio dodatni zapis u tablici %. Ništa nije vraćeno.', TG_TABLE_NAME;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE
  target record;
  keys text[];
BEGIN
  FOR target IN
    SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname NOT IN ('app_user_permissions', 'app_push_tokens')
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped)
  LOOP
    SELECT array_agg(a.attname::text ORDER BY key.ordinality) INTO keys
    FROM pg_constraint pk CROSS JOIN LATERAL unnest(pk.conkey) WITH ORDINALITY key(attnum, ordinality)
    JOIN pg_attribute a ON a.attrelid = pk.conrelid AND a.attnum = key.attnum
    WHERE pk.conrelid = target.oid AND pk.contype = 'p';
    IF keys IS NULL THEN RAISE EXCEPTION 'Tablica % nema primarni ključ potreban za siguran povrat.', target.relname; END IF;
    INSERT INTO private.resource_recovery_tables VALUES (target.relname, keys);
    EXECUTE format('CREATE TRIGGER zzzz_resource_recovery AFTER INSERT OR UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION private.capture_resource_recovery_row()', target.relname);
  END LOOP;
END;
$$;

CREATE FUNCTION private.resource_deletion_allowed(p_deletion_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  operation private.resource_deletions%ROWTYPE;
  item record;
  required_module text;
  equipment jsonb;
BEGIN
  SELECT * INTO operation FROM private.resource_deletions WHERE id = p_deletion_id;
  IF operation.company_id IS DISTINCT FROM public.app_current_company_id()
    OR NOT public.app_has_module_permission(operation.module, 'edit') THEN RETURN false; END IF;
  FOR item IN SELECT table_name, COALESCE(before_data, after_data) snapshot
    FROM private.resource_deletion_rows WHERE deletion_id = operation.id LOOP
    required_module := private.resource_recovery_module(item.table_name, item.snapshot);
    IF required_module = 'admin' THEN
      IF NOT public.app_is_admin() THEN RETURN false; END IF;
    ELSIF required_module = 'oprema' THEN
      SELECT snapshot INTO equipment FROM private.resource_deletions
        WHERE table_name = 'oprema' AND record_id = (item.snapshot->>'oprema_id')::uuid AND id = operation.id;
      IF equipment IS NULL THEN SELECT to_jsonb(o) INTO equipment FROM public.oprema o
        WHERE id = (item.snapshot->>'oprema_id')::uuid AND company_id = operation.company_id; END IF;
      IF equipment IS NULL THEN RETURN false; END IF;
      required_module := private.resource_recovery_module('oprema', equipment);
      IF NOT public.app_has_module_permission(required_module, 'edit') THEN RETURN false; END IF;
    ELSIF required_module = 'unsupported' OR NOT public.app_has_module_permission(required_module, 'edit') THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE FUNCTION private.guard_resource_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM private.resource_deletions WHERE active AND NOT restoring
      AND transaction_id = txid_current() AND table_name = TG_TABLE_NAME AND record_id = OLD.id
      AND company_id = OLD.company_id
  ) THEN
    RAISE EXCEPTION 'Zaštićeno brisanje resursa zahtijeva novu verziju aplikacije i delete_resource_with_history.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER guard_resource_deletion BEFORE DELETE ON public.radnici FOR EACH ROW EXECUTE FUNCTION private.guard_resource_deletion();
CREATE TRIGGER guard_resource_deletion BEFORE DELETE ON public.vozila FOR EACH ROW EXECUTE FUNCTION private.guard_resource_deletion();
CREATE TRIGGER guard_resource_deletion BEFORE DELETE ON public.oprema FOR EACH ROW EXECUTE FUNCTION private.guard_resource_deletion();

CREATE FUNCTION public.delete_resource_with_history(p_table text, p_record_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  resource jsonb;
  operation_id uuid;
  required_module text;
  history_sequence bigint;
  untracked text;
BEGIN
  IF p_table NOT IN ('radnici', 'vozila', 'oprema') THEN RAISE EXCEPTION 'Tablica nije podržana.' USING ERRCODE = '22023'; END IF;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id = $1 AND company_id = $2 FOR UPDATE', p_table)
    INTO resource USING p_record_id, public.app_current_company_id();
  IF resource IS NULL THEN RAISE EXCEPTION 'Resurs nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  required_module := private.resource_recovery_module(p_table, resource);
  IF NOT public.app_has_module_permission(required_module, 'edit') THEN RAISE EXCEPTION 'Nedostaje pravo uređivanja resursa.' USING ERRCODE = '42501'; END IF;
  -- New FK tables must be instrumented before deletion is allowed.
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
  EXECUTE format('DELETE FROM public.%I WHERE id = $1', p_table) USING p_record_id;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id = $1', p_table) INTO resource USING p_record_id;
  IF resource IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM private.resource_deletion_rows WHERE deletion_id = operation_id
      AND table_name = p_table AND row_key = jsonb_build_object('id', p_record_id) AND after_data IS NULL
  ) THEN RAISE EXCEPTION 'Brisanje nije provedeno i evidentirano. Radnja je poništena.'; END IF;
  IF NOT private.resource_deletion_allowed(operation_id) THEN
    RAISE EXCEPTION 'Za ovu radnju potrebna su prava uređivanja svih povezanih modula, a za vezu korisničkog računa administrator. Ništa nije obrisano.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO private.resource_deletion_events
    SELECT operation_id, id FROM private.business_change_history WHERE transaction_id = txid_current() AND sequence > history_sequence;
  UPDATE private.resource_deletions SET active = false WHERE id = operation_id;
  RETURN operation_id;
END;
$$;

CREATE FUNCTION public.get_resource_deletions(p_module text, p_before_time timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, snapshot jsonb, actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, can_restore boolean, affected_rows jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_module NOT IN ('radnici', 'vozila', 'alat', 'strojevi') OR NOT public.app_has_module_permission(p_module, 'edit') THEN
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

CREATE FUNCTION public.restore_resource_deletion(p_deletion_id uuid)
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
BEGIN
  -- One restore at a time per company; normal writes still use row locks and revision checks.
  PERFORM pg_advisory_xact_lock(hashtextextended('resource-restore:' || public.app_current_company_id()::text, 0));
  SELECT * INTO operation FROM private.resource_deletions
    WHERE id = p_deletion_id AND company_id = public.app_current_company_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Brisanje nije dostupno u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  IF operation.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Brisanje je već vraćeno.'; END IF;
  IF operation.active OR operation.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Istekao je rok od 30 dana.'; END IF;
  IF NOT private.resource_deletion_allowed(operation.id) THEN RAISE EXCEPTION 'Nedostaju prava za povezane module ili administratorska prava.' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(max(sequence), 0) INTO history_sequence FROM private.business_change_history;
  UPDATE private.resource_deletions SET active = true, restoring = true, transaction_id = txid_current() WHERE id = operation.id;
  FOR item IN
    WITH RECURSIVE dependencies(oid, path) AS (
      SELECT format('public.%I', operation.table_name)::regclass::oid,
        ARRAY[format('public.%I', operation.table_name)::regclass::oid]
      UNION ALL SELECT fk.conrelid, parent.path || fk.conrelid
        FROM pg_constraint fk JOIN dependencies parent ON parent.oid = fk.confrelid
        WHERE fk.contype = 'f' AND fk.confdeltype IN ('c', 'n', 'd') AND NOT fk.conrelid = ANY(parent.path)
    ), depths AS (
      SELECT c.relname, max(cardinality(dependencies.path)) depth FROM dependencies JOIN pg_class c USING (oid) GROUP BY c.relname
    )
    SELECT r.* FROM private.resource_deletion_rows r LEFT JOIN depths ON depths.relname = r.table_name
      WHERE r.deletion_id = operation.id
      ORDER BY CASE WHEN r.after_data IS NULL THEN 0 ELSE 1 END, COALESCE(depths.depth, 100), r.sequence DESC
  LOOP
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
      EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)',
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
    -- Allow undoing an earlier overlapping deletion only when this undo restores its exact revision lineage.
    UPDATE private.resource_deletion_rows earlier SET after_revision = v.revision
      FROM private.resource_recovery_versions v, private.resource_deletions parent
      WHERE earlier.deletion_id = parent.id AND parent.company_id = operation.company_id
        AND parent.reversed_at IS NULL AND parent.id <> operation.id AND parent.created_at < operation.created_at
        AND earlier.table_name = item.table_name AND earlier.row_key = item.row_key
        AND earlier.after_revision = item.before_revision AND earlier.after_data IS NOT DISTINCT FROM restored_data
        AND v.table_name = item.table_name AND v.row_key = item.row_key;
  END LOOP;
  -- Later triggers can modify a previously restored row (fuel mileage sync, for example).
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

CREATE FUNCTION private.resource_restore_snapshot(p_table text, p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT row.before_data FROM private.resource_deletions operation
    JOIN private.resource_deletion_rows row ON row.deletion_id = operation.id
    WHERE operation.active AND operation.restoring AND operation.transaction_id = txid_current()
      AND row.table_name = p_table AND row.row_key = jsonb_build_object('id', p_id);
$$;

CREATE OR REPLACE FUNCTION private.set_radnik_dokument_category_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  category_name text;
  recovery_snapshot jsonb;
BEGIN
  category_name := CASE NEW.vrsta WHEN 'lijecnicki' THEN 'Liječnički pregled' WHEN 'atest' THEN 'Atest'
    WHEN 'zastita_na_radu' THEN 'Zaštita na radu' WHEN 'osposobljavanje' THEN 'Osposobljavanje'
    WHEN 'ostalo' THEN 'Ostalo' ELSE NULL END;
  IF category_name IS NULL THEN
    SELECT category.naziv INTO category_name FROM public.radnik_dokument_kategorije category
      WHERE 'custom:' || category.id::text = NEW.vrsta AND category.company_id = NEW.company_id;
  END IF;
  IF category_name IS NULL THEN RAISE EXCEPTION 'Odaberite kategoriju dokumenta iz svoje tvrtke.' USING ERRCODE = '23514'; END IF;
  recovery_snapshot := private.resource_restore_snapshot('radnici_dokumenti', NEW.id);
  IF recovery_snapshot IS NOT NULL AND recovery_snapshot->>'vrsta' = NEW.vrsta THEN
    NEW.naziv := recovery_snapshot->>'naziv';
  ELSE NEW.naziv := category_name; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_vozila_gorivo_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  vehicle_company uuid;
  worker_company uuid;
  worker_name text;
  recovery_snapshot jsonb;
BEGIN
  SELECT company_id INTO vehicle_company FROM public.vozila WHERE id = NEW.vozilo_id;
  IF vehicle_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Vozilo mora pripadati istoj tvrtki kao zapis goriva.' USING ERRCODE = '23514';
  END IF;
  IF NEW.tocio_radnik_id IS NOT NULL THEN
    SELECT company_id, concat_ws(' ', ime, prezime) INTO worker_company, worker_name FROM public.radnici WHERE id = NEW.tocio_radnik_id;
    IF worker_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Djelatnik mora pripadati istoj tvrtki kao zapis goriva.' USING ERRCODE = '23514';
    END IF;
    recovery_snapshot := private.resource_restore_snapshot('vozila_gorivo', NEW.id);
    IF recovery_snapshot IS NOT NULL AND recovery_snapshot->>'tocio_radnik_id' = NEW.tocio_radnik_id::text THEN
      NEW.tocio_ime := recovery_snapshot->>'tocio_ime';
    ELSE NEW.tocio_ime := worker_name; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.snapshot_machine_usage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  machine_rate numeric(12,2);
  recovery_snapshot jsonb;
BEGIN
  IF NEW.tip = 'stroj' AND NEW.nalog_id IS NOT NULL AND NEW.oprema_id IS NOT NULL AND (
    TG_OP = 'INSERT' OR OLD.nalog_id IS DISTINCT FROM NEW.nalog_id OR OLD.oprema_id IS DISTINCT FROM NEW.oprema_id
  ) THEN
    SELECT item.cijena_sata INTO machine_rate FROM public.oprema item
      WHERE item.id = NEW.oprema_id AND item.kategorija = 'stroj' AND item.company_id = NEW.company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stroj nije dostupan u tvrtki radnog naloga.'; END IF;
    recovery_snapshot := private.resource_restore_snapshot('radni_nalozi_stavke', NEW.id);
    IF recovery_snapshot IS NOT NULL THEN
      NEW.cijena_sata := (recovery_snapshot->>'cijena_sata')::numeric;
      NEW.koristenje_at := (recovery_snapshot->>'koristenje_at')::timestamptz;
    ELSE
      NEW.cijena_sata := machine_rate;
      NEW.koristenje_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.prune_resource_deletions()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM private.resource_deletions WHERE expires_at <= clock_timestamp() AND NOT active;
$$;
SELECT cron.schedule('prune-resource-deletions', '23 * * * *', 'SELECT private.prune_resource_deletions();');
REVOKE ALL ON FUNCTION private.resource_recovery_module(text, jsonb), private.capture_resource_recovery_row(),
  private.resource_deletion_allowed(uuid), private.guard_resource_deletion(), private.prune_resource_deletions(),
  private.resource_restore_snapshot(text, uuid), private.snapshot_machine_usage(),
  private.set_radnik_dokument_category_name(), private.validate_vozila_gorivo_company() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_resource_with_history(text, uuid),
  public.get_resource_deletions(text, timestamptz, uuid), public.restore_resource_deletion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_resource_with_history(text, uuid),
  public.get_resource_deletions(text, timestamptz, uuid), public.restore_resource_deletion(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
