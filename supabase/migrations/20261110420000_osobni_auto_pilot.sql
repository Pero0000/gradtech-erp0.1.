BEGIN;

CREATE TABLE private.osobni_auto_pilot (
  radnik_id uuid PRIMARY KEY REFERENCES public.radnici(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.tvrtke(id) ON DELETE RESTRICT,
  zadnje_vozilo_id uuid REFERENCES public.vozila(id) ON DELETE RESTRICT
);
ALTER TABLE private.osobni_auto_pilot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.osobni_auto_pilot FROM PUBLIC, anon, authenticated;

-- Resolve the pilot once; subsequent authorization uses the stored ID, never a display name.
DO $$
DECLARE workers uuid[];
BEGIN
  SELECT array_agg(worker.id) INTO workers FROM public.radnici worker
  WHERE lower(btrim(worker.ime)) = 'ivan' AND lower(btrim(worker.prezime)) = 'perićak'
    AND worker.status = 'aktivan'
    AND EXISTS (
      SELECT 1 FROM public.app_profiles profile
      WHERE profile.radnik_id = worker.id AND profile.company_id = worker.company_id AND profile.approved
    );
  IF COALESCE(cardinality(workers), 0) <> 1 THEN
    RAISE EXCEPTION 'Pilot osobnog auta zahtijeva točno jednog aktivnog djelatnika Ivan Perićak s odobrenim povezanim računom. Provjerite djelatnika prije primjene migracije.';
  END IF;
  INSERT INTO private.osobni_auto_pilot(radnik_id, company_id)
    SELECT id, company_id FROM public.radnici WHERE id = workers[1];
END;
$$;

CREATE FUNCTION public.has_my_personal_car()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.osobni_auto_pilot pilot
    JOIN public.radnici worker ON worker.id = pilot.radnik_id AND worker.company_id = pilot.company_id
    JOIN public.app_profiles profile ON profile.radnik_id = worker.id AND profile.company_id = worker.company_id
    WHERE profile.id = auth.uid() AND profile.approved AND worker.status = 'aktivan'
      AND pilot.company_id = public.app_current_company_id()
  );
$$;

