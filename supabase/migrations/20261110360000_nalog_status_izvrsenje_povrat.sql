CREATE TABLE private.work_order_status_changes (
  id uuid PRIMARY KEY,
  nalog_id uuid NOT NULL,
  company_id uuid NOT NULL,
  settlement_id uuid,
  before_order jsonb NOT NULL,
  after_order jsonb NOT NULL,
  before_tasks jsonb NOT NULL,
  after_tasks jsonb NOT NULL,
  before_deadlines jsonb NOT NULL,
  after_deadlines jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reversed_at timestamptz
);
ALTER TABLE private.work_order_status_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.work_order_status_changes FROM PUBLIC, anon, authenticated;

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
  status_change_id uuid := gen_random_uuid();
  task_id uuid;
  task_ids uuid[];
  task_count integer;
  before_tasks jsonb;
  after_tasks jsonb;
  before_deadlines jsonb;
  after_deadlines jsonb;
BEGIN
  SELECT * INTO order_before FROM public.radni_nalozi
  WHERE id = p_nalog_id AND company_id = company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nalog nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;

  SELECT COALESCE(array_agg(task.id ORDER BY task.id), ARRAY[]::uuid[]),
         COALESCE(jsonb_agg(to_jsonb(task) ORDER BY task.id), '[]'::jsonb)
  INTO task_ids, before_tasks
  FROM public.gradiliste_zadaci task
  WHERE task.nalog_id = p_nalog_id AND task.company_id = company;
  task_count := cardinality(task_ids);
  IF EXISTS (
    SELECT 1 FROM public.rokovi deadline
    WHERE deadline.zadatak_id = ANY(task_ids) AND deadline.company_id IS DISTINCT FROM company
  ) THEN
    RAISE EXCEPTION 'Povezani rok pripada drugoj tvrtki. Ništa nije spremljeno.' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(deadline) ORDER BY deadline.id), '[]'::jsonb)
  INTO before_deadlines
  FROM public.rokovi deadline
  WHERE deadline.company_id = company AND deadline.zadatak_id = ANY(task_ids);

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
    SELECT COALESCE(jsonb_agg(to_jsonb(task) ORDER BY task.id), '[]'::jsonb)
    INTO after_tasks FROM public.gradiliste_zadaci task
    WHERE task.id = ANY(task_ids) AND task.company_id = company;
    SELECT COALESCE(jsonb_agg(to_jsonb(deadline) ORDER BY deadline.id), '[]'::jsonb)
    INTO after_deadlines FROM public.rokovi deadline
    WHERE deadline.company_id = company AND deadline.zadatak_id = ANY(task_ids);

    INSERT INTO private.work_order_status_changes(
      id, nalog_id, company_id, settlement_id, before_order, after_order,
      before_tasks, after_tasks, before_deadlines, after_deadlines
    ) VALUES (
      status_change_id, p_nalog_id, company, operation_id, to_jsonb(order_before), to_jsonb(order_after),
      before_tasks, after_tasks, before_deadlines, after_deadlines
    );
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
        'settlement_id', operation_id,
        'status_change_id', status_change_id,
        'task_count', task_count
      )
    );
  END IF;

  RETURN operation_id;
END;
$$;

