CREATE OR REPLACE FUNCTION private.resource_history_module(p_table text, p_row jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_table
    WHEN 'radnici' THEN 'radnici' WHEN 'vozila' THEN 'vozila'
    WHEN 'gradilista' THEN 'gradilista' WHEN 'rokovi' THEN 'gradilista'
    WHEN 'gradiliste_zadaci' THEN 'gradilista' WHEN 'radni_nalozi' THEN 'radni_nalozi'
    WHEN 'radno_vrijeme' THEN 'radno_vrijeme' WHEN 'troskovi' THEN 'troskovi'
    WHEN 'fakture' THEN 'fakture' WHEN 'ugovoreni_radovi' THEN 'gradilista'
    WHEN 'investitori' THEN 'investitori' WHEN 'objekti' THEN 'objekti'
    WHEN 'kooperanti' THEN 'kooperanti' WHEN 'kooperant_angazmani' THEN 'kooperanti'
    WHEN 'stavke' THEN 'stavke'
    WHEN 'oprema' THEN CASE p_row->>'kategorija' WHEN 'alat' THEN 'alat' ELSE 'strojevi' END
    ELSE NULL END;
$$;

CREATE FUNCTION private.catalog_price_timestamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.cijena IS DISTINCT FROM OLD.cijena THEN NEW.cijena_promijenjena_at:=clock_timestamp();
    ELSE NEW.cijena_promijenjena_at:=OLD.cijena_promijenjena_at; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION private.catalog_price_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE log_id uuid; previous_price numeric;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.cijena IS NOT DISTINCT FROM OLD.cijena THEN RETURN NEW; END IF;
    previous_price:=OLD.cijena;
  END IF;
  INSERT INTO public.stavke_cijene_log(company_id,stavka_id,stara_cijena,nova_cijena)
    VALUES (NEW.company_id,NEW.id,previous_price,NEW.cijena) RETURNING id INTO log_id;
  IF log_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.stavke_cijene_log l WHERE l.id=log_id
    AND l.company_id=NEW.company_id AND l.stavka_id=NEW.id
    AND l.stara_cijena IS NOT DISTINCT FROM previous_price AND l.nova_cijena=NEW.cijena) THEN
    RAISE EXCEPTION 'Promjena cijene nije točno evidentirana. Ništa nije spremljeno.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.catalog_price_timestamp(),private.catalog_price_log() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER catalog_price_timestamp BEFORE UPDATE ON public.stavke FOR EACH ROW EXECUTE FUNCTION private.catalog_price_timestamp();
CREATE TRIGGER catalog_price_log AFTER INSERT OR UPDATE ON public.stavke FOR EACH ROW EXECUTE FUNCTION private.catalog_price_log();
CREATE TRIGGER catalog_change_history AFTER INSERT OR UPDATE OR DELETE ON public.stavke
  FOR EACH ROW EXECUTE FUNCTION private.capture_resource_change();

