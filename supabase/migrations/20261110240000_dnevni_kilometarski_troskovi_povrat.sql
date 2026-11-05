CREATE TABLE private.daily_vehicle_km_settlements (
  deletion_id uuid PRIMARY KEY REFERENCES private.resource_deletions(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  settlement_date date NOT NULL,
  after_costs jsonb NOT NULL
);
ALTER TABLE private.daily_vehicle_km_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.daily_vehicle_km_settlements FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.guard_daily_vehicle_km_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  operation private.resource_deletions%ROWTYPE;
  row_data jsonb;
BEGIN
  IF (TG_OP <> 'INSERT' AND OLD.kategorija = 'put' AND OLD.opis LIKE 'Kilometri:%')
    OR (TG_OP <> 'DELETE' AND NEW.kategorija = 'put' AND NEW.opis LIKE 'Kilometri:%') THEN
    SELECT * INTO operation FROM private.resource_deletions
      WHERE active AND transaction_id = txid_current()
        AND snapshot->>'__history_type' = 'daily_vehicle_km_settlement';
    IF operation.id IS NULL OR current_setting('app.daily_vehicle_km_settlement_id', true)
      IS DISTINCT FROM operation.id::text THEN
      RAISE EXCEPTION 'Kilometarski troškovi mijenjaju se samo kroz evidentirani dnevni obračun.' USING ERRCODE = '42501';
    END IF;
    row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    IF (row_data->>'company_id')::uuid IS DISTINCT FROM operation.company_id
      OR (row_data->>'datum')::date IS DISTINCT FROM (operation.snapshot->>'settlement_date')::date THEN
      RAISE EXCEPTION 'Kilometarski trošak ne pripada ovom dnevnom obračunu.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER guard_daily_vehicle_km_cost
  BEFORE INSERT OR UPDATE OR DELETE ON public.troskovi
  FOR EACH ROW EXECUTE FUNCTION private.guard_daily_vehicle_km_cost();
REVOKE ALL ON FUNCTION private.guard_daily_vehicle_km_cost() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.daily_vehicle_km_settlement_unchanged(p_deletion_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  package private.daily_vehicle_km_settlements%ROWTYPE;
  current_costs jsonb;
BEGIN
  SELECT * INTO package FROM private.daily_vehicle_km_settlements WHERE deletion_id = p_deletion_id;
  IF NOT FOUND OR package.company_id IS DISTINCT FROM public.app_current_company_id()
    OR NOT public.app_has_module_permission('radni_nalozi', 'edit')
    OR NOT public.app_has_module_permission('troskovi', 'edit') THEN
    RETURN false;
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(cost) ORDER BY cost.id), '[]'::jsonb) INTO current_costs
    FROM public.troskovi cost
    WHERE cost.company_id = package.company_id AND cost.datum = package.settlement_date
      AND cost.kategorija = 'put' AND cost.opis LIKE 'Kilometri:%';
  RETURN current_costs IS NOT DISTINCT FROM package.after_costs;
END;
$$;

