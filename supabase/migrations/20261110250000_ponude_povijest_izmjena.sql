CREATE TABLE private.ponuda_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  company_id uuid NOT NULL,
  ponuda_id uuid NOT NULL,
  actor_id uuid,
  actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '30 days',
  before_ponuda jsonb NOT NULL,
  after_ponuda jsonb NOT NULL,
  before_stavke jsonb NOT NULL,
  after_stavke jsonb NOT NULL,
  reverses_id uuid,
  reversed_at timestamptz,
  reversed_by uuid
);
CREATE INDEX ponuda_change_history_record ON private.ponuda_change_history(company_id, ponuda_id, sequence DESC);
ALTER TABLE private.ponuda_change_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ponuda_change_history FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.guard_ponuda_content()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  target_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'ponude' THEN
    IF TG_OP = 'UPDATE' THEN
      target_id := OLD.id;
      IF current_setting('app.ponuda_history_id', true) IS DISTINCT FROM target_id::text
        AND (to_jsonb(OLD) - ARRAY['gradiliste_id', 'updated_at'])
          IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['gradiliste_id', 'updated_at'])
        AND NOT (
          OLD.gradiliste_id IS NULL AND NEW.gradiliste_id IS NOT NULL
          AND (to_jsonb(OLD) - ARRAY['gradiliste_id', 'updated_at'])
            IS NOT DISTINCT FROM (to_jsonb(NEW) - ARRAY['gradiliste_id', 'updated_at'])
        ) THEN
        RAISE EXCEPTION 'Izmjena ponude zahtijeva novu aplikaciju i spremanje kroz povijest ponude.' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.ponuda_id ELSE NEW.ponuda_id END;
  IF auth.uid() IS NOT NULL
    AND current_setting('app.ponuda_history_id', true) IS DISTINCT FROM target_id::text
    AND NOT EXISTS (
      SELECT 1 FROM private.resource_deletions deletion
      WHERE deletion.active AND deletion.transaction_id = txid_current()
        AND deletion.table_name = 'ponude' AND deletion.record_id = target_id
    ) THEN
    RAISE EXCEPTION 'Stavke postojeće ponude mijenjaju se samo kroz evidentirano spremanje ponude.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER guard_ponuda_content
  BEFORE UPDATE ON public.ponude FOR EACH ROW EXECUTE FUNCTION private.guard_ponuda_content();
CREATE TRIGGER guard_ponuda_content
  BEFORE INSERT OR UPDATE OR DELETE ON public.ponude_stavke
  FOR EACH ROW EXECUTE FUNCTION private.guard_ponuda_content();
