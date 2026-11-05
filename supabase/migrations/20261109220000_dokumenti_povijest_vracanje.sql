-- Keep file bytes in Storage; deleting storage.objects directly does not delete the file.
CREATE TABLE private.retained_document_files (
  path text PRIMARY KEY,
  company_id uuid NOT NULL,
  retained_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.retained_document_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.retained_document_files FROM PUBLIC, anon, authenticated;
CREATE INDEX radnici_dokumenti_file_reference ON public.radnici_dokumenti(putanja, company_id) WHERE putanja IS NOT NULL;
CREATE INDEX vozila_dokumenti_file_reference ON public.vozila_dokumenti(putanja, company_id) WHERE putanja IS NOT NULL;
CREATE INDEX oprema_dokumenti_file_reference ON public.oprema_dokumenti(putanja, company_id) WHERE putanja IS NOT NULL;

CREATE FUNCTION private.document_history_parent(p_table text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_table
    WHEN 'radnici_dokumenti' THEN ARRAY['radnici', 'radnik_id']
    WHEN 'vozila_dokumenti' THEN ARRAY['vozila', 'vozilo_id']
    WHEN 'oprema_dokumenti' THEN ARRAY['oprema', 'oprema_id']
    ELSE NULL END;
$$;

CREATE FUNCTION private.capture_document_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  row_data jsonb;
  parent_info text[] := private.document_history_parent(TG_TABLE_NAME);
  owning_module text;
  actor_label text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND old_data = new_data THEN RETURN NEW; END IF;
  row_data := COALESCE(new_data, old_data);
  owning_module := CASE parent_info[1] WHEN 'radnici' THEN 'radnici' WHEN 'vozila' THEN 'vozila' ELSE 'strojevi' END;
  IF parent_info[1] = 'oprema' AND EXISTS (
    SELECT 1 FROM public.oprema WHERE id = (row_data->>'oprema_id')::uuid AND kategorija = 'alat'
  ) THEN owning_module := 'alat'; END IF;
  SELECT p.email INTO actor_label FROM public.app_profiles p
  WHERE p.id = auth.uid() AND p.company_id = (row_data->>'company_id')::uuid;
  INSERT INTO private.business_change_history (
    company_id, module, table_name, record_id, parent_id, operation,
    before_data, after_data, actor_id, actor_name
  ) VALUES (
    (row_data->>'company_id')::uuid, owning_module, TG_TABLE_NAME,
    (row_data->>'id')::uuid, (row_data->>parent_info[2])::uuid, TG_OP,
    old_data, new_data, auth.uid(), COALESCE(actor_label, CASE WHEN auth.uid() IS NULL THEN 'Sustav' ELSE 'Korisnik' END)
  );
  INSERT INTO private.retained_document_files(path, company_id)
    SELECT DISTINCT snapshot->>'putanja', (snapshot->>'company_id')::uuid
    FROM (VALUES (old_data), (new_data)) snapshots(snapshot)
    WHERE NULLIF(snapshot->>'putanja', '') IS NOT NULL
    ON CONFLICT (path) DO NOTHING;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER document_change_history AFTER INSERT OR UPDATE OR DELETE ON public.radnici_dokumenti
  FOR EACH ROW EXECUTE FUNCTION private.capture_document_change();
CREATE TRIGGER document_change_history AFTER INSERT OR UPDATE OR DELETE ON public.vozila_dokumenti
  FOR EACH ROW EXECUTE FUNCTION private.capture_document_change();
CREATE TRIGGER document_change_history AFTER INSERT OR UPDATE OR DELETE ON public.oprema_dokumenti
  FOR EACH ROW EXECUTE FUNCTION private.capture_document_change();

INSERT INTO private.retained_document_files(path, company_id)
SELECT putanja, company_id FROM (
  SELECT putanja, company_id FROM public.radnici_dokumenti
  UNION SELECT putanja, company_id FROM public.vozila_dokumenti
  UNION SELECT putanja, company_id FROM public.oprema_dokumenti
) documents WHERE NULLIF(putanja, '') IS NOT NULL
ON CONFLICT (path) DO NOTHING;

CREATE FUNCTION public.app_document_file_visible(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM private.retained_document_files WHERE path = p_path)
    OR EXISTS (SELECT 1 FROM public.radnici_dokumenti WHERE putanja = p_path AND company_id = public.app_current_company_id())
    OR EXISTS (SELECT 1 FROM public.vozila_dokumenti WHERE putanja = p_path AND company_id = public.app_current_company_id())
    OR EXISTS (SELECT 1 FROM public.oprema_dokumenti WHERE putanja = p_path AND company_id = public.app_current_company_id());
$$;
CREATE FUNCTION public.app_document_file_mutable(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM private.retained_document_files WHERE path = p_path)
    AND NOT EXISTS (SELECT 1 FROM public.radnici_dokumenti WHERE putanja = p_path)
    AND NOT EXISTS (SELECT 1 FROM public.vozila_dokumenti WHERE putanja = p_path)
    AND NOT EXISTS (SELECT 1 FROM public.oprema_dokumenti WHERE putanja = p_path);
$$;

-- Restrictive policies supplement existing tenant, module and worker policies.
CREATE POLICY document_file_visibility ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id <> 'nalozi-foto' OR public.app_document_file_visible(name));
CREATE POLICY document_file_retention_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'nalozi-foto' OR public.app_document_file_mutable(name));
CREATE POLICY document_file_retention_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'nalozi-foto' OR public.app_document_file_mutable(name))
  WITH CHECK (bucket_id <> 'nalozi-foto' OR public.app_document_file_mutable(name));

