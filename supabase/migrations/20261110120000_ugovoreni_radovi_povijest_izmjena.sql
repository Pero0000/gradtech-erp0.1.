CREATE OR REPLACE FUNCTION private.resource_history_module(p_table text, p_row jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_table
    WHEN 'radnici' THEN 'radnici'
    WHEN 'vozila' THEN 'vozila'
    WHEN 'gradilista' THEN 'gradilista'
    WHEN 'rokovi' THEN 'gradilista'
    WHEN 'radno_vrijeme' THEN 'radno_vrijeme'
    WHEN 'troskovi' THEN 'troskovi'
    WHEN 'fakture' THEN 'fakture'
    WHEN 'ugovoreni_radovi' THEN 'gradilista'
    WHEN 'oprema' THEN CASE p_row->>'kategorija' WHEN 'alat' THEN 'alat' ELSE 'strojevi' END
    ELSE NULL END;
$$;
CREATE TRIGGER contracted_work_change_history AFTER INSERT OR UPDATE OR DELETE ON public.ugovoreni_radovi
  FOR EACH ROW EXECUTE FUNCTION private.capture_resource_change();

CREATE FUNCTION private.contracted_work_change_blocked(p_event private.business_change_history, p_current jsonb)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_event.reversed_at IS NOT NULL OR p_event.reverses_id IS NOT NULL THEN
    RETURN 'Promjena je već vraćena.';
  END IF;
  IF (p_event.before_data - ARRAY['gradiliste_id','naziv','opis','ugovoreni_iznos','ostvareni_iznos','status','updated_at'])
    IS DISTINCT FROM
    (p_event.after_data - ARRAY['gradiliste_id','naziv','opis','ugovoreni_iznos','ostvareni_iznos','status','updated_at']) THEN
    RETURN 'Promjena sadrži identitet, vrstu rada, vezu ponude, prilog ili druga nepodržana polja.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.business_change_history newer
    WHERE newer.company_id = p_event.company_id AND newer.table_name = 'ugovoreni_radovi'
      AND newer.record_id = p_event.record_id AND newer.sequence > p_event.sequence
      AND newer.reversed_at IS NULL AND newer.reverses_id IS NULL
  ) THEN RETURN 'Rad ima noviju promjenu. Najprije provjerite nju.'; END IF;
  IF (p_current - 'updated_at') IS DISTINCT FROM (p_event.after_data - 'updated_at') THEN
    RETURN 'Ugovoreni/VTR rad je naknadno promijenjen.';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.contracted_work_change_blocked(private.business_change_history, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_contracted_work_change_history(p_record_id uuid, p_before_sequence bigint DEFAULT NULL)
RETURNS TABLE (
  id uuid, sequence text, operation text, before_data jsonb, after_data jsonb,
  actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, reverses_id uuid, can_restore boolean, blocked_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE current_data jsonb;
BEGIN
  IF NOT public.app_has_module_permission('gradilista', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja gradilišta.' USING ERRCODE = '42501';
  END IF;
  SELECT to_jsonb(r) INTO current_data FROM public.ugovoreni_radovi r
    WHERE r.id = p_record_id AND r.company_id = public.app_current_company_id();
  IF current_data IS NULL THEN RAISE EXCEPTION 'Rad nije dostupan u vašoj tvrtki. Za obrisani zapis najprije vratite brisanje.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT h.id, h.sequence::text, h.operation, h.before_data, h.after_data,
    h.actor_name, h.created_at, h.expires_at, h.reversed_at, h.reverses_id,
    reason.message IS NULL, reason.message
  FROM private.business_change_history h
  CROSS JOIN LATERAL (SELECT private.contracted_work_change_blocked(h, current_data) AS message) reason
  WHERE h.company_id = public.app_current_company_id() AND h.module = 'gradilista'
    AND h.table_name = 'ugovoreni_radovi' AND h.record_id = p_record_id AND h.operation = 'UPDATE'
    AND h.expires_at > now() AND (p_before_sequence IS NULL OR h.sequence < p_before_sequence)
  ORDER BY h.sequence DESC LIMIT 50;
END;
$$;

CREATE FUNCTION public.restore_contracted_work_change(p_history_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  event private.business_change_history%ROWTYPE;
  current_data jsonb;
  restored_data jsonb;
  reason text;
  assignments text;
  last_sequence bigint;
  new_event_id uuid;
BEGIN
  IF NOT public.app_has_module_permission('gradilista', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja gradilišta.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO event FROM private.business_change_history h
    WHERE h.id = p_history_id AND h.company_id = public.app_current_company_id()
      AND h.module = 'gradilista' AND h.table_name = 'ugovoreni_radovi' AND h.operation = 'UPDATE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Promjena nije dostupna u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  SELECT to_jsonb(r) INTO current_data FROM public.ugovoreni_radovi r
    WHERE r.id = event.record_id AND r.company_id = event.company_id FOR UPDATE;
  IF current_data IS NULL THEN RAISE EXCEPTION 'Rad je obrisan. Najprije vratite cijelu radnju brisanja.'; END IF;
  SELECT * INTO event FROM private.business_change_history h WHERE h.id = p_history_id FOR UPDATE;
  IF NOT FOUND OR event.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Istekao je rok od 30 dana.'; END IF;
  reason := private.contracted_work_change_blocked(event, current_data);
  IF reason IS NOT NULL THEN RAISE EXCEPTION '% Ništa nije vraćeno.', reason USING ERRCODE = '40001'; END IF;
  IF event.before_data->>'gradiliste_id' IS NOT NULL THEN
    PERFORM 1 FROM public.gradilista WHERE id = (event.before_data->>'gradiliste_id')::uuid
      AND company_id = event.company_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Izvorno gradilište nije dostupno u vašoj tvrtki. Ništa nije vraćeno.' USING ERRCODE = '23503'; END IF;
  END IF;
  IF event.before_data->>'ponuda_id' IS NOT NULL THEN
    PERFORM 1 FROM public.ponude WHERE id = (event.before_data->>'ponuda_id')::uuid
      AND company_id = event.company_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Izvorna ponuda nije dostupna u vašoj tvrtki. Ništa nije vraćeno.' USING ERRCODE = '23503'; END IF;
  END IF;
  IF NULLIF(event.before_data->>'dokument_putanja', '') IS NOT NULL THEN
    PERFORM 1 FROM storage.objects WHERE bucket_id = 'nalozi-foto' AND name = event.before_data->>'dokument_putanja';
    IF NOT FOUND THEN RAISE EXCEPTION 'Nedostaje izvorni prilog rada. Ništa nije vraćeno.' USING ERRCODE = '23503'; END IF;
  END IF;
  SELECT string_agg(format('%I = previous.%I', a.attname, a.attname), ', ' ORDER BY a.attnum)
    INTO assignments FROM pg_attribute a
    WHERE a.attrelid = 'public.ugovoreni_radovi'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attgenerated = '' AND a.attname <> 'updated_at'
      AND event.before_data->a.attname IS DISTINCT FROM event.after_data->a.attname;
  IF assignments IS NULL THEN RAISE EXCEPTION 'Nema podržanih izmjena za vraćanje.'; END IF;
  SELECT COALESCE(max(h.sequence), 0) INTO last_sequence FROM private.business_change_history h
    WHERE h.company_id = event.company_id AND h.table_name = 'ugovoreni_radovi' AND h.record_id = event.record_id;
  EXECUTE format('UPDATE public.ugovoreni_radovi r SET %s FROM jsonb_populate_record(NULL::public.ugovoreni_radovi, $1) previous
    WHERE r.id = $2 AND r.company_id = $3', assignments)
    USING event.before_data, event.record_id, event.company_id;
  SELECT to_jsonb(r) INTO restored_data FROM public.ugovoreni_radovi r WHERE r.id = event.record_id AND r.company_id = event.company_id;
  IF (restored_data - 'updated_at') IS DISTINCT FROM (event.before_data - 'updated_at') THEN
    RAISE EXCEPTION 'Postojeća pravila nisu dopustila točno vraćanje rada. Ništa nije vraćeno.';
  END IF;
  SELECT h.id INTO new_event_id FROM private.business_change_history h
    WHERE h.company_id = event.company_id AND h.table_name = 'ugovoreni_radovi' AND h.record_id = event.record_id
      AND h.sequence > last_sequence AND h.transaction_id = txid_current() AND h.operation = 'UPDATE'
      AND (h.before_data - 'updated_at') = (current_data - 'updated_at')
      AND (h.after_data - 'updated_at') = (event.before_data - 'updated_at')
    ORDER BY h.sequence DESC LIMIT 1;
  IF new_event_id IS NULL THEN RAISE EXCEPTION 'Povrat nije zabilježen. Ništa nije vraćeno.'; END IF;
  UPDATE private.business_change_history SET reverses_id = event.id WHERE id = new_event_id;
  UPDATE private.business_change_history SET reversed_at = clock_timestamp(), reversed_by = auth.uid() WHERE id = event.id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_contracted_work_change_history(uuid, bigint), public.restore_contracted_work_change(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contracted_work_change_history(uuid, bigint), public.restore_contracted_work_change(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
