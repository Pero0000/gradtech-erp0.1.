ALTER TABLE public.rokovi
  ADD COLUMN IF NOT EXISTS datum_pocetka date,
  ADD COLUMN IF NOT EXISTS datum_zavrsetka date;

UPDATE public.rokovi
SET
  datum_pocetka = COALESCE(datum_pocetka, datum),
  datum_zavrsetka = COALESCE(datum_zavrsetka, datum);

ALTER TABLE public.rokovi
  ALTER COLUMN datum_pocetka SET NOT NULL,
  ALTER COLUMN datum_zavrsetka SET NOT NULL,
  ADD CONSTRAINT rokovi_datum_raspon_check CHECK (datum_zavrsetka >= datum_pocetka);

NOTIFY pgrst, 'reload schema';
