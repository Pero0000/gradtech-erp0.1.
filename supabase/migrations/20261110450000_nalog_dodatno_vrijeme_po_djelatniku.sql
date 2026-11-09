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
    SELECT 1 FROM public.radni_nalozi
    WHERE id = p_nalog_id AND mobile_potvrde @> ARRAY['vrijeme']::text[]
  ) THEN
    RAISE EXCEPTION 'Potvrđeno radno vrijeme nije moguće naknadno mijenjati.';
  END IF;
  IF cardinality(COALESCE(p_bez_sati_radnici, ARRAY[]::uuid[]))
    <> cardinality(ARRAY(SELECT DISTINCT unnest(COALESCE(p_bez_sati_radnici, ARRAY[]::uuid[])))) THEN
    RAISE EXCEPTION 'Popis djelatnika s 0 sati sadrži duplikate.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_bez_sati_radnici, ARRAY[]::uuid[])) selected(radnik_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.radni_nalozi_radnici assignment
      WHERE assignment.nalog_id = p_nalog_id AND assignment.radnik_id = selected.radnik_id
    )
  ) THEN
    RAISE EXCEPTION 'Odabrani djelatnik nije dodijeljen ovom nalogu.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_dodatne_dionice) AS item(segment)
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

REVOKE ALL ON FUNCTION public.mobile_save_nalog_time_entries(uuid, jsonb, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_save_nalog_time_entries(uuid, jsonb, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