CREATE FUNCTION public.get_document_change_history(
  p_table text, p_parent_id uuid, p_before_sequence bigint DEFAULT NULL
)
RETURNS TABLE (
  id uuid, sequence text, operation text, before_data jsonb, after_data jsonb,
  actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, reverses_id uuid, can_restore boolean, blocked_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  parent_info text[] := private.document_history_parent(p_table);
  parent_data jsonb;
  owning_module text;
BEGIN
  IF parent_info IS NULL THEN RAISE EXCEPTION 'Tablica dokumenata nije podržana.' USING ERRCODE = '22023'; END IF;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id = $1 AND company_id = $2', parent_info[1])
    INTO parent_data USING p_parent_id, public.app_current_company_id();
  IF parent_data IS NULL THEN RAISE EXCEPTION 'Resurs nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  owning_module := CASE parent_info[1] WHEN 'radnici' THEN 'radnici' WHEN 'vozila' THEN 'vozila'
    ELSE CASE parent_data->>'kategorija' WHEN 'alat' THEN 'alat' ELSE 'strojevi' END END;
  IF NOT public.app_has_module_permission(owning_module, 'edit') THEN
    RAISE EXCEPTION 'Potrebno je pravo uređivanja pripadajućeg modula.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT h.id, h.sequence::text, h.operation, h.before_data, h.after_data,
    h.actor_name, h.created_at, h.expires_at, h.reversed_at, h.reverses_id,
    reason.message IS NULL, reason.message
  FROM private.business_change_history h
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN h.reversed_at IS NOT NULL OR h.reverses_id IS NOT NULL THEN 'Promjena je već vraćena.'
      WHEN h.operation = 'UPDATE' AND (
        h.before_data->parent_info[2] IS DISTINCT FROM h.after_data->parent_info[2]
        OR h.before_data->'company_id' IS DISTINCT FROM h.after_data->'company_id'
      ) THEN 'Premještanje dokumenta nije podržano za vraćanje.'
      WHEN EXISTS (
        SELECT 1 FROM private.business_change_history newer WHERE newer.company_id = h.company_id
          AND newer.table_name = h.table_name AND newer.record_id = h.record_id AND newer.sequence > h.sequence
          AND newer.reversed_at IS NULL AND newer.reverses_id IS NULL
      ) THEN 'Dokument ima noviju promjenu. Najprije provjerite nju.'
      ELSE NULL END message
  ) reason
  WHERE h.company_id = public.app_current_company_id() AND h.table_name = p_table AND h.parent_id = p_parent_id
    AND h.expires_at > now() AND (p_before_sequence IS NULL OR h.sequence < p_before_sequence)
  ORDER BY h.sequence DESC LIMIT 50;
END;
$$;

