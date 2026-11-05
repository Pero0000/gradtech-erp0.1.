CREATE OR REPLACE FUNCTION private.resource_recovery_module(p_table text, p_data jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_table IN ('radnici', 'radnici_dokumenti', 'radnici_odsustva', 'radnici_povijest', 'radnik_dokument_kategorije') THEN 'radnici'
    WHEN p_table IN ('vozila', 'vozila_dokumenti', 'vozila_gorivo', 'vozila_obavijesti', 'vozila_gorivo_anomalije') THEN 'vozila'
    WHEN p_table = 'oprema' THEN CASE p_data->>'kategorija' WHEN 'alat' THEN 'alat' ELSE 'strojevi' END
    WHEN p_table = 'oprema_dokumenti' THEN 'oprema'
    WHEN p_table IN ('raspored', 'raspored_radnici', 'raspored_vozila', 'dnevni_raspored_gradilista', 'dnevni_raspored_radnici', 'dnevni_raspored_ostalo', 'raspored_objave') THEN 'raspored'
    WHEN p_table = 'radno_vrijeme' THEN 'radno_vrijeme'
    WHEN p_table LIKE 'radni_nalozi%' OR p_table IN ('nalog_gradiliste_dokumenti', 'mobile_work_order_audit') THEN 'radni_nalozi'
    WHEN p_table = 'app_profiles' THEN 'admin'
    WHEN p_table = 'troskovi' THEN 'troskovi'
    WHEN p_table = 'kooperant_dokumenti' THEN 'kooperanti'
    ELSE 'unsupported' END;
$$;

INSERT INTO private.resource_recovery_tables(table_name, key_columns)
VALUES ('kooperant_dokumenti', ARRAY['id'])
ON CONFLICT (table_name) DO UPDATE SET key_columns = EXCLUDED.key_columns;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.kooperant_dokumenti'::regclass
      AND tgname = 'zzzz_resource_recovery' AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER zzzz_resource_recovery AFTER INSERT OR UPDATE OR DELETE ON public.kooperant_dokumenti
      FOR EACH ROW EXECUTE FUNCTION private.capture_resource_recovery_row();
  END IF;
END;
$$;

CREATE FUNCTION public.create_kooperant_invoice(
  p_kooperant_id uuid,
  p_gradiliste_id uuid,
  p_putanja text,
  p_naziv text,
  p_broj_racuna text,
  p_datum date,
  p_placen boolean,
  p_placeno_at date,
  p_stavke jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  company uuid := public.app_current_company_id();
  document public.kooperant_dokumenti%ROWTYPE;
  line record;
  total integer := 0;
BEGIN
  IF NOT public.app_has_module_permission('kooperanti', 'edit')
    OR NOT public.app_has_module_permission('troskovi', 'edit') THEN
    RAISE EXCEPTION 'Za spremanje kooperantskog računa potrebna su prava uređivanja kooperanata i troškova.' USING ERRCODE = '42501';
  END IF;
  IF company IS NULL THEN RAISE EXCEPTION 'Tvrtka nije dostupna.' USING ERRCODE = '42501'; END IF;
  IF p_naziv IS NULL OR btrim(p_naziv) = '' OR p_putanja IS NULL
    OR p_putanja NOT LIKE company::text || '/' || p_kooperant_id::text || '/%'
    OR p_datum IS NULL OR (p_placen AND p_placeno_at IS NULL) OR (NOT p_placen AND p_placeno_at IS NOT NULL)
    OR jsonb_typeof(p_stavke) IS DISTINCT FROM 'array' OR jsonb_array_length(p_stavke) = 0 THEN
    RAISE EXCEPTION 'Podaci računa nisu potpuni ili valjani.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.kooperanti k WHERE k.id = p_kooperant_id AND k.company_id = company FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kooperant nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.gradilista g WHERE g.id = p_gradiliste_id AND g.company_id = company FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gradilište nije dostupno u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'kooperant-dokumenti' AND name = p_putanja) THEN
    RAISE EXCEPTION 'Učitani prilog računa nije pronađen.' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.kooperant_dokumenti(id, company_id, kooperant_id, gradiliste_id, vrsta, naziv, putanja)
    VALUES (gen_random_uuid(), company, p_kooperant_id, p_gradiliste_id, 'racun', p_naziv, p_putanja)
    RETURNING * INTO document;

  FOR line IN SELECT * FROM jsonb_to_recordset(p_stavke) AS item(
    opis text, iznos numeric, kolicina numeric, jedinica text, jedinicna_cijena numeric
  ) LOOP
    IF line.opis IS NULL OR btrim(line.opis) = '' OR line.iznos IS NULL OR line.iznos <= 0
      OR line.kolicina < 0 OR line.jedinicna_cijena IS NULL OR line.jedinicna_cijena < 0 THEN
      RAISE EXCEPTION 'Stavka računa ima nevaljan opis, količinu, cijenu ili iznos.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.troskovi(
      company_id, gradiliste_id, kategorija, kooperant_id, kooperant_racun_id, broj_racuna,
      kolicina, jedinica, jedinicna_cijena, opis, iznos, datum, placen, placeno_at
    ) VALUES (
      company, p_gradiliste_id, 'kooperanti', p_kooperant_id, document.id, NULLIF(btrim(p_broj_racuna), ''),
      NULLIF(line.kolicina, 0), NULLIF(btrim(line.jedinica), ''), line.jedinicna_cijena,
      btrim(line.opis), line.iznos, p_datum, p_placen, p_placeno_at
    );
    total := total + 1;
  END LOOP;
  IF total <> jsonb_array_length(p_stavke) THEN RAISE EXCEPTION 'Nisu spremljene sve stavke računa.'; END IF;
  RETURN to_jsonb(document);
END;
$$;

CREATE FUNCTION private.guard_cooperator_invoice_file()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  snapshot jsonb;
BEGIN
  IF TG_OP = 'DELETE' AND OLD.vrsta = 'racun' AND auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM private.resource_deletions d WHERE d.active AND NOT d.restoring
        AND d.transaction_id = txid_current() AND d.company_id = OLD.company_id
        AND ((d.table_name = 'kooperant_dokumenti' AND d.record_id = OLD.id)
          OR (d.table_name = 'kooperanti' AND d.record_id = OLD.kooperant_id))
    ) THEN
    RAISE EXCEPTION 'Brisanje računa kooperanta zahtijeva zajedničko zaštićeno brisanje.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    snapshot := private.resource_restore_snapshot('kooperant_dokumenti', NEW.id);
    IF snapshot IS NOT NULL AND (
      snapshot->>'vrsta' = 'racun'
      AND NOT EXISTS (
        SELECT 1 FROM storage.objects WHERE bucket_id = 'kooperant-dokumenti' AND name = snapshot->>'putanja'
      )
    ) THEN
      RAISE EXCEPTION 'Nedostaje sačuvana datoteka računa kooperanta. Ništa nije vraćeno.' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER guard_cooperator_invoice_file
  BEFORE INSERT OR DELETE ON public.kooperant_dokumenti
  FOR EACH ROW EXECUTE FUNCTION private.guard_cooperator_invoice_file();

