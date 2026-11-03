ALTER TABLE public.objekti
  ADD COLUMN IF NOT EXISTS znanje jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'objekti_znanje_array_check'
      AND conrelid = 'public.objekti'::regclass
  ) THEN
    ALTER TABLE public.objekti
      ADD CONSTRAINT objekti_znanje_array_check
      CHECK (jsonb_typeof(znanje) = 'array');
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
