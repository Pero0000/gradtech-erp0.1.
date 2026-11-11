BEGIN;

ALTER TABLE public.osobni_auto_voznje
  ADD COLUMN radno_vrijeme_od time,
  ADD COLUMN radno_vrijeme_do time,
  ADD COLUMN radno_vrijeme_nocni_sati numeric(4,1);

ALTER TABLE public.osobni_auto_voznje
  ADD CONSTRAINT osobni_auto_radno_vrijeme_check CHECK (
    (gradiliste_id IS NULL
      AND radno_vrijeme_od IS NULL
      AND radno_vrijeme_do IS NULL
      AND radno_vrijeme_nocni_sati IS NULL)
    OR
    (gradiliste_id IS NOT NULL
      AND radno_vrijeme_od IS NOT NULL
      AND radno_vrijeme_do IS NOT NULL
      AND radno_vrijeme_od <> radno_vrijeme_do
      AND radno_vrijeme_nocni_sati BETWEEN 0 AND
        round((mod(
          extract(hour FROM radno_vrijeme_do) * 60 + extract(minute FROM radno_vrijeme_do)
          - extract(hour FROM radno_vrijeme_od) * 60 - extract(minute FROM radno_vrijeme_od)
          + 1440,
          1440
        ) / 60.0)::numeric, 1))
  );

ALTER TABLE public.radno_vrijeme
  ADD COLUMN osobni_auto_voznja_id uuid UNIQUE
    REFERENCES public.osobni_auto_voznje(id) ON DELETE RESTRICT;

DROP FUNCTION public.report_my_personal_car_trip(uuid, uuid, date, integer, integer, uuid, time, time, text);

