DO $$
BEGIN
  IF to_regprocedure(
      'private.set_work_order_status_with_settlement_v1(uuid,boolean,boolean,boolean,boolean,numeric,numeric,text,jsonb,jsonb)'
    ) IS NULL
    AND to_regprocedure(
      'public.set_work_order_status_with_settlement(uuid,boolean,boolean,boolean,boolean,numeric,numeric,text,jsonb,jsonb)'
    ) IS NOT NULL THEN
    ALTER FUNCTION public.set_work_order_status_with_settlement(
      uuid, boolean, boolean, boolean, boolean, numeric, numeric, text, jsonb, jsonb
    ) SET SCHEMA private;
    ALTER FUNCTION private.set_work_order_status_with_settlement(
      uuid, boolean, boolean, boolean, boolean, numeric, numeric, text, jsonb, jsonb
    ) RENAME TO set_work_order_status_with_settlement_v1;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.set_work_order_status_with_settlement_v1(
  uuid, boolean, boolean, boolean, boolean, numeric, numeric, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

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
  operation_id uuid;
  task_id uuid;
BEGIN
  operation_id := private.set_work_order_status_with_settlement_v1(
    p_nalog_id, p_zavrsen, p_bez_potvrde_djelatnika, p_bez_izvrsenja,
    p_spremi_izvrsenje, p_km_pocetak, p_km_kraj, p_napomena, p_entries, p_costs
  );

  IF p_zavrsen AND EXISTS (
    SELECT 1 FROM public.gradiliste_zadaci
    WHERE nalog_id = p_nalog_id AND company_id = public.app_current_company_id()
      AND gotovo = true
  ) AND NOT public.app_has_module_permission('gradilista', 'edit') THEN
    RAISE EXCEPTION 'Za sinkronizaciju rokova dovršenih zadataka potrebno je pravo uređivanja gradilišta.'
      USING ERRCODE = '42501';
  END IF;

  IF p_zavrsen THEN
    FOR task_id IN
      SELECT id FROM public.gradiliste_zadaci
      WHERE nalog_id = p_nalog_id AND company_id = public.app_current_company_id()
        AND gotovo = true
      ORDER BY id
      FOR UPDATE
    LOOP
      UPDATE public.gradiliste_zadaci
      SET gotovo_at = COALESCE(gotovo_at, clock_timestamp())
      WHERE id = task_id;
      PERFORM private.project_task_deadline(task_id);
    END LOOP;
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
