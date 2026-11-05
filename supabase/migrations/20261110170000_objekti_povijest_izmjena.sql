CREATE OR REPLACE FUNCTION private.resource_history_module(p_table text, p_row jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_table
    WHEN 'radnici' THEN 'radnici' WHEN 'vozila' THEN 'vozila'
    WHEN 'gradilista' THEN 'gradilista' WHEN 'rokovi' THEN 'gradilista'
    WHEN 'gradiliste_zadaci' THEN 'gradilista' WHEN 'radni_nalozi' THEN 'radni_nalozi'
    WHEN 'radno_vrijeme' THEN 'radno_vrijeme' WHEN 'troskovi' THEN 'troskovi'
    WHEN 'fakture' THEN 'fakture' WHEN 'ugovoreni_radovi' THEN 'gradilista'
    WHEN 'investitori' THEN 'investitori' WHEN 'objekti' THEN 'objekti'
    WHEN 'oprema' THEN CASE p_row->>'kategorija' WHEN 'alat' THEN 'alat' ELSE 'strojevi' END
    ELSE NULL END;
$$;
CREATE TRIGGER object_change_history AFTER INSERT OR UPDATE OR DELETE ON public.objekti
  FOR EACH ROW EXECUTE FUNCTION private.capture_resource_change();

CREATE FUNCTION private.object_change_blocked(p_event private.business_change_history,p_current jsonb)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_event.reversed_at IS NOT NULL OR p_event.reverses_id IS NOT NULL THEN RETURN 'Promjena je već vraćena.'; END IF;
  IF (p_event.before_data-ARRAY['naziv','investitor_id','adresa','mjesto','postanski_broj','kontakt_osoba','telefon','napomena','updated_at'])
    IS DISTINCT FROM
    (p_event.after_data-ARRAY['naziv','investitor_id','adresa','mjesto','postanski_broj','kontakt_osoba','telefon','napomena','updated_at']) THEN
    RETURN 'Promjena sadrži znanje objekta, identitet, vrijeme stvaranja ili druga nepodržana polja.';
  END IF;
  IF EXISTS (SELECT 1 FROM private.business_change_history h WHERE h.company_id=p_event.company_id
    AND h.table_name='objekti' AND h.record_id=p_event.record_id AND h.sequence>p_event.sequence
    AND h.reversed_at IS NULL AND h.reverses_id IS NULL) THEN
    RETURN 'Objekt ima noviju promjenu. Najprije provjerite nju.';
  END IF;
  IF (p_current-'updated_at') IS DISTINCT FROM (p_event.after_data-'updated_at') THEN
    RETURN 'Objekt je naknadno promijenjen.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES (p_event.before_data->>'investitor_id'),(p_event.after_data->>'investitor_id')) parent(id)
    WHERE parent.id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.investitori i WHERE i.id=parent.id::uuid AND i.company_id=p_event.company_id
    )
  ) THEN RETURN 'Izvorni ili aktualni investitor više nije dostupan u vašoj tvrtki.'; END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.object_change_blocked(private.business_change_history,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_object_change_history(p_record_id uuid,p_before_sequence bigint DEFAULT NULL)
RETURNS TABLE(id uuid,sequence text,operation text,before_data jsonb,after_data jsonb,
  actor_name text,created_at timestamptz,expires_at timestamptz,reversed_at timestamptz,reverses_id uuid,
  can_restore boolean,blocked_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE current_data jsonb;
BEGIN
  IF NOT public.app_has_module_permission('objekti','edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja objekata.' USING ERRCODE='42501';
  END IF;
  SELECT to_jsonb(o) INTO current_data FROM public.objekti o
    WHERE o.id=p_record_id AND o.company_id=public.app_current_company_id();
  IF current_data IS NULL THEN RAISE EXCEPTION 'Objekt nije dostupan u vašoj tvrtki.' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT h.id,h.sequence::text,h.operation,h.before_data,h.after_data,h.actor_name,
    h.created_at,h.expires_at,h.reversed_at,h.reverses_id,reason.message IS NULL,reason.message
    FROM private.business_change_history h
    CROSS JOIN LATERAL (SELECT private.object_change_blocked(h,current_data) message) reason
    WHERE h.company_id=public.app_current_company_id() AND h.table_name='objekti' AND h.module='objekti'
      AND h.record_id=p_record_id AND h.operation='UPDATE' AND h.expires_at>now()
      AND (p_before_sequence IS NULL OR h.sequence<p_before_sequence)
    ORDER BY h.sequence DESC LIMIT 50;
END;
$$;

CREATE FUNCTION public.restore_object_change(p_history_id uuid)
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
  IF NOT public.app_has_module_permission('objekti','edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja objekata.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO event FROM private.business_change_history h WHERE h.id=p_history_id
    AND h.company_id=public.app_current_company_id() AND h.table_name='objekti'
    AND h.module='objekti' AND h.operation='UPDATE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Promjena nije dostupna u vašoj tvrtki.' USING ERRCODE='42501'; END IF;
  SELECT to_jsonb(o) INTO current_data FROM public.objekti o
    WHERE o.id=event.record_id AND o.company_id=event.company_id FOR UPDATE;
  IF current_data IS NULL THEN RAISE EXCEPTION 'Objekt je obrisan. Ovaj panel ne vraća brisanje.'; END IF;
  SELECT * INTO event FROM private.business_change_history h WHERE h.id=p_history_id FOR UPDATE;
  IF NOT FOUND OR event.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Istekao je rok od 30 dana.'; END IF;
  PERFORM i.id FROM public.investitori i
    WHERE i.id IN ((event.before_data->>'investitor_id')::uuid,(event.after_data->>'investitor_id')::uuid)
    ORDER BY i.id FOR SHARE;
  reason:=private.object_change_blocked(event,current_data);
  IF reason IS NOT NULL THEN RAISE EXCEPTION '% Ništa nije vraćeno.',reason USING ERRCODE='40001'; END IF;
  SELECT string_agg(format('%I = previous.%I',a.attname,a.attname),', ' ORDER BY a.attnum)
    INTO assignments FROM pg_attribute a
    WHERE a.attrelid='public.objekti'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated=''
      AND a.attname=ANY(ARRAY['naziv','investitor_id','adresa','mjesto','postanski_broj','kontakt_osoba','telefon','napomena'])
      AND event.before_data->a.attname IS DISTINCT FROM event.after_data->a.attname;
  IF assignments IS NULL THEN RAISE EXCEPTION 'Nema podržanih izmjena za vraćanje.'; END IF;
  SELECT COALESCE(max(sequence),0) INTO last_sequence FROM private.business_change_history
    WHERE company_id=event.company_id AND table_name='objekti' AND record_id=event.record_id;
  EXECUTE format('UPDATE public.objekti o SET %s FROM jsonb_populate_record(NULL::public.objekti,$1) previous
    WHERE o.id=$2 AND o.company_id=$3',assignments) USING event.before_data,event.record_id,event.company_id;
  SELECT to_jsonb(o) INTO restored_data FROM public.objekti o WHERE o.id=event.record_id;
  IF (restored_data-'updated_at') IS DISTINCT FROM (event.before_data-'updated_at') THEN
    RAISE EXCEPTION 'Pravila objekta nisu dopustila točan povrat. Ništa nije vraćeno.';
  END IF;
  SELECT h.id INTO new_event_id FROM private.business_change_history h WHERE h.company_id=event.company_id
    AND h.table_name='objekti' AND h.record_id=event.record_id AND h.operation='UPDATE'
    AND h.transaction_id=txid_current() AND h.sequence>last_sequence
    AND (h.before_data-'updated_at')=(current_data-'updated_at')
    AND (h.after_data-'updated_at')=(event.before_data-'updated_at') ORDER BY h.sequence DESC LIMIT 1;
  IF new_event_id IS NULL THEN RAISE EXCEPTION 'Povrat nije evidentiran. Ništa nije vraćeno.'; END IF;
  UPDATE private.business_change_history SET reverses_id=event.id WHERE id=new_event_id;
  UPDATE private.business_change_history SET reversed_at=clock_timestamp(),reversed_by=auth.uid() WHERE id=event.id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_object_change_history(uuid,bigint),public.restore_object_change(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_object_change_history(uuid,bigint),public.restore_object_change(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
