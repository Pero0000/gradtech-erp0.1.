CREATE TABLE public.vozila_gorivo_anomalije (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.tvrtke(id) ON DELETE CASCADE,
  vozilo_id uuid NOT NULL REFERENCES public.vozila(id) ON DELETE CASCADE,
  gorivo_id uuid NOT NULL REFERENCES public.vozila_gorivo(id) ON DELETE CASCADE,
  vrsta text NOT NULL CHECK (vrsta IN ('potrosnja_visoka', 'potrosnja_niska', 'kilometraza')),
  datum date NOT NULL,
  litara numeric(10, 2) NOT NULL,
  kilometraza integer NOT NULL,
  potrosnja numeric(10, 2),
  usporedna_potrosnja numeric(10, 2),
  opis text NOT NULL,
  rijeseno_at timestamptz,
  rijesio uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gorivo_id, vrsta)
);

REVOKE ALL ON TABLE public.vozila_gorivo_anomalije FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.vozila_gorivo_anomalije TO authenticated;

CREATE INDEX vozila_gorivo_anomalije_open_company_date
  ON public.vozila_gorivo_anomalije (company_id, datum DESC)
  WHERE rijeseno_at IS NULL;

ALTER TABLE public.vozila_gorivo_anomalije ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON public.vozila_gorivo_anomalije AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (company_id = public.app_current_company_id())
  WITH CHECK (company_id = public.app_current_company_id());

CREATE POLICY vozila_gorivo_anomalije_select ON public.vozila_gorivo_anomalije
  FOR SELECT TO authenticated
  USING (public.app_has_module_permission('obavijesti', 'view'));

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
  WITH ordered AS (
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
      CASE WHEN candidate.potrosnja > comparison.median * 1.5
        THEN 'potrosnja_visoka' ELSE 'potrosnja_niska' END AS vrsta,
      candidate.datum,
      candidate.litara,
      candidate.kilometraza,
      candidate.potrosnja,
      comparison.median AS usporedna_potrosnja,
      format(
        'Izračunata potrošnja je %s l/100 km, a medijan drugih točenja ovog vozila %s l/100 km.',
        round(candidate.potrosnja, 2), round(comparison.median, 2)
      ) AS opis
    FROM measured candidate
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
        candidate.potrosnja > comparison.median * 1.5
        OR candidate.potrosnja < comparison.median * 0.5
      )
  )
  SELECT * FROM mileage_anomalies
  UNION ALL
  SELECT * FROM consumption_anomalies;
$$;

CREATE OR REPLACE FUNCTION public.refresh_vozila_gorivo_anomalije()
RETURNS SETOF public.vozila_gorivo_anomalije
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF NOT public.app_has_module_permission('obavijesti', 'view') THEN
    RAISE EXCEPTION 'Nemate pravo pregledavati anomalije goriva.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.vozila_gorivo_anomalije existing
  WHERE existing.company_id = public.app_current_company_id()
    AND NOT EXISTS (
      SELECT 1
      FROM private.compute_vozila_gorivo_anomalije() current
      WHERE current.gorivo_id = existing.gorivo_id
        AND current.vrsta = existing.vrsta
    );

  INSERT INTO public.vozila_gorivo_anomalije (
    company_id, vozilo_id, gorivo_id, vrsta, datum, litara, kilometraza,
    potrosnja, usporedna_potrosnja, opis
  )
  SELECT
    company_id, vozilo_id, gorivo_id, vrsta, datum, litara, kilometraza,
    potrosnja, usporedna_potrosnja, opis
  FROM private.compute_vozila_gorivo_anomalije()
  ON CONFLICT (gorivo_id, vrsta) DO UPDATE SET
    datum = EXCLUDED.datum,
    litara = EXCLUDED.litara,
    kilometraza = EXCLUDED.kilometraza,
    potrosnja = EXCLUDED.potrosnja,
    usporedna_potrosnja = EXCLUDED.usporedna_potrosnja,
    opis = EXCLUDED.opis,
    updated_at = now();

  RETURN QUERY
  SELECT *
  FROM public.vozila_gorivo_anomalije anomaly
  WHERE anomaly.company_id = public.app_current_company_id()
    AND anomaly.rijeseno_at IS NULL
  ORDER BY anomaly.datum DESC, anomaly.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_vozila_gorivo_anomalija(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_has_module_permission('vozila', 'edit') THEN
    RAISE EXCEPTION 'Nemate pravo označiti anomaliju goriva riješenom.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.vozila_gorivo_anomalije
  SET rijeseno_at = now(), rijesio = auth.uid(), updated_at = now()
  WHERE id = p_id
    AND company_id = public.app_current_company_id()
    AND rijeseno_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aktivna anomalija goriva nije pronađena.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.compute_vozila_gorivo_anomalije() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_vozila_gorivo_anomalije() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_vozila_gorivo_anomalija(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_vozila_gorivo_anomalije() TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_vozila_gorivo_anomalija(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
