CREATE OR REPLACE FUNCTION public.app_mobile_editable_nalog(p_nalog_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.app_mobile_assigned_nalog(p_nalog_id)
    AND EXISTS (
      SELECT 1
      FROM public.radni_nalozi nalog
      WHERE nalog.id = p_nalog_id
        AND nalog.status NOT IN ('zavrsen', 'otkazan')
        AND nalog.mobile_status IN ('dodijeljen', 'u_tijeku', 'predan')
    );
$$;

CREATE OR REPLACE FUNCTION public.mobile_save_nalog_izvjestaj(
  p_nalog_id uuid,
  p_km_pocetak integer,
  p_km_kraj integer,
  p_km_na boolean,
  p_enc_stanje numeric,
  p_potvrde text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  allowed text[] := ARRAY[
    'poslovi', 'poslovi:na', 'dodatni', 'dodatni:na', 'foto', 'foto:na', 'materijal', 'materijal:na',
    'alat', 'alat:na', 'strojevi', 'strojevi:na', 'vrijeme', 'enc', 'enc:na', 'km_kraj', 'km_kraj:na'
  ];
  potvrde text[];
BEGIN
  IF NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan za uređivanje.';
  END IF;
  IF (p_km_pocetak IS NOT NULL AND p_km_pocetak < 0) OR (p_km_kraj IS NOT NULL AND p_km_kraj < 0) THEN
    RAISE EXCEPTION 'Kilometri moraju biti pozitivni brojevi.';
  END IF;
  IF p_enc_stanje IS NOT NULL AND p_enc_stanje < 0 THEN
    RAISE EXCEPTION 'Stanje ENC-a ne može biti negativno.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT item), ARRAY[]::text[])
  INTO potvrde
  FROM unnest(COALESCE(p_potvrde, ARRAY[]::text[])) AS item
  WHERE item = ANY(allowed);

  UPDATE public.radni_nalozi
  SET km_pocetak = CASE WHEN p_km_na THEN NULL ELSE p_km_pocetak END,
    km_kraj = CASE
      WHEN p_km_na OR 'km_kraj:na' = ANY(potvrde) THEN NULL
      ELSE p_km_kraj
    END,
    enc_stanje = p_enc_stanje,
    mobile_km_na = COALESCE(p_km_na, false),
    mobile_potvrde = potvrde,
    mobile_tasks_confirmed = potvrde && ARRAY['poslovi', 'poslovi:na'],
    mobile_foto_na = 'foto:na' = ANY(potvrde),
    mobile_materijal_na = 'materijal:na' = ANY(potvrde),
    mobile_alat_na = 'alat:na' = ANY(potvrde),
    mobile_status = CASE WHEN mobile_status = 'predan' THEN 'u_tijeku' ELSE mobile_status END,
    status = CASE WHEN mobile_status = 'predan' THEN 'u_tijeku' ELSE status END
  WHERE id = p_nalog_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mobile_start_nalog(p_nalog_id uuid, p_reviewed_sections text[])
RETURNS time
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  worker_id uuid := public.app_mobile_radnik_id();
  start_time time := timezone('Europe/Zagreb', now())::time;
  required_sections text[] := ARRAY['upute', 'zadaci', 'materijal', 'alat', 'dokumenti'];
BEGIN
  IF worker_id IS NULL OR NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan prijavljenom djelatniku.';
  END IF;
  IF NOT (COALESCE(p_reviewed_sections, ARRAY[]::text[]) @> required_sections) THEN
    RAISE EXCEPTION 'Prije početka potvrdi pregled svih dijelova naloga.';
  END IF;

  UPDATE public.radni_nalozi_radnici
  SET mobile_reviewed_sections = p_reviewed_sections,
      mobile_started_at = COALESCE(mobile_started_at, now()),
      vrijeme_od = COALESCE(vrijeme_od, start_time)
  WHERE nalog_id = p_nalog_id AND radnik_id = worker_id;

  UPDATE public.radni_nalozi
  SET mobile_status = 'u_tijeku', status = 'u_tijeku'
  WHERE id = p_nalog_id AND mobile_status IN ('dodijeljen', 'u_tijeku');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nalog više nije dostupan za početak rada.';
  END IF;

  RETURN start_time;
END;
$$;

CREATE OR REPLACE FUNCTION public.mobile_start_worker_time(
  p_nalog_id uuid,
  p_radnik_id uuid,
  p_reviewed_sections text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  start_time time := timezone('Europe/Zagreb', now())::time;
  required_sections text[] := ARRAY['upute', 'zadaci', 'materijal', 'alat', 'dokumenti'];
BEGIN
  IF NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan za uređivanje.';
  END IF;
  IF NOT (COALESCE(p_reviewed_sections, ARRAY[]::text[]) @> required_sections) THEN
    RAISE EXCEPTION 'Prije početka potvrdi pregled svih dijelova naloga.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND radnik_id = p_radnik_id
  ) THEN
    RAISE EXCEPTION 'Odabrani djelatnik nije dodijeljen ovom nalogu.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi
    WHERE id = p_nalog_id AND mobile_status IN ('dodijeljen', 'u_tijeku')
  ) THEN
    RAISE EXCEPTION 'Nalog više nije dostupan za početak rada.';
  END IF;

  UPDATE public.radni_nalozi_radnici
  SET mobile_reviewed_sections = p_reviewed_sections,
      mobile_started_at = COALESCE(mobile_started_at, now()),
      vrijeme_od = COALESCE(vrijeme_od, start_time)
  WHERE nalog_id = p_nalog_id AND radnik_id = p_radnik_id;

  UPDATE public.radni_nalozi
  SET mobile_status = 'u_tijeku', status = 'u_tijeku'
  WHERE id = p_nalog_id AND mobile_status IN ('dodijeljen', 'u_tijeku');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nalog više nije dostupan za početak rada.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mobile_save_worker_time(
  p_nalog_id uuid,
  p_radnik_id uuid,
  p_vrijeme_od time,
  p_vrijeme_do time,
  p_reviewed_sections text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan za uređivanje.';
  END IF;
  IF p_vrijeme_od IS NULL THEN
    RAISE EXCEPTION 'Unesi vrijeme početka rada.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND radnik_id = p_radnik_id
  ) THEN
    RAISE EXCEPTION 'Odabrani djelatnik nije dodijeljen ovom nalogu.';
  END IF;

  UPDATE public.radni_nalozi_radnici
  SET mobile_reviewed_sections = p_reviewed_sections,
      mobile_started_at = COALESCE(mobile_started_at, now()),
      mobile_finished_at = CASE
        WHEN p_vrijeme_do IS NULL THEN NULL
        ELSE COALESCE(mobile_finished_at, now())
      END,
      vrijeme_od = p_vrijeme_od,
      vrijeme_do = p_vrijeme_do
  WHERE nalog_id = p_nalog_id AND radnik_id = p_radnik_id;

  UPDATE public.radni_nalozi
  SET mobile_status = 'u_tijeku', status = 'u_tijeku'
  WHERE id = p_nalog_id AND mobile_status IN ('dodijeljen', 'u_tijeku', 'predan');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nalog više nije dostupan za unos radnog vremena.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mobile_finish_worker_time(p_nalog_id uuid, p_radnik_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  finish_time time := timezone('Europe/Zagreb', now())::time;
BEGIN
  IF NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan za uređivanje.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND radnik_id = p_radnik_id
  ) THEN
    RAISE EXCEPTION 'Odabrani djelatnik nije dodijeljen ovom nalogu.';
  END IF;

  UPDATE public.radni_nalozi_radnici
  SET mobile_finished_at = now(), vrijeme_do = finish_time
  WHERE nalog_id = p_nalog_id
    AND radnik_id = p_radnik_id
    AND mobile_started_at IS NOT NULL
    AND mobile_finished_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vrijeme za odabranog djelatnika nije započeto ili je već završeno.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.mobile_submit_nalog(p_nalog_id uuid, p_leader_confirmed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  nalog public.radni_nalozi%ROWTYPE;
  section record;
BEGIN
  IF NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan za uređivanje ili je ured već završno zaključio nalog.';
  END IF;
  IF p_leader_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'Potvrdi pregled vremena ekipe i završnog izvještaja.';
  END IF;

  SELECT * INTO nalog FROM public.radni_nalozi WHERE id = p_nalog_id;
  IF NOT FOUND OR nalog.mobile_status NOT IN ('u_tijeku', 'predan') THEN
    RAISE EXCEPTION 'Nalog nije spreman za predaju.';
  END IF;

  FOR section IN
    SELECT * FROM (VALUES
      ('poslovi', 'Poslovi'),
      ('foto', 'Fotografije'),
      ('materijal', 'Materijal'),
      ('alat', 'Alat'),
      ('strojevi', 'Strojevi')
    ) AS s(kljuc, naziv)
  LOOP
    IF NOT (section.kljuc = ANY(nalog.mobile_potvrde) OR (section.kljuc || ':na') = ANY(nalog.mobile_potvrde)) THEN
      RAISE EXCEPTION 'Potvrdi dio "%" ili označi da nije primjenjiv.', section.naziv;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.gradiliste_zadaci WHERE nalog_id = p_nalog_id AND vrsta = 'dodatni')
    AND NOT ('dodatni' = ANY(nalog.mobile_potvrde) OR 'dodatni:na' = ANY(nalog.mobile_potvrde)) THEN
    RAISE EXCEPTION 'Potvrdi dio "Dodatni radovi" ili označi da nije primjenjiv.';
  END IF;

  IF 'foto' = ANY(nalog.mobile_potvrde) AND NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi_foto WHERE nalog_id = p_nalog_id
  ) THEN
    RAISE EXCEPTION 'Dodaj barem jednu fotografiju ili označi da fotografija nije primjenjiva.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND (vrijeme_od IS NULL OR vrijeme_do IS NULL OR mobile_finished_at IS NULL)
  ) OR NOT ('vrijeme' = ANY(nalog.mobile_potvrde)) THEN
    RAISE EXCEPTION 'Potvrdi radno vrijeme cijele ekipe.';
  END IF;

  IF NOT (nalog.enc_stanje IS NOT NULL AND 'enc' = ANY(nalog.mobile_potvrde) OR 'enc:na' = ANY(nalog.mobile_potvrde)) THEN
    RAISE EXCEPTION 'Upiši i potvrdi stanje ENC-a ili označi da nije primjenjivo.';
  END IF;

  IF NOT (nalog.mobile_km_na OR 'km_kraj:na' = ANY(nalog.mobile_potvrde) OR (
    nalog.km_pocetak IS NOT NULL AND nalog.km_kraj IS NOT NULL
    AND nalog.km_kraj >= nalog.km_pocetak
    AND 'km_kraj' = ANY(nalog.mobile_potvrde)
  )) THEN
    RAISE EXCEPTION 'Upiši i potvrdi kilometre povratka (ne smiju biti manji od početnih) ili označi da nisu primjenjivi.';
  END IF;

  UPDATE public.radni_nalozi SET mobile_status = 'predan' WHERE id = p_nalog_id;
END;
$$;

REVOKE ALL ON FUNCTION public.app_mobile_editable_nalog(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_mobile_editable_nalog(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.mobile_save_nalog_izvjestaj(uuid, integer, integer, boolean, numeric, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_save_nalog_izvjestaj(uuid, integer, integer, boolean, numeric, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.mobile_start_nalog(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_start_nalog(uuid, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.mobile_start_worker_time(uuid, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_start_worker_time(uuid, uuid, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.mobile_save_worker_time(uuid, uuid, time, time, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_save_worker_time(uuid, uuid, time, time, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.mobile_finish_worker_time(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_finish_worker_time(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.mobile_submit_nalog(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_submit_nalog(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
