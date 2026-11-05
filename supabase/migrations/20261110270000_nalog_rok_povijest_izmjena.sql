CREATE OR REPLACE FUNCTION private.order_change_blocked(p_event private.business_change_history,p_current jsonb)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_event.reversed_at IS NOT NULL OR p_event.reverses_id IS NOT NULL THEN RETURN 'Promjena je već vraćena.'; END IF;
  IF (p_event.before_data-ARRAY['naslov','opis','prioritet','rok','updated_at']) IS DISTINCT FROM
    (p_event.after_data-ARRAY['naslov','opis','prioritet','rok','updated_at']) THEN
    RETURN 'Promjena uključuje status, gradilište, izvršenje ili druga polja koja zahtijevaju zajednički povrat naloga.';
  END IF;
  IF EXISTS (SELECT 1 FROM private.business_change_history h WHERE h.company_id=p_event.company_id
    AND h.table_name='radni_nalozi' AND h.record_id=p_event.record_id AND h.sequence>p_event.sequence
    AND h.reversed_at IS NULL AND h.reverses_id IS NULL) THEN
    RETURN 'Nalog ima noviju promjenu. Najprije provjerite nju.';
  END IF;
  IF (p_current-'updated_at') IS DISTINCT FROM (p_event.after_data-'updated_at') THEN
    RETURN 'Nalog je naknadno promijenjen.';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.order_change_blocked(private.business_change_history,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.restore_order_change(p_history_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  event private.business_change_history%ROWTYPE;
  current_data jsonb;
  restored_data jsonb;
  reason text;
  last_sequence bigint;
  new_event_id uuid;
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi','edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja radnih naloga.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO event FROM private.business_change_history h WHERE h.id=p_history_id
    AND h.company_id=public.app_current_company_id() AND h.table_name='radni_nalozi'
    AND h.module='radni_nalozi' AND h.operation='UPDATE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Promjena nije dostupna u vašoj tvrtki.' USING ERRCODE='42501'; END IF;
  SELECT to_jsonb(n) INTO current_data FROM public.radni_nalozi n
    WHERE n.id=event.record_id AND n.company_id=event.company_id FOR UPDATE;
  IF current_data IS NULL THEN RAISE EXCEPTION 'Nalog je obrisan. Najprije vratite cijelu radnju brisanja.'; END IF;
  SELECT * INTO event FROM private.business_change_history h WHERE h.id=p_history_id FOR UPDATE;
  IF NOT FOUND OR event.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Istekao je rok od 30 dana.'; END IF;
  reason:=private.order_change_blocked(event,current_data);
  IF reason IS NOT NULL THEN RAISE EXCEPTION '% Ništa nije vraćeno.',reason USING ERRCODE='40001'; END IF;
  SELECT COALESCE(max(sequence),0) INTO last_sequence FROM private.business_change_history
    WHERE company_id=event.company_id AND table_name='radni_nalozi' AND record_id=event.record_id;
  UPDATE public.radni_nalozi n
    SET naslov=previous.naslov,opis=previous.opis,prioritet=previous.prioritet,rok=previous.rok
    FROM jsonb_populate_record(NULL::public.radni_nalozi,event.before_data) previous
    WHERE n.id=event.record_id AND n.company_id=event.company_id;
  SELECT to_jsonb(n) INTO restored_data FROM public.radni_nalozi n WHERE n.id=event.record_id;
  IF (restored_data-'updated_at') IS DISTINCT FROM (event.before_data-'updated_at') THEN
    RAISE EXCEPTION 'Pravila naloga nisu dopustila točan povrat. Ništa nije vraćeno.';
  END IF;
  SELECT h.id INTO new_event_id FROM private.business_change_history h WHERE h.company_id=event.company_id
    AND h.table_name='radni_nalozi' AND h.record_id=event.record_id AND h.operation='UPDATE'
    AND h.transaction_id=txid_current() AND h.sequence>last_sequence
    AND (h.before_data-'updated_at')=(current_data-'updated_at')
    AND (h.after_data-'updated_at')=(event.before_data-'updated_at') ORDER BY h.sequence DESC LIMIT 1;
  IF new_event_id IS NULL THEN RAISE EXCEPTION 'Povrat nije evidentiran. Ništa nije vraćeno.'; END IF;
  UPDATE private.business_change_history SET reverses_id=event.id WHERE id=new_event_id;
  UPDATE private.business_change_history SET reversed_at=clock_timestamp(),reversed_by=auth.uid() WHERE id=event.id;
END;
$$;

NOTIFY pgrst,'reload schema';
