ALTER TABLE public.radni_nalozi ADD COLUMN km_bez_obracuna boolean NOT NULL DEFAULT false;

CREATE TABLE private.work_order_km_confirmations (
  company_id uuid NOT NULL,
  nalog_id uuid NOT NULL,
  start_km numeric NOT NULL,
  end_km numeric NOT NULL,
  actor_id uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, nalog_id)
);

CREATE TABLE private.daily_vehicle_km_confirmations (
  company_id uuid NOT NULL,
  vozilo_id uuid NOT NULL,
  datum date NOT NULL,
  signature text NOT NULL,
  actor_id uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, vozilo_id, datum)
);

REVOKE ALL ON private.work_order_km_confirmations, private.daily_vehicle_km_confirmations
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.require_work_order_km_access(p_nalog_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi
    WHERE id = p_nalog_id AND company_id = public.app_current_company_id()
  ) OR NOT (
    public.app_has_module_permission('radni_nalozi', 'edit')
    OR public.app_mobile_editable_nalog(p_nalog_id)
  ) THEN
    RAISE EXCEPTION 'Nalog nije dostupan za provjeru kilometara.' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION public.work_order_km_confirmed(p_nalog_id uuid, p_start numeric, p_end numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
BEGIN
  PERFORM private.require_work_order_km_access(p_nalog_id);
  RETURN EXISTS (
    SELECT 1 FROM public.radni_nalozi
    WHERE id = p_nalog_id AND company_id = public.app_current_company_id() AND km_bez_obracuna
  ) OR EXISTS (
    SELECT 1 FROM private.work_order_km_confirmations
    WHERE company_id = public.app_current_company_id() AND nalog_id = p_nalog_id
      AND start_km = p_start AND end_km = p_end
  );
END;
$$;

CREATE FUNCTION public.confirm_work_order_km(p_nalog_id uuid, p_start numeric, p_end numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
BEGIN
  PERFORM private.require_work_order_km_access(p_nalog_id);
  IF p_start IS NULL OR p_end IS NULL
    OR p_start::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_end::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_start < 0 OR p_end < p_start OR trunc(p_start) <> p_start OR trunc(p_end) <> p_end THEN
    RAISE EXCEPTION 'Neispravna očitanja kilometara.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO private.work_order_km_confirmations (company_id, nalog_id, start_km, end_km, actor_id)
  VALUES (public.app_current_company_id(), p_nalog_id, p_start, p_end, auth.uid())
  ON CONFLICT (company_id, nalog_id) DO UPDATE
    SET start_km = EXCLUDED.start_km, end_km = EXCLUDED.end_km,
        actor_id = EXCLUDED.actor_id, confirmed_at = now();
END;
$$;

CREATE FUNCTION private.validate_work_order_km()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
BEGIN
  IF (NEW.km_pocetak IS NOT NULL AND (
      NEW.km_pocetak::text IN ('NaN', 'Infinity', '-Infinity')
      OR NEW.km_pocetak < 0 OR trunc(NEW.km_pocetak) <> NEW.km_pocetak))
    OR (NEW.km_kraj IS NOT NULL AND (
      NEW.km_kraj::text IN ('NaN', 'Infinity', '-Infinity')
      OR NEW.km_kraj < 0 OR trunc(NEW.km_kraj) <> NEW.km_kraj))
    OR NEW.km_kraj < NEW.km_pocetak THEN
    RAISE EXCEPTION 'Neispravna očitanja kilometara: završno stanje mora biti najmanje jednako početnom; upiši nenegativne cijele brojeve.'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.status IS DISTINCT FROM 'otkazan' AND NOT COALESCE(NEW.bez_izvrsenja, false)
    AND NOT NEW.km_bez_obracuna
    AND NEW.km_kraj - NEW.km_pocetak > 1000
    AND NOT EXISTS (
      SELECT 1 FROM private.work_order_km_confirmations
      WHERE company_id = NEW.company_id AND nalog_id = NEW.id
        AND start_km = NEW.km_pocetak AND end_km = NEW.km_kraj
    ) THEN
    RAISE EXCEPTION 'Prijeđeno je više od 1.000 km na nalogu %. Provjeri oba očitanja i potvrdi da je unos ispravan.', NEW.broj
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_work_order_km
  BEFORE INSERT OR UPDATE OF km_pocetak, km_kraj, status, bez_izvrsenja, km_bez_obracuna ON public.radni_nalozi
  FOR EACH ROW EXECUTE FUNCTION private.validate_work_order_km();

CREATE FUNCTION private.daily_vehicle_km_review(p_company uuid, p_datum date)
RETURNS TABLE (vozilo_id uuid, naziv text, kilometri numeric, signature text, confirmed boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
  WITH orders AS (
    SELECT DISTINCT schedule.vozilo_id, n.id, n.km_pocetak, n.km_kraj
    FROM public.dnevni_raspored_gradilista schedule
    JOIN public.radni_nalozi n ON n.id = schedule.nalog_id AND n.company_id = p_company
    WHERE schedule.company_id = p_company AND schedule.datum = p_datum
      AND schedule.vozilo_id IS NOT NULL AND n.status = 'zavrsen'
      AND NOT COALESCE(n.bez_troska, false) AND NOT COALESCE(n.bez_izvrsenja, false)
      AND NOT n.km_bez_obracuna
      AND n.km_pocetak IS NOT NULL AND n.km_kraj IS NOT NULL
  ), totals AS (
    SELECT orders.vozilo_id, sum(km_kraj - km_pocetak) AS km,
      md5(string_agg(id::text || ':' || km_pocetak::text || ':' || km_kraj::text, ',' ORDER BY id)) AS signature
    FROM orders GROUP BY orders.vozilo_id
    HAVING sum(km_kraj - km_pocetak) > 1000
  )
  SELECT totals.vozilo_id, concat_ws(' ', v.marka, v.model, v.registracija), totals.km, totals.signature,
    EXISTS (
      SELECT 1 FROM private.daily_vehicle_km_confirmations c
      WHERE c.company_id = p_company AND c.vozilo_id = totals.vozilo_id
        AND c.datum = p_datum AND c.signature = totals.signature
    )
  FROM totals JOIN public.vozila v ON v.id = totals.vozilo_id AND v.company_id = p_company;
$$;

CREATE FUNCTION public.review_daily_vehicle_km(p_datum date)
RETURNS TABLE (vozilo_id uuid, naziv text, kilometri numeric, signature text, confirmed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.app_has_module_permission('radni_nalozi', 'edit') THEN
    RAISE EXCEPTION 'Za provjeru dnevnih kilometara potrebna su prava uređivanja naloga.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM private.daily_vehicle_km_review(public.app_current_company_id(), p_datum);
END;
$$;

CREATE FUNCTION public.confirm_daily_vehicle_km(p_datum date, p_vozilo_id uuid, p_signature text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.review_daily_vehicle_km(p_datum) r
    WHERE r.vozilo_id = p_vozilo_id AND r.signature = p_signature
  ) THEN
    RAISE EXCEPTION 'Očitanja su promijenjena. Ponovi provjeru dnevnih kilometara.' USING ERRCODE = '40001';
  END IF;
  INSERT INTO private.daily_vehicle_km_confirmations (company_id, vozilo_id, datum, signature, actor_id)
  VALUES (public.app_current_company_id(), p_vozilo_id, p_datum, p_signature, auth.uid())
  ON CONFLICT (company_id, vozilo_id, datum) DO UPDATE
    SET signature = EXCLUDED.signature, actor_id = EXCLUDED.actor_id, confirmed_at = now();
END;
$$;

CREATE FUNCTION private.validate_daily_vehicle_km_amount()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
DECLARE
  maximum_cost numeric;
BEGIN
  IF NEW.nalog_id IS NOT NULL AND NEW.kategorija = 'put' AND NEW.opis LIKE 'Kilometri:%' THEN
    SELECT max(round(total.km * vehicle.cijena_km, 2)) INTO maximum_cost
    FROM (
      SELECT DISTINCT s.vozilo_id
      FROM public.dnevni_raspored_gradilista s
      WHERE s.company_id = NEW.company_id AND s.datum = NEW.datum AND s.nalog_id = NEW.nalog_id
    ) linked
    JOIN public.vozila vehicle ON vehicle.id = linked.vozilo_id AND vehicle.company_id = NEW.company_id
    CROSS JOIN LATERAL (
      SELECT sum(n.km_kraj - n.km_pocetak) AS km
      FROM public.radni_nalozi n
      WHERE n.company_id = NEW.company_id AND n.status = 'zavrsen'
        AND NOT COALESCE(n.bez_troska, false) AND NOT COALESCE(n.bez_izvrsenja, false)
        AND NOT n.km_bez_obracuna
        AND n.km_pocetak IS NOT NULL AND n.km_kraj >= n.km_pocetak AND n.km_pocetak >= 0
        AND EXISTS (
          SELECT 1 FROM public.dnevni_raspored_gradilista s
          WHERE s.company_id = NEW.company_id AND s.datum = NEW.datum
            AND s.vozilo_id = linked.vozilo_id AND s.nalog_id = n.id
        )
    ) total;
    IF maximum_cost IS NULL OR NEW.iznos < 0 OR NEW.iznos > maximum_cost THEN
      RAISE EXCEPTION 'Kilometarski trošak ne odgovara upisanim vožnjama. Provjeri oba očitanja i ponovno obračunaj kilometre.'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.radni_nalozi n
      WHERE n.id = NEW.nalog_id AND n.company_id = NEW.company_id
        AND (n.km_bez_obracuna OR n.km_pocetak IS NULL OR n.km_kraj IS NULL
          OR n.km_pocetak < 0 OR n.km_kraj < n.km_pocetak
          OR n.km_pocetak::text IN ('NaN', 'Infinity', '-Infinity')
          OR n.km_kraj::text IN ('NaN', 'Infinity', '-Infinity')
          OR (n.km_kraj - n.km_pocetak > 1000 AND NOT EXISTS (
            SELECT 1 FROM private.work_order_km_confirmations c
            WHERE c.company_id = n.company_id AND c.nalog_id = n.id
              AND c.start_km = n.km_pocetak AND c.end_km = n.km_kraj
          )))
    ) OR EXISTS (
      SELECT 1 FROM private.daily_vehicle_km_review(NEW.company_id, NEW.datum) r
      JOIN public.dnevni_raspored_gradilista s ON s.vozilo_id = r.vozilo_id
      WHERE s.company_id = NEW.company_id AND s.datum = NEW.datum AND s.nalog_id = NEW.nalog_id
        AND NOT r.confirmed
    ) THEN
      RAISE EXCEPTION 'Kilometarski trošak nije spremljen. Provjeri oba očitanja i potvrdi vožnju veću od 1.000 km.'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_daily_vehicle_km_amount
  BEFORE INSERT OR UPDATE ON public.troskovi
  FOR EACH ROW EXECUTE FUNCTION private.validate_daily_vehicle_km_amount();

REVOKE ALL ON FUNCTION private.require_work_order_km_access(uuid), private.validate_work_order_km(),
  private.daily_vehicle_km_review(uuid, date), private.validate_daily_vehicle_km_amount()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.work_order_km_confirmed(uuid, numeric, numeric),
  public.confirm_work_order_km(uuid, numeric, numeric), public.review_daily_vehicle_km(date),
  public.confirm_daily_vehicle_km(date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_order_km_confirmed(uuid, numeric, numeric),
  public.confirm_work_order_km(uuid, numeric, numeric), public.review_daily_vehicle_km(date),
  public.confirm_daily_vehicle_km(date, uuid, text) TO authenticated;

COMMENT ON TABLE private.work_order_km_confirmations IS
  'Potvrda vožnje preko 1000 km vezana uz točna očitanja. Migracija ne mijenja stare kilometre ni troškove.';
