ALTER TABLE rokovi ADD COLUMN IF NOT EXISTS opis text;
ALTER TABLE rokovi ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'otvoren';
ALTER TABLE rokovi ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE rokovi ADD COLUMN IF NOT EXISTS nalog_id uuid REFERENCES radni_nalozi(id) ON DELETE CASCADE;
ALTER TABLE rokovi ALTER COLUMN gradiliste_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
