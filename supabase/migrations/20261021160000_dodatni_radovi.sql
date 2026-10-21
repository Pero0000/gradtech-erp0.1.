-- "Dodatni radovi": ista tablica i isto ponašanje kao radni zadaci (veza s nalogom, prijenos na idući nalog,
-- vraćanje na gradilište, rokovi, mobilna aplikacija), razlikuju se samo po vrsti.
ALTER TABLE public.gradiliste_zadaci
  ADD COLUMN IF NOT EXISTS vrsta text NOT NULL DEFAULT 'zadatak';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gradiliste_zadaci_vrsta_check' AND conrelid = 'public.gradiliste_zadaci'::regclass
  ) THEN
    ALTER TABLE public.gradiliste_zadaci
      ADD CONSTRAINT gradiliste_zadaci_vrsta_check CHECK (vrsta IN ('zadatak', 'dodatni'));
  END IF;
END;
$$;

-- Mobilna aplikacija: potvrda dijela "Dodatni radovi" (ili "nije primjenjivo").
CREATE OR REPLACE FUNCTION public.mobile_save_nalog_izvjestaj(
  p_nalog_id uuid,
  p_km_pocetak integer,
  p_km_kraj integer,
  p_km_na boolean,
  p_enc_stanje numeric,
  p_potvrde text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_leader boolean := public.app_mobile_leads_nalog(p_nalog_id);
  allowed text[] := ARRAY[
    'poslovi', 'poslovi:na', 'dodatni', 'dodatni:na', 'foto', 'foto:na', 'materijal', 'materijal:na',
    'alat', 'alat:na', 'strojevi', 'strojevi:na', 'vrijeme', 'enc', 'enc:na', 'km_kraj', 'km_kraj:na'
  ];
  potvrde text[];
BEGIN
  IF NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan za uređivanje.';
  END IF;
  IF (p_km_pocetak IS NOT NULL AND p_km_pocetak < 0) OR (p_km_kraj IS NOT NULL AND p_km_kraj < 0) THEN
    RAISE EXCEPTION 'Kilometri moraju biti pozitivni brojevi.';
  END IF;
  IF p_enc_stanje IS NOT NULL AND p_enc_stanje < 0 THEN
    RAISE EXCEPTION 'Stanje ENC-a ne može biti negativno.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT item), ARRAY[]::text[])
  INTO potvrde
  FROM unnest(COALESCE(p_potvrde, ARRAY[]::text[])) AS item
  WHERE item = ANY(allowed);

  UPDATE public.radni_nalozi
  SET km_pocetak = CASE WHEN COALESCE(CASE WHEN is_leader THEN p_km_na END, mobile_km_na) THEN NULL ELSE p_km_pocetak END,
    km_kraj = CASE
      WHEN COALESCE(CASE WHEN is_leader THEN p_km_na END, mobile_km_na)
        OR 'km_kraj:na' = ANY(CASE WHEN is_leader THEN potvrde ELSE mobile_potvrde END) THEN NULL
      ELSE p_km_kraj
    END,
    enc_stanje = p_enc_stanje,
    mobile_km_na = CASE WHEN is_leader THEN COALESCE(p_km_na, false) ELSE mobile_km_na END,
    mobile_potvrde = CASE WHEN is_leader THEN potvrde ELSE mobile_potvrde END,
    mobile_tasks_confirmed = CASE WHEN is_leader THEN potvrde && ARRAY['poslovi', 'poslovi:na'] ELSE mobile_tasks_confirmed END,
    mobile_foto_na = CASE WHEN is_leader THEN 'foto:na' = ANY(potvrde) ELSE mobile_foto_na END,
    mobile_materijal_na = CASE WHEN is_leader THEN 'materijal:na' = ANY(potvrde) ELSE mobile_materijal_na END,
    mobile_alat_na = CASE WHEN is_leader THEN 'alat:na' = ANY(potvrde) ELSE mobile_alat_na END
  WHERE id = p_nalog_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mobile_submit_nalog(p_nalog_id uuid, p_leader_confirmed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  nalog public.radni_nalozi%ROWTYPE;
  section record;
BEGIN
  IF NOT public.app_mobile_leads_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Samo dodijeljeni poslovođa može zaključiti nalog.';
  END IF;
  IF p_leader_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'Poslovođa mora potvrditi sve dijelove naloga.';
  END IF;

  SELECT * INTO nalog FROM public.radni_nalozi WHERE id = p_nalog_id;
  IF NOT FOUND OR nalog.mobile_status <> 'u_tijeku' THEN
    RAISE EXCEPTION 'Nalog nije u tijeku.';
  END IF;

  FOR section IN
    SELECT * FROM (VALUES
      ('poslovi', 'Poslovi'),
      ('foto', 'Fotografije'),
      ('materijal', 'Materijal'),
      ('alat', 'Alat'),
      ('strojevi', 'Strojevi')
    ) AS s(kljuc, naziv)
  LOOP
    IF NOT (section.kljuc = ANY(nalog.mobile_potvrde) OR (section.kljuc || ':na') = ANY(nalog.mobile_potvrde)) THEN
      RAISE EXCEPTION 'Potvrdi dio "%" ili označi da nije primjenjiv.', section.naziv;
    END IF;
  END LOOP;

  -- Potvrda dodatnih radova traži se kad ih nalog ima (starije verzije aplikacije nemaju tu potvrdu).
  IF EXISTS (SELECT 1 FROM public.gradiliste_zadaci WHERE nalog_id = p_nalog_id AND vrsta = 'dodatni')
    AND NOT ('dodatni' = ANY(nalog.mobile_potvrde) OR 'dodatni:na' = ANY(nalog.mobile_potvrde)) THEN
    RAISE EXCEPTION 'Potvrdi dio "Dodatni radovi" ili označi da nije primjenjiv.';
  END IF;

  IF 'foto' = ANY(nalog.mobile_potvrde) AND NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi_foto WHERE nalog_id = p_nalog_id
  ) THEN
    RAISE EXCEPTION 'Dodaj barem jednu fotografiju ili označi da fotografija nije primjenjiva.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND (vrijeme_od IS NULL OR vrijeme_do IS NULL OR mobile_finished_at IS NULL)
  ) OR NOT ('vrijeme' = ANY(nalog.mobile_potvrde)) THEN
    RAISE EXCEPTION 'Potvrdi radno vrijeme cijele ekipe.';
  END IF;

  IF NOT (nalog.enc_stanje IS NOT NULL AND 'enc' = ANY(nalog.mobile_potvrde) OR 'enc:na' = ANY(nalog.mobile_potvrde)) THEN
    RAISE EXCEPTION 'Upiši i potvrdi stanje ENC-a ili označi da nije primjenjivo.';
  END IF;

  IF NOT (nalog.mobile_km_na OR 'km_kraj:na' = ANY(nalog.mobile_potvrde) OR (
    nalog.km_pocetak IS NOT NULL AND nalog.km_kraj IS NOT NULL
    AND nalog.km_kraj >= nalog.km_pocetak
    AND 'km_kraj' = ANY(nalog.mobile_potvrde)
  )) THEN
    RAISE EXCEPTION 'Upiši i potvrdi kilometre povratka (ne smiju biti manji od početnih) ili označi da nisu primjenjivi.';
  END IF;

  UPDATE public.radni_nalozi SET mobile_status = 'predan' WHERE id = p_nalog_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mobile_save_nalog_izvjestaj(uuid, integer, integer, boolean, numeric, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_save_nalog_izvjestaj(uuid, integer, integer, boolean, numeric, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.mobile_submit_nalog(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_submit_nalog(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
