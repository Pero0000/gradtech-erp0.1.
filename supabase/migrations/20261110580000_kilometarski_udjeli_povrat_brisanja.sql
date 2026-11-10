INSERT INTO private.resource_recovery_tables (table_name, key_columns)
VALUES (
  'dnevni_kilometarski_udjeli',
  ARRAY['company_id', 'datum', 'vozilo_id', 'gradiliste_id']
)
ON CONFLICT (table_name) DO UPDATE SET key_columns = EXCLUDED.key_columns;

DROP TRIGGER IF EXISTS zzzz_resource_recovery ON public.dnevni_kilometarski_udjeli;
CREATE TRIGGER zzzz_resource_recovery
  AFTER INSERT OR UPDATE OR DELETE ON public.dnevni_kilometarski_udjeli
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
    WHEN p_table IN ('raspored', 'raspored_radnici', 'raspored_vozila', 'dnevni_raspored_gradilista', 'dnevni_raspored_radnici', 'dnevni_raspored_ostalo', 'raspored_objave', 'dnevni_kilometarski_udjeli') THEN 'raspored'
    WHEN p_table = 'radno_vrijeme' THEN 'radno_vrijeme'
    WHEN p_table LIKE 'radni_nalozi%' OR p_table IN ('nalog_gradiliste_dokumenti', 'mobile_work_order_audit') THEN 'radni_nalozi'
    WHEN p_table = 'app_profiles' THEN 'admin'
    WHEN p_table IN ('troskovi', 'osobni_auto_voznje') THEN 'troskovi'
    WHEN p_table = 'kooperant_dokumenti' THEN 'kooperanti'
    ELSE 'unsupported' END;
$$;