CREATE FUNCTION public.report_my_personal_car_trip(
  p_id uuid, p_vozilo_id uuid, p_datum date, p_km_pocetak integer, p_km_kraj integer,
  p_gradiliste_id uuid DEFAULT NULL, p_vrijeme_od time DEFAULT NULL, p_vrijeme_do time DEFAULT NULL,
  p_napomena text DEFAULT '', p_radno_vrijeme_od time DEFAULT NULL, p_radno_vrijeme_do time DEFAULT NULL,
  p_nocni_sati numeric DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
DECLARE
  worker_id uuid;
  company uuid := public.app_current_company_id();
  vehicle public.vozila%ROWTYPE;
  site_name text;
  cost_id uuid;
  rate numeric;
  amount numeric(12,2);
  vehicle_name text;
  existing public.osobni_auto_voznje%ROWTYPE;
  work_minutes integer;
  work_hours numeric(4,1);
BEGIN
  IF NOT public.has_my_personal_car() THEN
    RAISE EXCEPTION 'Osobni auto nije uključen za vaš račun.' USING ERRCODE = '42501';
  END IF;
  SELECT pilot.radnik_id INTO worker_id FROM private.osobni_auto_pilot pilot
    JOIN public.app_profiles profile ON profile.radnik_id = pilot.radnik_id
    WHERE profile.id = auth.uid() AND pilot.company_id = company FOR UPDATE OF pilot;
  IF p_id IS NULL THEN RAISE EXCEPTION 'Nedostaje oznaka prijave vožnje.' USING ERRCODE = '22023'; END IF;

  IF p_gradiliste_id IS NOT NULL THEN
    IF p_radno_vrijeme_od IS NULL OR p_radno_vrijeme_do IS NULL
      OR p_radno_vrijeme_od = p_radno_vrijeme_do OR p_nocni_sati IS NULL THEN
      RAISE EXCEPTION 'Za vožnju na gradilište obavezno unesite početak, završetak i noćne sate radne smjene.' USING ERRCODE = '22023';
    END IF;
    work_minutes := mod(
      extract(hour FROM p_radno_vrijeme_do)::integer * 60 + extract(minute FROM p_radno_vrijeme_do)::integer
      - extract(hour FROM p_radno_vrijeme_od)::integer * 60 - extract(minute FROM p_radno_vrijeme_od)::integer
      + 1440,
      1440
    );
    work_hours := round((work_minutes / 60.0)::numeric, 1);
    IF work_minutes = 0 OR p_nocni_sati < 0 OR p_nocni_sati > work_hours THEN
      RAISE EXCEPTION 'Uneseni radni sati ili noćni sati nisu valjani.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_radno_vrijeme_od IS NOT NULL OR p_radno_vrijeme_do IS NOT NULL OR p_nocni_sati IS NOT NULL THEN
    RAISE EXCEPTION 'Privatna vožnja ne može sadržavati radno vrijeme.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO existing FROM public.osobni_auto_voznje WHERE id = p_id;
  IF FOUND THEN
    IF existing.company_id = company AND existing.radnik_id = worker_id AND existing.created_by = auth.uid()
      AND ROW(existing.vozilo_id, existing.datum, existing.km_pocetak, existing.km_kraj,
        existing.gradiliste_id, existing.vrijeme_od, existing.vrijeme_do, existing.napomena,
        existing.radno_vrijeme_od, existing.radno_vrijeme_do, existing.radno_vrijeme_nocni_sati)
      IS NOT DISTINCT FROM ROW(p_vozilo_id, p_datum, p_km_pocetak, p_km_kraj,
        p_gradiliste_id, p_vrijeme_od, p_vrijeme_do, btrim(COALESCE(p_napomena, '')),
        p_radno_vrijeme_od, p_radno_vrijeme_do, p_nocni_sati)
      AND (existing.gradiliste_id IS NULL OR EXISTS (
        SELECT 1 FROM public.radno_vrijeme entry WHERE entry.osobni_auto_voznja_id = existing.id
          AND entry.company_id = existing.company_id AND entry.radnik_id = existing.radnik_id
          AND entry.gradiliste_id = existing.gradiliste_id AND entry.datum = existing.datum
      )) THEN
      RETURN existing.id;
    END IF;
    RAISE EXCEPTION 'Oznaka prijave već je iskorištena za drugu vožnju.' USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL OR p_datum > CURRENT_DATE OR p_km_pocetak IS NULL OR p_km_pocetak < 0
    OR p_km_kraj IS NULL OR p_km_kraj <= p_km_pocetak
    OR (p_vrijeme_od IS NULL) <> (p_vrijeme_do IS NULL)
    OR length(COALESCE(p_napomena, '')) > 1000 THEN
    RAISE EXCEPTION 'Unesite datum do danas, početne i veće završne kilometre te oba vremena vožnje ili nijedno. Razlog puta može imati do 1000 znakova.'
      USING ERRCODE = '22023';
  END IF;

  IF p_gradiliste_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(worker_id::text), hashtext('worker-work-time-overlap'));
    IF EXISTS (
      WITH incoming AS (
        SELECT p_datum + p_radno_vrijeme_od AS starts_at,
          p_datum + p_radno_vrijeme_do
            + CASE WHEN p_radno_vrijeme_do < p_radno_vrijeme_od THEN interval '1 day' ELSE interval '0' END AS ends_at
      ),
      existing_shifts AS (
        SELECT work_date.work_date + assignment.vrijeme_od AS starts_at,
          work_date.work_date + assignment.vrijeme_do
            + CASE WHEN assignment.vrijeme_do < assignment.vrijeme_od THEN interval '1 day' ELSE interval '0' END AS ends_at
        FROM public.radni_nalozi_radnici assignment
        JOIN public.radni_nalozi nalog ON nalog.id = assignment.nalog_id
        CROSS JOIN LATERAL (SELECT private.work_order_time_date(nalog) AS work_date) work_date
        WHERE assignment.radnik_id = worker_id AND nalog.status IS DISTINCT FROM 'otkazan'
          AND NOT COALESCE(nalog.bez_izvrsenja, false)
          AND NOT COALESCE(assignment.mobile_zero_hours, false)
          AND assignment.vrijeme_od IS NOT NULL AND assignment.vrijeme_do IS NOT NULL
        UNION ALL
        SELECT work_date.work_date + (segment->>'vrijeme_od')::time,
          work_date.work_date + (segment->>'vrijeme_do')::time
            + CASE WHEN (segment->>'vrijeme_do')::time < (segment->>'vrijeme_od')::time
                THEN interval '1 day' ELSE interval '0' END
        FROM public.radni_nalozi_radnici assignment
        JOIN public.radni_nalozi nalog ON nalog.id = assignment.nalog_id
        CROSS JOIN LATERAL (SELECT private.work_order_time_date(nalog) AS work_date) work_date
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(assignment.mobile_extra_time, '[]'::jsonb)) segment
        WHERE assignment.radnik_id = worker_id AND nalog.status IS DISTINCT FROM 'otkazan'
          AND NOT COALESCE(nalog.bez_izvrsenja, false)
        UNION ALL
        SELECT trip.datum + trip.radno_vrijeme_od,
          trip.datum + trip.radno_vrijeme_do
            + CASE WHEN trip.radno_vrijeme_do < trip.radno_vrijeme_od
                THEN interval '1 day' ELSE interval '0' END
        FROM public.osobni_auto_voznje trip
        WHERE trip.radnik_id = worker_id AND trip.radno_vrijeme_od IS NOT NULL
      )
      SELECT 1 FROM incoming JOIN existing_shifts
        ON incoming.starts_at < existing_shifts.ends_at
        AND existing_shifts.starts_at < incoming.ends_at
    ) THEN
      RAISE EXCEPTION 'Radna smjena preklapa se s radnim nalogom ili drugom prijavljenom smjenom. Uskladite evidenciju prije spremanja.'
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  SELECT * INTO vehicle FROM public.vozila WHERE id = p_vozilo_id AND company_id = company
    AND status NOT IN ('servis', 'neispravno') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Odabrano vozilo nije dostupno u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.osobni_auto_voznje trip
    WHERE trip.vozilo_id = vehicle.id AND trip.stornirano_at IS NULL
      AND trip.km_pocetak < p_km_kraj AND trip.km_kraj > p_km_pocetak) THEN
    RAISE EXCEPTION 'Ovi kilometri preklapaju se s već prijavljenom vožnjom. Provjerite povijest ili stornirajte pogrešan unos.'
      USING ERRCODE = '22023';
  END IF;
  rate := COALESCE(vehicle.cijena_km, 0);
  IF p_gradiliste_id IS NULL AND (rate < 0 OR rate::text IN ('NaN', 'Infinity', '-Infinity')) THEN rate := 0; END IF;
  vehicle_name := concat_ws(' ', vehicle.marka, vehicle.model) || ' · ' || vehicle.registracija;
  amount := 0;
  IF p_gradiliste_id IS NOT NULL THEN
    SELECT naziv INTO site_name FROM public.gradilista WHERE id = p_gradiliste_id
      AND company_id = company AND status <> 'zavrseno' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Odabrano gradilište nije dostupno u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
    IF rate <= 0 OR rate::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'Vozilo nema valjanu cijenu po kilometru. Ured treba postaviti cijenu prije poslovne vožnje.' USING ERRCODE = '22023';
    END IF;
    amount := round((p_km_kraj::numeric - p_km_pocetak) * rate, 2);
    INSERT INTO public.troskovi(company_id, gradiliste_id, kategorija, opis, iznos, datum)
    VALUES (company, p_gradiliste_id, 'put',
      format('Osobni auto: %s · %s km × %s €/km · vožnja %s', vehicle_name, p_km_kraj - p_km_pocetak, rate, p_id),
      amount, p_datum) RETURNING id INTO cost_id;
    IF cost_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.troskovi cost WHERE cost.id = cost_id
      AND cost.company_id = company AND cost.gradiliste_id = p_gradiliste_id AND cost.iznos = amount) THEN
      RAISE EXCEPTION 'Trošak vožnje nije točno spremljen. Ništa nije prijavljeno.';
    END IF;
  END IF;

  INSERT INTO public.osobni_auto_voznje(id, company_id, radnik_id, created_by, vozilo_id, vozilo_naziv,
    datum, km_pocetak, km_kraj, gradiliste_id, gradiliste_naziv, cijena_km, iznos, trosak_id,
    vrijeme_od, vrijeme_do, napomena, radno_vrijeme_od, radno_vrijeme_do, radno_vrijeme_nocni_sati)
  VALUES (p_id, company, worker_id, auth.uid(), vehicle.id, vehicle_name, p_datum, p_km_pocetak, p_km_kraj,
    p_gradiliste_id, site_name, GREATEST(rate, 0), amount, cost_id, p_vrijeme_od, p_vrijeme_do,
    btrim(COALESCE(p_napomena, '')), p_radno_vrijeme_od, p_radno_vrijeme_do,
    CASE WHEN p_gradiliste_id IS NOT NULL THEN p_nocni_sati::numeric(4,1) END);
  IF NOT EXISTS (SELECT 1 FROM public.osobni_auto_voznje trip WHERE trip.id = p_id
    AND ROW(trip.company_id, trip.radnik_id, trip.created_by, trip.vozilo_id, trip.datum,
      trip.km_pocetak, trip.km_kraj, trip.gradiliste_id, trip.cijena_km, trip.iznos, trip.trosak_id,
      trip.vrijeme_od, trip.vrijeme_do, trip.napomena,
      trip.radno_vrijeme_od, trip.radno_vrijeme_do, trip.radno_vrijeme_nocni_sati)
    IS NOT DISTINCT FROM ROW(company, worker_id, auth.uid(), vehicle.id, p_datum,
      p_km_pocetak, p_km_kraj, p_gradiliste_id, GREATEST(rate, 0), amount, cost_id,
      p_vrijeme_od, p_vrijeme_do, btrim(COALESCE(p_napomena, '')),
      p_radno_vrijeme_od, p_radno_vrijeme_do,
      CASE WHEN p_gradiliste_id IS NOT NULL THEN p_nocni_sati::numeric(4,1) END)) THEN
    RAISE EXCEPTION 'Zapis vožnje nije točno spremljen. Ništa nije prijavljeno.';
  END IF;

  IF p_gradiliste_id IS NOT NULL THEN
    INSERT INTO public.radno_vrijeme(
      company_id, nalog_id, radnik_id, gradiliste_id, datum, sati, nocni_sati, napomena, osobni_auto_voznja_id
    ) VALUES (
      company, NULL, worker_id, p_gradiliste_id, p_datum, work_hours,
      p_nocni_sati::numeric(4,1),
      concat('Osobni auto · ', vehicle_name,
        CASE WHEN btrim(COALESCE(p_napomena, '')) = '' THEN '' ELSE ' · Razlog puta: ' || btrim(p_napomena) END),
      p_id
    );
    IF NOT EXISTS (SELECT 1 FROM public.radno_vrijeme entry
      WHERE entry.osobni_auto_voznja_id = p_id AND entry.company_id = company
        AND entry.radnik_id = worker_id AND entry.gradiliste_id = p_gradiliste_id
        AND entry.datum = p_datum AND entry.sati = work_hours
        AND entry.nocni_sati = p_nocni_sati::numeric(4,1)) THEN
      RAISE EXCEPTION 'Radno vrijeme nije točno spremljeno. Ništa nije prijavljeno.';
    END IF;
  END IF;

  UPDATE public.vozila SET kilometraza = GREATEST(kilometraza, p_km_kraj) WHERE id = vehicle.id;
  IF NOT EXISTS (SELECT 1 FROM public.vozila WHERE id = vehicle.id AND kilometraza >= p_km_kraj) THEN
    RAISE EXCEPTION 'Kilometraža vozila nije spremljena. Ništa nije prijavljeno.';
  END IF;
  UPDATE private.osobni_auto_pilot SET zadnje_vozilo_id = vehicle.id WHERE radnik_id = worker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Odabir auta nije spremljen. Ništa nije prijavljeno.'; END IF;
  RETURN p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_radno_vrijeme(p_od date, p_do date)
