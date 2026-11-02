ALTER TABLE public.kooperanti
  ADD COLUMN IF NOT EXISTS timeline_color text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kooperanti_timeline_color_check'
      AND conrelid = 'public.kooperanti'::regclass
  ) THEN
    ALTER TABLE public.kooperanti
      ADD CONSTRAINT kooperanti_timeline_color_check
      CHECK (timeline_color IS NULL OR timeline_color ~ '^#[0-9A-Fa-F]{6}$');
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
