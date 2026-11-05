CREATE TABLE private.work_order_settlement_packages (
  deletion_id uuid PRIMARY KEY REFERENCES private.resource_deletions(id) ON DELETE CASCADE,
  nalog_id uuid NOT NULL,
  company_id uuid NOT NULL,
  work_time_revision bigint NOT NULL,
  after_work_time jsonb NOT NULL,
  after_costs jsonb NOT NULL
);
ALTER TABLE private.work_order_settlement_packages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.work_order_settlement_packages FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.lock_work_order_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  target uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  FOR target IN SELECT DISTINCT value::uuid FROM (
    VALUES (old_data->>'nalog_id'), (new_data->>'nalog_id')
  ) orders(value) WHERE value IS NOT NULL ORDER BY value::uuid LOOP
    PERFORM 1 FROM public.radni_nalozi WHERE id = target FOR UPDATE;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER lock_work_order_cost
  BEFORE INSERT OR UPDATE OR DELETE ON public.troskovi
  FOR EACH ROW EXECUTE FUNCTION private.lock_work_order_cost();
REVOKE ALL ON FUNCTION private.lock_work_order_cost() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.guard_work_order_settlement_restore()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  operation private.resource_deletions%ROWTYPE;
BEGIN
  SELECT d.* INTO operation FROM private.resource_deletions d
    JOIN private.work_order_settlement_packages package ON package.deletion_id = d.id
    WHERE d.active AND d.restoring AND d.transaction_id = txid_current();
  IF operation.id IS NOT NULL AND current_setting('app.work_order_settlement_restore_id', true)
      IS DISTINCT FROM operation.id::text THEN
    RAISE EXCEPTION 'Obračun naloga zahtijeva namjenski provjeren povrat. Ništa nije vraćeno.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER guard_work_order_settlement_restore
  BEFORE INSERT OR UPDATE OR DELETE ON public.radno_vrijeme
  FOR EACH ROW EXECUTE FUNCTION private.guard_work_order_settlement_restore();
CREATE TRIGGER guard_work_order_settlement_restore
  BEFORE INSERT OR UPDATE OR DELETE ON public.troskovi
  FOR EACH ROW EXECUTE FUNCTION private.guard_work_order_settlement_restore();
REVOKE ALL ON FUNCTION private.guard_work_order_settlement_restore() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.work_order_settlement_unchanged(p_deletion_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  package private.work_order_settlement_packages%ROWTYPE;
  current_work_time jsonb;
  current_costs jsonb;
  current_revision bigint;
BEGIN
  SELECT * INTO package FROM private.work_order_settlement_packages WHERE deletion_id = p_deletion_id;
  IF NOT FOUND OR package.company_id IS DISTINCT FROM public.app_current_company_id()
    OR NOT EXISTS (SELECT 1 FROM public.radni_nalozi WHERE id = package.nalog_id AND company_id = package.company_id) THEN
    RETURN false;
  END IF;
  SELECT revision INTO current_revision FROM private.work_time_order_versions WHERE nalog_id = package.nalog_id;
  IF current_revision IS DISTINCT FROM package.work_time_revision THEN RETURN false; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb) INTO current_work_time
    FROM public.radno_vrijeme r WHERE r.company_id = package.company_id AND r.nalog_id = package.nalog_id;
  IF current_work_time IS DISTINCT FROM package.after_work_time THEN RETURN false; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id), '[]'::jsonb) INTO current_costs
    FROM public.troskovi c WHERE c.company_id = package.company_id AND c.nalog_id = package.nalog_id
      AND NOT (c.kategorija = 'put' AND c.opis LIKE 'Kilometri:%');
  RETURN current_costs IS NOT DISTINCT FROM package.after_costs;
END;
$$;

