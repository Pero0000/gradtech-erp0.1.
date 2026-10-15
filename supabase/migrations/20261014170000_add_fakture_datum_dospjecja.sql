ALTER TABLE public.fakture
  ADD COLUMN IF NOT EXISTS datum_dospjecja date;

NOTIFY pgrst, 'reload schema';
