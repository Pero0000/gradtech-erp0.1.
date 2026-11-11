DO $migration$
DECLARE
  routine record;
  definition text;
  error_pattern constant text := $pattern$(\mERRCODE[[:space:]]*=[[:space:]]*)'40001'$pattern$;
BEGIN
  FOR routine IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname IN ('public', 'private')
      AND l.lanname = 'plpgsql'
      AND p.prokind = 'f'
      AND p.prosrc ~* error_pattern
    ORDER BY p.oid
  LOOP
    definition := pg_get_functiondef(routine.oid);
    -- Preserve the installed function, changing only explicit business-error assignments.
    EXECUTE regexp_replace(definition, error_pattern, $replacement$\1'P0001'$replacement$, 'gi');
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname IN ('public', 'private')
      AND l.lanname = 'plpgsql'
      AND p.prokind = 'f'
      AND p.prosrc ~* error_pattern
  ) THEN
    RAISE EXCEPTION 'Nisu zamijenjeni svi poslovni kodovi greške 40001.';
  END IF;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
