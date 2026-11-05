CREATE OR REPLACE FUNCTION public.set_work_order_status_with_settlement(
  p_nalog_id uuid,
  p_zavrsen boolean,
  p_bez_potvrde_djelatnika boolean,
  p_bez_izvrsenja boolean,
  p_spremi_izvrsenje boolean,
  p_km_pocetak numeric,
  p_km_kraj numeric,
  p_napomena text,
  p_entries jsonb,
  p_costs jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  company uuid := public.app_current_company_id();
  order_before public.radni_nalozi%ROWTYPE;
  order_after public.radni_nalozi%ROWTYPE;
  operation_id uuid;
  task_id uuid;
BEGIN
  SELECT * INTO order_before FROM public.radni_nalozi
  WHERE id = p_nalog_id AND company_id = company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nalog nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;

  operation_id := private.set_work_order_status_with_settlement_v1(
    p_nalog_id, p_zavrsen, p_bez_potvrde_djelatnika, p_bez_izvrsenja,
    p_spremi_izvrsenje, p_km_pocetak, p_km_kraj, p_napomena, p_entries, p_costs
  );

  IF p_zavrsen AND EXISTS (
    SELECT 1 FROM public.gradiliste_zadaci
    WHERE nalog_id = p_nalog_id AND company_id = company AND gotovo = true
  ) AND NOT public.app_has_module_permission('gradilista', 'edit') THEN
    RAISE EXCEPTION 'Za sinkronizaciju rokova dovršenih zadataka potrebno je pravo uređivanja gradilišta.'
      USING ERRCODE = '42501';
  END IF;

  IF p_zavrsen THEN
    FOR task_id IN
      SELECT id FROM public.gradiliste_zadaci
      WHERE nalog_id = p_nalog_id AND company_id = company AND gotovo = true
      ORDER BY id
      FOR UPDATE
    LOOP
      UPDATE public.gradiliste_zadaci
      SET gotovo_at = COALESCE(gotovo_at, clock_timestamp())
      WHERE id = task_id;
      PERFORM private.project_task_deadline(task_id);
    END LOOP;
  END IF;

  SELECT * INTO order_after FROM public.radni_nalozi
  WHERE id = p_nalog_id AND company_id = company;
  IF ROW(
    order_before.status, order_before.mobile_status, order_before.bez_izvrsenja,
    order_before.zakljucen_at, order_before.km_pocetak, order_before.km_kraj, order_before.napomena
  ) IS DISTINCT FROM ROW(
    order_after.status, order_after.mobile_status, order_after.bez_izvrsenja,
    order_after.zakljucen_at, order_after.km_pocetak, order_after.km_kraj, order_after.napomena
  ) THEN
    PERFORM public.write_mobile_work_order_audit(
      p_nalog_id,
      'office_status_changed',
      jsonb_build_object(
        'old_status', order_before.status,
        'new_status', order_after.status,
        'old_mobile_status', order_before.mobile_status,
        'new_mobile_status', order_after.mobile_status,
        'old_bez_izvrsenja', order_before.bez_izvrsenja,
        'new_bez_izvrsenja', order_after.bez_izvrsenja,
        'old_zakljucen_at', order_before.zakljucen_at,
        'new_zakljucen_at', order_after.zakljucen_at,
        'old_km_pocetak', order_before.km_pocetak,
        'new_km_pocetak', order_after.km_pocetak,
        'old_km_kraj', order_before.km_kraj,
        'new_km_kraj', order_after.km_kraj,
        'old_napomena', order_before.napomena,
        'new_napomena', order_after.napomena,
        'settlement_id', operation_id
      )
    );
  END IF;

  RETURN operation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_work_order_status_with_settlement(
  uuid, boolean, boolean, boolean, boolean, numeric, numeric, text, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_work_order_status_with_settlement(
  uuid, boolean, boolean, boolean, boolean, numeric, numeric, text, jsonb, jsonb
) TO authenticated;
NOTIFY pgrst, 'reload schema';