REVOKE ALL ON FUNCTION private.guard_ponuda_content() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.validate_ponuda_payload(p_data jsonb, p_lines jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) field WHERE field NOT IN (
      'naslov', 'investitor_id', 'objekt_id', 'adresa_radova', 'datum', 'status',
      'popust', 'pdv', 'prikazi_popust', 'prijenos_porezne_obveze', 'napomene', 'gradiliste_id'
    )) OR (p_data = '{}'::jsonb AND p_lines IS NULL) THEN
    RAISE EXCEPTION 'Neispravni podaci ponude.' USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NOT NULL AND jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Stavke ponude moraju biti popis.' USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NOT NULL AND (
    EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) line WHERE jsonb_typeof(line) <> 'object')
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_lines) line
      WHERE EXISTS (SELECT 1 FROM jsonb_object_keys(line) field WHERE field NOT IN (
        'stavka_id', 'redoslijed', 'opis', 'vrsta_posla', 'podgrupa', 'jedinica', 'kolicina', 'cijena', 'popust'
      ))
    )
  ) THEN
    RAISE EXCEPTION 'Stavka ponude ima neispravna polja.' USING ERRCODE = '22023';
  END IF;
  IF p_data ? 'naslov' AND (jsonb_typeof(p_data->'naslov') <> 'string' OR btrim(p_data->>'naslov') = '')
    OR p_data ? 'datum' AND (jsonb_typeof(p_data->'datum') <> 'string' OR (p_data->>'datum')::date IS NULL)
    OR p_data ? 'status' AND p_data->>'status' NOT IN ('nepotvrdena', 'potvrdena', 'odbijena')
    OR p_data ? 'popust' AND (jsonb_typeof(p_data->'popust') <> 'number' OR (p_data->>'popust')::numeric < 0 OR (p_data->>'popust')::numeric > 100)
    OR p_data ? 'pdv' AND (jsonb_typeof(p_data->'pdv') <> 'number' OR (p_data->>'pdv')::numeric < 0)
    OR p_data ? 'prikazi_popust' AND jsonb_typeof(p_data->'prikazi_popust') <> 'boolean'
    OR p_data ? 'prijenos_porezne_obveze' AND jsonb_typeof(p_data->'prijenos_porezne_obveze') <> 'boolean'
    OR p_data ? 'investitor_id' AND p_data->'investitor_id' <> 'null'::jsonb
      AND jsonb_typeof(p_data->'investitor_id') <> 'string'
    OR p_data ? 'objekt_id' AND p_data->'objekt_id' <> 'null'::jsonb
      AND jsonb_typeof(p_data->'objekt_id') <> 'string'
    OR p_data ? 'gradiliste_id' AND p_data->'gradiliste_id' <> 'null'::jsonb
      AND jsonb_typeof(p_data->'gradiliste_id') <> 'string' THEN
    RAISE EXCEPTION 'Neispravna vrijednost ponude.' USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) line(
      stavka_id uuid, redoslijed integer, opis text, vrsta_posla text, podgrupa text,
      jedinica text, kolicina numeric, cijena numeric, popust numeric
    )
    WHERE line.opis IS NULL OR btrim(line.opis) = '' OR line.jedinica IS NULL OR btrim(line.jedinica) = ''
      OR line.kolicina IS NULL OR line.kolicina < 0 OR line.cijena IS NULL OR line.cijena < 0
      OR line.popust IS NULL OR line.popust < 0 OR line.popust > 100
  ) THEN
    RAISE EXCEPTION 'Neispravna stavka ponude.' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_ponuda_payload(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.ponuda_lines(p_ponuda_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(line) ORDER BY line.redoslijed, line.id), '[]'::jsonb)
  FROM public.ponude_stavke line WHERE line.ponuda_id = p_ponuda_id;
