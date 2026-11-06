BEGIN;

DROP TRIGGER IF EXISTS zzzzzz_delete_completed_task_copies ON public.gradiliste_zadaci;
DROP TRIGGER IF EXISTS zzzzzz_delete_completed_material_copies ON public.radni_nalozi_stavke;
DROP TRIGGER IF EXISTS zzzzzz_delete_completed_tool_copies ON public.radni_nalozi_stavke;

CREATE TABLE private.copied_completion_context (
  transaction_id bigint NOT NULL,
  table_name text NOT NULL,
  PRIMARY KEY (transaction_id, table_name)
);
ALTER TABLE private.copied_completion_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.copied_completion_context FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.guard_closed_order_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE order_status text;
BEGIN
  IF TG_TABLE_NAME = 'radni_nalozi_stavke' THEN
    IF NEW.tip NOT IN ('materijal', 'alat') THEN RETURN NEW; END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.resource_deletions WHERE transaction_id = txid_current() AND active
      AND (restoring OR table_name <> 'task_changes')
  ) THEN RETURN NEW; END IF;
  SELECT order_row.status INTO order_status FROM public.radni_nalozi order_row
    WHERE order_row.id = NEW.nalog_id AND order_row.company_id = NEW.company_id FOR SHARE NOWAIT;
  IF order_status IN ('zavrsen', 'otkazan') THEN
    RAISE EXCEPTION 'Oznaku stavke završenog ili otkazanog naloga nije moguće mijenjati. Najprije ponovno otvorite nalog.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION 'Nalog upravo uređuje druga osoba. Promjena nije spremljena; osvježite nalog i pokušajte ponovno.'
    USING ERRCODE = '40001';
END;
$$;
CREATE TRIGGER aaa_guard_closed_order_task_completion
  BEFORE UPDATE ON public.gradiliste_zadaci FOR EACH ROW
  WHEN (OLD.gotovo IS DISTINCT FROM NEW.gotovo)
  EXECUTE FUNCTION private.guard_closed_order_completion();
CREATE TRIGGER aaa_guard_closed_order_item_completion
  BEFORE UPDATE ON public.radni_nalozi_stavke FOR EACH ROW
  WHEN (OLD.gotovo IS DISTINCT FROM NEW.gotovo OR OLD.uzeto IS DISTINCT FROM NEW.uzeto)
  EXECUTE FUNCTION private.guard_closed_order_completion();