CREATE TABLE public.osobni_auto_voznje (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.tvrtke(id) ON DELETE RESTRICT,
  radnik_id uuid NOT NULL REFERENCES public.radnici(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  vozilo_id uuid NOT NULL REFERENCES public.vozila(id) ON DELETE RESTRICT,
  vozilo_naziv text NOT NULL,
  datum date NOT NULL,
  km_pocetak integer NOT NULL CHECK (km_pocetak >= 0),
  km_kraj integer NOT NULL CHECK (km_kraj > km_pocetak),
  kilometri integer GENERATED ALWAYS AS (km_kraj - km_pocetak) STORED,
  gradiliste_id uuid REFERENCES public.gradilista(id) ON DELETE RESTRICT,
  gradiliste_naziv text,
  cijena_km numeric NOT NULL CHECK (cijena_km >= 0),
  iznos numeric(12,2) NOT NULL CHECK (iznos >= 0),
  trosak_id uuid UNIQUE REFERENCES public.troskovi(id) ON DELETE RESTRICT,
  vrijeme_od time,
  vrijeme_do time,
  napomena text NOT NULL DEFAULT '' CHECK (length(napomena) <= 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  stornirano_at timestamptz,
  stornirao uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  razlog_storna text,
  CHECK ((gradiliste_id IS NULL AND gradiliste_naziv IS NULL AND trosak_id IS NULL AND iznos = 0)
    OR (gradiliste_id IS NOT NULL AND gradiliste_naziv IS NOT NULL AND trosak_id IS NOT NULL AND cijena_km > 0)),
  CHECK ((vrijeme_od IS NULL) = (vrijeme_do IS NULL)),
  CHECK ((stornirano_at IS NULL AND stornirao IS NULL AND razlog_storna IS NULL)
    OR (stornirano_at IS NOT NULL AND stornirao IS NOT NULL AND length(btrim(razlog_storna)) BETWEEN 1 AND 500))
);
CREATE INDEX osobni_auto_voznje_worker ON public.osobni_auto_voznje(company_id, radnik_id, created_at DESC, id DESC);
CREATE INDEX osobni_auto_voznje_vehicle ON public.osobni_auto_voznje(vozilo_id) WHERE stornirano_at IS NULL;
ALTER TABLE public.osobni_auto_voznje ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.osobni_auto_voznje FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.osobni_auto_voznje TO authenticated;
CREATE POLICY own_personal_car_trips ON public.osobni_auto_voznje FOR SELECT TO authenticated
  USING (company_id = public.app_current_company_id() AND public.has_my_personal_car()
    AND radnik_id = (SELECT profile.radnik_id FROM public.app_profiles profile WHERE profile.id = auth.uid()));

CREATE FUNCTION public.get_my_personal_car_options()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_my_personal_car() THEN
    RAISE EXCEPTION 'Osobni auto nije uključen za vaš račun.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'zadnje_vozilo_id', (SELECT pilot.zadnje_vozilo_id FROM private.osobni_auto_pilot pilot
      JOIN public.app_profiles profile ON profile.radnik_id = pilot.radnik_id
      WHERE profile.id = auth.uid() AND pilot.company_id = public.app_current_company_id()),
    'vozila', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', vehicle.id, 'naziv', concat_ws(' ', vehicle.marka, vehicle.model) || ' · ' || vehicle.registracija,
      'kilometraza', vehicle.kilometraza, 'cijena_km', vehicle.cijena_km
    ) ORDER BY vehicle.marka, vehicle.registracija) FROM public.vozila vehicle
      WHERE vehicle.company_id = public.app_current_company_id() AND vehicle.status NOT IN ('servis', 'neispravno')), '[]'::jsonb),
    'gradilista', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', site.id, 'naziv', site.naziv) ORDER BY site.naziv)
      FROM public.gradilista site WHERE site.company_id = public.app_current_company_id()
        AND site.status <> 'zavrseno'), '[]'::jsonb)
  );
END;
$$;

CREATE FUNCTION public.report_my_personal_car_trip(
  p_id uuid, p_vozilo_id uuid, p_datum date, p_km_pocetak integer, p_km_kraj integer,
  p_gradiliste_id uuid DEFAULT NULL, p_vrijeme_od time DEFAULT NULL, p_vrijeme_do time DEFAULT NULL,
  p_napomena text DEFAULT ''
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
BEGIN
  IF NOT public.has_my_personal_car() THEN
    RAISE EXCEPTION 'Osobni auto nije uključen za vaš račun.' USING ERRCODE = '42501';
  END IF;
  SELECT pilot.radnik_id INTO worker_id FROM private.osobni_auto_pilot pilot
    JOIN public.app_profiles profile ON profile.radnik_id = pilot.radnik_id
    WHERE profile.id = auth.uid() AND pilot.company_id = company FOR UPDATE OF pilot;
  IF p_id IS NULL THEN RAISE EXCEPTION 'Nedostaje oznaka prijave vožnje.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO existing FROM public.osobni_auto_voznje WHERE id = p_id;
  IF FOUND THEN
    IF existing.company_id = company AND existing.radnik_id = worker_id AND existing.created_by = auth.uid()
      AND ROW(existing.vozilo_id, existing.datum, existing.km_pocetak, existing.km_kraj,
        existing.gradiliste_id, existing.vrijeme_od, existing.vrijeme_do, existing.napomena)
      IS NOT DISTINCT FROM ROW(p_vozilo_id, p_datum, p_km_pocetak, p_km_kraj,
        p_gradiliste_id, p_vrijeme_od, p_vrijeme_do, btrim(COALESCE(p_napomena, ''))) THEN
      RETURN existing.id;
    END IF;
    RAISE EXCEPTION 'Oznaka prijave već je iskorištena za drugu vožnju.' USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL OR p_datum > CURRENT_DATE OR p_km_pocetak IS NULL OR p_km_pocetak < 0
    OR p_km_kraj IS NULL OR p_km_kraj <= p_km_pocetak
    OR (p_vrijeme_od IS NULL) <> (p_vrijeme_do IS NULL)
    OR length(COALESCE(p_napomena, '')) > 1000 THEN
    RAISE EXCEPTION 'Unesite datum do danas, početne i veće završne kilometre te oba vremena ili nijedno. Napomena može imati do 1000 znakova.'
      USING ERRCODE = '22023';
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
    datum, km_pocetak, km_kraj, gradiliste_id, gradiliste_naziv, cijena_km, iznos, trosak_id, vrijeme_od, vrijeme_do, napomena)
  VALUES (p_id, company, worker_id, auth.uid(), vehicle.id, vehicle_name, p_datum, p_km_pocetak, p_km_kraj,
    p_gradiliste_id, site_name, GREATEST(rate, 0), amount, cost_id, p_vrijeme_od, p_vrijeme_do, btrim(COALESCE(p_napomena, '')));
  IF NOT EXISTS (SELECT 1 FROM public.osobni_auto_voznje trip WHERE trip.id = p_id
    AND ROW(trip.company_id, trip.radnik_id, trip.created_by, trip.vozilo_id, trip.datum,
      trip.km_pocetak, trip.km_kraj, trip.gradiliste_id, trip.cijena_km, trip.iznos, trip.trosak_id,
      trip.vrijeme_od, trip.vrijeme_do, trip.napomena)
    IS NOT DISTINCT FROM ROW(company, worker_id, auth.uid(), vehicle.id, p_datum,
      p_km_pocetak, p_km_kraj, p_gradiliste_id, GREATEST(rate, 0), amount, cost_id,
      p_vrijeme_od, p_vrijeme_do, btrim(COALESCE(p_napomena, '')))) THEN
    RAISE EXCEPTION 'Zapis vožnje nije točno spremljen. Ništa nije prijavljeno.';
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

