ALTER TABLE public.fakture
  ADD COLUMN IF NOT EXISTS rabat numeric(12,2) NOT NULL DEFAULT 0
  CHECK (rabat >= 0);