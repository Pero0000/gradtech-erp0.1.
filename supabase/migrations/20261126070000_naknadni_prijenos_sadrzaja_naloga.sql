CREATE OR REPLACE FUNCTION private.sync_new_item_to_next_work_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  source_order public.radni_nalozi%ROWTYPE;
  next_order_id uuid;
BEGIN
  IF NEW.nalog_id IS NULL
    OR NEW.gotovo
    OR COALESCE(NEW.uzeto, false)
    OR NEW.tip NOT IN ('materijal', 'alat')
    OR (NEW.tip = 'materijal' AND NEW.izvor_materijal_id IS NOT NULL)
    OR (NEW.tip = 'alat' AND NEW.izvor_alat_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO source_order
  FROM public.radni_nalozi
  WHERE id = NEW.nalog_id
    AND company_id = NEW.company_id;

  IF NOT FOUND OR source_order.gradiliste_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT target.id
  INTO next_order_id
  FROM public.radni_nalozi target
  WHERE target.company_id = source_order.company_id
    AND target.gradiliste_id = source_order.gradiliste_id
    AND target.id <> source_order.id
    AND target.status <> 'otkazan'
    AND target.created_at > source_order.created_at
  ORDER BY target.created_at, target.id
  LIMIT 1;

  IF next_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.tip = 'materijal' THEN
    INSERT INTO public.radni_nalozi_stavke (
      nalog_id, gradiliste_id, tip, naziv, oprema_id, izvor_materijal_id, company_id
    )
    VALUES (
      next_order_id, source_order.gradiliste_id, NEW.tip, NEW.naziv,
      NEW.oprema_id, NEW.id, NEW.company_id
    )
    ON CONFLICT (nalog_id, izvor_materijal_id) DO NOTHING;
  ELSE
    INSERT INTO public.radni_nalozi_stavke (
      nalog_id, gradiliste_id, tip, naziv, oprema_id, izvor_alat_id, company_id
    )
    VALUES (
      next_order_id, source_order.gradiliste_id, NEW.tip, NEW.naziv,
      NEW.oprema_id, NEW.id, NEW.company_id
    )
    ON CONFLICT (nalog_id, izvor_alat_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.sync_new_task_to_next_work_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  source_order public.radni_nalozi%ROWTYPE;
  next_order_id uuid;
BEGIN
  IF NEW.nalog_id IS NULL
    OR NEW.gotovo
    OR NEW.izvor_zadatak_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO source_order
  FROM public.radni_nalozi
  WHERE id = NEW.nalog_id
    AND company_id = NEW.company_id;

  IF NOT FOUND OR source_order.gradiliste_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT target.id
  INTO next_order_id
  FROM public.radni_nalozi target
  WHERE target.company_id = source_order.company_id
    AND target.gradiliste_id = source_order.gradiliste_id
    AND target.id <> source_order.id
    AND target.status <> 'otkazan'
    AND target.created_at > source_order.created_at
  ORDER BY target.created_at, target.id
  LIMIT 1;

  IF next_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.gradiliste_zadaci (
    nalog_id, gradiliste_id, naziv, rok, kooperant_id, vrsta,
    izvor_zadatak_id, company_id
  )
  VALUES (
    next_order_id, NEW.gradiliste_id, NEW.naziv, NEW.rok, NEW.kooperant_id,
    NEW.vrsta, NEW.id, NEW.company_id
  )
  ON CONFLICT (nalog_id, izvor_zadatak_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_new_item_to_next_order ON public.radni_nalozi_stavke;
CREATE TRIGGER sync_new_item_to_next_order
  AFTER INSERT ON public.radni_nalozi_stavke
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_new_item_to_next_work_order();

DROP TRIGGER IF EXISTS sync_new_task_to_next_order ON public.gradiliste_zadaci;
CREATE TRIGGER sync_new_task_to_next_order
  AFTER INSERT ON public.gradiliste_zadaci
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_new_task_to_next_work_order();

REVOKE ALL ON FUNCTION private.sync_new_item_to_next_work_order(),
  private.sync_new_task_to_next_work_order()
FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