CREATE FUNCTION private.copied_completion_family(p_table text, p_id uuid)
RETURNS TABLE(id uuid, nalog_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_table = 'gradiliste_zadaci' THEN
    RETURN QUERY
    WITH RECURSIVE nodes AS (
      SELECT task.id, task.nalog_id, task.izvor_zadatak_id AS source_id
      FROM public.gradiliste_zadaci task
      JOIN public.gradiliste_zadaci root ON root.id = p_id
      WHERE task.company_id = root.company_id
        AND task.gradiliste_id IS NOT DISTINCT FROM root.gradiliste_id
        AND COALESCE(task.vrsta, 'zadatak') = COALESCE(root.vrsta, 'zadatak')
        AND (task.nalog_id IS NULL OR EXISTS (
          SELECT 1 FROM public.radni_nalozi order_row
          WHERE order_row.id = task.nalog_id AND order_row.company_id = root.company_id
            AND order_row.gradiliste_id IS NOT DISTINCT FROM root.gradiliste_id
        ))
    ), family(id, source_id) AS (
      SELECT node.id, node.source_id FROM nodes node WHERE node.id = p_id
      UNION
      SELECT node.id, node.source_id FROM nodes node
      JOIN family parent ON node.source_id = parent.id OR node.id = parent.source_id
    )
    SELECT node.id, node.nalog_id FROM nodes node JOIN family USING (id);
  ELSIF p_table = 'radni_nalozi_stavke' THEN
    RETURN QUERY
    WITH RECURSIVE nodes AS (
      SELECT item.id, item.nalog_id,
        COALESCE(
          CASE item.tip WHEN 'materijal' THEN item.izvor_materijal_id ELSE item.izvor_alat_id END,
          item.izvor_id
        ) AS source_id
      FROM public.radni_nalozi_stavke item
      JOIN public.radni_nalozi_stavke root ON root.id = p_id
      WHERE root.tip IN ('materijal', 'alat') AND item.tip = root.tip
        AND item.company_id = root.company_id
        AND item.gradiliste_id IS NOT DISTINCT FROM root.gradiliste_id
        AND (item.nalog_id IS NULL OR EXISTS (
          SELECT 1 FROM public.radni_nalozi order_row
          WHERE order_row.id = item.nalog_id AND order_row.company_id = root.company_id
            AND order_row.gradiliste_id IS NOT DISTINCT FROM root.gradiliste_id
        ))
    ), family(id, source_id) AS (
      SELECT node.id, node.source_id FROM nodes node WHERE node.id = p_id
      UNION
      SELECT node.id, node.source_id FROM nodes node
      JOIN family parent ON node.source_id = parent.id OR node.id = parent.source_id
    )
    SELECT node.id, node.nalog_id FROM nodes node JOIN family USING (id);
  END IF;
END;
$$;

CREATE FUNCTION private.sync_copied_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  root_data jsonb;
  family_ids uuid[];
  order_ids uuid[];
  target_id uuid;
  completed boolean;
  completed_at timestamptz;
BEGIN
  IF EXISTS (
    SELECT 1 FROM private.copied_completion_context
    WHERE transaction_id = txid_current() AND table_name = TG_TABLE_NAME
  ) OR EXISTS (
    SELECT 1 FROM private.resource_deletions
    WHERE transaction_id = txid_current() AND active
  ) THEN RETURN NEW; END IF;

  -- Read the current row: a deferred recovery event may contain an older snapshot.
  IF TG_TABLE_NAME = 'gradiliste_zadaci' THEN
    SELECT to_jsonb(task) INTO root_data FROM public.gradiliste_zadaci task WHERE task.id = NEW.id;
  ELSE
    SELECT to_jsonb(item) INTO root_data FROM public.radni_nalozi_stavke item WHERE item.id = NEW.id;
    IF root_data->>'tip' NOT IN ('materijal', 'alat') THEN RETURN NEW; END IF;
  END IF;
  IF root_data IS NULL OR EXISTS (
    SELECT 1 FROM public.radni_nalozi order_row
    WHERE order_row.id = (root_data->>'nalog_id')::uuid AND order_row.status IN ('zavrsen', 'otkazan')
  ) THEN RETURN NEW; END IF;

  SELECT array_agg(family.id ORDER BY family.id), array_agg(DISTINCT family.nalog_id)
    INTO family_ids, order_ids
    FROM private.copied_completion_family(TG_TABLE_NAME, NEW.id) family;
  IF COALESCE(cardinality(family_ids), 0) < 2 THEN RETURN NEW; END IF;

  -- The initiating row is already locked. Fail explicitly rather than deadlock with another crew.
  IF TG_TABLE_NAME = 'gradiliste_zadaci' THEN
    PERFORM 1 FROM public.gradiliste_zadaci WHERE id = ANY(family_ids) ORDER BY id FOR UPDATE NOWAIT;
  ELSE
    PERFORM 1 FROM public.radni_nalozi_stavke WHERE id = ANY(family_ids) ORDER BY id FOR UPDATE NOWAIT;
  END IF;
  PERFORM 1 FROM public.radni_nalozi WHERE id = ANY(order_ids) ORDER BY id FOR SHARE NOWAIT;

  completed := COALESCE((root_data->>'gotovo')::boolean, false);
  completed_at := CASE WHEN completed THEN COALESCE((root_data->>'gotovo_at')::timestamptz, now()) END;
  INSERT INTO private.copied_completion_context VALUES (txid_current(), TG_TABLE_NAME);

  -- One statement per task lets its existing audit/deadline package finish before the next starts.
  FOREACH target_id IN ARRAY family_ids LOOP
    IF target_id = NEW.id THEN CONTINUE; END IF;
    IF TG_TABLE_NAME = 'gradiliste_zadaci' THEN
      UPDATE public.gradiliste_zadaci task SET gotovo = completed, gotovo_at = completed_at
      WHERE task.id = target_id
        AND (task.gotovo IS DISTINCT FROM completed OR (NOT completed AND task.gotovo_at IS NOT NULL))
        AND (task.nalog_id IS NULL OR EXISTS (
          SELECT 1 FROM public.radni_nalozi order_row
          WHERE order_row.id = task.nalog_id AND order_row.status NOT IN ('zavrsen', 'otkazan')
        ));
    ELSE
      UPDATE public.radni_nalozi_stavke item SET gotovo = completed, uzeto = completed
      WHERE item.id = target_id
        AND (item.gotovo IS DISTINCT FROM completed OR item.uzeto IS DISTINCT FROM completed)
        AND (item.nalog_id IS NULL OR EXISTS (
          SELECT 1 FROM public.radni_nalozi order_row
          WHERE order_row.id = item.nalog_id AND order_row.status NOT IN ('zavrsen', 'otkazan')
        ));
    END IF;
  END LOOP;
  IF TG_TABLE_NAME = 'gradiliste_zadaci' THEN
    IF EXISTS (
      SELECT 1 FROM public.gradiliste_zadaci task
      WHERE task.id = ANY(family_ids) AND task.id <> NEW.id
        AND (task.gotovo IS DISTINCT FROM completed OR (NOT completed AND task.gotovo_at IS NOT NULL))
        AND (task.nalog_id IS NULL OR EXISTS (
          SELECT 1 FROM public.radni_nalozi order_row
          WHERE order_row.id = task.nalog_id AND order_row.status NOT IN ('zavrsen', 'otkazan')
        ))
    ) THEN
      RAISE EXCEPTION 'Povezani zadaci nisu usklađeni. Ništa nije spremljeno.' USING ERRCODE = '40001';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.radni_nalozi_stavke item
      WHERE item.id = ANY(family_ids) AND item.id <> NEW.id
        AND (item.gotovo IS DISTINCT FROM completed OR item.uzeto IS DISTINCT FROM completed)
        AND (item.nalog_id IS NULL OR EXISTS (
          SELECT 1 FROM public.radni_nalozi order_row
          WHERE order_row.id = item.nalog_id AND order_row.status NOT IN ('zavrsen', 'otkazan')
        ))
    ) THEN
      RAISE EXCEPTION 'Povezani materijal ili alat nisu usklađeni. Ništa nije spremljeno.' USING ERRCODE = '40001';
    END IF;
  END IF;
  DELETE FROM private.copied_completion_context
    WHERE transaction_id = txid_current() AND table_name = TG_TABLE_NAME;
  RETURN NEW;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION 'Povezanu stavku ili nalog upravo uređuje druga osoba. Promjena nije spremljena; osvježite nalog i pokušajte ponovno.'
    USING ERRCODE = '40001';
