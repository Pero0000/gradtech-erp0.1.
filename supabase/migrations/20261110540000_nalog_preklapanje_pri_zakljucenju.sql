CREATE OR REPLACE FUNCTION private.guard_work_order_close_time_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  worker_id uuid;
  conflicting_order text;
  conflicting_site text;
  conflicting_date date;
  conflicting_start time;
  conflicting_end time;
  conflicting_end_date date;
  worker_name text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'zavrsen' OR OLD.status = 'zavrsen' THEN
    RETURN NEW;
  END IF;

  FOR worker_id IN
    SELECT DISTINCT assignment.radnik_id
    FROM public.radni_nalozi_radnici assignment
    WHERE assignment.nalog_id = NEW.id
      AND assignment.radnik_id IS NOT NULL
    ORDER BY assignment.radnik_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(worker_id::text), hashtext('worker-work-time-overlap'));

    WITH incoming AS (
      SELECT
        incoming_date.work_date + assignment.vrijeme_od AS starts_at,
        incoming_date.work_date + assignment.vrijeme_do
          + CASE WHEN assignment.vrijeme_do <= assignment.vrijeme_od THEN interval '1 day' ELSE interval '0' END AS ends_at
      FROM public.radni_nalozi_radnici assignment
      CROSS JOIN LATERAL (
        SELECT COALESCE(
          timezone('Europe/Zagreb', assignment.mobile_started_at)::date,
          NEW.rok,
          timezone('Europe/Zagreb', NEW.datum_kreiranja)::date
        ) AS work_date
      ) incoming_date
      WHERE assignment.nalog_id = NEW.id
        AND assignment.radnik_id = worker_id
        AND NOT COALESCE(assignment.mobile_zero_hours, false)
        AND assignment.vrijeme_od IS NOT NULL
        AND assignment.vrijeme_do IS NOT NULL
      UNION ALL
      SELECT
        incoming_date.work_date + (segment->>'vrijeme_od')::time,
        incoming_date.work_date + (segment->>'vrijeme_do')::time
          + CASE
              WHEN (segment->>'vrijeme_do')::time <= (segment->>'vrijeme_od')::time
                THEN interval '1 day'
              ELSE interval '0'
            END
      FROM public.radni_nalozi_radnici assignment
      CROSS JOIN LATERAL (
        SELECT COALESCE(
          timezone('Europe/Zagreb', assignment.mobile_started_at)::date,
          NEW.rok,
          timezone('Europe/Zagreb', NEW.datum_kreiranja)::date
        ) AS work_date
      ) incoming_date
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(assignment.mobile_extra_time, '[]'::jsonb)) AS segment
      WHERE assignment.nalog_id = NEW.id
        AND assignment.radnik_id = worker_id
    ),
    existing AS (
      SELECT
        other_order.broj AS nalog_broj,
        site.naziv AS gradiliste_naziv,
        other_date.work_date + assignment.vrijeme_od AS starts_at,
        other_date.work_date + assignment.vrijeme_do
          + CASE WHEN assignment.vrijeme_do <= assignment.vrijeme_od THEN interval '1 day' ELSE interval '0' END AS ends_at
      FROM public.radni_nalozi_radnici assignment
      JOIN public.radni_nalozi other_order ON other_order.id = assignment.nalog_id
      LEFT JOIN public.gradilista site ON site.id = other_order.gradiliste_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(
          timezone('Europe/Zagreb', assignment.mobile_started_at)::date,
          other_order.rok,
          timezone('Europe/Zagreb', other_order.datum_kreiranja)::date
        ) AS work_date
      ) other_date
      WHERE assignment.radnik_id = worker_id
        AND assignment.nalog_id <> NEW.id
        AND NOT COALESCE(assignment.mobile_zero_hours, false)
        AND assignment.vrijeme_od IS NOT NULL
        AND assignment.vrijeme_do IS NOT NULL
      UNION ALL
      SELECT
        other_order.broj,
        site.naziv,
        other_date.work_date + (segment->>'vrijeme_od')::time,
        other_date.work_date + (segment->>'vrijeme_do')::time
          + CASE
              WHEN (segment->>'vrijeme_do')::time <= (segment->>'vrijeme_od')::time
                THEN interval '1 day'
              ELSE interval '0'
            END
      FROM public.radni_nalozi_radnici assignment
      JOIN public.radni_nalozi other_order ON other_order.id = assignment.nalog_id
      LEFT JOIN public.gradilista site ON site.id = other_order.gradiliste_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(
          timezone('Europe/Zagreb', assignment.mobile_started_at)::date,
          other_order.rok,
          timezone('Europe/Zagreb', other_order.datum_kreiranja)::date
        ) AS work_date
      ) other_date
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(assignment.mobile_extra_time, '[]'::jsonb)) AS segment
      WHERE assignment.radnik_id = worker_id
        AND assignment.nalog_id <> NEW.id
    )
    SELECT
      existing.nalog_broj,
      existing.gradiliste_naziv,
      existing.starts_at::date,
      existing.starts_at::time,
      existing.ends_at::date,
      existing.ends_at::time
    INTO
      conflicting_order,
      conflicting_site,
      conflicting_date,
      conflicting_start,
      conflicting_end_date,
      conflicting_end
    FROM incoming
    JOIN existing
      ON incoming.starts_at < existing.ends_at
      AND existing.starts_at < incoming.ends_at
    LIMIT 1;

    IF conflicting_order IS NOT NULL THEN
      SELECT concat_ws(' ', ime, prezime)
      INTO worker_name
      FROM public.radnici
      WHERE id = worker_id;

      RAISE EXCEPTION
        'Nalog nije zaključen: radno vrijeme za djelatnika % dana % od % do % već je upisano na gradilištu „%” (nalog %). Uskladi sate prije zaključivanja.',
        COALESCE(NULLIF(worker_name, ''), worker_id::text),
        to_char(conflicting_date, 'DD.MM.YYYY'),
        to_char(conflicting_start, 'HH24:MI'),
        to_char(conflicting_end, 'HH24:MI')
          || CASE WHEN conflicting_end_date > conflicting_date THEN ' sljedeći dan' ELSE '' END,
        COALESCE(NULLIF(conflicting_site, ''), 'gradilište nije navedeno'),
        COALESCE(conflicting_order, 'bez broja')
        USING ERRCODE = '23P01';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_work_order_close_time_overlap
  BEFORE UPDATE OF status ON public.radni_nalozi
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_work_order_close_time_overlap();

REVOKE ALL ON FUNCTION private.guard_work_order_close_time_overlap() FROM PUBLIC, anon, authenticated;
