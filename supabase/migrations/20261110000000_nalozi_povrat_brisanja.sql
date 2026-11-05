CREATE FUNCTION private.guard_work_order_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM private.resource_deletions d WHERE d.active AND NOT d.restoring
      AND d.transaction_id = txid_current() AND d.company_id = OLD.company_id
      AND ((d.table_name = 'radni_nalozi' AND d.record_id = OLD.id)
        OR (d.table_name = 'gradilista' AND d.record_id = OLD.gradiliste_id))
  ) THEN
    RAISE EXCEPTION 'Zaštićeno brisanje naloga zahtijeva novu verziju aplikacije i delete_resource_with_history.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_work_order_deletion() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_work_order_deletion BEFORE DELETE ON public.radni_nalozi
  FOR EACH ROW EXECUTE FUNCTION private.guard_work_order_deletion();

-- Preserve the existing release/transfer behavior, but capture it inside the same deletion transaction.
CREATE FUNCTION private.prepare_work_order_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.resource_deletions d WHERE d.active AND NOT d.restoring
    AND d.transaction_id = txid_current() AND d.table_name = 'radni_nalozi'
    AND d.record_id = OLD.id AND d.company_id = OLD.company_id
  ) THEN
    UPDATE public.radni_nalozi_stavke SET nalog_id = NULL
      WHERE nalog_id = OLD.id AND company_id = OLD.company_id
        AND gotovo = false AND izvor_id IS NULL AND gradiliste_id IS NOT NULL;
    UPDATE public.radni_nalozi_stavke source SET preneseno = false
      WHERE source.company_id = OLD.company_id AND source.id IN (
        SELECT copy.izvor_id FROM public.radni_nalozi_stavke copy
          WHERE copy.nalog_id = OLD.id AND copy.company_id = OLD.company_id AND copy.izvor_id IS NOT NULL
      );
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.prepare_work_order_deletion() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER prepare_work_order_deletion BEFORE DELETE ON public.radni_nalozi
  FOR EACH ROW EXECUTE FUNCTION private.prepare_work_order_deletion();

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
  IF p_table NOT IN ('radnici', 'vozila', 'oprema', 'gradilista', 'radni_nalozi') THEN
    RAISE EXCEPTION 'Tablica nije podržana.' USING ERRCODE = '22023';
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
  IF p_table IN ('gradilista', 'radni_nalozi') THEN
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
  IF p_module NOT IN ('radnici', 'vozila', 'alat', 'strojevi', 'gradilista', 'radni_nalozi')
    OR NOT public.app_has_module_permission(p_module, 'edit') THEN
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

NOTIFY pgrst, 'reload schema';