$$;
REVOKE ALL ON FUNCTION private.ponuda_lines(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.create_ponuda_with_stavke(p_data jsonb, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  company uuid := public.app_current_company_id();
  offer_row public.ponude%ROWTYPE;
  offer_id uuid := gen_random_uuid();
  offer_year integer;
  offer_number integer;
BEGIN
  IF NOT public.app_has_module_permission('ponude', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja ponuda.' USING ERRCODE = '42501';
  END IF;
  PERFORM private.validate_ponuda_payload(p_data, p_lines);
  IF p_lines IS NULL THEN RAISE EXCEPTION 'Nova ponuda zahtijeva cjelovit popis stavki.' USING ERRCODE = '22023'; END IF;
  offer_year := EXTRACT(YEAR FROM (p_data->>'datum')::date)::integer;
  offer_number := public.next_company_number('ponuda', offer_year);
  IF p_data->>'investitor_id' IS NOT NULL THEN
    PERFORM 1 FROM public.investitori WHERE id = (p_data->>'investitor_id')::uuid AND company_id = company FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Investitor nije dostupan u vašoj tvrtki.' USING ERRCODE = '23503'; END IF;
  END IF;
  IF p_data->>'objekt_id' IS NOT NULL THEN
    PERFORM 1 FROM public.objekti WHERE id = (p_data->>'objekt_id')::uuid AND company_id = company FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Objekt nije dostupan u vašoj tvrtki.' USING ERRCODE = '23503'; END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) line(stavka_id uuid)
    WHERE line.stavka_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.stavke item WHERE item.id = line.stavka_id AND item.company_id = company
    )
  ) THEN RAISE EXCEPTION 'Stavka iz baze nije dostupna u vašoj tvrtki.' USING ERRCODE = '23503'; END IF;
  INSERT INTO public.ponude(
    id, company_id, godina, redni_broj, naslov, investitor_id, objekt_id, adresa_radova, datum, status,
    popust, pdv, napomene, prikazi_popust, prijenos_porezne_obveze
  ) VALUES (
    offer_id, company, offer_year, offer_number, btrim(p_data->>'naslov'),
    NULLIF(p_data->>'investitor_id', '')::uuid, NULLIF(p_data->>'objekt_id', '')::uuid,
    NULLIF(btrim(p_data->>'adresa_radova'), ''), (p_data->>'datum')::date,
    COALESCE(p_data->>'status', 'nepotvrdena'),
    COALESCE((p_data->>'popust')::numeric, 0), COALESCE((p_data->>'pdv')::numeric, 25),
    NULLIF(btrim(p_data->>'napomene'), ''), COALESCE((p_data->>'prikazi_popust')::boolean, true),
    COALESCE((p_data->>'prijenos_porezne_obveze')::boolean, false)
  ) RETURNING * INTO offer_row;
  PERFORM set_config('app.ponuda_history_id', offer_id::text, true);
  INSERT INTO public.ponude_stavke(
    company_id, ponuda_id, stavka_id, redoslijed, opis, vrsta_posla, podgrupa, jedinica, kolicina, cijena, popust
  )
  SELECT company, offer_id, line.stavka_id, (item.ordinality - 1)::integer,
    btrim(line.opis), NULLIF(btrim(line.vrsta_posla), ''), NULLIF(btrim(line.podgrupa), ''),
    btrim(line.jedinica), line.kolicina, line.cijena, line.popust
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY item(value, ordinality)
    CROSS JOIN LATERAL jsonb_populate_record(NULL::public.ponude_stavke, item.value) line;
  RETURN to_jsonb(offer_row);
END;
$$;

CREATE FUNCTION public.save_ponuda_with_history(p_record_id uuid, p_data jsonb, p_lines jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  company uuid := public.app_current_company_id();
  offer_row public.ponude%ROWTYPE;
  before_offer jsonb;
  after_offer jsonb;
  merged_offer jsonb;
  before_lines jsonb;
  after_lines jsonb;
  assignments text;
  actor text;
  offer_fields text[] := ARRAY[
    'naslov', 'investitor_id', 'objekt_id', 'adresa_radova', 'datum', 'status',
    'popust', 'pdv', 'napomene', 'prikazi_popust', 'prijenos_porezne_obveze', 'gradiliste_id'
  ];
BEGIN
  IF NOT public.app_has_module_permission('ponude', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja ponuda.' USING ERRCODE = '42501';
  END IF;
  PERFORM private.validate_ponuda_payload(p_data, p_lines);
  SELECT * INTO offer_row FROM public.ponude WHERE id = p_record_id AND company_id = company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ponuda nije dostupna u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  before_offer := to_jsonb(offer_row) - 'gradiliste_id';
  before_lines := private.ponuda_lines(p_record_id);
  merged_offer := to_jsonb(offer_row) || p_data;
  after_offer := merged_offer - 'gradiliste_id';
  IF after_offer->>'naslov' IS NULL OR btrim(after_offer->>'naslov') = ''
    OR after_offer->>'status' NOT IN ('nepotvrdena', 'potvrdena', 'odbijena')
    OR (after_offer->>'popust')::numeric < 0 OR (after_offer->>'popust')::numeric > 100
    OR (after_offer->>'pdv')::numeric < 0 THEN
    RAISE EXCEPTION 'Neispravno konačno stanje ponude.' USING ERRCODE = '22023';
  END IF;
  IF after_offer->>'investitor_id' IS NOT NULL THEN
    PERFORM 1 FROM public.investitori WHERE id = (after_offer->>'investitor_id')::uuid AND company_id = company FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Investitor nije dostupan u vašoj tvrtki.' USING ERRCODE = '23503'; END IF;
  END IF;
  IF after_offer->>'objekt_id' IS NOT NULL THEN
    PERFORM 1 FROM public.objekti WHERE id = (after_offer->>'objekt_id')::uuid AND company_id = company FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Objekt nije dostupan u vašoj tvrtki.' USING ERRCODE = '23503'; END IF;
  END IF;
  IF merged_offer->>'gradiliste_id' IS NOT NULL THEN
    PERFORM 1 FROM public.gradilista WHERE id = (merged_offer->>'gradiliste_id')::uuid AND company_id = company FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Gradilište nije dostupno u vašoj tvrtki.' USING ERRCODE = '23503'; END IF;
  END IF;
  IF p_lines IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) line(stavka_id uuid)
    WHERE line.stavka_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.stavke item WHERE item.id = line.stavka_id AND item.company_id = company
    )
  ) THEN RAISE EXCEPTION 'Stavka iz baze nije dostupna u vašoj tvrtki.' USING ERRCODE = '23503'; END IF;
  IF p_lines IS NOT NULL THEN
    SELECT string_agg(format('%I = patch.%I', field, field), ', ')
      INTO assignments FROM unnest(offer_fields) field WHERE p_data ? field;
  ELSE
    SELECT string_agg(format('%I = patch.%I', field, field), ', ')
      INTO assignments FROM unnest(offer_fields) field WHERE p_data ? field;
  END IF;
  IF assignments IS NOT NULL THEN
    PERFORM set_config('app.ponuda_history_id', p_record_id::text, true);
    EXECUTE format('UPDATE public.ponude offer SET %s, updated_at = clock_timestamp()
      FROM jsonb_populate_record(NULL::public.ponude, $1) patch
      WHERE offer.id = $2 AND offer.company_id = $3', assignments)
      USING merged_offer, p_record_id, company;
  END IF;
  IF p_lines IS NOT NULL THEN
    PERFORM set_config('app.ponuda_history_id', p_record_id::text, true);
    DELETE FROM public.ponude_stavke WHERE ponuda_id = p_record_id AND company_id = company;
    INSERT INTO public.ponude_stavke(
      company_id, ponuda_id, stavka_id, redoslijed, opis, vrsta_posla, podgrupa, jedinica, kolicina, cijena, popust
    )
    SELECT company, p_record_id, line.stavka_id, (item.ordinality - 1)::integer,
      btrim(line.opis), NULLIF(btrim(line.vrsta_posla), ''), NULLIF(btrim(line.podgrupa), ''),
      btrim(line.jedinica), line.kolicina, line.cijena, line.popust
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY item(value, ordinality)
      CROSS JOIN LATERAL jsonb_populate_record(NULL::public.ponude_stavke, item.value) line;
  END IF;
  SELECT to_jsonb(offer) - 'gradiliste_id' INTO after_offer FROM public.ponude offer WHERE offer.id = p_record_id;
  after_lines := private.ponuda_lines(p_record_id);
  IF (before_offer - 'updated_at') IS DISTINCT FROM (after_offer - 'updated_at')
    OR before_lines IS DISTINCT FROM after_lines THEN
    SELECT profile.email INTO actor FROM public.app_profiles profile WHERE profile.id = auth.uid() AND profile.company_id = company;
    INSERT INTO private.ponuda_change_history(
      company_id, ponuda_id, actor_id, actor_name, before_ponuda, after_ponuda, before_stavke, after_stavke
    ) VALUES (
      company, p_record_id, auth.uid(), COALESCE(actor, 'Korisnik'),
      before_offer, after_offer, before_lines, after_lines
    );
  END IF;
END;
$$;

CREATE FUNCTION public.get_ponuda_change_history(p_record_id uuid, p_before_sequence bigint DEFAULT NULL)
RETURNS TABLE(
  id uuid, sequence text, before_ponuda jsonb, after_ponuda jsonb,
  before_stavke jsonb, after_stavke jsonb, actor_name text, created_at timestamptz,
  expires_at timestamptz, reversed_at timestamptz, reverses_id uuid,
  can_restore boolean, blocked_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  current_offer jsonb;
  current_lines jsonb;
BEGIN
  IF NOT public.app_has_module_permission('ponude', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja ponuda.' USING ERRCODE = '42501';
  END IF;
  SELECT to_jsonb(offer), private.ponuda_lines(offer.id) INTO current_offer, current_lines
    FROM public.ponude offer WHERE offer.id = p_record_id AND offer.company_id = public.app_current_company_id();
  IF current_offer IS NULL THEN RAISE EXCEPTION 'Ponuda nije dostupna u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT history.id, history.sequence::text, history.before_ponuda, history.after_ponuda,
    history.before_stavke, history.after_stavke, history.actor_name, history.created_at,
    history.expires_at, history.reversed_at, history.reverses_id,
    reason.message IS NULL, reason.message
  FROM private.ponuda_change_history history
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN history.reversed_at IS NOT NULL OR history.reverses_id IS NOT NULL THEN 'Promjena je već vraćena.'
      WHEN EXISTS (
        SELECT 1 FROM private.ponuda_change_history newer
        WHERE newer.company_id = history.company_id AND newer.ponuda_id = history.ponuda_id
          AND newer.sequence > history.sequence AND newer.reversed_at IS NULL AND newer.reverses_id IS NULL
      ) THEN 'Ponuda ima noviju promjenu. Najprije provjerite nju.'
      WHEN (current_offer - ARRAY['updated_at', 'gradiliste_id']) IS DISTINCT FROM (history.after_ponuda - ARRAY['updated_at', 'gradiliste_id'])
        OR current_lines IS DISTINCT FROM history.after_stavke THEN 'Ponuda ili njezine stavke naknadno su promijenjene.'
      ELSE NULL
    END AS message
  ) reason
  WHERE history.company_id = public.app_current_company_id() AND history.ponuda_id = p_record_id
    AND history.expires_at > now() AND (p_before_sequence IS NULL OR history.sequence < p_before_sequence)
  ORDER BY history.sequence DESC LIMIT 50;
END;
$$;

CREATE FUNCTION public.restore_ponuda_change(p_history_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  history private.ponuda_change_history%ROWTYPE;
  offer_row public.ponude%ROWTYPE;
  current_offer jsonb;
  current_lines jsonb;
  restored_offer jsonb;
  restored_lines jsonb;
  actor text;
  fields text[] := ARRAY[
    'naslov', 'investitor_id', 'objekt_id', 'adresa_radova', 'datum', 'status',
    'popust', 'pdv', 'napomene', 'prikazi_popust', 'prijenos_porezne_obveze'
  ];
  assignments text;
  reverse_id uuid;
BEGIN
  IF NOT public.app_has_module_permission('ponude', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja ponuda.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO history FROM private.ponuda_change_history
    WHERE id = p_history_id AND company_id = public.app_current_company_id() FOR UPDATE;
  IF NOT FOUND OR history.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'Promjena nije dostupna ili je istekla.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO offer_row FROM public.ponude
    WHERE id = history.ponuda_id AND company_id = history.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ponuda je obrisana. Najprije vratite brisanje ponude.' USING ERRCODE = '40001'; END IF;
  current_offer := to_jsonb(offer_row) - 'gradiliste_id';
  current_lines := private.ponuda_lines(history.ponuda_id);
  IF history.reversed_at IS NOT NULL OR history.reverses_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ova promjena već je vraćena.' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.ponuda_change_history newer
    WHERE newer.company_id = history.company_id AND newer.ponuda_id = history.ponuda_id
      AND newer.sequence > history.sequence AND newer.reversed_at IS NULL AND newer.reverses_id IS NULL
  ) OR (current_offer - ARRAY['updated_at', 'gradiliste_id']) IS DISTINCT FROM (history.after_ponuda - ARRAY['updated_at', 'gradiliste_id'])
    OR current_lines IS DISTINCT FROM history.after_stavke THEN
    RAISE EXCEPTION 'Ponuda ili njezine stavke imaju noviju promjenu. Ništa nije vraćeno.' USING ERRCODE = '40001';
  END IF;
  IF history.before_ponuda->>'investitor_id' IS NOT NULL THEN
    PERFORM 1 FROM public.investitori WHERE id = (history.before_ponuda->>'investitor_id')::uuid
      AND company_id = history.company_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Izvorni investitor nije dostupan u vašoj tvrtki.' USING ERRCODE = '23503'; END IF;
  END IF;
  IF history.before_ponuda->>'objekt_id' IS NOT NULL THEN
    PERFORM 1 FROM public.objekti WHERE id = (history.before_ponuda->>'objekt_id')::uuid
      AND company_id = history.company_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Izvorni objekt nije dostupan u vašoj tvrtki.' USING ERRCODE = '23503'; END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(history.before_stavke) line(stavka_id uuid)
    WHERE line.stavka_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.stavke item WHERE item.id = line.stavka_id AND item.company_id = history.company_id
    )
  ) THEN RAISE EXCEPTION 'Izvorna stavka kataloga nije dostupna u vašoj tvrtki.' USING ERRCODE = '23503'; END IF;
  SELECT string_agg(format('%I = previous.%I', field, field), ', ') INTO assignments FROM unnest(fields) field;
  PERFORM set_config('app.ponuda_history_id', history.ponuda_id::text, true);
  EXECUTE format('UPDATE public.ponude offer SET %s, updated_at = clock_timestamp()
    FROM jsonb_populate_record(NULL::public.ponude, $1) previous
    WHERE offer.id = $2 AND offer.company_id = $3', assignments)
    USING history.before_ponuda, history.ponuda_id, history.company_id;
  DELETE FROM public.ponude_stavke WHERE ponuda_id = history.ponuda_id AND company_id = history.company_id;
  INSERT INTO public.ponude_stavke(
    id, company_id, ponuda_id, stavka_id, redoslijed, opis, vrsta_posla, podgrupa, jedinica, kolicina, cijena, popust, created_at
  )
  SELECT line.id, history.company_id, history.ponuda_id, line.stavka_id, line.redoslijed,
    line.opis, line.vrsta_posla, line.podgrupa, line.jedinica, line.kolicina, line.cijena, line.popust, line.created_at
  FROM jsonb_populate_recordset(NULL::public.ponude_stavke, history.before_stavke) line;
  SELECT to_jsonb(offer), private.ponuda_lines(offer.id) INTO restored_offer, restored_lines
    FROM public.ponude offer WHERE offer.id = history.ponuda_id;
  restored_offer := restored_offer - 'gradiliste_id';
  IF (restored_offer - ARRAY['updated_at', 'gradiliste_id']) IS DISTINCT FROM (history.before_ponuda - ARRAY['updated_at', 'gradiliste_id'])
    OR restored_lines IS DISTINCT FROM history.before_stavke THEN
    RAISE EXCEPTION 'Pravila baze nisu dopustila točan povrat ponude i stavki. Ništa nije vraćeno.';
  END IF;
  SELECT profile.email INTO actor FROM public.app_profiles profile
    WHERE profile.id = auth.uid() AND profile.company_id = history.company_id;
  INSERT INTO private.ponuda_change_history(
    company_id, ponuda_id, actor_id, actor_name, before_ponuda, after_ponuda,
    before_stavke, after_stavke, reverses_id
  ) VALUES (
    history.company_id, history.ponuda_id, auth.uid(), COALESCE(actor, 'Korisnik'),
    current_offer, restored_offer, current_lines, restored_lines, history.id
  ) RETURNING id INTO reverse_id;
  UPDATE private.ponuda_change_history SET reversed_at = clock_timestamp(), reversed_by = auth.uid()
    WHERE id = history.id;
END;
$$;

CREATE FUNCTION private.prune_ponuda_change_history()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM private.ponuda_change_history WHERE expires_at <= clock_timestamp();
$$;

REVOKE ALL ON FUNCTION public.create_ponuda_with_stavke(jsonb, jsonb),
  public.save_ponuda_with_history(uuid, jsonb, jsonb),
  public.get_ponuda_change_history(uuid, bigint),
  public.restore_ponuda_change(uuid),
  private.prune_ponuda_change_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_ponuda_with_stavke(jsonb, jsonb),
  public.save_ponuda_with_history(uuid, jsonb, jsonb),
  public.get_ponuda_change_history(uuid, bigint),
  public.restore_ponuda_change(uuid) TO authenticated;
SELECT cron.schedule(
  'prune-ponuda-change-history', '41 * * * *',
  'SELECT private.prune_ponuda_change_history();'
);
NOTIFY pgrst, 'reload schema';
