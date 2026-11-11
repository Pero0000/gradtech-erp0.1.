CREATE FUNCTION private.compute_vozila_gorivo_anomalije(p_company_id uuid)
RETURNS TABLE (
  company_id uuid, vozilo_id uuid, gorivo_id uuid, vrsta text, datum date,
  litara numeric, kilometraza integer, potrosnja numeric, usporedna_potrosnja numeric, opis text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
  WITH threshold AS (
    SELECT COALESCE((
      SELECT s.prag_odstupanja_postotak FROM public.vozila_gorivo_postavke s
      WHERE s.company_id = p_company_id
    ), 50)::numeric AS percent
  ),
  ordered AS (
    SELECT f.company_id, f.vozilo_id, f.id AS gorivo_id, f.datum, f.litara, f.kilometraza,
      lag(f.kilometraza) OVER (
        PARTITION BY f.vozilo_id ORDER BY f.datum, f.created_at, f.id
      ) AS prethodna_kilometraza
    FROM public.vozila_gorivo f WHERE f.company_id = p_company_id
  ),
  measured AS (
    SELECT ordered.*,
      CASE WHEN kilometraza > prethodna_kilometraza
        THEN litara * 100 / (kilometraza - prethodna_kilometraza) ELSE NULL END AS potrosnja
    FROM ordered
  ),
  mileage_anomalies AS (
    SELECT company_id, vozilo_id, gorivo_id, 'kilometraza'::text AS vrsta,
      datum, litara, kilometraza, NULL::numeric AS potrosnja, NULL::numeric AS usporedna_potrosnja,
      format(
        'Očitanje kilometraže (%s km) manje je od prethodnog (%s km). Provjerite unos.',
        kilometraza, prethodna_kilometraza
      ) AS opis
    FROM measured WHERE prethodna_kilometraza IS NOT NULL AND kilometraza < prethodna_kilometraza
  ),
  consumption_anomalies AS (
    SELECT candidate.company_id, candidate.vozilo_id, candidate.gorivo_id,
      CASE WHEN candidate.potrosnja > comparison.median * (1 + threshold.percent / 100)
        THEN 'potrosnja_visoka' ELSE 'potrosnja_niska' END AS vrsta,
      candidate.datum, candidate.litara, candidate.kilometraza, candidate.potrosnja,
      comparison.median AS usporedna_potrosnja,
      format(
        'Izračunata potrošnja je %s l/100 km, a medijan drugih točenja ovog vozila %s l/100 km (prag odstupanja %s%%).',
        round(candidate.potrosnja, 2), round(comparison.median, 2), threshold.percent
      ) AS opis
    FROM measured candidate CROSS JOIN threshold
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS broj,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY other.potrosnja::double precision)::numeric AS median
      FROM measured other WHERE other.vozilo_id = candidate.vozilo_id
        AND other.gorivo_id <> candidate.gorivo_id AND other.potrosnja IS NOT NULL
    ) comparison
    WHERE candidate.potrosnja IS NOT NULL AND comparison.broj >= 3 AND comparison.median > 0
      AND (candidate.potrosnja > comparison.median * (1 + threshold.percent / 100)
        OR candidate.potrosnja < comparison.median * (1 - threshold.percent / 100))
  )
  SELECT * FROM mileage_anomalies UNION ALL SELECT * FROM consumption_anomalies;
$$;

