DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT fk.conname
    FROM pg_constraint fk
    JOIN pg_attribute column_row
      ON column_row.attrelid = fk.conrelid
     AND column_row.attnum = ANY(fk.conkey)
    WHERE fk.conrelid = 'public.radni_nalozi'::regclass
      AND fk.contype = 'f'
      AND column_row.attname = 'gradiliste_id'
      AND fk.confrelid = 'public.gradilista'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.radni_nalozi DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE public.radni_nalozi
    ADD CONSTRAINT radni_nalozi_gradiliste_id_fkey
    FOREIGN KEY (gradiliste_id) REFERENCES public.gradilista(id) ON DELETE CASCADE;
END;
$$;
