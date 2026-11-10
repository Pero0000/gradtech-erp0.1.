CREATE FUNCTION private.work_order_time_date(order_row public.radni_nalozi)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT min(datum) FROM public.dnevni_raspored_gradilista WHERE nalog_id = order_row.id),
    order_row.rok,
    timezone('UTC', order_row.datum_kreiranja)::date
  );
$$;

CREATE FUNCTION private.assert_work_order_worker_time(
  assignment public.radni_nalozi_radnici,
  order_row public.radni_nalozi,
  closing boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  work_date date;
  conflict record;
  worker_name text;
BEGIN
  IF assignment.radnik_id IS NULL
    OR order_row.status = 'otkazan'
    OR COALESCE(order_row.bez_izvrsenja, false) THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(assignment.radnik_id::text), hashtext('worker-work-time-overlap'));

  -- Match the settlement date, including an order linked to the daily schedule.
  work_date := private.work_order_time_date(order_row);

  WITH incoming AS (
    SELECT
      work_date + assignment.vrijeme_od AS starts_at,
      work_date + assignment.vrijeme_do
        + CASE WHEN assignment.vrijeme_do < assignment.vrijeme_od THEN interval '1 day' ELSE interval '0' END AS ends_at
    WHERE NOT COALESCE(assignment.mobile_zero_hours, false)
      AND assignment.vrijeme_od IS NOT NULL
      AND assignment.vrijeme_do IS NOT NULL
    UNION ALL
    SELECT
      work_date + (segment->>'vrijeme_od')::time,
      work_date + (segment->>'vrijeme_do')::time
        + CASE WHEN (segment->>'vrijeme_do')::time < (segment->>'vrijeme_od')::time
            THEN interval '1 day' ELSE interval '0' END
    FROM jsonb_array_elements(COALESCE(assignment.mobile_extra_time, '[]'::jsonb)) segment
  ),
  numbered_incoming AS (
    SELECT *, row_number() OVER () AS segment_number FROM incoming
    WHERE starts_at < ends_at
  ),
  existing AS (
    SELECT
      other_order.broj AS nalog_broj,
      site.naziv AS gradiliste_naziv,
      other_date.work_date + other_assignment.vrijeme_od AS starts_at,
      other_date.work_date + other_assignment.vrijeme_do
        + CASE WHEN other_assignment.vrijeme_do < other_assignment.vrijeme_od
            THEN interval '1 day' ELSE interval '0' END AS ends_at
    FROM public.radni_nalozi_radnici other_assignment
    JOIN public.radni_nalozi other_order ON other_order.id = other_assignment.nalog_id
    LEFT JOIN public.gradilista site ON site.id = other_order.gradiliste_id
    CROSS JOIN LATERAL (
      SELECT private.work_order_time_date(other_order) AS work_date
    ) other_date
    WHERE other_assignment.radnik_id = assignment.radnik_id
      AND other_assignment.nalog_id <> order_row.id
      AND other_order.status IS DISTINCT FROM 'otkazan'
      AND NOT COALESCE(other_order.bez_izvrsenja, false)
      AND NOT COALESCE(other_assignment.mobile_zero_hours, false)
      AND other_assignment.vrijeme_od IS NOT NULL
      AND other_assignment.vrijeme_do IS NOT NULL
    UNION ALL
    SELECT
      other_order.broj,
      site.naziv,
      other_date.work_date + (segment->>'vrijeme_od')::time,
      other_date.work_date + (segment->>'vrijeme_do')::time
        + CASE WHEN (segment->>'vrijeme_do')::time < (segment->>'vrijeme_od')::time
            THEN interval '1 day' ELSE interval '0' END
    FROM public.radni_nalozi_radnici other_assignment
    JOIN public.radni_nalozi other_order ON other_order.id = other_assignment.nalog_id
    LEFT JOIN public.gradilista site ON site.id = other_order.gradiliste_id
    CROSS JOIN LATERAL (
      SELECT private.work_order_time_date(other_order) AS work_date
    ) other_date
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(other_assignment.mobile_extra_time, '[]'::jsonb)) segment
    WHERE other_assignment.radnik_id = assignment.radnik_id
      AND other_assignment.nalog_id <> order_row.id
      AND other_order.status IS DISTINCT FROM 'otkazan'
      AND NOT COALESCE(other_order.bez_izvrsenja, false)
  )
  SELECT collisions.*
  INTO conflict
  FROM (
    SELECT existing.*
    FROM numbered_incoming incoming
    JOIN existing
      ON incoming.starts_at < existing.ends_at
      AND existing.starts_at < incoming.ends_at
      AND existing.starts_at < existing.ends_at
    UNION ALL
    SELECT order_row.broj, site.naziv, first_segment.starts_at, first_segment.ends_at
    FROM numbered_incoming first_segment
    JOIN numbered_incoming second_segment
      ON first_segment.segment_number < second_segment.segment_number
      AND first_segment.starts_at < second_segment.ends_at
      AND second_segment.starts_at < first_segment.ends_at
    LEFT JOIN public.gradilista site ON site.id = order_row.gradiliste_id
  ) collisions
  LIMIT 1;

  IF FOUND THEN
    SELECT concat_ws(' ', ime, prezime)
    INTO worker_name
    FROM public.radnici
    WHERE id = assignment.radnik_id;

    RAISE EXCEPTION
      '%: radno vrijeme za djelatnika % dana % od % do % već je upisano na gradilištu „%” (nalog %). Uskladi sate prije spremanja.',
      CASE WHEN closing THEN 'Nalog nije zaključen' ELSE 'Potvrda nije spremljena' END,
      COALESCE(NULLIF(worker_name, ''), assignment.radnik_id::text),
      to_char(conflict.starts_at, 'DD.MM.YYYY'),
      to_char(conflict.starts_at, 'HH24:MI'),
      to_char(conflict.ends_at, 'HH24:MI')
        || CASE WHEN conflict.ends_at::date > conflict.starts_at::date THEN ' sljedeći dan' ELSE '' END,
      COALESCE(NULLIF(conflict.gradiliste_naziv, ''), 'gradilište nije navedeno'),
      COALESCE(conflict.nalog_broj, 'bez broja')
      USING ERRCODE = '23P01';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_worker_work_time_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  order_row public.radni_nalozi;