CREATE OR REPLACE FUNCTION private.compute_vozila_gorivo_anomalije()
RETURNS TABLE (
  company_id uuid, vozilo_id uuid, gorivo_id uuid, vrsta text, datum date,
  litara numeric, kilometraza integer, potrosnja numeric, usporedna_potrosnja numeric, opis text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
  SELECT * FROM private.compute_vozila_gorivo_anomalije(public.app_current_company_id());
$$;

CREATE FUNCTION private.recalculate_fuel_anomalies(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
BEGIN
  -- Serialize writers for the same company before taking the calculation snapshot.
  PERFORM pg_advisory_xact_lock(hashtextextended('fuel-anomalies:' || p_company_id::text, 0));
  WITH calculated AS MATERIALIZED (
    SELECT * FROM private.compute_vozila_gorivo_anomalije(p_company_id)
  ), removed AS (
    DELETE FROM public.vozila_gorivo_anomalije existing
    WHERE existing.company_id = p_company_id AND NOT EXISTS (
      SELECT 1 FROM calculated c WHERE c.gorivo_id = existing.gorivo_id AND c.vrsta = existing.vrsta
    )
  )
  INSERT INTO public.vozila_gorivo_anomalije AS existing (
    company_id, vozilo_id, gorivo_id, vrsta, datum, litara, kilometraza, potrosnja, usporedna_potrosnja, opis
  )
  SELECT company_id, vozilo_id, gorivo_id, vrsta, datum, litara, kilometraza, potrosnja, usporedna_potrosnja, opis
  FROM calculated
  ON CONFLICT (gorivo_id, vrsta) DO UPDATE SET
    vozilo_id = EXCLUDED.vozilo_id, datum = EXCLUDED.datum, litara = EXCLUDED.litara,
    kilometraza = EXCLUDED.kilometraza, potrosnja = EXCLUDED.potrosnja,
    usporedna_potrosnja = EXCLUDED.usporedna_potrosnja, opis = EXCLUDED.opis, updated_at = now()
  WHERE ROW(existing.vozilo_id, existing.datum, existing.litara, existing.kilometraza,
      existing.potrosnja, existing.usporedna_potrosnja, existing.opis)
    IS DISTINCT FROM ROW(EXCLUDED.vozilo_id, EXCLUDED.datum, EXCLUDED.litara, EXCLUDED.kilometraza,
      EXCLUDED.potrosnja, EXCLUDED.usporedna_potrosnja, EXCLUDED.opis);
END;
$$;

CREATE FUNCTION private.recalculate_fuel_anomalies_on_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'vozila_gorivo' THEN
      IF ROW(OLD.company_id, OLD.vozilo_id, OLD.datum, OLD.litara, OLD.kilometraza, OLD.created_at)
        IS NOT DISTINCT FROM ROW(NEW.company_id, NEW.vozilo_id, NEW.datum, NEW.litara, NEW.kilometraza, NEW.created_at)
        THEN RETURN NEW; END IF;
    ELSE
      IF ROW(OLD.company_id, OLD.prag_odstupanja_postotak)
        IS NOT DISTINCT FROM ROW(NEW.company_id, NEW.prag_odstupanja_postotak)
        THEN RETURN NEW; END IF;
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM private.recalculate_fuel_anomalies(OLD.company_id);
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.recalculate_fuel_anomalies(NEW.company_id);
  ELSIF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    PERFORM private.recalculate_fuel_anomalies(NEW.company_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER recalculate_fuel_anomalies_on_change
  AFTER INSERT OR UPDATE OR DELETE ON public.vozila_gorivo
  FOR EACH ROW EXECUTE FUNCTION private.recalculate_fuel_anomalies_on_change();
CREATE TRIGGER recalculate_fuel_anomalies_on_threshold_change
  AFTER INSERT OR UPDATE OR DELETE ON public.vozila_gorivo_postavke
  FOR EACH ROW EXECUTE FUNCTION private.recalculate_fuel_anomalies_on_change();

CREATE FUNCTION public.recalculate_vozila_gorivo_anomalije()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
BEGIN
  IF public.app_current_company_id() IS NULL
    OR NOT public.app_has_module_permission('vozila', 'edit') THEN
    RAISE EXCEPTION 'Nemate pravo ponovno izračunati anomalije goriva.' USING ERRCODE = '42501';
  END IF;
  PERFORM private.recalculate_fuel_anomalies(public.app_current_company_id());
END;
$$;

-- Old clients may still call this name while loading notifications. Keep it read-only.
CREATE OR REPLACE FUNCTION public.refresh_vozila_gorivo_anomalije()
RETURNS SETOF public.vozila_gorivo_anomalije
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.app_has_module_permission('obavijesti', 'view') THEN
    RAISE EXCEPTION 'Nemate pravo pregledavati anomalije goriva.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.vozila_gorivo_anomalije
    WHERE company_id = public.app_current_company_id() AND rijeseno_at IS NULL
    ORDER BY datum DESC, created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION private.compute_vozila_gorivo_anomalije(uuid),
  private.compute_vozila_gorivo_anomalije(), private.recalculate_fuel_anomalies(uuid),
  private.recalculate_fuel_anomalies_on_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_vozila_gorivo_anomalije() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_vozila_gorivo_anomalije() TO authenticated;
COMMENT ON FUNCTION public.refresh_vozila_gorivo_anomalije()
  IS 'Read-only compatibility endpoint. Calculation runs only after fuel/settings changes or an explicit recalculate request.';
NOTIFY pgrst, 'reload schema';