CREATE FUNCTION public.replace_work_order_settlement(p_nalog_id uuid, p_entries jsonb, p_costs jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  company uuid := public.app_current_company_id();
  order_row public.radni_nalozi%ROWTYPE;
  operation_id uuid;
  untracked text;
  history_sequence bigint;
  work_time_snapshot jsonb;
  cost_snapshot jsonb;
  revision bigint;
  affected_count integer;
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit')
    OR NOT public.app_has_module_permission('radno_vrijeme', 'edit')
    OR NOT public.app_has_module_permission('troskovi', 'edit') THEN
    RAISE EXCEPTION 'Za obračun naloga potrebna su prava uređivanja naloga, radnog vremena i troškova.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO order_row FROM public.radni_nalozi
    WHERE id = p_nalog_id AND company_id = company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nalog nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array'
    OR p_costs IS NULL OR jsonb_typeof(p_costs) <> 'array' THEN
    RAISE EXCEPTION 'Neispravni podaci obračuna naloga.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_entries) entry WHERE jsonb_typeof(entry) <> 'object')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_costs) entry WHERE jsonb_typeof(entry) <> 'object') THEN
    RAISE EXCEPTION 'Stavka obračuna mora biti objekt.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_entries) entry
    WHERE entry->>'nalog_id' IS DISTINCT FROM p_nalog_id::text OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(entry) field WHERE field NOT IN
        ('radnik_id', 'gradiliste_id', 'datum', 'sati', 'napomena', 'nalog_id', 'nocni_sati')
    )
  ) THEN RAISE EXCEPTION 'Neispravna veza ili polja sati naloga.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_entries) entry(
      radnik_id uuid, gradiliste_id uuid, datum date, sati numeric, nocni_sati numeric
    )
    WHERE entry.datum IS NULL OR entry.sati IS NULL OR entry.sati <= 0
      OR COALESCE(entry.nocni_sati, 0) < 0 OR COALESCE(entry.nocni_sati, 0) > entry.sati
      OR NOT EXISTS (SELECT 1 FROM public.radnici w WHERE w.id = entry.radnik_id AND w.company_id = company)
      OR (entry.gradiliste_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.gradilista g WHERE g.id = entry.gradiliste_id AND g.company_id = company
      ))
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_entries) entry GROUP BY entry->>'radnik_id' HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Neispravni sati, djelatnik, gradilište ili dvostruki obračun.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_costs) entry
    WHERE entry->>'nalog_id' IS DISTINCT FROM p_nalog_id::text
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(entry) field WHERE field NOT IN
        ('gradiliste_id', 'kategorija', 'opis', 'iznos', 'datum', 'nalog_id'))
      OR entry->>'kategorija' NOT IN ('place', 'oprema')
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_costs) entry(
      gradiliste_id uuid, kategorija text, opis text, iznos numeric, datum date, nalog_id uuid
    )
    WHERE entry.opis IS NULL OR btrim(entry.opis) = '' OR entry.iznos IS NULL OR entry.iznos <= 0
      OR entry.datum IS NULL
      OR (entry.gradiliste_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.gradilista g WHERE g.id = entry.gradiliste_id AND g.company_id = company
      ))
  ) THEN RAISE EXCEPTION 'Neispravna stavka troška obračuna.' USING ERRCODE = '22023'; END IF;
  WITH RECURSIVE affected(oid, cascading) AS (
    SELECT initial.oid, true FROM (VALUES
      ('public.radno_vrijeme'::regclass::oid), ('public.troskovi'::regclass::oid)
    ) initial(oid)
    UNION SELECT fk.conrelid, fk.confdeltype = 'c' FROM pg_constraint fk JOIN affected parent ON parent.oid = fk.confrelid
      WHERE parent.cascading AND fk.contype = 'f' AND fk.confdeltype IN ('c', 'n', 'd')
  )
  SELECT c.relname INTO untracked FROM affected JOIN pg_class c USING (oid) JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'public' OR NOT EXISTS (
      SELECT 1 FROM private.resource_recovery_tables tracked WHERE tracked.table_name = c.relname
    ) LIMIT 1;
  IF untracked IS NOT NULL THEN RAISE EXCEPTION 'Povrat nije pripremljen za povezanu tablicu %. Ništa nije promijenjeno.', untracked; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb) INTO work_time_snapshot
    FROM public.radno_vrijeme r WHERE r.company_id = company AND r.nalog_id = p_nalog_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id), '[]'::jsonb) INTO cost_snapshot
    FROM public.troskovi c WHERE c.company_id = company AND c.nalog_id = p_nalog_id
      AND NOT (c.kategorija = 'put' AND c.opis LIKE 'Kilometri:%');
  IF NOT EXISTS (SELECT 1 FROM private.work_time_order_versions WHERE nalog_id = p_nalog_id) THEN
    INSERT INTO private.work_time_order_versions VALUES (p_nalog_id, nextval('private.resource_recovery_revision'));
  END IF;
  SELECT COALESCE(max(sequence), 0) INTO history_sequence FROM private.business_change_history;
  INSERT INTO private.resource_deletions(company_id, module, table_name, record_id, snapshot, actor_name)
    VALUES (company, 'radni_nalozi', 'radni_nalozi', p_nalog_id,
      to_jsonb(order_row) || jsonb_build_object('__history_type', 'work_order_settlement'),
      COALESCE((SELECT email FROM public.app_profiles WHERE id = auth.uid()), 'Korisnik'))
    RETURNING id INTO operation_id;

  DELETE FROM public.radno_vrijeme WHERE company_id = company AND nalog_id = p_nalog_id;
  DELETE FROM public.troskovi WHERE company_id = company AND nalog_id = p_nalog_id
    AND NOT (kategorija = 'put' AND opis LIKE 'Kilometri:%');
  INSERT INTO public.radno_vrijeme(company_id, radnik_id, gradiliste_id, datum, sati, napomena, nalog_id, nocni_sati)
    SELECT company, entry.radnik_id, entry.gradiliste_id, entry.datum, entry.sati,
      entry.napomena, p_nalog_id, COALESCE(entry.nocni_sati, 0)
    FROM jsonb_populate_recordset(NULL::public.radno_vrijeme, p_entries) entry;
  INSERT INTO public.troskovi(company_id, gradiliste_id, kategorija, opis, iznos, datum, nalog_id)
    SELECT company, entry.gradiliste_id, entry.kategorija, btrim(entry.opis), entry.iznos, entry.datum, p_nalog_id
    FROM jsonb_populate_recordset(NULL::public.troskovi, p_costs) entry;

  SELECT count(*)::integer INTO affected_count FROM private.resource_deletion_rows
    WHERE deletion_id = operation_id;
  IF affected_count = 0 THEN
    UPDATE private.resource_deletions SET active = false WHERE id = operation_id;
    RETURN NULL;
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb) INTO work_time_snapshot
    FROM public.radno_vrijeme r WHERE r.company_id = company AND r.nalog_id = p_nalog_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id), '[]'::jsonb) INTO cost_snapshot
    FROM public.troskovi c WHERE c.company_id = company AND c.nalog_id = p_nalog_id
      AND NOT (c.kategorija = 'put' AND c.opis LIKE 'Kilometri:%');
  INSERT INTO private.work_time_order_versions VALUES (p_nalog_id, nextval('private.resource_recovery_revision'))
    ON CONFLICT (nalog_id) DO UPDATE SET revision = EXCLUDED.revision
    RETURNING work_time_order_versions.revision INTO revision;
  IF NOT private.resource_deletion_allowed(operation_id) THEN
    RAISE EXCEPTION 'Za povrat obračuna nedostaju prava jednog od zahvaćenih modula. Ništa nije promijenjeno.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO private.work_order_settlement_packages(
    deletion_id, nalog_id, company_id, work_time_revision, after_work_time, after_costs
  ) VALUES (operation_id, p_nalog_id, company, revision, work_time_snapshot, cost_snapshot);
  INSERT INTO private.resource_deletion_events
    SELECT operation_id, h.id FROM private.business_change_history h
    WHERE h.transaction_id = txid_current() AND h.sequence > history_sequence;
  UPDATE private.resource_deletions SET active = false WHERE id = operation_id;
  RETURN operation_id;