CREATE OR REPLACE FUNCTION private.guard_cost_recovery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  operation private.resource_deletions%ROWTYPE;
BEGIN
  SELECT * INTO operation FROM private.resource_deletions
    WHERE active AND transaction_id = txid_current();
  IF TG_OP = 'INSERT' AND operation.restoring AND operation.table_name = 'troskovi' AND operation.record_id = NEW.id THEN
    IF NEW.nalog_id IS NOT NULL OR NEW.kooperant_racun_id IS NOT NULL THEN
      RAISE EXCEPTION 'Trošak pripada nalogu ili grupnom računu. Potreban je zajednički povrat obračuna; ništa nije vraćeno.' USING ERRCODE = '40001';
    END IF;
    IF NEW.gradiliste_id IS NOT NULL THEN
      PERFORM 1 FROM public.gradilista WHERE id = NEW.gradiliste_id AND company_id = operation.company_id FOR KEY SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Izvorno gradilište nije dostupno u vašoj tvrtki. Ništa nije vraćeno.' USING ERRCODE = '23503'; END IF;
    END IF;
    IF NEW.kooperant_id IS NOT NULL THEN
      PERFORM 1 FROM public.kooperanti WHERE id = NEW.kooperant_id AND company_id = operation.company_id FOR KEY SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Izvorni kooperant nije dostupan u vašoj tvrtki. Ništa nije vraćeno.' USING ERRCODE = '23503'; END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' AND auth.uid() IS NOT NULL AND OLD.kooperant_racun_id IS NOT NULL AND operation.id IS NULL THEN
    RAISE EXCEPTION 'Brisanje stavki kooperantskog računa zahtijeva zajedničko zaštićeno brisanje.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' AND auth.uid() IS NOT NULL AND operation.id IS NULL
    AND OLD.nalog_id IS NULL AND OLD.kooperant_racun_id IS NULL THEN
    RAISE EXCEPTION 'Zaštićeno brisanje ručnog troška zahtijeva novu verziju aplikacije i delete_cost_with_history.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE FUNCTION private.validate_cooperator_invoice_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  operation private.resource_deletions%ROWTYPE;
