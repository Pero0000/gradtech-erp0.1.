DO $$
DECLARE
  target public.troskovi;
  matches integer;
  operation_id uuid;
  history_sequence bigint;
  remaining_costs jsonb;
  affected integer;
BEGIN
  SELECT count(*) INTO matches
  FROM public.troskovi t
  JOIN public.gradilista g ON g.id = t.gradiliste_id AND g.company_id = t.company_id
  WHERE g.naziv = 'Brane Stan' AND t.datum = DATE '2026-11-09'
    AND t.kategorija = 'put' AND t.iznos = 22960
    AND t.opis ILIKE '%Vivaro%82000 km%';

  IF matches = 0 THEN
    RAISE NOTICE 'Pogrešan put Brane Stan / Vivaro / 09.11.2026. / 22.960 EUR nije pronađen. Ništa nije promijenjeno.';
    RETURN;
  ELSIF matches <> 1 THEN
    RAISE EXCEPTION 'Pronađeno je % odgovarajućih troškova. Ispravak je zaustavljen radi provjere tvrtke i naloga.', matches;
  END IF;

  SELECT t.* INTO target
  FROM public.troskovi t
  JOIN public.gradilista g ON g.id = t.gradiliste_id AND g.company_id = t.company_id
  WHERE g.naziv = 'Brane Stan' AND t.datum = DATE '2026-11-09'
    AND t.kategorija = 'put' AND t.iznos = 22960
    AND t.opis ILIKE '%Vivaro%82000 km%';

  IF target.nalog_id IS NULL THEN
    RAISE EXCEPTION 'Trošak nema izvorni nalog. Ništa nije promijenjeno.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'daily-vehicle-km:' || target.company_id::text || ':' || target.datum::text, 0
  ));
  PERFORM id FROM public.radni_nalozi
  WHERE id = target.nalog_id AND company_id = target.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Izvorni nalog nije pronađen. Ništa nije promijenjeno.'; END IF;
  PERFORM id FROM public.troskovi
  WHERE company_id = target.company_id AND datum = target.datum
    AND kategorija = 'put' AND opis LIKE 'Kilometri:%'
  ORDER BY id FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.troskovi t WHERE t.id = target.id AND to_jsonb(t) = to_jsonb(target)
  ) THEN
    RAISE EXCEPTION 'Trošak je u međuvremenu promijenjen. Ponovi provjeru.';
  END IF;

  SELECT COALESCE(max(sequence), 0) INTO history_sequence FROM private.business_change_history;
  INSERT INTO private.resource_deletions(company_id, module, table_name, record_id, snapshot, actor_name)
  VALUES (
    target.company_id, 'radni_nalozi', 'troskovi', target.id,
    jsonb_build_object(
      '__history_type', 'daily_vehicle_km_settlement', 'settlement_date', target.datum,
      'reason', 'Uklanjanje pogrešnog puta od 82000 km na izričit zahtjev korisnika',
      'original_cost', to_jsonb(target),
      'original_order', (SELECT to_jsonb(n) FROM public.radni_nalozi n WHERE n.id = target.nalog_id)
    ),
    'Ispravak pogrešnog puta — zahtjev korisnika'
  ) RETURNING id INTO operation_id;
  PERFORM set_config('app.daily_vehicle_km_settlement_id', operation_id::text, true);

  UPDATE public.radni_nalozi SET km_bez_obracuna = true
  WHERE id = target.nalog_id AND company_id = target.company_id;
  DELETE FROM public.troskovi WHERE id = target.id AND company_id = target.company_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Očekivano je uklanjanje točno jednog troška. Ništa nije promijenjeno.'; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO remaining_costs
  FROM public.troskovi t
  WHERE t.company_id = target.company_id AND t.datum = target.datum
    AND t.kategorija = 'put' AND t.opis LIKE 'Kilometri:%';
  INSERT INTO private.daily_vehicle_km_settlements(deletion_id, company_id, settlement_date, after_costs)
  VALUES (operation_id, target.company_id, target.datum, remaining_costs);
  INSERT INTO private.resource_deletion_events
  SELECT operation_id, h.id FROM private.business_change_history h
  WHERE h.transaction_id = txid_current() AND h.sequence > history_sequence;
  UPDATE private.resource_deletions SET active = false WHERE id = operation_id;

  RAISE NOTICE 'Uklonjen je samo trošak % od 22.960 EUR. Izvorna očitanja, sati i ostali troškovi ostaju; kilometri naloga % isključeni su iz ponovnog obračuna.',
    target.id, target.nalog_id;
END;
$$;
