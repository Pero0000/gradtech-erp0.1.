CREATE FUNCTION private.clear_cancelled_work_order_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  settlement_date date;
  remaining_costs jsonb;
  settlement_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'otkazan' OR OLD.status = 'otkazan' THEN
    RETURN NEW;
  END IF;

  settlement_id := public.replace_work_order_settlement(NEW.id, '[]'::jsonb, '[]'::jsonb);

  FOR settlement_date IN
    SELECT DISTINCT datum FROM public.troskovi
    WHERE company_id = NEW.company_id AND nalog_id = NEW.id
      AND kategorija = 'put' AND opis LIKE 'Kilometri:%'
    ORDER BY datum
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'daily-vehicle-km:' || NEW.company_id::text || ':' || settlement_date::text, 0
    ));
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nalog_id', cost.nalog_id, 'gradiliste_id', cost.gradiliste_id,
      'kategorija', cost.kategorija, 'opis', cost.opis, 'iznos', cost.iznos, 'datum', cost.datum
    ) ORDER BY cost.id), '[]'::jsonb)
    INTO remaining_costs
    FROM public.troskovi cost
    WHERE cost.company_id = NEW.company_id AND cost.datum = settlement_date
      AND cost.kategorija = 'put' AND cost.opis LIKE 'Kilometri:%'
      AND cost.nalog_id IS DISTINCT FROM NEW.id;

    PERFORM public.replace_daily_vehicle_km_settlement(settlement_date, remaining_costs);
  END LOOP;

  PERFORM public.write_mobile_work_order_audit(
    NEW.id, 'office_order_cancelled',
    jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status, 'settlement_id', settlement_id)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER clear_cancelled_work_order_settlement
  AFTER UPDATE OF status ON public.radni_nalozi
  FOR EACH ROW EXECUTE FUNCTION private.clear_cancelled_work_order_settlement();

REVOKE ALL ON FUNCTION private.clear_cancelled_work_order_settlement() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.clear_cancelled_work_order_settlement() IS
  'Otkazivanje u istoj transakciji uklanja obračun rada/opreme i kilometarske redove naloga kroz postojeću povijest. Troškovi drugih naloga, izvršenje i dovršeni zadaci ostaju sačuvani.';
