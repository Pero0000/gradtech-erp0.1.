-- Master-record updates only. Cascading deletion, documents and cost recalculation need separate handlers.
CREATE FUNCTION private.resource_history_fields(p_table text)
RETURNS text[] LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_table
    WHEN 'radnici' THEN ARRAY['ime','prezime','telefon','email','napomena']
    WHEN 'vozila' THEN ARRAY[
      'registracija','broj_sasije','marka','model','tip','status','kilometraza',
      'godina_proizvodnje','broj_mjesta','nosivost_kg','masa_kg','u_rasporedu','enc_broj',
      'servis_interval_km','servis_interval_mjeseci','servis_upozorenje_km','servis_upozorenje_dana',
      'sljedeci_servis_napomena','jamstvo_aktivno','jamstvo_od','jamstvo_mjeseci','jamstvo_do_km',
      'jamstvo_uvjeti','napomena'
    ]
    WHEN 'oprema' THEN ARRAY[
      'naziv','podkategorija','marka','model','inventarski_broj','serijski_broj',
      'stanje','datum_nabave','nabavna_vrijednost','servisni_interval_sati','servis_upozorenje_sati',
      'jamstvo_aktivno','jamstvo_od','jamstvo_mjeseci','jamstvo_do_radnih_sati','jamstvo_uvjeti','napomena'
    ]
    ELSE NULL
  END;
$$;

