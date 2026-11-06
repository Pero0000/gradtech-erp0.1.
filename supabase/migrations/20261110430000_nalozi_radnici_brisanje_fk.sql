BEGIN;

-- Older installations may already have this table with a non-cascading FK.
-- CREATE TABLE IF NOT EXISTS in the original migration did not repair that FK.
DO $$
DECLARE
  constraint_row record;
  update_action text;
  timing text;
  found_fk boolean := false;
BEGIN
  FOR constraint_row IN
    SELECT fk.* FROM pg_constraint fk
    WHERE fk.contype = 'f'
      AND fk.conrelid = 'public.radni_nalozi_radnici'::regclass
      AND fk.confrelid = 'public.radni_nalozi'::regclass
      AND fk.conkey = ARRAY[(SELECT attnum FROM pg_attribute
        WHERE attrelid = fk.conrelid AND attname = 'nalog_id')]::smallint[]
      AND fk.confkey = ARRAY[(SELECT attnum FROM pg_attribute
        WHERE attrelid = fk.confrelid AND attname = 'id')]::smallint[]
  LOOP
    found_fk := true;
    IF constraint_row.confdeltype = 'c' THEN CONTINUE; END IF;
    update_action := CASE constraint_row.confupdtype
      WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT'
    END;
    timing := CASE WHEN constraint_row.condeferrable
      THEN CASE WHEN constraint_row.condeferred THEN 'DEFERRABLE INITIALLY DEFERRED'
        ELSE 'DEFERRABLE INITIALLY IMMEDIATE' END
      ELSE 'NOT DEFERRABLE' END;
    EXECUTE format('ALTER TABLE public.radni_nalozi_radnici DROP CONSTRAINT %I', constraint_row.conname);
    EXECUTE format('ALTER TABLE public.radni_nalozi_radnici ADD CONSTRAINT %I
      FOREIGN KEY (nalog_id) REFERENCES public.radni_nalozi(id)
      ON UPDATE %s ON DELETE CASCADE %s',
      constraint_row.conname, update_action, timing);
  END LOOP;
  IF NOT found_fk THEN
    ALTER TABLE public.radni_nalozi_radnici
      ADD CONSTRAINT radni_nalozi_radnici_nalog_id_fkey
      FOREIGN KEY (nalog_id) REFERENCES public.radni_nalozi(id) ON DELETE CASCADE;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