CREATE FUNCTION private.catalog_change_blocked(p_event private.business_change_history,p_current jsonb)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_event.reversed_at IS NOT NULL OR p_event.reverses_id IS NOT NULL THEN RETURN 'Promjena je već vraćena.'; END IF;
  IF (p_event.before_data-ARRAY['sifra','naziv','vrsta_posla','podgrupa','jedinica','cijena','opis','cijena_promijenjena_at','updated_at'])
    IS DISTINCT FROM
    (p_event.after_data-ARRAY['sifra','naziv','vrsta_posla','podgrupa','jedinica','cijena','opis','cijena_promijenjena_at','updated_at']) THEN
    RETURN 'Promjena sadrži identitet, vrijeme stvaranja ili druga nepodržana polja.';
  END IF;
  IF EXISTS (SELECT 1 FROM private.business_change_history h WHERE h.company_id=p_event.company_id
    AND h.table_name='stavke' AND h.record_id=p_event.record_id AND h.sequence>p_event.sequence
    AND h.reversed_at IS NULL AND h.reverses_id IS NULL) THEN
    RETURN 'Stavka ima noviju promjenu. Najprije provjerite nju.';
  END IF;
  IF (p_current-ARRAY['updated_at','cijena_promijenjena_at'])
    IS DISTINCT FROM (p_event.after_data-ARRAY['updated_at','cijena_promijenjena_at']) THEN
    RETURN 'Stavka je naknadno promijenjena.';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.catalog_change_blocked(private.business_change_history,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_catalog_change_history(p_record_id uuid,p_before_sequence bigint DEFAULT NULL)
RETURNS TABLE(id uuid,sequence text,operation text,before_data jsonb,after_data jsonb,
  actor_name text,created_at timestamptz,expires_at timestamptz,reversed_at timestamptz,reverses_id uuid,
  can_restore boolean,blocked_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE current_data jsonb;
BEGIN
  IF NOT public.app_has_module_permission('stavke','edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja stavki.' USING ERRCODE='42501';
  END IF;
  SELECT to_jsonb(s) INTO current_data FROM public.stavke s
    WHERE s.id=p_record_id AND s.company_id=public.app_current_company_id();
  IF current_data IS NULL THEN RAISE EXCEPTION 'Stavka nije dostupna u vašoj tvrtki.' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT h.id,h.sequence::text,h.operation,h.before_data,h.after_data,h.actor_name,
    h.created_at,h.expires_at,h.reversed_at,h.reverses_id,reason.message IS NULL,reason.message
    FROM private.business_change_history h
    CROSS JOIN LATERAL (SELECT private.catalog_change_blocked(h,current_data) message) reason
    WHERE h.company_id=public.app_current_company_id() AND h.table_name='stavke' AND h.module='stavke'
      AND h.record_id=p_record_id AND h.operation='UPDATE' AND h.expires_at>now()
      AND (p_before_sequence IS NULL OR h.sequence<p_before_sequence)
    ORDER BY h.sequence DESC LIMIT 50;
END;
$$;
CREATE FUNCTION public.restore_catalog_change(p_history_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  event private.business_change_history%ROWTYPE;
  current_data jsonb;
  restored_data jsonb;
  reason text;
  assignments text;
  last_sequence bigint;
  new_event_id uuid;
  previous_log_ids uuid[];
BEGIN
  IF NOT public.app_has_module_permission('stavke','edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja stavki.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO event FROM private.business_change_history h WHERE h.id=p_history_id
    AND h.company_id=public.app_current_company_id() AND h.table_name='stavke' AND h.module='stavke' AND h.operation='UPDATE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Promjena nije dostupna u vašoj tvrtki.' USING ERRCODE='42501'; END IF;
  SELECT to_jsonb(s) INTO current_data FROM public.stavke s
    WHERE s.id=event.record_id AND s.company_id=event.company_id FOR UPDATE;
  IF current_data IS NULL THEN RAISE EXCEPTION 'Stavka je obrisana. Ovaj panel ne vraća brisanje.'; END IF;
  SELECT * INTO event FROM private.business_change_history h WHERE h.id=p_history_id FOR UPDATE;
  IF NOT FOUND OR event.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Istekao je rok od 30 dana.'; END IF;
  reason:=private.catalog_change_blocked(event,current_data);
  IF reason IS NOT NULL THEN RAISE EXCEPTION '% Ništa nije vraćeno.',reason USING ERRCODE='40001'; END IF;
  SELECT string_agg(format('%I = previous.%I',a.attname,a.attname),', ' ORDER BY a.attnum)
    INTO assignments FROM pg_attribute a
    WHERE a.attrelid='public.stavke'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated=''
      AND a.attname=ANY(ARRAY['sifra','naziv','vrsta_posla','podgrupa','jedinica','cijena','opis'])
      AND event.before_data->a.attname IS DISTINCT FROM event.after_data->a.attname;
  IF assignments IS NULL THEN RAISE EXCEPTION 'Nema podržanih izmjena za vraćanje.'; END IF;
  SELECT COALESCE(max(sequence),0) INTO last_sequence FROM private.business_change_history
    WHERE company_id=event.company_id AND table_name='stavke' AND record_id=event.record_id;
  SELECT COALESCE(array_agg(l.id),ARRAY[]::uuid[]) INTO previous_log_ids FROM public.stavke_cijene_log l
    WHERE l.stavka_id=event.record_id;
  EXECUTE format('UPDATE public.stavke s SET %s,updated_at=clock_timestamp()
    FROM jsonb_populate_record(NULL::public.stavke,$1) previous WHERE s.id=$2 AND s.company_id=$3',assignments)
    USING event.before_data,event.record_id,event.company_id;
  SELECT to_jsonb(s) INTO restored_data FROM public.stavke s WHERE s.id=event.record_id;
  IF (restored_data-ARRAY['updated_at','cijena_promijenjena_at'])
    IS DISTINCT FROM (event.before_data-ARRAY['updated_at','cijena_promijenjena_at']) THEN
    RAISE EXCEPTION 'Pravila stavke nisu dopustila točan povrat. Ništa nije vraćeno.';
  END IF;
  IF event.before_data->'cijena' IS DISTINCT FROM current_data->'cijena' AND NOT EXISTS (
    SELECT 1 FROM public.stavke_cijene_log l WHERE l.stavka_id=event.record_id AND l.company_id=event.company_id
      AND NOT (l.id=ANY(previous_log_ids))
      AND l.stara_cijena=(current_data->>'cijena')::numeric AND l.nova_cijena=(event.before_data->>'cijena')::numeric
  ) THEN RAISE EXCEPTION 'Povrat cijene nije evidentiran. Ništa nije vraćeno.'; END IF;
  SELECT h.id INTO new_event_id FROM private.business_change_history h WHERE h.company_id=event.company_id
    AND h.table_name='stavke' AND h.record_id=event.record_id AND h.operation='UPDATE'
    AND h.transaction_id=txid_current() AND h.sequence>last_sequence
    AND (h.before_data-ARRAY['updated_at','cijena_promijenjena_at'])=(current_data-ARRAY['updated_at','cijena_promijenjena_at'])
    AND (h.after_data-ARRAY['updated_at','cijena_promijenjena_at'])=(event.before_data-ARRAY['updated_at','cijena_promijenjena_at'])
    ORDER BY h.sequence DESC LIMIT 1;
  IF new_event_id IS NULL THEN RAISE EXCEPTION 'Povrat nije evidentiran. Ništa nije vraćeno.'; END IF;
  UPDATE private.business_change_history SET reverses_id=event.id WHERE id=new_event_id;
  UPDATE private.business_change_history SET reversed_at=clock_timestamp(),reversed_by=auth.uid() WHERE id=event.id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_catalog_change_history(uuid,bigint),public.restore_catalog_change(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_catalog_change_history(uuid,bigint),public.restore_catalog_change(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