CREATE FUNCTION public.remember_my_personal_car_vehicle(p_vozilo_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_my_personal_car() THEN
    RAISE EXCEPTION 'Osobni auto nije uključen za vaš račun.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vozila WHERE id = p_vozilo_id
    AND company_id = public.app_current_company_id() AND status NOT IN ('servis', 'neispravno')) THEN
    RAISE EXCEPTION 'Odabrano vozilo nije dostupno u vašoj tvrtki.' USING ERRCODE = '42501';
  END IF;
  UPDATE private.osobni_auto_pilot pilot SET zadnje_vozilo_id = p_vozilo_id
    FROM public.app_profiles profile WHERE profile.id = auth.uid()
      AND profile.radnik_id = pilot.radnik_id AND pilot.company_id = public.app_current_company_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Odabir auta nije spremljen.'; END IF;
END;
$$;

CREATE FUNCTION public.get_my_personal_car_trips(p_before_time timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL)
RETURNS SETOF public.osobni_auto_voznje
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_my_personal_car() THEN
    RAISE EXCEPTION 'Osobni auto nije uključen za vaš račun.' USING ERRCODE = '42501';
  END IF;
  IF (p_before_time IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'Nepotpun pokazivač povijesti vožnji.' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT trip.* FROM public.osobni_auto_voznje trip
    WHERE trip.company_id = public.app_current_company_id()
      AND trip.radnik_id = (SELECT radnik_id FROM public.app_profiles WHERE id = auth.uid())
      AND (p_before_time IS NULL OR (trip.created_at, trip.id) < (p_before_time, p_before_id))
    ORDER BY trip.created_at DESC, trip.id DESC LIMIT 30;
END;
$$;

CREATE FUNCTION private.guard_personal_car_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE trip public.osobni_auto_voznje%ROWTYPE;
BEGIN
  SELECT * INTO trip FROM public.osobni_auto_voznje WHERE trosak_id = OLD.id;
  IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(OLD) - ARRAY['placen', 'placeno_at', 'updated_at', 'iznos'])
      IS NOT DISTINCT FROM (to_jsonb(NEW) - ARRAY['placen', 'placeno_at', 'updated_at', 'iznos'])
      AND NEW.iznos = (CASE WHEN trip.stornirano_at IS NULL THEN trip.iznos ELSE 0 END) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Trošak je vezan uz prijavu vožnje. Ispravak napravite storniranjem vožnje u portalu.' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER aaa_guard_personal_car_cost BEFORE UPDATE OR DELETE ON public.troskovi
  FOR EACH ROW EXECUTE FUNCTION private.guard_personal_car_cost();