CREATE FUNCTION public.restore_work_order_status_change(p_status_change_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  change private.work_order_status_changes%ROWTYPE;
  order_row public.radni_nalozi%ROWTYPE;
  task_row jsonb;
  expected_order jsonb;
  current_tasks jsonb;
  current_deadlines jsonb;
  task_ids uuid[];
  task_count integer;
  audit_details jsonb;
BEGIN
  SELECT * INTO change FROM private.work_order_status_changes
  WHERE id = p_status_change_id AND company_id = public.app_current_company_id()
  FOR UPDATE;
  IF NOT FOUND OR change.reversed_at IS NOT NULL OR change.created_at <= clock_timestamp() - interval '30 days' THEN
    RAISE EXCEPTION 'Promjena statusa nije dostupna, već vraćena ili je istekao rok od 30 dana.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO order_row FROM public.radni_nalozi
  WHERE id = change.nalog_id AND company_id = change.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Radni nalog nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja radnih naloga.' USING ERRCODE = '42501';
  END IF;

  expected_order := change.after_order - 'updated_at';
  IF (to_jsonb(order_row) - 'updated_at') IS DISTINCT FROM expected_order THEN
    RAISE EXCEPTION 'Nalog je nakon promjene statusa izmijenjen. Ništa nije vraćeno.' USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mobile_work_order_audit audit
    WHERE audit.nalog_id = change.nalog_id
      AND audit.action = 'office_status_changed'
      AND audit.details->>'status_change_id' = change.id::text
  ) THEN
    RAISE EXCEPTION 'Nedostaje zapis povijesti promjene statusa. Ništa nije vraćeno.' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mobile_work_order_audit audit
    WHERE audit.nalog_id = change.nalog_id AND audit.action = 'office_status_changed'
      AND audit.id > (
        SELECT max(original.id) FROM public.mobile_work_order_audit original
        WHERE original.nalog_id = change.nalog_id
          AND original.details->>'status_change_id' = change.id::text
      )
  ) THEN
    RAISE EXCEPTION 'Nalog ima noviju promjenu statusa. Najprije je provjerite.' USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(array_agg((item->>'id')::uuid ORDER BY (item->>'id')::uuid), ARRAY[]::uuid[])
  INTO task_ids FROM jsonb_array_elements(change.after_tasks) item;
  task_count := cardinality(task_ids);
  IF task_count > 0 AND NOT public.app_has_module_permission('gradilista', 'edit') THEN
    RAISE EXCEPTION 'Za vraćanje prenesenih zadataka i rokova potrebno je pravo uređivanja gradilišta.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rokovi deadline
    WHERE deadline.zadatak_id = ANY(task_ids) AND deadline.company_id IS DISTINCT FROM change.company_id
  ) THEN
    RAISE EXCEPTION 'Povezani rok pripada drugoj tvrtki. Ništa nije vraćeno.' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(task) - 'updated_at' ORDER BY task.id), '[]'::jsonb)
  INTO current_tasks FROM public.gradiliste_zadaci task
  WHERE task.id = ANY(task_ids) AND task.company_id = change.company_id;
  IF current_tasks IS DISTINCT FROM (
    SELECT COALESCE(jsonb_agg(item - 'updated_at' ORDER BY item->>'id'), '[]'::jsonb)
    FROM jsonb_array_elements(change.after_tasks) item
  ) THEN
    RAISE EXCEPTION 'Zadaci naloga naknadno su promijenjeni. Ništa nije vraćeno.' USING ERRCODE = '40001';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(deadline) ORDER BY deadline.id), '[]'::jsonb)
  INTO current_deadlines FROM public.rokovi deadline
  WHERE deadline.company_id = change.company_id AND deadline.zadatak_id = ANY(task_ids);
  IF current_deadlines IS DISTINCT FROM change.after_deadlines THEN
    RAISE EXCEPTION 'Rokovi zadataka naknadno su promijenjeni. Ništa nije vraćeno.' USING ERRCODE = '40001';
  END IF;

  IF change.settlement_id IS NOT NULL THEN
    PERFORM public.restore_work_order_settlement(change.settlement_id);
  END IF;

  UPDATE public.radni_nalozi
  SET status = (change.before_order->>'status'),
      mobile_status = (change.before_order->>'mobile_status'),
      bez_izvrsenja = (change.before_order->>'bez_izvrsenja')::boolean,
      zakljucen_at = NULLIF(change.before_order->>'zakljucen_at', '')::timestamptz,
      km_pocetak = NULLIF(change.before_order->>'km_pocetak', '')::numeric,
      km_kraj = NULLIF(change.before_order->>'km_kraj', '')::numeric,
      napomena = change.before_order->>'napomena'
  WHERE id = change.nalog_id AND company_id = change.company_id;

  FOR task_row IN SELECT item FROM jsonb_array_elements(change.before_tasks) item ORDER BY item->>'id'
  LOOP
    UPDATE public.gradiliste_zadaci task
    SET nalog_id = previous.nalog_id,
        gotovo_at = previous.gotovo_at
    FROM jsonb_populate_record(NULL::public.gradiliste_zadaci, task_row) previous
    WHERE task.id = previous.id AND task.company_id = change.company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Zadatak više nije dostupan. Ništa nije vraćeno.' USING ERRCODE = '40001'; END IF;
  END LOOP;

  IF task_count > 0 THEN
    INSERT INTO private.deadline_sync_context(transaction_id, task_id)
    SELECT txid_current(), task_id FROM unnest(task_ids) task_id
    ON CONFLICT DO NOTHING;
    DELETE FROM public.rokovi
    WHERE company_id = change.company_id AND zadatak_id = ANY(task_ids);
    INSERT INTO public.rokovi
    SELECT (jsonb_populate_record(NULL::public.rokovi, item)).*
    FROM jsonb_array_elements(change.before_deadlines) item;
    DELETE FROM private.deadline_sync_context
    WHERE transaction_id = txid_current() AND task_id = ANY(task_ids);
  END IF;

  UPDATE private.work_order_status_changes
  SET reversed_at = clock_timestamp()
  WHERE id = change.id AND company_id = change.company_id AND reversed_at IS NULL;
  audit_details := jsonb_build_object(
    'status_change_id', change.id,
    'old_status', change.after_order->>'status',
    'new_status', change.before_order->>'status',
    'old_mobile_status', change.after_order->>'mobile_status',
    'new_mobile_status', change.before_order->>'mobile_status'
  );
  PERFORM public.write_mobile_work_order_audit(change.nalog_id, 'office_status_restored', audit_details);
END;
$$;

REVOKE ALL ON FUNCTION public.restore_work_order_status_change(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_work_order_status_change(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.prune_business_change_history()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM private.business_change_history WHERE expires_at <= clock_timestamp();
  DELETE FROM private.work_order_team_change_history WHERE expires_at <= clock_timestamp();
  DELETE FROM private.work_order_status_changes WHERE created_at <= clock_timestamp() - interval '30 days';
$$;
REVOKE ALL ON FUNCTION private.prune_business_change_history() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
