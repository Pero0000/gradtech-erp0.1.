ALTER TABLE public.vozila
  ADD COLUMN IF NOT EXISTS jamstvo_aktivno boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS jamstvo_od date,
  ADD COLUMN IF NOT EXISTS jamstvo_mjeseci integer,
  ADD COLUMN IF NOT EXISTS jamstvo_do_km integer,
  ADD COLUMN IF NOT EXISTS jamstvo_uvjeti text,
  ADD CONSTRAINT vozila_jamstvo_mjeseci_check CHECK (jamstvo_mjeseci IS NULL OR jamstvo_mjeseci > 0),
  ADD CONSTRAINT vozila_jamstvo_km_check CHECK (jamstvo_do_km IS NULL OR jamstvo_do_km >= 0);

ALTER TABLE public.oprema
  ADD COLUMN IF NOT EXISTS jamstvo_aktivno boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS jamstvo_od date,
  ADD COLUMN IF NOT EXISTS jamstvo_mjeseci integer,
  ADD COLUMN IF NOT EXISTS jamstvo_do_radnih_sati numeric,
  ADD COLUMN IF NOT EXISTS jamstvo_uvjeti text,
  ADD CONSTRAINT oprema_jamstvo_mjeseci_check CHECK (jamstvo_mjeseci IS NULL OR jamstvo_mjeseci > 0),
  ADD CONSTRAINT oprema_jamstvo_radni_sati_check CHECK (jamstvo_do_radnih_sati IS NULL OR jamstvo_do_radnih_sati >= 0);

NOTIFY pgrst, 'reload schema';