END;
$$;

CREATE FUNCTION public.get_work_order_settlement_deletions(
  p_before_time timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, snapshot jsonb, actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, can_restore boolean, affected_rows jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit')
    OR NOT public.app_has_module_permission('radno_vrijeme', 'edit')
    OR NOT public.app_has_module_permission('troskovi', 'edit') THEN
    RAISE EXCEPTION 'Za pregled povijesti obračuna potrebna su prava uređivanja naloga, radnog vremena i troškova.' USING ERRCODE = '42501';
  END IF;
  IF (p_before_time IS NULL) <> (p_before_id IS NULL) THEN RAISE EXCEPTION 'Nepotpun pokazivač stranice.' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT d.id, d.snapshot, d.actor_name, d.created_at, d.expires_at, d.reversed_at,
    d.reversed_at IS NULL AND private.resource_deletion_allowed(d.id)
      AND private.work_order_settlement_unchanged(d.id),
    (SELECT jsonb_object_agg(summary.table_name, summary.total) FROM (
      SELECT r.table_name, count(*) total FROM private.resource_deletion_rows r
      WHERE r.deletion_id = d.id GROUP BY r.table_name
    ) summary)
  FROM private.resource_deletions d
  JOIN private.work_order_settlement_packages package ON package.deletion_id = d.id
  WHERE d.company_id = public.app_current_company_id() AND d.module = 'radni_nalozi'
    AND NOT d.active AND d.expires_at > now()
    AND (p_before_time IS NULL OR (d.created_at, d.id) < (p_before_time, p_before_id))
  ORDER BY d.created_at DESC, d.id DESC LIMIT 50;
END;
$$;

CREATE FUNCTION public.restore_work_order_settlement(p_deletion_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  operation private.resource_deletions%ROWTYPE;
  package private.work_order_settlement_packages%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('resource-restore:' || public.app_current_company_id()::text, 0));
  SELECT * INTO operation FROM private.resource_deletions
    WHERE id = p_deletion_id AND company_id = public.app_current_company_id() FOR UPDATE;
  SELECT * INTO package FROM private.work_order_settlement_packages WHERE deletion_id = p_deletion_id FOR UPDATE;
  IF NOT FOUND OR operation.id IS NULL OR operation.module <> 'radni_nalozi' OR operation.active
    OR operation.expires_at <= clock_timestamp() OR operation.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Obračun nije dostupan ili je istekao rok povrata.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.radni_nalozi WHERE id = package.nalog_id
    AND company_id = package.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nalog nije dostupan u vašoj tvrtki. Ništa nije vraćeno.' USING ERRCODE = '23503'; END IF;
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit')
    OR NOT public.app_has_module_permission('radno_vrijeme', 'edit')
    OR NOT public.app_has_module_permission('troskovi', 'edit')
    OR NOT private.resource_deletion_allowed(operation.id) THEN
    RAISE EXCEPTION 'Nedostaju prava za vraćanje svih dijelova obračuna.' USING ERRCODE = '42501';
  END IF;
  IF NOT private.work_order_settlement_unchanged(operation.id) THEN
    RAISE EXCEPTION 'Nalog, sati ili stavke troška obračuna naknadno su promijenjeni. Ništa nije vraćeno.' USING ERRCODE = '40001';
  END IF;
  PERFORM set_config('app.work_order_settlement_restore_id', operation.id::text, true);
  PERFORM public.restore_resource_deletion(operation.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_work_order_hours(p_nalog_id uuid, p_entries jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Obračun sati zahtijeva novu verziju aplikacije i replace_work_order_settlement.' USING ERRCODE = '0A000';
END;
$$;

REVOKE ALL ON FUNCTION private.work_order_settlement_unchanged(uuid),
  private.guard_work_order_settlement_restore(),
  public.replace_work_order_settlement(uuid, jsonb, jsonb),
  public.get_work_order_settlement_deletions(timestamptz, uuid),
  public.restore_work_order_settlement(uuid),
  public.replace_work_order_hours(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_work_order_settlement(uuid, jsonb, jsonb),
  public.get_work_order_settlement_deletions(timestamptz, uuid),
  public.restore_work_order_settlement(uuid),
  public.replace_work_order_hours(uuid, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