RETURNS TABLE (
  izvor text,
  nalog_id uuid,
  nalog_broj text,
  gradiliste_naziv text,
  datum date,
  vrijeme_od time,
  vrijeme_do time,
  sati numeric,
  napomena text,
  nocni_sati numeric,
  teren boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH me AS (
    SELECT public.app_mobile_radnik_id() AS radnik_id
    WHERE public.get_my_portal_vrijeme()
  )
  SELECT * FROM (
    SELECT
      'nalog'::text, nalog.id, nalog.broj, site.naziv,
      COALESCE(timezone('Europe/Zagreb', assignment.mobile_started_at)::date, nalog.rok, nalog.datum_kreiranja),
      assignment.vrijeme_od, assignment.vrijeme_do,
      CASE WHEN assignment.vrijeme_od IS NOT NULL AND assignment.vrijeme_do IS NOT NULL
        THEN round((((extract(epoch FROM (assignment.vrijeme_do - assignment.vrijeme_od)) + 86400)::numeric % 86400) / 3600.0), 1)
        ELSE NULL END,
      NULL::text,
      COALESCE((SELECT sum(entry.nocni_sati) FROM public.radno_vrijeme entry
        WHERE entry.nalog_id = nalog.id AND entry.radnik_id = me.radnik_id), 0),
      COALESCE(nalog.teren, false)
    FROM me
    JOIN public.radni_nalozi_radnici assignment ON assignment.radnik_id = me.radnik_id
    JOIN public.radni_nalozi nalog ON nalog.id = assignment.nalog_id
    LEFT JOIN public.gradilista site ON site.id = nalog.gradiliste_id
    WHERE assignment.vrijeme_od IS NOT NULL OR assignment.mobile_started_at IS NOT NULL
    UNION ALL
    SELECT
      CASE WHEN trip.id IS NULL THEN 'evidencija'::text ELSE 'osobni_auto'::text END,
      entry.nalog_id, nalog.broj, COALESCE(trip.gradiliste_naziv, site.naziv),
      entry.datum, trip.radno_vrijeme_od, trip.radno_vrijeme_do,
      entry.sati, entry.napomena, entry.nocni_sati, false
    FROM me
    JOIN public.radno_vrijeme entry ON entry.radnik_id = me.radnik_id
    LEFT JOIN public.radni_nalozi nalog ON nalog.id = entry.nalog_id
    LEFT JOIN public.gradilista site ON site.id = entry.gradiliste_id
    LEFT JOIN public.osobni_auto_voznje trip ON trip.id = entry.osobni_auto_voznja_id
    WHERE entry.nalog_id IS NULL
  ) entries (izvor, nalog_id, nalog_broj, gradiliste_naziv, datum, vrijeme_od, vrijeme_do, sati, napomena, nocni_sati, teren)
  WHERE (p_od IS NULL OR entries.datum >= p_od)
    AND (p_do IS NULL OR entries.datum <= p_do)
  ORDER BY entries.datum DESC, entries.nalog_broj;
$$;

REVOKE ALL ON FUNCTION public.report_my_personal_car_trip(uuid, uuid, date, integer, integer, uuid, time, time, text, time, time, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_my_personal_car_trip(uuid, uuid, date, integer, integer, uuid, time, time, text, time, time, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_radno_vrijeme(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_radno_vrijeme(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