CREATE FUNCTION public.replace_daily_vehicle_km_settlement(p_datum date, p_costs jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  company uuid := public.app_current_company_id();
  operation_id uuid;
  actor text;
  history_sequence bigint;
  current_costs jsonb;
  requested_costs jsonb;
  after_costs jsonb;
  changed_count integer;
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit')
    OR NOT public.app_has_module_permission('troskovi', 'edit') THEN
    RAISE EXCEPTION 'Za dnevni obračun kilometara potrebna su prava uređivanja naloga i troškova.' USING ERRCODE = '42501';
  END IF;
  IF p_datum IS NULL OR p_costs IS NULL OR jsonb_typeof(p_costs) <> 'array' THEN
    RAISE EXCEPTION 'Neispravni podaci dnevnog kilometarskog obračuna.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_costs) item WHERE jsonb_typeof(item) <> 'object')
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_costs) item
      WHERE EXISTS (SELECT 1 FROM jsonb_object_keys(item) field
        WHERE field NOT IN ('nalog_id', 'gradiliste_id', 'kategorija', 'opis', 'iznos', 'datum'))
    ) THEN
    RAISE EXCEPTION 'Stavka kilometarskog obračuna ima neispravna polja.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_costs) entry(
      nalog_id uuid, gradiliste_id uuid, kategorija text, opis text, iznos numeric, datum date
    )
    WHERE entry.nalog_id IS NULL OR entry.kategorija IS DISTINCT FROM 'put'
      OR entry.opis IS NULL OR entry.opis NOT LIKE 'Kilometri:%'
      OR entry.iznos IS NULL OR entry.iznos <= 0 OR entry.datum IS DISTINCT FROM p_datum
      OR NOT EXISTS (SELECT 1 FROM public.radni_nalozi order_row
        WHERE order_row.id = entry.nalog_id AND order_row.company_id = company)
      OR (entry.gradiliste_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.gradilista site WHERE site.id = entry.gradiliste_id AND site.company_id = company
      ))
  ) THEN
    RAISE EXCEPTION 'Kilometarski trošak mora pripadati nalogu, gradilištu i datumu iz iste tvrtke.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('daily-vehicle-km:' || company::text || ':' || p_datum::text, 0));
  PERFORM order_row.id FROM public.radni_nalozi order_row
    WHERE order_row.company_id = company AND order_row.id IN (
      SELECT cost.nalog_id FROM public.troskovi cost
      WHERE cost.company_id = company AND cost.datum = p_datum
        AND cost.kategorija = 'put' AND cost.opis LIKE 'Kilometri:%'
      UNION
      SELECT entry.nalog_id FROM jsonb_to_recordset(p_costs) entry(nalog_id uuid)
    )
    ORDER BY order_row.id FOR UPDATE;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nalog_id', cost.nalog_id, 'gradiliste_id', cost.gradiliste_id,
      'kategorija', cost.kategorija, 'opis', cost.opis, 'iznos', cost.iznos, 'datum', cost.datum
    ) ORDER BY cost.nalog_id, cost.gradiliste_id, cost.opis, cost.iznos), '[]'::jsonb)
    INTO current_costs
    FROM public.troskovi cost
    WHERE cost.company_id = company AND cost.datum = p_datum
      AND cost.kategorija = 'put' AND cost.opis LIKE 'Kilometri:%';
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nalog_id', entry.nalog_id, 'gradiliste_id', entry.gradiliste_id,
      'kategorija', entry.kategorija, 'opis', btrim(entry.opis), 'iznos', entry.iznos, 'datum', entry.datum
    ) ORDER BY entry.nalog_id, entry.gradiliste_id, btrim(entry.opis), entry.iznos), '[]'::jsonb)
    INTO requested_costs
    FROM jsonb_to_recordset(p_costs) entry(
      nalog_id uuid, gradiliste_id uuid, kategorija text, opis text, iznos numeric, datum date
    );
  IF current_costs = requested_costs THEN RETURN NULL; END IF;

  SELECT count(*)::integer INTO changed_count FROM public.troskovi cost
    WHERE cost.company_id = company AND cost.datum = p_datum
      AND cost.kategorija = 'put' AND cost.opis LIKE 'Kilometri:%';
  IF changed_count = 0 AND jsonb_array_length(p_costs) = 0 THEN RETURN NULL; END IF;
  SELECT COALESCE(max(sequence), 0) INTO history_sequence FROM private.business_change_history;
  SELECT email INTO actor FROM public.app_profiles WHERE id = auth.uid();
  INSERT INTO private.resource_deletions(company_id, module, table_name, record_id, snapshot, actor_name)
    VALUES (company, 'radni_nalozi', 'troskovi', gen_random_uuid(),
      jsonb_build_object('__history_type', 'daily_vehicle_km_settlement', 'settlement_date', p_datum),
      COALESCE(actor, 'Korisnik'))
    RETURNING id INTO operation_id;
  PERFORM set_config('app.daily_vehicle_km_settlement_id', operation_id::text, true);

  DELETE FROM public.troskovi cost
    WHERE cost.company_id = company AND cost.datum = p_datum
      AND cost.kategorija = 'put' AND cost.opis LIKE 'Kilometri:%';
  INSERT INTO public.troskovi(company_id, nalog_id, gradiliste_id, kategorija, opis, iznos, datum)
    SELECT company, entry.nalog_id, entry.gradiliste_id, entry.kategorija,
      btrim(entry.opis), entry.iznos, entry.datum
    FROM jsonb_to_recordset(p_costs) entry(
      nalog_id uuid, gradiliste_id uuid, kategorija text, opis text, iznos numeric, datum date
    );
  SELECT COALESCE(jsonb_agg(to_jsonb(cost) ORDER BY cost.id), '[]'::jsonb) INTO after_costs
    FROM public.troskovi cost
    WHERE cost.company_id = company AND cost.datum = p_datum
      AND cost.kategorija = 'put' AND cost.opis LIKE 'Kilometri:%';
  IF NOT private.resource_deletion_allowed(operation_id) THEN
    RAISE EXCEPTION 'Za povrat dnevnog obračuna nedostaju prava za naloge ili troškove. Ništa nije promijenjeno.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO private.daily_vehicle_km_settlements(deletion_id, company_id, settlement_date, after_costs)
    VALUES (operation_id, company, p_datum, after_costs);
  INSERT INTO private.resource_deletion_events
    SELECT operation_id, history.id FROM private.business_change_history history
    WHERE history.transaction_id = txid_current() AND history.sequence > history_sequence;
  UPDATE private.resource_deletions SET active = false WHERE id = operation_id;
  RETURN operation_id;
