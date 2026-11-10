DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT constraint_row.conname
    FROM pg_constraint constraint_row
    JOIN pg_attribute column_row
      ON column_row.attrelid = constraint_row.conrelid
     AND column_row.attnum = ANY(constraint_row.conkey)
    WHERE constraint_row.conrelid = 'public.osobni_auto_voznje'::regclass
      AND constraint_row.contype = 'f'
      AND column_row.attname = 'gradiliste_id'
      AND constraint_row.confrelid = 'public.gradilista'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.osobni_auto_voznje DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE public.osobni_auto_voznje
    ADD CONSTRAINT osobni_auto_voznje_gradiliste_id_set_null_fkey
    FOREIGN KEY (gradiliste_id) REFERENCES public.gradilista(id) ON DELETE SET NULL;
END;
$$;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT constraint_row.conname
    FROM pg_constraint constraint_row
    JOIN pg_attribute column_row
      ON column_row.attrelid = constraint_row.conrelid
     AND column_row.attnum = ANY(constraint_row.conkey)
    WHERE constraint_row.conrelid = 'public.osobni_auto_voznje'::regclass
      AND constraint_row.contype = 'f'
      AND column_row.attname = 'trosak_id'
      AND constraint_row.confrelid = 'public.troskovi'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.osobni_auto_voznje DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE public.osobni_auto_voznje
    ADD CONSTRAINT osobni_auto_voznje_trosak_id_set_null_fkey
    FOREIGN KEY (trosak_id) REFERENCES public.troskovi(id) ON DELETE SET NULL;
END;
$$;

DO $$
DECLARE
  check_constraint record;
BEGIN
  FOR check_constraint IN
    SELECT constraint_row.conname, pg_get_constraintdef(constraint_row.oid) AS definition
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.osobni_auto_voznje'::regclass
      AND constraint_row.contype = 'c'
  LOOP
    IF check_constraint.definition LIKE '%gradiliste_id IS NULL%'
      AND check_constraint.definition LIKE '%gradiliste_naziv IS NULL%'
      AND check_constraint.definition LIKE '%trosak_id IS NULL%' THEN
      EXECUTE format('ALTER TABLE public.osobni_auto_voznje DROP CONSTRAINT %I', check_constraint.conname);
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.osobni_auto_voznje
  ADD CONSTRAINT osobni_auto_voznje_site_snapshot_check CHECK (
    (
      gradiliste_id IS NULL
      AND gradiliste_naziv IS NULL
      AND trosak_id IS NULL
      AND iznos = 0
    )
    OR (
      gradiliste_naziv IS NOT NULL
      AND cijena_km > 0
      AND (
        gradiliste_id IS NULL
        OR trosak_id IS NOT NULL
      )
    )
  );

INSERT INTO private.resource_recovery_tables (table_name, key_columns)
VALUES ('osobni_auto_voznje', ARRAY['id'])
ON CONFLICT (table_name) DO UPDATE SET key_columns = EXCLUDED.key_columns;

DROP TRIGGER IF EXISTS zzzz_resource_recovery ON public.osobni_auto_voznje;
CREATE TRIGGER zzzz_resource_recovery
  AFTER INSERT OR UPDATE OR DELETE ON public.osobni_auto_voznje
  FOR EACH ROW EXECUTE FUNCTION private.capture_resource_recovery_row();

CREATE OR REPLACE FUNCTION private.resource_recovery_module(p_table text, p_data jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_table IN ('gradilista', 'gradiliste_board_layout', 'gradiliste_zadaci', 'gradiliste_dokumenti', 'gradiliste_stavke', 'rokovi', 'ugovoreni_radovi') THEN 'gradilista'
    WHEN p_table = 'fakture' THEN 'fakture'
    WHEN p_table IN ('ponude', 'ponude_stavke') THEN 'ponude'
    WHEN p_table = 'kooperant_angazmani' THEN 'kooperanti'
    WHEN p_table IN ('radnici', 'radnici_dokumenti', 'radnici_odsustva', 'radnici_povijest', 'radnik_dokument_kategorije') THEN 'radnici'
    WHEN p_table IN ('vozila', 'vozila_dokumenti', 'vozila_gorivo', 'vozila_obavijesti', 'vozila_gorivo_anomalije') THEN 'vozila'
    WHEN p_table = 'oprema' THEN CASE p_data->>'kategorija' WHEN 'alat' THEN 'alat' ELSE 'strojevi' END
    WHEN p_table = 'oprema_dokumenti' THEN 'oprema'
    WHEN p_table IN ('raspored', 'raspored_radnici', 'raspored_vozila', 'dnevni_raspored_gradilista', 'dnevni_raspored_radnici', 'dnevni_raspored_ostalo', 'raspored_objave') THEN 'raspored'
    WHEN p_table = 'radno_vrijeme' THEN 'radno_vrijeme'
    WHEN p_table LIKE 'radni_nalozi%' OR p_table IN ('nalog_gradiliste_dokumenti', 'mobile_work_order_audit') THEN 'radni_nalozi'
    WHEN p_table = 'app_profiles' THEN 'admin'
    WHEN p_table IN ('troskovi', 'osobni_auto_voznje') THEN 'troskovi'
    WHEN p_table = 'kooperant_dokumenti' THEN 'kooperanti'
    ELSE 'unsupported' END;
$$;
