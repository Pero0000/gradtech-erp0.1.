ALTER TABLE public.radni_nalozi_radnici
  ADD COLUMN IF NOT EXISTS mobile_extra_time jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mobile_zero_hours boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.radni_nalozi_radnici'::regclass
      AND conname = 'radni_nalozi_radnici_mobile_extra_time_array'
  ) THEN
    ALTER TABLE public.radni_nalozi_radnici
      ADD CONSTRAINT radni_nalozi_radnici_mobile_extra_time_array
      CHECK (jsonb_typeof(mobile_extra_time) = 'array');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_mobile_nalog_time_entries(p_nalog_id uuid)
RETURNS TABLE (
  radnik_id uuid,
  dodatne_dionice jsonb,
  bez_sati_na_gradilistu boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_mobile_assigned_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dodijeljen prijavljenom djelatniku.';
  END IF;

  RETURN QUERY
  SELECT assignment.radnik_id, assignment.mobile_extra_time, assignment.mobile_zero_hours
  FROM public.radni_nalozi_radnici assignment
  WHERE assignment.nalog_id = p_nalog_id
  ORDER BY assignment.radnik_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mobile_save_nalog_time_entries(
  p_nalog_id uuid,
  p_dodatne_dionice jsonb,
  p_bez_sati_radnici uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  segment jsonb;
  start_time time;
  end_time time;
  worker_id uuid := public.app_mobile_radnik_id();
BEGIN
  IF worker_id IS NULL OR NOT public.app_mobile_assigned_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dodijeljen prijavljenom djelatniku.';
  END IF;
  IF jsonb_typeof(p_dodatne_dionice) <> 'array' OR p_dodatne_dionice IS NULL THEN
    RAISE EXCEPTION 'Dodatne dionice moraju biti unesene kao popis.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi
    WHERE id = p_nalog_id AND mobile_status IN ('dodijeljen', 'u_tijeku')
  ) THEN
    RAISE EXCEPTION 'Nalog više nije dostupan za unos radnog vremena.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.radni_nalozi
    WHERE id = p_nalog_id
      AND mobile_potvrde @> ARRAY['vrijeme']::text[]
  ) THEN
    RAISE EXCEPTION 'Potvrđeno radno vrijeme nije moguće naknadno mijenjati.';
  END IF;
  IF cardinality(COALESCE(p_bez_sati_radnici, ARRAY[]::uuid[]))
    <> cardinality(ARRAY(SELECT DISTINCT unnest(COALESCE(p_bez_sati_radnici, ARRAY[]::uuid[])))) THEN
    RAISE EXCEPTION 'Popis djelatnika s 0 sati sadrži duplikate.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_bez_sati_radnici, ARRAY[]::uuid[])) selected(radnik_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.radni_nalozi_radnici assignment
      WHERE assignment.nalog_id = p_nalog_id AND assignment.radnik_id = selected.radnik_id
    )
  ) THEN
    RAISE EXCEPTION 'Odabrani djelatnik nije dodijeljen ovom nalogu.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_dodatne_dionice) AS item(segment)
    WHERE jsonb_typeof(item.segment) <> 'object'
      OR COALESCE(item.segment->>'id', '') = ''
      OR COALESCE(item.segment->>'grupa_id', '') = ''
      OR COALESCE(item.segment->>'radnik_id', '') = ''
      OR COALESCE(item.segment->>'vrijeme_od', '') = ''
      OR COALESCE(item.segment->>'vrijeme_do', '') = ''
  ) THEN
    RAISE EXCEPTION 'Svaka dodatna dionica mora imati ID, djelatnika te početak i završetak.';
  END IF;

  IF (
    SELECT count(*) <> count(DISTINCT item.segment->>'id')
    FROM jsonb_array_elements(p_dodatne_dionice) AS item(segment)
  ) THEN
    RAISE EXCEPTION 'Unosi dodatnog vremena moraju imati jedinstvene ID-eve.';
  END IF;

  FOR segment IN SELECT value FROM jsonb_array_elements(p_dodatne_dionice)
  LOOP
    start_time := (segment->>'vrijeme_od')::time;
    end_time := (segment->>'vrijeme_do')::time;
    IF start_time = end_time THEN
      RAISE EXCEPTION 'Početak i završetak dodatne dionice ne mogu biti jednaki.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.radni_nalozi_radnici assignment
      WHERE assignment.nalog_id = p_nalog_id
        AND assignment.radnik_id = (segment->>'radnik_id')::uuid
    ) THEN
      RAISE EXCEPTION 'Djelatnik izvan ekipe ne može biti odabran za dodatnu dionicu.';
    END IF;
  END LOOP;

  IF EXISTS (
    WITH intervals AS (
      SELECT
        item.segment->>'id' AS segment_key,
        (item.segment->>'radnik_id')::uuid AS radnik_id,
        (extract(epoch FROM (item.segment->>'vrijeme_od')::time) / 60)::integer AS starts_at,
        (extract(epoch FROM (item.segment->>'vrijeme_do')::time) / 60)::integer
          + CASE WHEN (item.segment->>'vrijeme_do')::time <= (item.segment->>'vrijeme_od')::time THEN 1440 ELSE 0 END AS ends_at
      FROM jsonb_array_elements(p_dodatne_dionice) AS item(segment)
      UNION ALL
      SELECT
        'base:' || assignment.radnik_id::text,
        assignment.radnik_id,
        (extract(epoch FROM assignment.vrijeme_od) / 60)::integer,
        (extract(epoch FROM assignment.vrijeme_do) / 60)::integer
          + CASE WHEN assignment.vrijeme_do <= assignment.vrijeme_od THEN 1440 ELSE 0 END
      FROM public.radni_nalozi_radnici assignment
      WHERE assignment.nalog_id = p_nalog_id
        AND NOT assignment.radnik_id = ANY(COALESCE(p_bez_sati_radnici, ARRAY[]::uuid[]))
        AND assignment.vrijeme_od IS NOT NULL
        AND assignment.vrijeme_do IS NOT NULL
    )
    SELECT 1 FROM intervals a
    JOIN intervals b ON b.radnik_id = a.radnik_id AND b.segment_key > a.segment_key
    CROSS JOIN generate_series(-1440, 1440, 1440) AS shift(minutes)
    WHERE a.starts_at < b.ends_at + shift.minutes
      AND b.starts_at + shift.minutes < a.ends_at
  ) THEN
    RAISE EXCEPTION 'Dodatne vremenske dionice istog djelatnika ne smiju se preklapati.';
  END IF;

  UPDATE public.radni_nalozi_radnici assignment
  SET mobile_extra_time = COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', item.segment->>'id',
          'grupa_id', item.segment->>'grupa_id',
          'vrijeme_od', item.segment->>'vrijeme_od',
          'vrijeme_do', item.segment->>'vrijeme_do',
          'napomena', NULLIF(btrim(COALESCE(item.segment->>'napomena', '')), '')
        ) ORDER BY item.ordinality)
        FROM jsonb_array_elements(p_dodatne_dionice) WITH ORDINALITY AS item(segment, ordinality)
        WHERE (item.segment->>'radnik_id')::uuid = assignment.radnik_id
      ), '[]'::jsonb),
      mobile_zero_hours = assignment.radnik_id = ANY(COALESCE(p_bez_sati_radnici, ARRAY[]::uuid[])),
      vrijeme_od = CASE
        WHEN assignment.radnik_id = ANY(COALESCE(p_bez_sati_radnici, ARRAY[]::uuid[])) THEN NULL
        ELSE assignment.vrijeme_od
      END,
      vrijeme_do = CASE
        WHEN assignment.radnik_id = ANY(COALESCE(p_bez_sati_radnici, ARRAY[]::uuid[])) THEN NULL
        ELSE assignment.vrijeme_do
      END,
      mobile_started_at = CASE
        WHEN assignment.radnik_id = ANY(COALESCE(p_bez_sati_radnici, ARRAY[]::uuid[])) THEN NULL
        ELSE assignment.mobile_started_at
      END,
      mobile_finished_at = CASE
        WHEN assignment.radnik_id = ANY(COALESCE(p_bez_sati_radnici, ARRAY[]::uuid[])) THEN NULL
        ELSE assignment.mobile_finished_at
      END
  WHERE assignment.nalog_id = p_nalog_id;

  UPDATE public.radni_nalozi
  SET mobile_status = 'u_tijeku', status = 'u_tijeku'
  WHERE id = p_nalog_id AND mobile_status IN ('dodijeljen', 'u_tijeku');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nalog više nije dostupan za unos radnog vremena.';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.mobile_submit_nalog(uuid, boolean);

