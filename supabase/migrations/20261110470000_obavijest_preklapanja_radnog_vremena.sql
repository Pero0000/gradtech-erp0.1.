CREATE OR REPLACE FUNCTION private.guard_worker_work_time_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  work_date date;
  conflicting_order text;
  conflicting_date date;
  conflicting_start time;
  conflicting_end time;
  conflicting_end_date date;
  worker_name text;
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
  SELECT existing.nalog_broj, existing.starts_at::date, existing.starts_at::time,
    existing.ends_at::date, existing.ends_at::time
  INTO conflicting_order, conflicting_date, conflicting_start, conflicting_end_date, conflicting_end
  FROM incoming
  JOIN existing
    ON incoming.starts_at < existing.ends_at
    AND existing.starts_at < incoming.ends_at
  LIMIT 1;

  IF conflicting_order IS NOT NULL THEN
    SELECT concat_ws(' ', ime, prezime)
    INTO worker_name
    FROM public.radnici
    WHERE id = NEW.radnik_id;

    RAISE EXCEPTION
      'Potvrda nije spremljena: djelatnik % već ima evidentirano vrijeme na nalogu % dana % od % do %. Provjeri taj nalog i uskladi sate.',
      COALESCE(NULLIF(worker_name, ''), NEW.radnik_id::text),
      COALESCE(conflicting_order, 'bez broja'),
      to_char(conflicting_date, 'DD.MM.YYYY'),
      to_char(conflicting_start, 'HH24:MI'),
      to_char(conflicting_end, 'HH24:MI')
      || CASE WHEN conflicting_end_date > conflicting_date THEN ' sljedeći dan' ELSE '' END
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
