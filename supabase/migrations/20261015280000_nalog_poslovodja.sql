ALTER TABLE radni_nalozi ADD COLUMN IF NOT EXISTS poslovodja_id uuid REFERENCES radnici(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