CREATE FUNCTION public.mobile_submit_nalog(p_nalog_id uuid, p_leader_confirmed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_mobile_leads_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Samo dodijeljeni poslovođa može predati nalog.';
  END IF;
  IF p_leader_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'Poslovođa mora potvrditi pregled vremena ekipe i završnog izvještaja.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id
      AND NOT mobile_zero_hours
      AND (mobile_started_at IS NULL OR mobile_finished_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'Svi djelatnici moraju imati evidentiran početak i završetak osnovne smjene ili biti označeni s 0 sati.';
  END IF;

  PERFORM 1 FROM public.radni_nalozi nalog
  WHERE nalog.id = p_nalog_id
    AND nalog.mobile_status = 'u_tijeku'
    AND (nalog.mobile_km_na OR (nalog.km_pocetak IS NOT NULL AND nalog.km_kraj IS NOT NULL AND nalog.km_kraj >= nalog.km_pocetak))
    AND (nalog.mobile_napomena_na OR NULLIF(btrim(COALESCE(nalog.napomena, '')), '') IS NOT NULL)
    AND nalog.mobile_tasks_confirmed
    AND (nalog.mobile_foto_na OR EXISTS (
      SELECT 1
      FROM public.radni_nalozi_foto photo
      JOIN public.radni_nalozi_radnici leader
        ON leader.nalog_id = photo.nalog_id
        AND leader.radnik_id = nalog.poslovodja_id
      WHERE photo.nalog_id = p_nalog_id
        AND photo.created_at >= leader.mobile_started_at
    ))
    AND (nalog.mobile_materijal_na OR EXISTS (
      SELECT 1 FROM public.radni_nalozi_stavke WHERE nalog_id = p_nalog_id AND tip = 'materijal'
    ))
    AND (nalog.mobile_alat_na OR EXISTS (
      SELECT 1 FROM public.radni_nalozi_stavke WHERE nalog_id = p_nalog_id AND tip = 'alat'
    ));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nedostaju obavezni podaci. Provjeri vrijeme ekipe, kilometre, napomenu, zadatke, fotografije, materijal i alat.';
  END IF;

  UPDATE public.radni_nalozi SET mobile_status = 'predan' WHERE id = p_nalog_id;
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT public.app_mobile_radnik_id() AS radnik_id
    WHERE public.get_my_portal_vrijeme()
  )
  SELECT * FROM (
    SELECT
      'nalog'::text,
      nalog.id,
      nalog.broj,
      site.naziv,
      COALESCE(timezone('Europe/Zagreb', assignment.mobile_started_at)::date, nalog.rok, nalog.datum_kreiranja),
      assignment.vrijeme_od,
      assignment.vrijeme_do,
      CASE
        WHEN assignment.vrijeme_od IS NOT NULL AND assignment.vrijeme_do IS NOT NULL
          THEN round((((extract(epoch FROM (assignment.vrijeme_do - assignment.vrijeme_od)) + 86400)::numeric % 86400) / 3600.0), 1)
        ELSE NULL
      END,
      NULL::text,
      COALESCE((
        SELECT sum(entry.nocni_sati) FROM public.radno_vrijeme entry
        WHERE entry.nalog_id = nalog.id AND entry.radnik_id = me.radnik_id
      ), 0),
      COALESCE(nalog.teren, false)
    FROM me
    JOIN public.radni_nalozi_radnici assignment ON assignment.radnik_id = me.radnik_id
    JOIN public.radni_nalozi nalog ON nalog.id = assignment.nalog_id
    LEFT JOIN public.gradilista site ON site.id = nalog.gradiliste_id
    WHERE NOT assignment.mobile_zero_hours
      AND (assignment.vrijeme_od IS NOT NULL OR assignment.mobile_started_at IS NOT NULL)
    UNION ALL
    SELECT
      'dionica'::text,
      nalog.id,
      nalog.broj,
      site.naziv,
      COALESCE(timezone('Europe/Zagreb', assignment.mobile_started_at)::date, nalog.rok, nalog.datum_kreiranja),
      (segment->>'vrijeme_od')::time,
      (segment->>'vrijeme_do')::time,
      NULL::numeric,
      NULLIF(segment->>'napomena', ''),
      0::numeric,
      COALESCE(nalog.teren, false)
    FROM me
    JOIN public.radni_nalozi_radnici assignment ON assignment.radnik_id = me.radnik_id
    JOIN public.radni_nalozi nalog ON nalog.id = assignment.nalog_id
    LEFT JOIN public.gradilista site ON site.id = nalog.gradiliste_id
    CROSS JOIN LATERAL jsonb_array_elements(assignment.mobile_extra_time) segment
    UNION ALL
    SELECT
      'evidencija'::text,
      entry.nalog_id,
      nalog.broj,
      site.naziv,
      entry.datum,
      NULL::time,
      NULL::time,
      entry.sati,
      entry.napomena,
      entry.nocni_sati,
      false
    FROM me
    JOIN public.radno_vrijeme entry ON entry.radnik_id = me.radnik_id
    LEFT JOIN public.radni_nalozi nalog ON nalog.id = entry.nalog_id
    LEFT JOIN public.gradilista site ON site.id = entry.gradiliste_id
    WHERE entry.nalog_id IS NULL
  ) entries (izvor, nalog_id, nalog_broj, gradiliste_naziv, datum, vrijeme_od, vrijeme_do, sati, napomena, nocni_sati, teren)
  WHERE (p_od IS NULL OR entries.datum >= p_od)
    AND (p_do IS NULL OR entries.datum <= p_do)
  ORDER BY entries.datum DESC, entries.nalog_broj;
$$;

REVOKE ALL ON FUNCTION public.get_mobile_nalog_time_entries(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mobile_save_nalog_time_entries(uuid, jsonb, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mobile_submit_nalog(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_radno_vrijeme(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_nalog_time_entries(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_save_nalog_time_entries(uuid, jsonb, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mobile_submit_nalog(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_radno_vrijeme(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