BEGIN
  IF NEW.kooperant_racun_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.kooperant_dokumenti d
    WHERE d.id = NEW.kooperant_racun_id AND d.company_id = NEW.company_id
      AND d.kooperant_id = NEW.kooperant_id AND d.vrsta = 'racun'
  ) THEN RETURN NEW; END IF;
  SELECT * INTO operation FROM private.resource_deletions
    WHERE active AND transaction_id = txid_current();
  IF operation.restoring AND EXISTS (
    SELECT 1 FROM private.resource_deletion_rows r WHERE r.deletion_id = operation.id
      AND r.table_name = 'troskovi' AND r.row_key = jsonb_build_object('id', NEW.id)
      AND r.before_data->>'kooperant_id' = NEW.kooperant_id::text
      AND r.before_data->>'kooperant_racun_id' = NEW.kooperant_racun_id::text
  ) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND operation.id IS NOT NULL AND operation.table_name = 'kooperanti'
    AND operation.record_id = OLD.kooperant_id AND operation.company_id = NEW.company_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Stavka mora biti povezana s postojećim računom istog kooperanta i tvrtke.' USING ERRCODE = '23503';
END;
$$;
CREATE TRIGGER validate_cooperator_invoice_cost
  BEFORE INSERT OR UPDATE OF kooperant_id, kooperant_racun_id, company_id ON public.troskovi
  FOR EACH ROW EXECUTE FUNCTION private.validate_cooperator_invoice_cost();

CREATE FUNCTION public.app_cooperator_invoice_file_retained(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.app_has_module_permission('kooperanti', 'edit')
    AND p_path LIKE public.app_current_company_id()::text || '/%'
    AND EXISTS (
    SELECT 1 FROM private.resource_deletions d WHERE d.table_name = 'kooperant_dokumenti'
      AND d.company_id = public.app_current_company_id()
      AND d.module = 'kooperanti' AND d.snapshot->>'vrsta' = 'racun'
      AND d.snapshot->>'putanja' = p_path AND NOT d.active
      AND d.reversed_at IS NULL AND d.expires_at > now()
  );
$$;
REVOKE ALL ON FUNCTION public.app_cooperator_invoice_file_retained(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_cooperator_invoice_file_retained(text) TO authenticated;

DROP POLICY IF EXISTS kooperant_files_select ON storage.objects;
CREATE POLICY kooperant_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'kooperant-dokumenti'
    AND split_part(name, '/', 1) = public.app_current_company_id()::text
    AND EXISTS (
      SELECT 1 FROM public.kooperant_dokumenti d
      WHERE d.putanja = name AND d.company_id = public.app_current_company_id()
        AND public.app_has_module_permission('kooperanti', 'view')
    )
  );
DROP POLICY IF EXISTS kooperant_files_delete ON storage.objects;
CREATE POLICY kooperant_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'kooperant-dokumenti'
    AND split_part(name, '/', 1) = public.app_current_company_id()::text
    AND EXISTS (
      SELECT 1 FROM public.kooperanti k
      WHERE k.id::text = split_part(name, '/', 2)
        AND k.company_id = public.app_current_company_id()
        AND public.app_has_module_permission('kooperanti', 'edit')
    )
    AND NOT public.app_cooperator_invoice_file_retained(name)
  );

