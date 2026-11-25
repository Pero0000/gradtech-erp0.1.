-- Kvačica "uzeto" završava materijal/alati jednako kao "gotovo".
-- Usklađuje stare zapise prije strožeg filtriranja pri prijenosu na novi nalog.
UPDATE public.radni_nalozi_stavke
SET gotovo = true
WHERE uzeto = true
  AND gotovo = false;

CREATE INDEX IF NOT EXISTS idx_radni_nalozi_stavke_otvorene
  ON public.radni_nalozi_stavke (gradiliste_id, nalog_id)
  WHERE gotovo = false AND uzeto = false AND preneseno = false;

NOTIFY pgrst, 'reload schema';
