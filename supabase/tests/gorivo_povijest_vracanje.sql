-- Run only on a staging database, as postgres, after the history migration.
-- An approved administrator of an active company must already exist.
-- All fixtures and changes are rolled back. No production records are deleted.
BEGIN;
DO $$
DECLARE
  test_user uuid;
  test_company uuid;
  vehicle_id uuid := gen_random_uuid();
  fuel_id uuid := gen_random_uuid();
  insert_event uuid;
  first_update uuid;
  second_update uuid;
  delete_event uuid;
  expired_event uuid;
  remaining integer;
BEGIN
  SELECT p.id, p.company_id INTO test_user, test_company
  FROM public.app_profiles p JOIN public.tvrtke c ON c.id = p.company_id
  WHERE p.approved AND p.is_admin AND c.aktivna LIMIT 1;
  IF test_user IS NULL THEN
    RAISE EXCEPTION 'Staging test requires an approved company administrator.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', test_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', test_user, 'role', 'authenticated')::text, true);
  INSERT INTO public.vozila (id, company_id, registracija, marka, model, tip, status, kilometraza)
  VALUES (vehicle_id, test_company, 'TEST-' || vehicle_id::text, 'Test', 'History', 'teretno', 'slobodno', 100000);
  INSERT INTO public.vozila_gorivo (
    id, company_id, vozilo_id, datum, litara, kilometraza, tocio_ime, created_by
  ) VALUES (fuel_id, test_company, vehicle_id, CURRENT_DATE, 40, 99500, 'Test', test_user);
  SELECT id INTO STRICT insert_event FROM private.business_change_history
  WHERE record_id = fuel_id AND operation = 'INSERT';

  UPDATE public.vozila_gorivo SET litara = 50, updated_at = clock_timestamp() WHERE id = fuel_id;
  SELECT id INTO first_update FROM private.business_change_history
  WHERE record_id = fuel_id ORDER BY sequence DESC LIMIT 1;
  UPDATE public.vozila_gorivo SET litara = 60, updated_at = clock_timestamp() WHERE id = fuel_id;
  SELECT id INTO second_update FROM private.business_change_history
  WHERE record_id = fuel_id ORDER BY sequence DESC LIMIT 1;
  BEGIN
    PERFORM public.restore_fuel_change(first_update);
    RAISE EXCEPTION 'TEST FAILED: older changes must conflict.';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;

  PERFORM public.restore_fuel_change(second_update);
  IF (SELECT litara FROM public.vozila_gorivo WHERE id = fuel_id) <> 50 THEN
    RAISE EXCEPTION 'TEST FAILED: latest update did not restore 50 litres.';
  END IF;
  PERFORM public.restore_fuel_change(first_update);
  IF (SELECT litara FROM public.vozila_gorivo WHERE id = fuel_id) <> 40 THEN
    RAISE EXCEPTION 'TEST FAILED: second backward step did not restore 40 litres.';
  END IF;
  BEGIN
    PERFORM public.restore_fuel_change(first_update);
    RAISE EXCEPTION 'TEST FAILED: duplicate restore was accepted.';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Ova promjena već%' THEN RAISE; END IF;
  END;

  DELETE FROM public.vozila_gorivo WHERE id = fuel_id;
  SELECT id INTO delete_event FROM private.business_change_history
  WHERE record_id = fuel_id ORDER BY sequence DESC LIMIT 1;
  PERFORM public.restore_fuel_change(delete_event);
  SELECT count(*) INTO remaining FROM public.vozila_gorivo WHERE id = fuel_id AND litara = 40 AND kilometraza = 99500;
  IF remaining <> 1 THEN RAISE EXCEPTION 'TEST FAILED: deleted fuel was not restored.'; END IF;
  IF (SELECT kilometraza FROM public.vozila WHERE id = vehicle_id) <> 100000 THEN
    RAISE EXCEPTION 'TEST FAILED: restore lowered vehicle odometer.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.restore_fuel_change(insert_event);
    RAISE EXCEPTION 'TEST FAILED: unauthorized restore was accepted.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', test_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', test_user, 'role', 'authenticated')::text, true);

  UPDATE public.vozila_gorivo SET litara = 70, updated_at = clock_timestamp() WHERE id = fuel_id;
  SELECT id INTO expired_event FROM private.business_change_history
  WHERE record_id = fuel_id ORDER BY sequence DESC LIMIT 1;
  UPDATE private.business_change_history SET expires_at = now() - interval '1 second' WHERE id = expired_event;
  BEGIN
    PERFORM public.restore_fuel_change(expired_event);
    RAISE EXCEPTION 'TEST FAILED: expired history was restored.';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Istekao je rok%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.get_fuel_change_history(vehicle_id) h WHERE h.id = expired_event) THEN
    RAISE EXCEPTION 'TEST FAILED: expired history is visible.';
  END IF;

  -- Restore the original insert after all later edits have been undone.
  UPDATE private.business_change_history SET expires_at = clock_timestamp() + interval '30 days' WHERE id = expired_event;
  PERFORM public.restore_fuel_change(expired_event);
  PERFORM public.restore_fuel_change(insert_event);
  IF EXISTS (SELECT 1 FROM public.vozila_gorivo WHERE id = fuel_id) THEN
    RAISE EXCEPTION 'TEST FAILED: undo insert did not remove the new fuel entry.';
  END IF;
  RAISE NOTICE 'Fuel history staging assertions passed.';
END;
$$;
ROLLBACK;
