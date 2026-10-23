ALTER TABLE public.radni_nalozi
  DROP CONSTRAINT IF EXISTS radni_nalozi_mobile_status_check;

ALTER TABLE public.radni_nalozi
  ADD CONSTRAINT radni_nalozi_mobile_status_check
  CHECK (mobile_status IN (
    'nije_poslan',
    'dodijeljen',
    'u_tijeku',
    'predan',
    'odobren',
    'zakljucen_bez_potvrde'
  ));

NOTIFY pgrst, 'reload schema';
