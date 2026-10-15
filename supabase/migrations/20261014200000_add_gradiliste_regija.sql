ALTER TABLE public.gradilista
  ADD COLUMN IF NOT EXISTS regija text;

ALTER TABLE public.gradilista
  DROP CONSTRAINT IF EXISTS gradilista_regija_check;

ALTER TABLE public.gradilista
  ADD CONSTRAINT gradilista_regija_check
  CHECK (
    regija IS NULL OR regija IN (
      'dalmacija',
      'istra_kvarner',
      'slavonija',
      'zagreb_i_okolica',
      'medimurje'
    )
  );

NOTIFY pgrst, 'reload schema';
