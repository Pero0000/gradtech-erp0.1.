ALTER TABLE public.gradiliste_zadaci
  ADD COLUMN IF NOT EXISTS izvor_zadatak_id uuid
  REFERENCES public.gradiliste_zadaci(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gradiliste_zadaci_nalog_izvor_unique
  ON public.gradiliste_zadaci(nalog_id, izvor_zadatak_id);

CREATE INDEX IF NOT EXISTS idx_gradiliste_zadaci_izvor
  ON public.gradiliste_zadaci(izvor_zadatak_id)
  WHERE izvor_zadatak_id IS NOT NULL;

ALTER TABLE public.radni_nalozi_stavke
  ADD COLUMN IF NOT EXISTS izvor_materijal_id uuid
  REFERENCES public.radni_nalozi_stavke(id) ON DELETE SET NULL;

ALTER TABLE public.radni_nalozi_stavke
  ADD COLUMN IF NOT EXISTS izvor_alat_id uuid
  REFERENCES public.radni_nalozi_stavke(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS radni_nalozi_stavke_nalog_materijal_izvor_unique
  ON public.radni_nalozi_stavke(nalog_id, izvor_materijal_id);

CREATE UNIQUE INDEX IF NOT EXISTS radni_nalozi_stavke_nalog_alat_izvor_unique
  ON public.radni_nalozi_stavke(nalog_id, izvor_alat_id);

CREATE INDEX IF NOT EXISTS idx_radni_nalozi_stavke_materijal_izvor
  ON public.radni_nalozi_stavke(izvor_materijal_id)
  WHERE izvor_materijal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_radni_nalozi_stavke_alat_izvor
  ON public.radni_nalozi_stavke(izvor_alat_id)
  WHERE izvor_alat_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.validate_copied_task_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  source_task public.gradiliste_zadaci%ROWTYPE;
BEGIN
  IF NEW.izvor_zadatak_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM private.resource_deletions operation
    WHERE operation.active AND operation.restoring
      AND operation.transaction_id = txid_current()
      AND operation.table_name = 'gradiliste_zadaci'
      AND operation.record_id = NEW.id
  ) THEN RETURN NEW; END IF;
  SELECT * INTO source_task
  FROM public.gradiliste_zadaci
  WHERE id = NEW.izvor_zadatak_id
  FOR UPDATE;
  IF NOT FOUND
    OR source_task.id = NEW.id
    OR source_task.company_id IS DISTINCT FROM NEW.company_id
    OR source_task.gradiliste_id IS DISTINCT FROM NEW.gradiliste_id
    OR source_task.nalog_id IS NULL
    OR source_task.nalog_id IS NOT DISTINCT FROM NEW.nalog_id
    OR source_task.gotovo THEN
    RAISE EXCEPTION 'Izvorni zadatak nije dostupan ili je već riješen.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_copied_task_source ON public.gradiliste_zadaci;
CREATE TRIGGER validate_copied_task_source
  BEFORE INSERT OR UPDATE OF izvor_zadatak_id ON public.gradiliste_zadaci
  FOR EACH ROW EXECUTE FUNCTION private.validate_copied_task_source();

CREATE OR REPLACE FUNCTION private.delete_completed_task_copies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  copied_task public.gradiliste_zadaci%ROWTYPE;
  operation_id uuid;
  history_sequence bigint;
  untracked text;
  missing_file text;
BEGIN
  IF OLD.gotovo OR NOT NEW.gotovo THEN RETURN NEW; END IF;

  FOR copied_task IN
    SELECT * FROM public.gradiliste_zadaci
    WHERE izvor_zadatak_id = NEW.id AND company_id = NEW.company_id
    ORDER BY id
    FOR UPDATE
  LOOP
    WITH RECURSIVE affected(oid, cascading) AS (
      SELECT 'public.gradiliste_zadaci'::regclass::oid, true
      UNION
      SELECT fk.conrelid, fk.confdeltype = 'c'
      FROM pg_constraint fk
      JOIN affected parent ON parent.oid = fk.confrelid
      WHERE parent.cascading AND fk.contype = 'f' AND fk.confdeltype IN ('c', 'n', 'd')
    )
    SELECT c.relname INTO untracked
    FROM affected
    JOIN pg_class c USING (oid)
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'public'
      OR NOT EXISTS (
        SELECT 1 FROM private.resource_recovery_tables table_definition
        WHERE table_definition.table_name = c.relname
      )
    LIMIT 1;
    IF untracked IS NOT NULL THEN
      RAISE EXCEPTION 'Povrat nije pripremljen za povezanu tablicu %. Kopirani zadatak nije uklonjen.', untracked;
    END IF;

    SELECT COALESCE(max(sequence), 0)
    INTO history_sequence
    FROM private.business_change_history;
    INSERT INTO private.resource_deletions(company_id, module, table_name, record_id, snapshot, actor_name)
    VALUES (
      copied_task.company_id,
      'gradilista',
      'gradiliste_zadaci',
      copied_task.id,
      to_jsonb(copied_task),
      COALESCE((
        SELECT profile.email FROM public.app_profiles profile
        WHERE profile.id = auth.uid() AND profile.company_id = copied_task.company_id
      ), 'Korisnik')
    )
    RETURNING id INTO operation_id;

    DELETE FROM public.gradiliste_zadaci WHERE id = copied_task.id;
    IF EXISTS (SELECT 1 FROM public.gradiliste_zadaci WHERE id = copied_task.id)
      OR NOT EXISTS (
        SELECT 1 FROM private.resource_deletion_rows
        WHERE resource_deletion_rows.deletion_id = operation_id
          AND table_name = 'gradiliste_zadaci'
          AND row_key = jsonb_build_object('id', copied_task.id)
          AND after_data IS NULL
      ) THEN
      RAISE EXCEPTION 'Kopirani zadatak nije uklonjen i evidentiran. Izvorni zadatak nije označen kao riješen.';
    END IF;

    SELECT path INTO missing_file
    FROM private.resource_deletion_rows row_change
    CROSS JOIN LATERAL private.resource_file_paths(row_change.table_name, row_change.before_data) path
    WHERE row_change.deletion_id = operation_id
      AND NOT EXISTS (
        SELECT 1 FROM storage.objects object
        WHERE object.bucket_id = 'nalozi-foto' AND object.name = path
      )
    LIMIT 1;
    IF missing_file IS NOT NULL THEN
      RAISE EXCEPTION 'Nedostaje prilog %. Kopirani zadatak nije uklonjen.', missing_file;
    END IF;

    INSERT INTO private.resource_deletion_events
    SELECT operation_id, history.id
    FROM private.business_change_history history
    WHERE history.transaction_id = txid_current() AND history.sequence > history_sequence;
    UPDATE private.resource_deletions SET active = false WHERE id = operation_id;
    untracked := NULL;
    missing_file := NULL;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS zzzzzz_delete_completed_task_copies ON public.gradiliste_zadaci;
CREATE TRIGGER zzzzzz_delete_completed_task_copies
  AFTER UPDATE OF gotovo ON public.gradiliste_zadaci
  FOR EACH ROW EXECUTE FUNCTION private.delete_completed_task_copies();

CREATE OR REPLACE FUNCTION private.validate_copied_material_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  source_item public.radni_nalozi_stavke%ROWTYPE;
BEGIN
  IF NEW.izvor_materijal_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM private.resource_deletions operation
    WHERE operation.active AND operation.restoring
      AND operation.transaction_id = txid_current()
      AND operation.table_name = 'radni_nalozi_stavke'
      AND EXISTS (
        SELECT 1 FROM private.resource_deletion_rows row_change
        WHERE row_change.deletion_id = operation.id
          AND row_change.table_name = 'radni_nalozi_stavke'
          AND row_change.row_key = jsonb_build_object('id', NEW.id)
      )
  ) THEN RETURN NEW; END IF;
  SELECT * INTO source_item
  FROM public.radni_nalozi_stavke
  WHERE id = NEW.izvor_materijal_id
  FOR UPDATE;
  IF NOT FOUND
    OR source_item.id = NEW.id
    OR source_item.company_id IS DISTINCT FROM NEW.company_id
    OR source_item.gradiliste_id IS DISTINCT FROM NEW.gradiliste_id
    OR source_item.tip <> 'materijal'
    OR source_item.nalog_id IS NULL
    OR source_item.nalog_id IS NOT DISTINCT FROM NEW.nalog_id
    OR source_item.gotovo
    OR source_item.uzeto THEN
    RAISE EXCEPTION 'Izvorni materijal nije dostupan ili je već riješen.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_copied_material_source ON public.radni_nalozi_stavke;