END;
$$;

REVOKE ALL ON FUNCTION private.copied_completion_family(text, uuid),
  private.sync_copied_completion(), private.guard_closed_order_completion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER zzzzzz_sync_copied_task_completion
  AFTER UPDATE ON public.gradiliste_zadaci FOR EACH ROW
  WHEN (OLD.gotovo IS DISTINCT FROM NEW.gotovo)
  EXECUTE FUNCTION private.sync_copied_completion();
CREATE TRIGGER zzzzzz_sync_copied_item_completion
  AFTER UPDATE ON public.radni_nalozi_stavke FOR EACH ROW
  WHEN (OLD.gotovo IS DISTINCT FROM NEW.gotovo OR OLD.uzeto IS DISTINCT FROM NEW.uzeto)
  EXECUTE FUNCTION private.sync_copied_completion();

-- Wider status/recovery packages must finish exact snapshot checks before propagating to other orders.
CREATE CONSTRAINT TRIGGER copied_task_completion_after_recovery
  AFTER UPDATE ON public.gradiliste_zadaci DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.gotovo IS DISTINCT FROM NEW.gotovo)
  EXECUTE FUNCTION private.sync_copied_completion();
CREATE CONSTRAINT TRIGGER copied_item_completion_after_recovery
  AFTER UPDATE ON public.radni_nalozi_stavke DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (OLD.gotovo IS DISTINCT FROM NEW.gotovo OR OLD.uzeto IS DISTINCT FROM NEW.uzeto)
  EXECUTE FUNCTION private.sync_copied_completion();

NOTIFY pgrst, 'reload schema';
COMMIT;
