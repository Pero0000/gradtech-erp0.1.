CREATE OR REPLACE FUNCTION private.resource_recovery_module(p_table text, p_data jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_table IN ('gradilista', 'gradiliste_board_layout', 'gradiliste_zadaci', 'gradiliste_dokumenti', 'gradiliste_stavke', 'rokovi', 'ugovoreni_radovi') THEN 'gradilista'
    WHEN p_table = 'fakture' THEN 'fakture'
    WHEN p_table IN ('ponude', 'ponude_stavke') THEN 'ponude'
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
    WHEN p_table = 'kooperant_dokumenti' THEN 'kooperanti'
    ELSE 'unsupported' END;
$$;

CREATE FUNCTION public.delete_ponuda_with_history(p_record_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  resource jsonb;
  operation_id uuid;
  history_sequence bigint;
  untracked text;
BEGIN
  SELECT to_jsonb(p) INTO resource FROM public.ponude p
    WHERE p.id = p_record_id AND p.company_id = public.app_current_company_id() FOR UPDATE;
  IF resource IS NULL THEN RAISE EXCEPTION 'Resurs nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  IF NOT public.app_has_module_permission('ponude', 'edit') THEN RAISE EXCEPTION 'Nedostaje pravo uređivanja ponuda.' USING ERRCODE = '42501'; END IF;
  WITH RECURSIVE affected(oid, cascading) AS (
    SELECT 'public.ponude'::regclass::oid, true
    UNION SELECT fk.conrelid, fk.confdeltype = 'c' FROM pg_constraint fk JOIN affected parent ON parent.oid = fk.confrelid
      WHERE parent.cascading AND fk.contype = 'f' AND fk.confdeltype IN ('c', 'n', 'd')
  )
  SELECT c.relname INTO untracked FROM affected JOIN pg_class c USING (oid) JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'public' OR NOT EXISTS (SELECT 1 FROM private.resource_recovery_tables WHERE table_name = c.relname) LIMIT 1;
  IF untracked IS NOT NULL THEN RAISE EXCEPTION 'Povrat nije pripremljen za povezanu tablicu %. Ništa nije obrisano.', untracked; END IF;
  SELECT COALESCE(max(sequence), 0) INTO history_sequence FROM private.business_change_history;
  INSERT INTO private.resource_deletions(company_id, module, table_name, record_id, snapshot, actor_name)
    VALUES (public.app_current_company_id(), 'ponude', 'ponude', p_record_id, resource,
      COALESCE((SELECT email FROM public.app_profiles WHERE id = auth.uid()), 'Korisnik')) RETURNING id INTO operation_id;
  DELETE FROM public.ponude WHERE id = p_record_id;
  SELECT to_jsonb(p) INTO resource FROM public.ponude p WHERE p.id = p_record_id;
  IF resource IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM private.resource_deletion_rows WHERE deletion_id = operation_id
      AND table_name = 'ponude' AND row_key = jsonb_build_object('id', p_record_id) AND after_data IS NULL
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
REVOKE ALL ON FUNCTION public.delete_ponuda_with_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_ponuda_with_history(uuid) TO authenticated;

CREATE FUNCTION public.get_ponuda_deletions(p_before_time timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, snapshot jsonb, actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, can_restore boolean, affected_rows jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.app_has_module_permission('ponude', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja ponuda.' USING ERRCODE = '42501';
  END IF;
  IF (p_before_time IS NULL) <> (p_before_id IS NULL) THEN RAISE EXCEPTION 'Nepotpun pokazivač stranice.' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT d.id, d.snapshot, d.actor_name, d.created_at, d.expires_at, d.reversed_at,
    d.reversed_at IS NULL AND private.resource_deletion_allowed(d.id),
    (SELECT jsonb_object_agg(summary.table_name, summary.total) FROM (
      SELECT r.table_name, count(*) total FROM private.resource_deletion_rows r WHERE r.deletion_id = d.id GROUP BY r.table_name
    ) summary)
  FROM private.resource_deletions d WHERE d.company_id = public.app_current_company_id()
    AND d.module = 'ponude' AND d.table_name = 'ponude'
    AND NOT d.active AND d.expires_at > now()
    AND (p_before_time IS NULL OR (d.created_at, d.id) < (p_before_time, p_before_id))
    ORDER BY d.created_at DESC, d.id DESC LIMIT 50;
END;
$$;
REVOKE ALL ON FUNCTION public.get_ponuda_deletions(timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ponuda_deletions(timestamptz, uuid) TO authenticated;

CREATE TRIGGER guard_resource_deletion
  BEFORE DELETE ON public.ponude
  FOR EACH ROW EXECUTE FUNCTION private.guard_resource_deletion();

NOTIFY pgrst, 'reload schema';