CREATE FUNCTION public.restore_document_change(p_history_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  event private.business_change_history%ROWTYPE;
  parent_info text[];
  parent_data jsonb;
  current_data jsonb;
  restored_data jsonb;
  owning_module text;
  columns_list text;
  assignments text;
  last_sequence bigint;
  new_event_id uuid;
BEGIN
  SELECT * INTO event FROM private.business_change_history h
  WHERE h.id = p_history_id AND h.company_id = public.app_current_company_id()
    AND h.table_name IN ('radnici_dokumenti', 'vozila_dokumenti', 'oprema_dokumenti');
  IF NOT FOUND THEN RAISE EXCEPTION 'Promjena nije dostupna u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  parent_info := private.document_history_parent(event.table_name);
  -- A deleted document has no row to lock; serialize restores for that identity too.
  PERFORM pg_advisory_xact_lock(hashtextextended(event.table_name || ':' || event.record_id::text, 0));
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id = $1 FOR UPDATE', event.table_name)
    INTO current_data USING event.record_id;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id = $1 AND company_id = $2 FOR SHARE', parent_info[1])
    INTO parent_data USING event.parent_id, event.company_id;
  IF parent_data IS NULL THEN RAISE EXCEPTION 'Resurs je obrisan. Najprije je potrebna obnova povezanih podataka.'; END IF;
  owning_module := CASE parent_info[1] WHEN 'radnici' THEN 'radnici' WHEN 'vozila' THEN 'vozila'
    ELSE CASE parent_data->>'kategorija' WHEN 'alat' THEN 'alat' ELSE 'strojevi' END END;
  IF NOT public.app_has_module_permission(owning_module, 'edit') THEN
    RAISE EXCEPTION 'Potrebno je pravo uređivanja pripadajućeg modula.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO event FROM private.business_change_history h WHERE h.id = p_history_id FOR UPDATE;
  IF NOT FOUND OR event.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Istekao je rok od 30 dana.'; END IF;
  IF event.reversed_at IS NOT NULL OR event.reverses_id IS NOT NULL THEN RAISE EXCEPTION 'Promjena je već vraćena.'; END IF;
  IF EXISTS (
    SELECT 1 FROM private.business_change_history h WHERE h.company_id = event.company_id
      AND h.table_name = parent_info[1] AND h.record_id = event.parent_id
      AND h.operation IN ('INSERT', 'DELETE') AND h.sequence > event.sequence
  ) THEN RAISE EXCEPTION 'Resurs je obrisan ili ponovno stvoren. Automatski povrat dokumenta nije siguran.' USING ERRCODE = '40001'; END IF;
  IF event.operation = 'UPDATE' AND (
    event.before_data->parent_info[2] IS DISTINCT FROM event.after_data->parent_info[2]
    OR event.before_data->'company_id' IS DISTINCT FROM event.after_data->'company_id'
  ) THEN RAISE EXCEPTION 'Premještanje dokumenta nije podržano za vraćanje.'; END IF;
  IF current_data IS DISTINCT FROM event.after_data OR EXISTS (
    SELECT 1 FROM private.business_change_history newer WHERE newer.company_id = event.company_id
      AND newer.table_name = event.table_name AND newer.record_id = event.record_id AND newer.sequence > event.sequence
      AND newer.reversed_at IS NULL AND newer.reverses_id IS NULL
  ) THEN RAISE EXCEPTION 'Dokument je naknadno promijenjen. Ništa nije vraćeno.' USING ERRCODE = '40001'; END IF;
  IF event.before_data->>'putanja' IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id = 'nalozi-foto' AND name = event.before_data->>'putanja'
  ) THEN RAISE EXCEPTION 'Prilog više nije u spremištu. Dokument nije vraćen.'; END IF;
  SELECT max(h.sequence) INTO last_sequence FROM private.business_change_history h
  WHERE h.table_name = event.table_name AND h.record_id = event.record_id AND h.company_id = event.company_id;
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
  INTO columns_list FROM pg_attribute a
  WHERE a.attrelid = format('public.%I', event.table_name)::regclass
    AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
    AND COALESCE(event.before_data, event.after_data) ? a.attname;
  IF event.operation = 'INSERT' THEN
    EXECUTE format('DELETE FROM public.%I WHERE id = $1', event.table_name) USING event.record_id;
  ELSIF event.operation = 'DELETE' THEN
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)',
      event.table_name, columns_list, columns_list, event.table_name) USING event.before_data;
  ELSE
    SELECT string_agg(format('%I = previous.%I', a.attname, a.attname), ', ' ORDER BY a.attnum)
      INTO assignments FROM pg_attribute a
      WHERE a.attrelid = format('public.%I', event.table_name)::regclass
        AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
        AND event.before_data->a.attname IS DISTINCT FROM event.after_data->a.attname;
    IF assignments IS NULL THEN RAISE EXCEPTION 'Nema izmjena za vraćanje.'; END IF;
    EXECUTE format('UPDATE public.%I SET %s FROM jsonb_populate_record(NULL::public.%I, $1) previous WHERE %I.id = $2',
      event.table_name, assignments, event.table_name, event.table_name) USING event.before_data, event.record_id;
  END IF;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id = $1', event.table_name)
    INTO restored_data USING event.record_id;
  IF restored_data IS DISTINCT FROM event.before_data THEN
    RAISE EXCEPTION 'Postojeća pravila nisu dopustila točno vraćanje. Promjene su poništene.';
  END IF;
  SELECT h.id INTO new_event_id FROM private.business_change_history h
  WHERE h.table_name = event.table_name AND h.record_id = event.record_id AND h.company_id = event.company_id
    AND h.sequence > last_sequence AND h.transaction_id = txid_current()
    AND h.before_data IS NOT DISTINCT FROM event.after_data AND h.after_data IS NOT DISTINCT FROM event.before_data
  ORDER BY h.sequence DESC LIMIT 1;
  IF new_event_id IS NULL THEN RAISE EXCEPTION 'Povrat nije evidentiran. Promjene su poništene.'; END IF;
  UPDATE private.business_change_history SET reverses_id = event.id WHERE id = new_event_id;
  UPDATE private.business_change_history SET reversed_at = clock_timestamp(), reversed_by = auth.uid() WHERE id = event.id;
END;
$$;

REVOKE ALL ON FUNCTION private.document_history_parent(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.capture_document_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_document_file_visible(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_document_file_mutable(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_document_change_history(text, uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_document_change(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_document_file_visible(text), public.app_document_file_mutable(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_document_change_history(text, uuid, bigint), public.restore_document_change(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
