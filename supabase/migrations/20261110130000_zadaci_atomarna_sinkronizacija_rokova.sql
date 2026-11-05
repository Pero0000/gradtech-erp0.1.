CREATE FUNCTION private.project_task_deadline(p_task_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  task public.gradiliste_zadaci%ROWTYPE;
  original_ids uuid[];
  current_ids uuid[];
  inserted_id uuid;
BEGIN
  SELECT * INTO task FROM public.gradiliste_zadaci WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zadatak više nije dostupan.' USING ERRCODE = '23503'; END IF;
  IF task.gradiliste_id IS NOT NULL THEN
    PERFORM 1 FROM public.gradilista WHERE id = task.gradiliste_id AND company_id = task.company_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Gradilište zadatka nije dostupno u istoj tvrtki.' USING ERRCODE = '23503'; END IF;
  END IF;
  IF task.kooperant_id IS NOT NULL THEN
    PERFORM 1 FROM public.kooperanti WHERE id = task.kooperant_id AND company_id = task.company_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Kooperant zadatka nije dostupan u istoj tvrtki.' USING ERRCODE = '23503'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rokovi WHERE zadatak_id = task.id AND company_id IS DISTINCT FROM task.company_id) THEN
    RAISE EXCEPTION 'Povezani rok pripada drugoj tvrtki. Ništa nije spremljeno.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO private.deadline_sync_context VALUES (txid_current(), task.id);
  SELECT array_agg(id ORDER BY id) INTO original_ids FROM public.rokovi WHERE zadatak_id = task.id;
  IF task.rok IS NULL OR task.gradiliste_id IS NULL THEN
    DELETE FROM public.rokovi WHERE zadatak_id = task.id;
    IF EXISTS (SELECT 1 FROM public.rokovi WHERE zadatak_id = task.id) THEN
      RAISE EXCEPTION 'Povezani rok nije uklonjen. Ništa nije spremljeno.';
    END IF;
  ELSE
    UPDATE public.rokovi SET gradiliste_id = task.gradiliste_id, naziv = task.naziv,
      datum = task.rok, datum_pocetka = task.rok, datum_zavrsetka = task.rok,
      kooperant_id = task.kooperant_id, status = CASE WHEN task.gotovo THEN 'zavrsen' ELSE 'otvoren' END
      WHERE zadatak_id = task.id AND
        ROW(gradiliste_id, naziv, datum, datum_pocetka, datum_zavrsetka, kooperant_id, status)
        IS DISTINCT FROM ROW(task.gradiliste_id, task.naziv, task.rok, task.rok, task.rok, task.kooperant_id,
          CASE WHEN task.gotovo THEN 'zavrsen' ELSE 'otvoren' END);
    IF original_ids IS NULL THEN
      INSERT INTO public.rokovi(company_id, gradiliste_id, zadatak_id, naziv, datum, datum_pocetka,
        datum_zavrsetka, kooperant_id, status, opis)
      VALUES (task.company_id, task.gradiliste_id, task.id, task.naziv, task.rok, task.rok, task.rok,
        task.kooperant_id, CASE WHEN task.gotovo THEN 'zavrsen' ELSE 'otvoren' END,
        CASE WHEN task.vrsta = 'dodatni' THEN 'Dodatni rad' ELSE 'Radni zadatak' END)
      RETURNING id INTO inserted_id;
      original_ids := ARRAY[inserted_id];
    END IF;
    SELECT array_agg(id ORDER BY id) INTO current_ids FROM public.rokovi WHERE zadatak_id = task.id;
    IF current_ids IS DISTINCT FROM original_ids OR EXISTS (
      SELECT 1 FROM public.rokovi WHERE zadatak_id = task.id AND
        ROW(company_id, gradiliste_id, naziv, datum, datum_pocetka, datum_zavrsetka, kooperant_id, status)
        IS DISTINCT FROM ROW(task.company_id, task.gradiliste_id, task.naziv, task.rok, task.rok, task.rok,
          task.kooperant_id, CASE WHEN task.gotovo THEN 'zavrsen' ELSE 'otvoren' END)
    ) THEN RAISE EXCEPTION 'Povezani rok nije točno spremljen. Ništa nije spremljeno.'; END IF;
  END IF;
  DELETE FROM private.deadline_sync_context WHERE transaction_id = txid_current() AND task_id = task.id;
END;
$$;
REVOKE ALL ON FUNCTION private.project_task_deadline(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.sync_changed_task_deadline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Recovery restores original deadline rows, not today's derived projection.
  IF EXISTS (SELECT 1 FROM private.resource_deletions
    WHERE active AND transaction_id = txid_current() AND company_id = NEW.company_id) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(OLD.naziv, OLD.rok, OLD.gotovo, OLD.kooperant_id, OLD.gradiliste_id)
      IS NOT DISTINCT FROM ROW(NEW.naziv, NEW.rok, NEW.gotovo, NEW.kooperant_id, NEW.gradiliste_id) THEN
      RETURN NEW;
    END IF;
  END IF;
  -- Authorization is the task's existing RLS, including assigned mobile workers.
  PERFORM private.project_task_deadline(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.sync_changed_task_deadline() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER task_deadline_projection AFTER INSERT OR UPDATE ON public.gradiliste_zadaci
  FOR EACH ROW EXECUTE FUNCTION private.sync_changed_task_deadline();

CREATE OR REPLACE FUNCTION public.sync_task_deadline(p_task_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.app_has_module_permission('gradilista', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja gradilišta.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.gradiliste_zadaci
    WHERE id = p_task_id AND company_id = public.app_current_company_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Zadatak nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  PERFORM private.project_task_deadline(p_task_id);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_task_deadline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_task_deadline(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