CREATE TRIGGER validate_copied_material_source
  BEFORE INSERT OR UPDATE OF izvor_materijal_id ON public.radni_nalozi_stavke
  FOR EACH ROW EXECUTE FUNCTION private.validate_copied_material_source();

CREATE OR REPLACE FUNCTION private.delete_completed_material_copies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  copy_id uuid;
  copy_item public.radni_nalozi_stavke%ROWTYPE;
  operation_id uuid;
  history_sequence bigint;
BEGIN
  IF OLD.tip <> 'materijal'
    OR (OLD.gotovo OR OLD.uzeto)
    OR NOT (NEW.gotovo OR NEW.uzeto) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(max(sequence), 0)
  INTO history_sequence
  FROM private.business_change_history;

  FOR copy_id IN
    WITH RECURSIVE copies(id, depth) AS (
      SELECT id, 1
      FROM public.radni_nalozi_stavke
      WHERE izvor_materijal_id = NEW.id
        AND company_id = NEW.company_id
        AND tip = 'materijal'
      UNION ALL
      SELECT child.id, parent.depth + 1
      FROM public.radni_nalozi_stavke child
      JOIN copies parent ON child.izvor_materijal_id = parent.id
      WHERE child.company_id = NEW.company_id AND child.tip = 'materijal'
    )
    SELECT id FROM copies ORDER BY depth DESC, id
  LOOP
    SELECT * INTO copy_item
    FROM public.radni_nalozi_stavke
    WHERE id = copy_id AND company_id = NEW.company_id
    FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF operation_id IS NULL THEN
      INSERT INTO private.resource_deletions(company_id, module, table_name, record_id, snapshot, actor_name)
      VALUES (
        copy_item.company_id,
        'radni_nalozi',
        'radni_nalozi_stavke',
        copy_item.id,
        to_jsonb(copy_item),
        COALESCE((
          SELECT profile.email FROM public.app_profiles profile
          WHERE profile.id = auth.uid() AND profile.company_id = copy_item.company_id
        ), 'Korisnik')
      )
      RETURNING id INTO operation_id;
    END IF;

    DELETE FROM public.radni_nalozi_stavke WHERE id = copy_item.id;
    IF EXISTS (SELECT 1 FROM public.radni_nalozi_stavke WHERE id = copy_item.id)
      OR NOT EXISTS (
        SELECT 1 FROM private.resource_deletion_rows
        WHERE deletion_id = operation_id
          AND table_name = 'radni_nalozi_stavke'
          AND row_key = jsonb_build_object('id', copy_item.id)
          AND after_data IS NULL
      ) THEN
      RAISE EXCEPTION 'Kopirani materijal nije uklonjen i evidentiran. Izvorni materijal nije označen kao riješen.';
    END IF;
  END LOOP;

  IF operation_id IS NOT NULL THEN
    INSERT INTO private.resource_deletion_events
    SELECT operation_id, history.id
    FROM private.business_change_history history
    WHERE history.transaction_id = txid_current() AND history.sequence > history_sequence;
    UPDATE private.resource_deletions SET active = false WHERE id = operation_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS zzzzzz_delete_completed_material_copies ON public.radni_nalozi_stavke;