BEGIN
  -- Serialize assignment edits against closing the parent order.
  SELECT * INTO order_row
  FROM public.radni_nalozi
  WHERE id = NEW.nalog_id
  FOR SHARE;

  IF public.app_has_module_permission('radni_nalozi', 'edit')
    AND order_row.status IS DISTINCT FROM 'zavrsen' THEN
    RETURN NEW;
  END IF;

  PERFORM private.assert_work_order_worker_time(NEW, order_row);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_work_order_close_time_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  assignment public.radni_nalozi_radnici;
BEGIN
  IF NEW.status IS DISTINCT FROM 'zavrsen' THEN
    RETURN NEW;
  END IF;

  FOR assignment IN
    SELECT * FROM public.radni_nalozi_radnici
    WHERE nalog_id = NEW.id
    ORDER BY radnik_id
  LOOP
    PERFORM private.assert_work_order_worker_time(assignment, NEW, true);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER prevent_work_order_close_time_overlap ON public.radni_nalozi;
CREATE TRIGGER prevent_work_order_close_time_overlap
  BEFORE INSERT OR UPDATE OF status, rok, datum_kreiranja, bez_izvrsenja ON public.radni_nalozi
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_work_order_close_time_overlap();

CREATE FUNCTION private.guard_scheduled_work_order_time_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  old_order_id uuid;
  new_order_id uuid;
  order_row public.radni_nalozi;
  assignment public.radni_nalozi_radnici;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_order_id := OLD.nalog_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_order_id := NEW.nalog_id; END IF;

  FOR order_row IN
    SELECT * FROM public.radni_nalozi
    WHERE id IN (old_order_id, new_order_id) AND status = 'zavrsen'
    ORDER BY id
    FOR SHARE
  LOOP
    FOR assignment IN
      SELECT * FROM public.radni_nalozi_radnici
      WHERE nalog_id = order_row.id
      ORDER BY radnik_id
    LOOP
      PERFORM private.assert_work_order_worker_time(assignment, order_row);
    END LOOP;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER prevent_scheduled_work_order_time_overlap
  AFTER INSERT OR UPDATE OF datum, nalog_id OR DELETE ON public.dnevni_raspored_gradilista
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_scheduled_work_order_time_overlap();

REVOKE ALL ON FUNCTION private.work_order_time_date(public.radni_nalozi),
  private.guard_scheduled_work_order_time_overlap() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION private.assert_work_order_worker_time(
  public.radni_nalozi_radnici, public.radni_nalozi, boolean
) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.assert_work_order_worker_time(
  public.radni_nalozi_radnici, public.radni_nalozi, boolean
) IS 'Zajednička provjera osnovne smjene i dodatnih dionica pri zaključivanju i izmjenama zaključenog naloga. Otvoreni nalozi ostaju uređivi u uredu; otkazani i nalozi bez izvršenja ne zauzimaju sate.';
