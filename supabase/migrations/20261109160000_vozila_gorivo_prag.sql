CREATE TABLE IF NOT EXISTS public.vozila_gorivo_postavke (
  company_id uuid PRIMARY KEY REFERENCES public.tvrtke(id) ON DELETE CASCADE,
  prag_odstupanja_postotak integer NOT NULL DEFAULT 50
    CHECK (prag_odstupanja_postotak BETWEEN 5 AND 90),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.vozila_gorivo_postavke FROM PUBLIC, anon, authenticated;
ALTER TABLE public.vozila_gorivo_postavke ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_scope ON public.vozila_gorivo_postavke;
CREATE POLICY tenant_scope ON public.vozila_gorivo_postavke AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (company_id = public.app_current_company_id())
  WITH CHECK (company_id = public.app_current_company_id());

CREATE OR REPLACE FUNCTION public.get_vozila_gorivo_anomaly_threshold()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  threshold_percent integer;
BEGIN
  IF NOT (
    public.app_has_module_permission('vozila', 'view')
    OR public.app_has_module_permission('vozila', 'edit')
  ) THEN
    RAISE EXCEPTION 'Nemate pravo pregledavati postavke potrošnje goriva.'
      USING ERRCODE = '42501';
  END IF;

  SELECT settings.prag_odstupanja_postotak
  INTO threshold_percent
  FROM public.vozila_gorivo_postavke settings
  WHERE settings.company_id = public.app_current_company_id();

  RETURN COALESCE(threshold_percent, 50);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_vozila_gorivo_anomaly_threshold(p_threshold_percent integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_has_module_permission('vozila', 'edit') THEN
    RAISE EXCEPTION 'Nemate pravo mijenjati prag upozorenja za potrošnju goriva.'
      USING ERRCODE = '42501';
  END IF;

  IF p_threshold_percent IS NULL OR p_threshold_percent < 5 OR p_threshold_percent > 90 THEN
    RAISE EXCEPTION 'Prag upozorenja mora biti cijeli broj od 5 do 90%%.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vozila_gorivo_postavke (company_id, prag_odstupanja_postotak, updated_at)
  VALUES (public.app_current_company_id(), p_threshold_percent, now())
  ON CONFLICT (company_id) DO UPDATE SET
    prag_odstupanja_postotak = EXCLUDED.prag_odstupanja_postotak,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION private.compute_vozila_gorivo_anomalije()
RETURNS TABLE (
  company_id uuid,
  vozilo_id uuid,
  gorivo_id uuid,
  vrsta text,
  datum date,
  litara numeric,
  kilometraza integer,
  potrosnja numeric,
  usporedna_potrosnja numeric,
  opis text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
  WITH threshold AS (
    SELECT COALESCE((
      SELECT settings.prag_odstupanja_postotak
      FROM public.vozila_gorivo_postavke settings
      WHERE settings.company_id = public.app_current_company_id()
    ), 50)::numeric AS percent
  ),
  ordered AS (
    SELECT
      fuel.company_id,
      fuel.vozilo_id,
      fuel.id AS gorivo_id,
      fuel.datum,
      fuel.litara,
      fuel.kilometraza,
      lag(fuel.kilometraza) OVER (
        PARTITION BY fuel.vozilo_id
        ORDER BY fuel.datum, fuel.created_at, fuel.id
      ) AS prethodna_kilometraza
    FROM public.vozila_gorivo fuel
    WHERE fuel.company_id = public.app_current_company_id()
  ),
  measured AS (
    SELECT
      ordered.*,
      CASE
        WHEN kilometraza > prethodna_kilometraza
          THEN litara * 100 / (kilometraza - prethodna_kilometraza)
        ELSE NULL
      END AS potrosnja
    FROM ordered
  ),
  mileage_anomalies AS (
    SELECT
      company_id, vozilo_id, gorivo_id, 'kilometraza'::text AS vrsta,
      datum, litara, kilometraza, NULL::numeric AS potrosnja,
      NULL::numeric AS usporedna_potrosnja,
      format(
        'Očitanje kilometraže (%s km) manje je od prethodnog (%s km). Provjerite unos.',
        kilometraza, prethodna_kilometraza
      ) AS opis
    FROM measured
    WHERE prethodna_kilometraza IS NOT NULL AND kilometraza < prethodna_kilometraza
  ),
  consumption_anomalies AS (
    SELECT
      candidate.company_id,
      candidate.vozilo_id,
      candidate.gorivo_id,
      CASE WHEN candidate.potrosnja > comparison.median * (1 + threshold.percent / 100)
        THEN 'potrosnja_visoka' ELSE 'potrosnja_niska' END AS vrsta,
      candidate.datum,
      candidate.litara,
      candidate.kilometraza,
      candidate.potrosnja,
      comparison.median AS usporedna_potrosnja,
      format(
        'Izračunata potrošnja je %s l/100 km, a medijan drugih točenja ovog vozila %s l/100 km (prag odstupanja %s%%).',
        round(candidate.potrosnja, 2), round(comparison.median, 2), threshold.percent
      ) AS opis
    FROM measured candidate
    CROSS JOIN threshold
    CROSS JOIN LATERAL (
      SELECT
        count(*)::integer AS broj,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY other.potrosnja::double precision)::numeric AS median
      FROM measured other
      WHERE other.vozilo_id = candidate.vozilo_id
        AND other.gorivo_id <> candidate.gorivo_id
        AND other.potrosnja IS NOT NULL
    ) comparison
    WHERE candidate.potrosnja IS NOT NULL
      AND comparison.broj >= 3
      AND comparison.median > 0
      AND (
        candidate.potrosnja > comparison.median * (1 + threshold.percent / 100)
        OR candidate.potrosnja < comparison.median * (1 - threshold.percent / 100)
      )
  )
  SELECT * FROM mileage_anomalies
  UNION ALL
  SELECT * FROM consumption_anomalies;
$$;

REVOKE ALL ON FUNCTION public.get_vozila_gorivo_anomaly_threshold() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_vozila_gorivo_anomaly_threshold(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_vozila_gorivo_anomaly_threshold() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_vozila_gorivo_anomaly_threshold(integer) TO authenticated;
REVOKE ALL ON FUNCTION private.compute_vozila_gorivo_anomalije() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