CREATE TRIGGER zzzzzz_delete_completed_material_copies
  AFTER UPDATE OF gotovo, uzeto ON public.radni_nalozi_stavke
  FOR EACH ROW EXECUTE FUNCTION private.delete_completed_material_copies();

CREATE OR REPLACE FUNCTION private.validate_copied_tool_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  source_item public.radni_nalozi_stavke%ROWTYPE;
BEGIN
  IF NEW.izvor_alat_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM private.resource_deletions operation
    WHERE operation.active AND operation.restoring
      AND operation.transaction_id = txid_current()
      AND operation.table_name = 'radni_nalozi_stavke'
      AND EXISTS (
        SELECT 1 FROM private.resource_deletion_rows row_change
        WHERE row_change.deletion_id = operation.id
          AND row_change.table_name = 'radni_nalozi_stavke'
          AND row_change.row_key = jsonb_build_object('id', NEW.id)
      )
  ) THEN RETURN NEW; END IF;
  SELECT * INTO source_item
  FROM public.radni_nalozi_stavke
  WHERE id = NEW.izvor_alat_id
  FOR UPDATE;
  IF NOT FOUND
    OR source_item.id = NEW.id
    OR source_item.company_id IS DISTINCT FROM NEW.company_id
    OR source_item.gradiliste_id IS DISTINCT FROM NEW.gradiliste_id
    OR source_item.tip <> 'alat'
    OR source_item.nalog_id IS NULL
    OR source_item.nalog_id IS NOT DISTINCT FROM NEW.nalog_id
    OR source_item.gotovo
    OR source_item.uzeto THEN
    RAISE EXCEPTION 'Izvorni alat nije dostupan ili je već riješen.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_copied_tool_source ON public.radni_nalozi_stavke;