CREATE FUNCTION public.cancel_my_personal_car_trip(p_id uuid, p_razlog text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE trip public.osobni_auto_voznje%ROWTYPE;
BEGIN
  IF NOT public.has_my_personal_car() THEN
    RAISE EXCEPTION 'Osobni auto nije uključen za vaš račun.' USING ERRCODE = '42501';
  END IF;
  IF p_razlog IS NULL OR length(btrim(p_razlog)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Upišite razlog storna (do 500 znakova).' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM private.osobni_auto_pilot pilot JOIN public.app_profiles profile ON profile.radnik_id = pilot.radnik_id
    WHERE profile.id = auth.uid() AND pilot.company_id = public.app_current_company_id() FOR UPDATE OF pilot;
  SELECT * INTO trip FROM public.osobni_auto_voznje entry
    WHERE entry.id = p_id AND entry.company_id = public.app_current_company_id()
      AND entry.radnik_id = (SELECT radnik_id FROM public.app_profiles WHERE id = auth.uid()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vožnja nije dostupna vašem računu.' USING ERRCODE = '42501'; END IF;
  IF trip.stornirano_at IS NOT NULL THEN RETURN; END IF;
  IF trip.trosak_id IS NOT NULL THEN
    PERFORM 1 FROM public.troskovi WHERE id = trip.trosak_id AND company_id = trip.company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Nedostaje povezani trošak. Storno nije proveden.'; END IF;
    IF EXISTS (SELECT 1 FROM public.troskovi WHERE id = trip.trosak_id AND placen) THEN
      RAISE EXCEPTION 'Trošak vožnje je već plaćen. Ured treba prvo riješiti plaćanje.' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.osobni_auto_voznje SET stornirano_at = clock_timestamp(), stornirao = auth.uid(), razlog_storna = btrim(p_razlog)
    WHERE id = trip.id;
  IF NOT EXISTS (SELECT 1 FROM public.osobni_auto_voznje WHERE id = trip.id
    AND stornirano_at IS NOT NULL AND stornirao = auth.uid() AND razlog_storna = btrim(p_razlog)) THEN
    RAISE EXCEPTION 'Storno vožnje nije spremljen. Ništa nije promijenjeno.';
  END IF;
  IF trip.trosak_id IS NOT NULL THEN
    UPDATE public.troskovi SET iznos = 0 WHERE id = trip.trosak_id;
    IF NOT EXISTS (SELECT 1 FROM public.troskovi WHERE id = trip.trosak_id AND iznos = 0) THEN
      RAISE EXCEPTION 'Trošak nije storniran. Ništa nije promijenjeno.';
    END IF;
  END IF;
  -- Odometer readings never decrease on cancellation; the original trip stays in history.
END;
$$;

REVOKE ALL ON FUNCTION private.guard_personal_car_cost() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_my_personal_car(), public.get_my_personal_car_options(),
  public.get_my_personal_car_trips(timestamptz,uuid),
  public.remember_my_personal_car_vehicle(uuid),
  public.report_my_personal_car_trip(uuid,uuid,date,integer,integer,uuid,time,time,text),
  public.cancel_my_personal_car_trip(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_my_personal_car(), public.get_my_personal_car_options(),
  public.get_my_personal_car_trips(timestamptz,uuid),
  public.remember_my_personal_car_vehicle(uuid),
  public.report_my_personal_car_trip(uuid,uuid,date,integer,integer,uuid,time,time,text),
  public.cancel_my_personal_car_trip(uuid,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