CREATE FUNCTION public.delete_kooperant_racun_with_history(p_kooperant_id uuid, p_invoice_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  company uuid := public.app_current_company_id();
  document public.kooperant_dokumenti%ROWTYPE;
  operation_id uuid;
  cost_count integer;
  captured_count integer;
  history_sequence bigint;
BEGIN
  IF NOT public.app_has_module_permission('kooperanti', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja kooperanata.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO document FROM public.kooperant_dokumenti d
    WHERE d.id = p_invoice_id AND d.company_id = company AND d.kooperant_id = p_kooperant_id AND d.vrsta = 'racun'
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Račun kooperanta nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  SELECT count(*)::integer INTO cost_count FROM public.troskovi c
    WHERE c.company_id = company AND c.kooperant_id = p_kooperant_id AND c.kooperant_racun_id = p_invoice_id;
  IF cost_count > 0 AND NOT public.app_has_module_permission('troskovi', 'edit') THEN
    RAISE EXCEPTION 'Za brisanje stavki računa potrebno je pravo uređivanja troškova.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'kooperant-dokumenti' AND name = document.putanja) THEN
    RAISE EXCEPTION 'Izvorna datoteka računa nedostaje; ništa nije obrisano.' USING ERRCODE = '23503';
  END IF;
  PERFORM 1 FROM public.troskovi c WHERE c.company_id = company AND c.kooperant_id = p_kooperant_id
    AND c.kooperant_racun_id = p_invoice_id ORDER BY c.id FOR UPDATE;
  SELECT COALESCE(max(sequence), 0) INTO history_sequence FROM private.business_change_history;
  INSERT INTO private.resource_deletions(company_id, module, table_name, record_id, snapshot, actor_name)
    VALUES (company, 'kooperanti', 'kooperant_dokumenti', document.id, to_jsonb(document),
      COALESCE((SELECT email FROM public.app_profiles WHERE id = auth.uid()), 'Korisnik'))
    RETURNING id INTO operation_id;
  DELETE FROM public.troskovi c WHERE c.company_id = company AND c.kooperant_id = p_kooperant_id
    AND c.kooperant_racun_id = p_invoice_id;
  DELETE FROM public.kooperant_dokumenti d WHERE d.id = document.id AND d.company_id = company;
  SELECT count(*)::integer INTO captured_count FROM private.resource_deletion_rows
    WHERE deletion_id = operation_id AND after_data IS NULL;
  IF captured_count <> cost_count + 1 OR EXISTS (
    SELECT 1 FROM private.resource_deletion_rows WHERE deletion_id = operation_id
      AND ((table_name = 'kooperant_dokumenti' AND row_key <> jsonb_build_object('id', document.id))
        OR (table_name = 'troskovi' AND after_data IS NOT NULL))
  ) THEN RAISE EXCEPTION 'Račun i sve njegove stavke nisu zajedno evidentirani. Ništa nije obrisano.'; END IF;
  IF NOT private.resource_deletion_allowed(operation_id) THEN
    RAISE EXCEPTION 'Nedostaju prava za vraćanje svih stavki računa. Ništa nije obrisano.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO private.resource_deletion_events
    SELECT operation_id, id FROM private.business_change_history
    WHERE transaction_id = txid_current() AND sequence > history_sequence;
  UPDATE private.resource_deletions SET active = false WHERE id = operation_id;
  RETURN operation_id;
END;
$$;

CREATE FUNCTION public.get_kooperant_invoice_deletions(p_before_time timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, snapshot jsonb, actor_name text, created_at timestamptz, expires_at timestamptz,
  reversed_at timestamptz, can_restore boolean, affected_rows jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.app_has_module_permission('kooperanti', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja kooperanata.' USING ERRCODE = '42501';
  END IF;
  IF (p_before_time IS NULL) <> (p_before_id IS NULL) THEN RAISE EXCEPTION 'Nepotpun pokazivač stranice.' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT d.id, d.snapshot, d.actor_name, d.created_at, d.expires_at, d.reversed_at,
    d.reversed_at IS NULL AND private.resource_deletion_allowed(d.id)
      AND EXISTS (SELECT 1 FROM storage.objects s WHERE s.bucket_id = 'kooperant-dokumenti' AND s.name = d.snapshot->>'putanja'),
    (SELECT jsonb_object_agg(summary.table_name, summary.total) FROM (
      SELECT r.table_name, count(*) total FROM private.resource_deletion_rows r
      WHERE r.deletion_id = d.id GROUP BY r.table_name
    ) summary)
  FROM private.resource_deletions d WHERE d.company_id = public.app_current_company_id()
    AND d.module = 'kooperanti' AND d.table_name = 'kooperant_dokumenti'
    AND d.snapshot->>'vrsta' = 'racun' AND NOT d.active AND d.expires_at > now()
    AND (p_before_time IS NULL OR (d.created_at, d.id) < (p_before_time, p_before_id))
  ORDER BY d.created_at DESC, d.id DESC LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_cooperator_invoice_file(), private.guard_cost_recovery(),
  private.validate_cooperator_invoice_cost(),
  public.create_kooperant_invoice(uuid, uuid, text, text, text, date, boolean, date, jsonb),
  public.delete_kooperant_racun_with_history(uuid, uuid),
  public.get_kooperant_invoice_deletions(timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_kooperant_invoice(uuid, uuid, text, text, text, date, boolean, date, jsonb),
  public.delete_kooperant_racun_with_history(uuid, uuid),
  public.get_kooperant_invoice_deletions(timestamptz, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