CREATE TRIGGER validate_copied_tool_source
  BEFORE INSERT OR UPDATE OF izvor_alat_id ON public.radni_nalozi_stavke
  FOR EACH ROW EXECUTE FUNCTION private.validate_copied_tool_source();

CREATE OR REPLACE FUNCTION private.delete_completed_tool_copies()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  copy_id uuid;
  copy_item public.radni_nalozi_stavke%ROWTYPE;
  operation_id uuid;
  history_sequence bigint;
BEGIN
  IF OLD.tip <> 'alat'
    OR (OLD.gotovo OR OLD.uzeto)
    OR NOT (NEW.gotovo OR NEW.uzeto) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(max(sequence), 0)
  INTO history_sequence
  FROM private.business_change_history;

  FOR copy_id IN
    WITH RECURSIVE copies(id, depth) AS (
      SELECT id, 1
      FROM public.radni_nalozi_stavke
      WHERE izvor_alat_id = NEW.id
        AND company_id = NEW.company_id
        AND tip = 'alat'
      UNION ALL
      SELECT child.id, parent.depth + 1
      FROM public.radni_nalozi_stavke child
      JOIN copies parent ON child.izvor_alat_id = parent.id
      WHERE child.company_id = NEW.company_id AND child.tip = 'alat'
    )
    SELECT id FROM copies ORDER BY depth DESC, id
  LOOP
    SELECT * INTO copy_item
    FROM public.radni_nalozi_stavke
    WHERE id = copy_id AND company_id = NEW.company_id
    FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF operation_id IS NULL THEN
      INSERT INTO private.resource_deletions(company_id, module, table_name, record_id, snapshot, actor_name)
      VALUES (
        copy_item.company_id,
        'radni_nalozi',
        'radni_nalozi_stavke',
        copy_item.id,
        to_jsonb(copy_item),
        COALESCE((
          SELECT profile.email FROM public.app_profiles profile
          WHERE profile.id = auth.uid() AND profile.company_id = copy_item.company_id
        ), 'Korisnik')
      )
      RETURNING id INTO operation_id;
    END IF;

    DELETE FROM public.radni_nalozi_stavke WHERE id = copy_item.id;
    IF EXISTS (SELECT 1 FROM public.radni_nalozi_stavke WHERE id = copy_item.id)
      OR NOT EXISTS (
        SELECT 1 FROM private.resource_deletion_rows
        WHERE deletion_id = operation_id
          AND table_name = 'radni_nalozi_stavke'
          AND row_key = jsonb_build_object('id', copy_item.id)
          AND after_data IS NULL
      ) THEN
      RAISE EXCEPTION 'Kopirani alat nije uklonjen i evidentiran. Izvorni alat nije označen kao riješen.';
    END IF;
  END LOOP;

  IF operation_id IS NOT NULL THEN
    INSERT INTO private.resource_deletion_events
    SELECT operation_id, history.id
    FROM private.business_change_history history
    WHERE history.transaction_id = txid_current() AND history.sequence > history_sequence;
    UPDATE private.resource_deletions SET active = false WHERE id = operation_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS zzzzzz_delete_completed_tool_copies ON public.radni_nalozi_stavke;
CREATE TRIGGER zzzzzz_delete_completed_tool_copies
  AFTER UPDATE OF gotovo, uzeto ON public.radni_nalozi_stavke
  FOR EACH ROW EXECUTE FUNCTION private.delete_completed_tool_copies();

REVOKE ALL ON FUNCTION private.validate_copied_task_source(), private.delete_completed_task_copies(),
  private.validate_copied_material_source(), private.delete_completed_material_copies(),
  private.validate_copied_tool_source(), private.delete_completed_tool_copies()
  FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
