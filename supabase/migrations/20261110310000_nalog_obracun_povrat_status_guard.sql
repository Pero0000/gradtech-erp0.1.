ALTER TABLE private.work_order_settlement_packages
  ADD COLUMN IF NOT EXISTS after_order jsonb;

UPDATE private.work_order_settlement_packages package
SET after_order = deletion.snapshot - '__history_type'
FROM private.resource_deletions deletion
WHERE deletion.id = package.deletion_id
  AND package.after_order IS NULL;

ALTER TABLE private.work_order_settlement_packages
  ALTER COLUMN after_order SET NOT NULL;

CREATE OR REPLACE FUNCTION private.capture_work_order_settlement_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.after_order IS NULL THEN
    SELECT deletion.snapshot - '__history_type' INTO NEW.after_order
    FROM private.resource_deletions deletion
    WHERE deletion.id = NEW.deletion_id;
  END IF;
  IF NEW.after_order IS NULL THEN
    RAISE EXCEPTION 'Nedostaje snimka naloga za povrat obračuna.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_work_order_settlement_order ON private.work_order_settlement_packages;
CREATE TRIGGER capture_work_order_settlement_order
  BEFORE INSERT ON private.work_order_settlement_packages
  FOR EACH ROW EXECUTE FUNCTION private.capture_work_order_settlement_order();
REVOKE ALL ON FUNCTION private.capture_work_order_settlement_order() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.work_order_settlement_unchanged(p_deletion_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  package private.work_order_settlement_packages%ROWTYPE;
  current_order jsonb;
  current_work_time jsonb;
  current_costs jsonb;
  current_revision bigint;
BEGIN
  SELECT * INTO package FROM private.work_order_settlement_packages WHERE deletion_id = p_deletion_id;
  IF NOT FOUND OR package.company_id IS DISTINCT FROM public.app_current_company_id() THEN
    RETURN false;
  END IF;
  SELECT to_jsonb(order_row) INTO current_order
  FROM public.radni_nalozi order_row
  WHERE order_row.id = package.nalog_id AND order_row.company_id = package.company_id;
  IF current_order IS NULL THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'status', 'mobile_status', 'bez_izvrsenja', 'bez_troska',
      'gradiliste_id', 'km_pocetak', 'km_kraj', 'teren'
    ]) AS fields(field_name)
    WHERE current_order->field_name IS DISTINCT FROM package.after_order->field_name
  ) THEN
    RETURN false;
  END IF;
  SELECT revision INTO current_revision
  FROM private.work_time_order_versions
  WHERE nalog_id = package.nalog_id;
  IF current_revision IS DISTINCT FROM package.work_time_revision THEN RETURN false; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id), '[]'::jsonb) INTO current_work_time
  FROM public.radno_vrijeme row_data
  WHERE row_data.company_id = package.company_id AND row_data.nalog_id = package.nalog_id;
  IF current_work_time IS DISTINCT FROM package.after_work_time THEN RETURN false; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(cost_data) ORDER BY cost_data.id), '[]'::jsonb) INTO current_costs
  FROM public.troskovi cost_data
  WHERE cost_data.company_id = package.company_id AND cost_data.nalog_id = package.nalog_id
    AND NOT (cost_data.kategorija = 'put' AND cost_data.opis LIKE 'Kilometri:%');
  RETURN current_costs IS NOT DISTINCT FROM package.after_costs;
END;
$$;
