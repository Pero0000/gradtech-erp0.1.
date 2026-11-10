INSERT INTO private.resource_recovery_tables (table_name, key_columns)
VALUES ('radni_nalozi_voznje', ARRAY['id'])
ON CONFLICT (table_name) DO UPDATE SET key_columns = EXCLUDED.key_columns;

DROP TRIGGER IF EXISTS zzzz_resource_recovery ON public.radni_nalozi_voznje;
CREATE TRIGGER zzzz_resource_recovery
  AFTER INSERT OR UPDATE OR DELETE ON public.radni_nalozi_voznje
  FOR EACH ROW EXECUTE FUNCTION private.capture_resource_recovery_row();
