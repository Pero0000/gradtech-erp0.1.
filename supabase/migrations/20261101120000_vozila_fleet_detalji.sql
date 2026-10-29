ALTER TABLE public.vozila
  DROP CONSTRAINT IF EXISTS vozila_status_check;

ALTER TABLE public.vozila
  ADD CONSTRAINT vozila_status_check
  CHECK (status IN ('slobodno', 'zauzeto', 'servis', 'neispravno'));

ALTER TABLE public.vozila_dokumenti
  ADD COLUMN IF NOT EXISTS serviser text,
  ADD COLUMN IF NOT EXISTS dijelovi text;

NOTIFY pgrst, 'reload schema';