END;
$$;

CREATE FUNCTION public.get_daily_vehicle_km_settlements(
  p_before_time timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, snapshot jsonb, actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, can_restore boolean, affected_rows jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit')
    OR NOT public.app_has_module_permission('troskovi', 'edit') THEN
    RAISE EXCEPTION 'Za pregled povijesti kilometarskih obračuna potrebna su prava uređivanja naloga i troškova.' USING ERRCODE = '42501';
  END IF;
  IF (p_before_time IS NULL) <> (p_before_id IS NULL) THEN RAISE EXCEPTION 'Nepotpun pokazivač stranice.' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT deletion.id, deletion.snapshot, deletion.actor_name, deletion.created_at, deletion.expires_at,
    deletion.reversed_at, deletion.reversed_at IS NULL
      AND private.resource_deletion_allowed(deletion.id)
      AND private.daily_vehicle_km_settlement_unchanged(deletion.id),
    (SELECT jsonb_object_agg(summary.table_name, summary.total) FROM (
      SELECT row.table_name, count(*) total FROM private.resource_deletion_rows row
      WHERE row.deletion_id = deletion.id GROUP BY row.table_name
    ) summary)
  FROM private.resource_deletions deletion
  JOIN private.daily_vehicle_km_settlements package ON package.deletion_id = deletion.id
  WHERE deletion.company_id = public.app_current_company_id()
    AND deletion.module = 'radni_nalozi' AND NOT deletion.active AND deletion.expires_at > now()
    AND (p_before_time IS NULL OR (deletion.created_at, deletion.id) < (p_before_time, p_before_id))
  ORDER BY deletion.created_at DESC, deletion.id DESC LIMIT 50;
END;
$$;

CREATE FUNCTION public.restore_daily_vehicle_km_settlement(p_deletion_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  operation private.resource_deletions%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('resource-restore:' || public.app_current_company_id()::text, 0));
  SELECT * INTO operation FROM private.resource_deletions
    WHERE id = p_deletion_id AND company_id = public.app_current_company_id() FOR UPDATE;
  IF NOT FOUND OR operation.module <> 'radni_nalozi'
    OR operation.snapshot->>'__history_type' <> 'daily_vehicle_km_settlement'
    OR operation.active OR operation.expires_at <= clock_timestamp() OR operation.reversed_at IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM private.daily_vehicle_km_settlements package WHERE package.deletion_id = operation.id) THEN
    RAISE EXCEPTION 'Dnevni kilometarski obračun nije dostupan ili mu je istekao rok povrata.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit')
    OR NOT public.app_has_module_permission('troskovi', 'edit')
    OR NOT private.resource_deletion_allowed(operation.id) THEN
    RAISE EXCEPTION 'Nedostaju prava za vraćanje kilometarskih troškova.' USING ERRCODE = '42501';
  END IF;
  IF NOT private.daily_vehicle_km_settlement_unchanged(operation.id) THEN
    RAISE EXCEPTION 'Kilometarski troškovi tog dana naknadno su promijenjeni. Ništa nije vraćeno.' USING ERRCODE = '40001';
  END IF;
  PERFORM set_config('app.daily_vehicle_km_settlement_id', operation.id::text, true);
  PERFORM public.restore_resource_deletion(operation.id);
END;
$$;

REVOKE ALL ON FUNCTION private.daily_vehicle_km_settlement_unchanged(uuid),
  private.guard_daily_vehicle_km_cost(),
  public.replace_daily_vehicle_km_settlement(date, jsonb),
  public.get_daily_vehicle_km_settlements(timestamptz, uuid),
  public.restore_daily_vehicle_km_settlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_daily_vehicle_km_settlement(date, jsonb),
  public.get_daily_vehicle_km_settlements(timestamptz, uuid),
  public.restore_daily_vehicle_km_settlement(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
