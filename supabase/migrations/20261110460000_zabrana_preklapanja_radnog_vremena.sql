CREATE OR REPLACE FUNCTION private.guard_worker_work_time_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  work_date date;
  conflicting_order text;
BEGIN
  IF NEW.radnik_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.radnik_id::text), hashtext('worker-work-time-overlap'));

  SELECT COALESCE(
    timezone('Europe/Zagreb', NEW.mobile_started_at)::date,
    nalog.rok,
    timezone('Europe/Zagreb', nalog.datum_kreiranja)::date
  )
  INTO work_date
  FROM public.radni_nalozi nalog
  WHERE nalog.id = NEW.nalog_id;

  IF work_date IS NULL THEN
    RETURN NEW;
  END IF;

  WITH incoming AS (
    SELECT
      work_date + NEW.vrijeme_od AS starts_at,
      work_date + NEW.vrijeme_do
        + CASE WHEN NEW.vrijeme_do <= NEW.vrijeme_od THEN interval '1 day' ELSE interval '0' END AS ends_at
    WHERE NOT COALESCE(NEW.mobile_zero_hours, false)
      AND NEW.vrijeme_od IS NOT NULL
      AND NEW.vrijeme_do IS NOT NULL
    UNION ALL
    SELECT
      work_date + (segment->>'vrijeme_od')::time,
      work_date + (segment->>'vrijeme_do')::time
        + CASE
            WHEN (segment->>'vrijeme_do')::time <= (segment->>'vrijeme_od')::time
              THEN interval '1 day'
            ELSE interval '0'
          END
    FROM jsonb_array_elements(COALESCE(NEW.mobile_extra_time, '[]'::jsonb)) AS segment
  ),
  existing AS (
    SELECT
      other_order.id AS nalog_id,
      other_order.broj AS nalog_broj,
      other_date.work_date + assignment.vrijeme_od AS starts_at,
      other_date.work_date + assignment.vrijeme_do
        + CASE WHEN assignment.vrijeme_do <= assignment.vrijeme_od THEN interval '1 day' ELSE interval '0' END AS ends_at
    FROM public.radni_nalozi_radnici assignment
    JOIN public.radni_nalozi other_order ON other_order.id = assignment.nalog_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        timezone('Europe/Zagreb', assignment.mobile_started_at)::date,
        other_order.rok,
        timezone('Europe/Zagreb', other_order.datum_kreiranja)::date
      ) AS work_date
    ) other_date
    WHERE assignment.radnik_id = NEW.radnik_id
      AND assignment.nalog_id <> NEW.nalog_id
      AND NOT COALESCE(assignment.mobile_zero_hours, false)
      AND assignment.vrijeme_od IS NOT NULL
      AND assignment.vrijeme_do IS NOT NULL
    UNION ALL
    SELECT
      other_order.id,
      other_order.broj,
      other_date.work_date + (segment->>'vrijeme_od')::time,
      other_date.work_date + (segment->>'vrijeme_do')::time
        + CASE
            WHEN (segment->>'vrijeme_do')::time <= (segment->>'vrijeme_od')::time
              THEN interval '1 day'
            ELSE interval '0'
          END
    FROM public.radni_nalozi_radnici assignment
    JOIN public.radni_nalozi other_order ON other_order.id = assignment.nalog_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        timezone('Europe/Zagreb', assignment.mobile_started_at)::date,
        other_order.rok,
        timezone('Europe/Zagreb', other_order.datum_kreiranja)::date
      ) AS work_date
    ) other_date
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(assignment.mobile_extra_time, '[]'::jsonb)) AS segment
    WHERE assignment.radnik_id = NEW.radnik_id
      AND assignment.nalog_id <> NEW.nalog_id
  )
  SELECT existing.nalog_broj
  INTO conflicting_order
  FROM incoming
  JOIN existing
    ON incoming.starts_at < existing.ends_at
    AND existing.starts_at < incoming.ends_at
  LIMIT 1;

  IF conflicting_order IS NOT NULL THEN
    RAISE EXCEPTION 'Djelatnik već ima radno vrijeme koje se preklapa s drugim nalogom (%).', conflicting_order
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_worker_work_time_overlap
  BEFORE INSERT OR UPDATE OF nalog_id, radnik_id, vrijeme_od, vrijeme_do,
    mobile_extra_time, mobile_zero_hours, mobile_started_at
  ON public.radni_nalozi_radnici
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_worker_work_time_overlap();

REVOKE ALL ON FUNCTION private.guard_worker_work_time_overlap() FROM PUBLIC, anon, authenticated;
