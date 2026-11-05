CREATE TABLE private.work_order_item_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  company_id uuid NOT NULL,
  nalog_id uuid NOT NULL,
  item_id uuid NOT NULL,
  actor_id uuid,
  actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '30 days',
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  reverses_id uuid,
  reversed_at timestamptz,
  reversed_by uuid
);
CREATE INDEX work_order_item_change_history_record
  ON private.work_order_item_change_history(company_id, nalog_id, sequence DESC);
ALTER TABLE private.work_order_item_change_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.work_order_item_change_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.work_order_item_change_history_sequence_seq FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.capture_work_order_item_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor text;
BEGIN
  IF OLD.nalog_id IS NULL OR NEW.nalog_id IS DISTINCT FROM OLD.nalog_id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN
    RETURN NEW;
  END IF;
  SELECT profile.email INTO actor FROM public.app_profiles profile
    WHERE profile.id = auth.uid() AND profile.company_id = NEW.company_id;
  INSERT INTO private.work_order_item_change_history(
    company_id, nalog_id, item_id, actor_id, actor_name, before_data, after_data
  ) VALUES (
    NEW.company_id, NEW.nalog_id, NEW.id, auth.uid(), COALESCE(actor, 'Korisnik'),
    to_jsonb(OLD), to_jsonb(NEW)
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_order_item_change_history
  AFTER UPDATE ON public.radni_nalozi_stavke
  FOR EACH ROW EXECUTE FUNCTION private.capture_work_order_item_change();
REVOKE ALL ON FUNCTION private.capture_work_order_item_change() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.work_order_item_change_blocked(p_history_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  history private.work_order_item_change_history%ROWTYPE;
  current_data jsonb;
  order_status text;
BEGIN
  SELECT * INTO history FROM private.work_order_item_change_history WHERE id = p_history_id;
  IF NOT FOUND OR history.company_id IS DISTINCT FROM public.app_current_company_id() THEN
    RETURN 'Promjena nije dostupna u vašoj tvrtki.';
  END IF;
  IF history.expires_at <= clock_timestamp() THEN RETURN 'Istekao je rok od 30 dana.'; END IF;
  IF history.reversed_at IS NOT NULL OR history.reverses_id IS NOT NULL THEN
    RETURN 'Promjena je već vraćena.';
  END IF;
  IF (history.before_data - ARRAY['naziv', 'gotovo', 'uzeto', 'updated_at'])
      IS DISTINCT FROM (history.after_data - ARRAY['naziv', 'gotovo', 'uzeto', 'updated_at'])
    OR history.before_data->>'nalog_id' IS DISTINCT FROM history.nalog_id::text
    OR history.after_data->>'nalog_id' IS DISTINCT FROM history.nalog_id::text
    OR history.before_data->>'tip' NOT IN ('materijal', 'alat')
    OR history.after_data->>'tip' IS DISTINCT FROM history.before_data->>'tip'
    OR ROW(history.before_data->'naziv', history.before_data->'gotovo', history.before_data->'uzeto')
      IS NOT DISTINCT FROM ROW(history.after_data->'naziv', history.after_data->'gotovo', history.after_data->'uzeto') THEN
    RETURN 'Promjena uključuje polja stavke naloga izvan podržane obnove materijala i alata.';
  END IF;
  SELECT to_jsonb(item), order_row.status INTO current_data, order_status
    FROM public.radni_nalozi_stavke item
    JOIN public.radni_nalozi order_row ON order_row.id = item.nalog_id
    WHERE item.id = history.item_id AND item.nalog_id = history.nalog_id
      AND item.company_id = history.company_id AND order_row.company_id = history.company_id;
  IF current_data IS NULL THEN RETURN 'Stavka ili radni nalog više nisu dostupni.'; END IF;
  IF order_status IN ('zavrsen', 'otkazan') THEN
    RETURN 'Stavku zaključenog ili otkazanog naloga nije moguće samostalno vratiti.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.work_order_item_change_history newer
    WHERE newer.company_id = history.company_id AND newer.item_id = history.item_id
      AND newer.sequence > history.sequence AND newer.reversed_at IS NULL AND newer.reverses_id IS NULL
  ) THEN RETURN 'Stavka ima noviju promjenu. Najprije provjerite nju.'; END IF;
  IF (current_data - 'updated_at') IS DISTINCT FROM (history.after_data - 'updated_at') THEN
    RETURN 'Stavka je naknadno promijenjena.';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.work_order_item_change_blocked(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_work_order_item_change_history(
  p_nalog_id uuid, p_before_sequence bigint DEFAULT NULL
)
RETURNS TABLE(
  id uuid, sequence text, item_id uuid, before_data jsonb, after_data jsonb,
  actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, reverses_id uuid, can_restore boolean, blocked_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja radnih naloga.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi order_row
    WHERE order_row.id = p_nalog_id AND order_row.company_id = public.app_current_company_id()
  ) THEN RAISE EXCEPTION 'Nalog nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT history.id, history.sequence::text, history.item_id,
    history.before_data, history.after_data, history.actor_name, history.created_at,
    history.expires_at, history.reversed_at, history.reverses_id,
    reason.message IS NULL, reason.message
  FROM private.work_order_item_change_history history
  CROSS JOIN LATERAL (
    SELECT private.work_order_item_change_blocked(history.id) AS message
  ) reason
  WHERE history.company_id = public.app_current_company_id()
    AND history.nalog_id = p_nalog_id AND history.expires_at > now()
    AND (p_before_sequence IS NULL OR history.sequence < p_before_sequence)
  ORDER BY history.sequence DESC LIMIT 50;
END;
$$;

CREATE FUNCTION public.restore_work_order_item_change(p_history_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  history private.work_order_item_change_history%ROWTYPE;
  order_row public.radni_nalozi%ROWTYPE;
  item public.radni_nalozi_stavke%ROWTYPE;
  current_data jsonb;
  restored_data jsonb;
  reason text;
  reverse_id uuid;
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja radnih naloga.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO history FROM private.work_order_item_change_history
    WHERE id = p_history_id AND company_id = public.app_current_company_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Promjena nije dostupna u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO order_row FROM public.radni_nalozi
    WHERE id = history.nalog_id AND company_id = history.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Radni nalog više nije dostupan.' USING ERRCODE = '40001'; END IF;
  SELECT * INTO item FROM public.radni_nalozi_stavke
    WHERE id = history.item_id AND nalog_id = history.nalog_id AND company_id = history.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stavka više nije dostupna.' USING ERRCODE = '40001'; END IF;
  SELECT * INTO history FROM private.work_order_item_change_history WHERE id = p_history_id FOR UPDATE;
  reason := private.work_order_item_change_blocked(history.id);
  IF reason IS NOT NULL THEN RAISE EXCEPTION '% Ništa nije vraćeno.', reason USING ERRCODE = '40001'; END IF;
  current_data := to_jsonb(item);
  UPDATE public.radni_nalozi_stavke target
    SET naziv = previous.naziv, gotovo = previous.gotovo, uzeto = previous.uzeto
    FROM jsonb_populate_record(NULL::public.radni_nalozi_stavke, history.before_data) previous
    WHERE target.id = history.item_id AND target.nalog_id = history.nalog_id
      AND target.company_id = history.company_id;
  SELECT to_jsonb(target) INTO restored_data FROM public.radni_nalozi_stavke target
    WHERE target.id = history.item_id AND target.nalog_id = history.nalog_id;
  IF (restored_data - 'updated_at') IS DISTINCT FROM (history.before_data - 'updated_at') THEN
    RAISE EXCEPTION 'Pravila stavke nisu dopustila točan povrat. Ništa nije vraćeno.';
  END IF;
  SELECT event.id INTO reverse_id
    FROM private.work_order_item_change_history event
    WHERE event.company_id = history.company_id AND event.nalog_id = history.nalog_id
      AND event.item_id = history.item_id AND event.transaction_id = txid_current()
      AND event.before_data = current_data AND event.after_data = restored_data
    ORDER BY event.sequence DESC LIMIT 1;
  IF reverse_id IS NULL THEN
    RAISE EXCEPTION 'Povrat stavke nije evidentiran. Ništa nije vraćeno.';
  END IF;
  UPDATE private.work_order_item_change_history SET reverses_id = history.id WHERE id = reverse_id;
  UPDATE private.work_order_item_change_history
    SET reversed_at = clock_timestamp(), reversed_by = auth.uid() WHERE id = history.id;
END;
$$;

CREATE FUNCTION private.prune_work_order_item_change_history()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM private.work_order_item_change_history WHERE expires_at <= clock_timestamp();
$$;

REVOKE ALL ON FUNCTION public.get_work_order_item_change_history(uuid, bigint),
  public.restore_work_order_item_change(uuid), private.prune_work_order_item_change_history()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_work_order_item_change_history(uuid, bigint),
  public.restore_work_order_item_change(uuid) TO authenticated;
SELECT cron.schedule(
  'prune-work-order-item-change-history', '47 * * * *',
  'SELECT private.prune_work_order_item_change_history();'
);
NOTIFY pgrst, 'reload schema';
