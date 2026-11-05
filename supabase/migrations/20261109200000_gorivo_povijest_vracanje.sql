-- The shared journal starts with fuel only. Other modules require their own restore handlers.
CREATE TABLE private.business_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  company_id uuid NOT NULL,
  module text NOT NULL,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  parent_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  before_data jsonb,
  after_data jsonb,
  actor_id uuid,
  actor_name text NOT NULL,
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '30 days'),
  reverses_id uuid,
  reversed_at timestamptz,
  reversed_by uuid
);

CREATE INDEX business_change_history_parent
  ON private.business_change_history (company_id, table_name, parent_id, sequence DESC);
CREATE INDEX business_change_history_record
  ON private.business_change_history (company_id, table_name, record_id, sequence DESC);
CREATE INDEX business_change_history_expiry ON private.business_change_history (expires_at);
ALTER TABLE private.business_change_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.business_change_history FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.capture_fuel_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  row_data jsonb;
  actor_label text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND old_data = new_data THEN RETURN NEW; END IF;
  row_data := COALESCE(new_data, old_data);
  SELECT profile.email INTO actor_label FROM public.app_profiles profile
  WHERE profile.id = auth.uid() AND profile.company_id = (row_data->>'company_id')::uuid;
  INSERT INTO private.business_change_history (
    company_id, module, table_name, record_id, parent_id, operation,
    before_data, after_data, actor_id, actor_name
  ) VALUES (
    (row_data->>'company_id')::uuid, 'vozila', 'vozila_gorivo',
    (row_data->>'id')::uuid, (row_data->>'vozilo_id')::uuid, TG_OP,
    old_data, new_data, auth.uid(),
    COALESCE(actor_label, CASE WHEN auth.uid() IS NULL THEN 'Sustav' ELSE 'Korisnik' END)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER fuel_change_history
  AFTER INSERT OR UPDATE OR DELETE ON public.vozila_gorivo
  FOR EACH ROW EXECUTE FUNCTION private.capture_fuel_change();

CREATE FUNCTION public.get_fuel_change_history(
  p_vehicle_id uuid, p_before_sequence bigint DEFAULT NULL
)
RETURNS TABLE (
  id uuid, sequence text, operation text, before_data jsonb, after_data jsonb,
  actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, reverses_id uuid, can_restore boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.app_current_company_id() IS NULL
    OR NOT public.app_has_module_permission('vozila', 'edit') THEN
    RAISE EXCEPTION 'Za povijest i vraćanje goriva potrebno je pravo uređivanja vozila.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vozila v
    WHERE v.id = p_vehicle_id AND v.company_id = public.app_current_company_id()
  ) THEN
    RAISE EXCEPTION 'Vozilo nije dostupno u vašoj tvrtki.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT h.id, h.sequence::text, h.operation, h.before_data, h.after_data,
    h.actor_name, h.created_at, h.expires_at, h.reversed_at, h.reverses_id,
    h.reversed_at IS NULL AND h.reverses_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM private.business_change_history newer
      WHERE newer.company_id = h.company_id AND newer.table_name = h.table_name
        AND newer.record_id = h.record_id AND newer.sequence > h.sequence
        AND newer.reversed_at IS NULL AND newer.reverses_id IS NULL
    )
  FROM private.business_change_history h
  WHERE h.company_id = public.app_current_company_id()
    AND h.table_name = 'vozila_gorivo' AND h.parent_id = p_vehicle_id
    AND h.expires_at > now()
    AND (p_before_sequence IS NULL OR h.sequence < p_before_sequence)
  ORDER BY h.sequence DESC
  LIMIT 50;
END;
$$;