CREATE FUNCTION private.capture_resource_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  row_data jsonb;
  actor_label text;
  owning_module text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND (old_data - 'updated_at') = (new_data - 'updated_at') THEN RETURN NEW; END IF;
  row_data := COALESCE(new_data, old_data);
  owning_module := CASE TG_TABLE_NAME
    WHEN 'radnici' THEN 'radnici' WHEN 'vozila' THEN 'vozila'
    WHEN 'oprema' THEN CASE row_data->>'kategorija' WHEN 'alat' THEN 'alat' ELSE 'strojevi' END
    ELSE NULL END;
  IF owning_module IS NULL THEN RAISE EXCEPTION 'Tablica nije podržana za povijest resursa.'; END IF;
  SELECT p.email INTO actor_label FROM public.app_profiles p
  WHERE p.id = auth.uid() AND p.company_id = (row_data->>'company_id')::uuid;
  INSERT INTO private.business_change_history (
    company_id, module, table_name, record_id, parent_id, operation,
    before_data, after_data, actor_id, actor_name
  ) VALUES (
    (row_data->>'company_id')::uuid, owning_module, TG_TABLE_NAME,
    (row_data->>'id')::uuid, (row_data->>'id')::uuid, TG_OP,
    old_data, new_data, auth.uid(), COALESCE(actor_label, CASE WHEN auth.uid() IS NULL THEN 'Sustav' ELSE 'Korisnik' END)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER resource_change_history AFTER INSERT OR UPDATE OR DELETE ON public.radnici
  FOR EACH ROW EXECUTE FUNCTION private.capture_resource_change();
CREATE TRIGGER resource_change_history AFTER INSERT OR UPDATE OR DELETE ON public.vozila
  FOR EACH ROW EXECUTE FUNCTION private.capture_resource_change();
CREATE TRIGGER resource_change_history AFTER INSERT OR UPDATE OR DELETE ON public.oprema
  FOR EACH ROW EXECUTE FUNCTION private.capture_resource_change();

CREATE FUNCTION public.get_resource_change_history(
  p_table text, p_record_id uuid, p_before_sequence bigint DEFAULT NULL
)
RETURNS TABLE (
  id uuid, sequence text, operation text, before_data jsonb, after_data jsonb,
  actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, reverses_id uuid, can_restore boolean, blocked_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_data jsonb;
  owning_module text;
  allowed_fields text[] := private.resource_history_fields(p_table);
BEGIN
  IF allowed_fields IS NULL THEN
    RAISE EXCEPTION 'Vraćanje ove tablice nije podržano.' USING ERRCODE = '22023';
  END IF;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id = $1 AND company_id = $2', p_table)
    INTO current_data USING p_record_id, public.app_current_company_id();
  IF current_data IS NULL THEN
    RAISE EXCEPTION 'Zapis nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501';
  END IF;
  owning_module := CASE p_table WHEN 'radnici' THEN 'radnici' WHEN 'vozila' THEN 'vozila'
    ELSE CASE current_data->>'kategorija' WHEN 'alat' THEN 'alat' ELSE 'strojevi' END END;
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
      WHEN (h.before_data - allowed_fields - 'updated_at')
        IS DISTINCT FROM (h.after_data - allowed_fields - 'updated_at')
        THEN 'Promjena uključuje cijene, obračune, dodjele ili druga polja koja još nemaju sigurno vraćanje.'
      WHEN EXISTS (
        SELECT 1 FROM private.business_change_history newer
        WHERE newer.company_id = h.company_id AND newer.table_name = h.table_name
          AND newer.record_id = h.record_id AND newer.sequence > h.sequence
          AND newer.reversed_at IS NULL AND newer.reverses_id IS NULL
      ) THEN 'Zapis ima noviju promjenu. Najprije provjerite nju.'
      ELSE NULL END AS message
  ) reason
  WHERE h.company_id = public.app_current_company_id() AND h.table_name = p_table
    AND h.record_id = p_record_id AND h.module = owning_module
    AND h.operation = 'UPDATE'
    AND h.expires_at > now()
    AND (p_before_sequence IS NULL OR h.sequence < p_before_sequence)
  ORDER BY h.sequence DESC LIMIT 50;
END;
$$;

CREATE FUNCTION public.restore_resource_change(p_history_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  event private.business_change_history%ROWTYPE;
  current_data jsonb;
  restored_data jsonb;
  allowed_fields text[];
  assignments text;
  last_sequence bigint;
  new_event_id uuid;
  owning_module text;
BEGIN
  SELECT * INTO event FROM private.business_change_history h
  WHERE h.id = p_history_id AND h.company_id = public.app_current_company_id()
    AND h.table_name IN ('radnici','vozila','oprema') AND h.operation = 'UPDATE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promjena nije dostupna u vašoj tvrtki.' USING ERRCODE = '42501';
  END IF;
  allowed_fields := private.resource_history_fields(event.table_name);
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id = $1 AND company_id = $2 FOR UPDATE', event.table_name)
    INTO current_data USING event.record_id, event.company_id;
  IF current_data IS NULL THEN RAISE EXCEPTION 'Zapis je obrisan. Obnova povezanih podataka još nije podržana.'; END IF;
  owning_module := CASE event.table_name WHEN 'radnici' THEN 'radnici' WHEN 'vozila' THEN 'vozila'
    ELSE CASE current_data->>'kategorija' WHEN 'alat' THEN 'alat' ELSE 'strojevi' END END;
  IF event.module <> owning_module OR NOT public.app_has_module_permission(owning_module, 'edit') THEN
    RAISE EXCEPTION 'Potrebno je pravo uređivanja pripadajućeg modula.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO event FROM private.business_change_history h WHERE h.id = p_history_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Povijest je istekla i uklonjena.'; END IF;
  IF event.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Istekao je rok od 30 dana.'; END IF;
  IF event.reversed_at IS NOT NULL OR event.reverses_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ova promjena već je vraćena.';
  END IF;
  IF (event.before_data - allowed_fields - 'updated_at')
    IS DISTINCT FROM (event.after_data - allowed_fields - 'updated_at') THEN
    RAISE EXCEPTION 'Promjena sadrži polja koja još nemaju sigurno vraćanje. Ništa nije promijenjeno.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.business_change_history newer
    WHERE newer.company_id = event.company_id AND newer.table_name = event.table_name
      AND newer.record_id = event.record_id AND newer.sequence > event.sequence
      AND newer.reversed_at IS NULL AND newer.reverses_id IS NULL
  ) OR (current_data - 'updated_at') IS DISTINCT FROM (event.after_data - 'updated_at') THEN
    RAISE EXCEPTION 'Zapis je naknadno promijenjen. Najprije provjerite noviju promjenu.' USING ERRCODE = '40001';
  END IF;
  SELECT string_agg(format('%I = previous.%I', a.attname, a.attname), ', ' ORDER BY a.attnum)
    INTO assignments FROM pg_attribute a
    WHERE a.attrelid = format('public.%I', event.table_name)::regclass
      AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      AND a.attname = ANY(allowed_fields)
      AND (event.before_data->a.attname) IS DISTINCT FROM (event.after_data->a.attname);
  IF assignments IS NULL THEN RAISE EXCEPTION 'Nema podržanih izmjena za vraćanje.'; END IF;
  SELECT max(h.sequence) INTO last_sequence FROM private.business_change_history h
  WHERE h.table_name = event.table_name AND h.record_id = event.record_id
    AND h.company_id = event.company_id;
  EXECUTE format(
    'UPDATE public.%I r SET %s, updated_at = clock_timestamp()
     FROM jsonb_populate_record(NULL::public.%I, $1) previous
     WHERE r.id = $2 AND r.company_id = $3', event.table_name, assignments, event.table_name
  ) USING event.before_data, event.record_id, event.company_id;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id = $1 AND company_id = $2', event.table_name)
    INTO restored_data USING event.record_id, event.company_id;
  IF (restored_data - 'updated_at') IS DISTINCT FROM (event.before_data - 'updated_at') THEN
    RAISE EXCEPTION 'Postojeća pravila zapisa nisu dopustila točno vraćanje. Promjene su poništene.';
  END IF;
  SELECT h.id INTO new_event_id FROM private.business_change_history h
  WHERE h.table_name = event.table_name AND h.record_id = event.record_id
    AND h.company_id = event.company_id AND h.sequence > last_sequence
    AND h.transaction_id = txid_current() AND h.operation = 'UPDATE'
    AND (h.before_data - 'updated_at') = (current_data - 'updated_at')
    AND (h.after_data - 'updated_at') = (event.before_data - 'updated_at')
  ORDER BY h.sequence DESC LIMIT 1;
  IF new_event_id IS NULL THEN RAISE EXCEPTION 'Vraćanje nije zabilježeno. Promjene su poništene.'; END IF;
  UPDATE private.business_change_history SET reverses_id = event.id WHERE id = new_event_id;
  UPDATE private.business_change_history SET reversed_at = clock_timestamp(), reversed_by = auth.uid()
    WHERE id = event.id;
END;
$$;

REVOKE ALL ON FUNCTION private.resource_history_fields(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.capture_resource_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_resource_change_history(text, uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_resource_change(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_resource_change_history(text, uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_resource_change(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