CREATE FUNCTION public.restore_fuel_change(p_history_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  event private.business_change_history%ROWTYPE;
  current_data jsonb;
  previous public.vozila_gorivo%ROWTYPE;
  new_event_id uuid;
BEGIN
  IF public.app_current_company_id() IS NULL
    OR NOT public.app_has_module_permission('vozila', 'edit') THEN
    RAISE EXCEPTION 'Za vraćanje goriva potrebno je pravo uređivanja vozila.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO event FROM private.business_change_history h
  WHERE h.id = p_history_id AND h.company_id = public.app_current_company_id()
    AND h.table_name = 'vozila_gorivo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promjena nije dostupna u vašoj tvrtki.' USING ERRCODE = '42501';
  END IF;

  -- Use the same row lock order as a normal fuel UPDATE: fuel row, then vehicle.
  SELECT to_jsonb(g) INTO current_data FROM public.vozila_gorivo g
  WHERE g.id = event.record_id AND g.company_id = event.company_id FOR UPDATE;
  PERFORM 1 FROM public.vozila v
  WHERE v.id = event.parent_id AND v.company_id = event.company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vozilo je obrisano. Vraćanje njegovih točenja još nije podržano.';
  END IF;
  SELECT * INTO event FROM private.business_change_history h
  WHERE h.id = p_history_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Povijest je istekla i uklonjena. Vraćanje nije izvršeno.';
  END IF;
  IF event.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Istekao je rok od 30 dana za vraćanje ove promjene.';
  END IF;
  IF event.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ova promjena već je vraćena.';
  END IF;
  IF event.reverses_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ovo je zapis već izvršenog vraćanja. Odaberite raniju izvornu promjenu.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.business_change_history h
    WHERE h.company_id = event.company_id AND h.table_name = event.table_name
      AND h.record_id = event.record_id AND h.sequence > event.sequence
      AND h.reversed_at IS NULL AND h.reverses_id IS NULL
  ) OR (current_data - 'updated_at') IS DISTINCT FROM (event.after_data - 'updated_at') THEN
    RAISE EXCEPTION 'Zapis je naknadno promijenjen. Osvježite povijest i prvo provjerite noviju promjenu.'
      USING ERRCODE = '40001';
  END IF;
  IF event.before_data IS NOT NULL THEN
    previous := jsonb_populate_record(NULL::public.vozila_gorivo, event.before_data);
    IF previous.company_id IS DISTINCT FROM event.company_id
      OR previous.vozilo_id IS DISTINCT FROM event.parent_id THEN
      RAISE EXCEPTION 'Vraćanje promjene vozila ili tvrtke nije podržano.';
    END IF;
    IF previous.tocio_radnik_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.radnici r WHERE r.id = previous.tocio_radnik_id
        AND r.company_id = event.company_id
    ) THEN
      RAISE EXCEPTION 'Djelatnik povezan s ranijim zapisom više nije dostupan. Vraćanje nije izvršeno.';
    END IF;
    IF previous.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = previous.created_by
    ) THEN
      RAISE EXCEPTION 'Korisnik povezan s ranijim zapisom više nije dostupan. Vraćanje nije izvršeno.';
    END IF;
  END IF;

  IF event.operation = 'INSERT' THEN
    DELETE FROM public.vozila_gorivo WHERE id = event.record_id AND company_id = event.company_id;
  ELSIF event.operation = 'DELETE' THEN
    INSERT INTO public.vozila_gorivo (
      id, company_id, vozilo_id, datum, litara, kilometraza,
      tocio_radnik_id, tocio_ime, created_by, created_at, updated_at
    ) VALUES (
      previous.id, previous.company_id, previous.vozilo_id, previous.datum,
      previous.litara, previous.kilometraza, previous.tocio_radnik_id, previous.tocio_ime,
      previous.created_by, previous.created_at, clock_timestamp()
    );
  ELSE
    UPDATE public.vozila_gorivo SET
      datum = previous.datum, litara = previous.litara, kilometraza = previous.kilometraza,
      tocio_radnik_id = previous.tocio_radnik_id, tocio_ime = previous.tocio_ime,
      created_by = previous.created_by, created_at = previous.created_at,
      updated_at = clock_timestamp()
    WHERE id = event.record_id AND company_id = event.company_id;
  END IF;
  SELECT h.id INTO new_event_id FROM private.business_change_history h
  WHERE h.company_id = event.company_id AND h.table_name = event.table_name
    AND h.record_id = event.record_id AND h.sequence > event.sequence
  ORDER BY h.sequence DESC LIMIT 1;
  IF new_event_id IS NULL THEN
    RAISE EXCEPTION 'Vraćanje nije zabilježeno. Promjene su poništene.';
  END IF;
  UPDATE private.business_change_history SET reverses_id = event.id WHERE id = new_event_id;
  UPDATE private.business_change_history
  SET reversed_at = clock_timestamp(), reversed_by = auth.uid() WHERE id = event.id;
END;
$$;

CREATE FUNCTION private.prune_business_change_history()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM private.business_change_history WHERE expires_at <= clock_timestamp();
$$;

REVOKE ALL ON FUNCTION private.capture_fuel_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.prune_business_change_history() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_fuel_change_history(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_fuel_change(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fuel_change_history(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_fuel_change(uuid) TO authenticated;

-- Supabase supports pg_cron. Expired history is unavailable immediately and purged hourly.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
SELECT cron.schedule(
  'prune-business-change-history', '17 * * * *',
  'SELECT private.prune_business_change_history();'
);

NOTIFY pgrst, 'reload schema';
