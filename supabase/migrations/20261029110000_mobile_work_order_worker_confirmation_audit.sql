DROP FUNCTION IF EXISTS public.mobile_submit_nalog(uuid, boolean);

CREATE OR REPLACE FUNCTION public.mobile_submit_nalog(p_nalog_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  nalog public.radni_nalozi%ROWTYPE;
  section record;
BEGIN
  IF NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dostupan za uređivanje ili je ured već završno zaključio nalog.';
  END IF;

  SELECT * INTO nalog FROM public.radni_nalozi WHERE id = p_nalog_id;
  IF NOT FOUND OR nalog.mobile_status NOT IN ('u_tijeku', 'predan') THEN
    RAISE EXCEPTION 'Nalog nije spreman za predaju.';
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
    IF NOT (section.kljuc = ANY(COALESCE(nalog.mobile_potvrde, ARRAY[]::text[]))
      OR (section.kljuc || ':na') = ANY(COALESCE(nalog.mobile_potvrde, ARRAY[]::text[]))) THEN
      RAISE EXCEPTION 'Potvrdi dio "%" ili označi da nije primjenjiv.', section.naziv;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.gradiliste_zadaci WHERE nalog_id = p_nalog_id AND vrsta = 'dodatni')
    AND NOT ('dodatni' = ANY(COALESCE(nalog.mobile_potvrde, ARRAY[]::text[]))
      OR 'dodatni:na' = ANY(COALESCE(nalog.mobile_potvrde, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'Potvrdi dio "Dodatni radovi" ili označi da nije primjenjiv.';
  END IF;

  IF 'foto' = ANY(COALESCE(nalog.mobile_potvrde, ARRAY[]::text[])) AND NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi_foto WHERE nalog_id = p_nalog_id
  ) THEN
    RAISE EXCEPTION 'Dodaj barem jednu fotografiju ili označi da fotografija nije primjenjiva.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND (vrijeme_od IS NULL OR vrijeme_do IS NULL OR mobile_finished_at IS NULL)
  ) OR NOT ('vrijeme' = ANY(COALESCE(nalog.mobile_potvrde, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'Potvrdi radno vrijeme cijele ekipe.';
  END IF;

  IF NOT (
    nalog.enc_stanje IS NOT NULL AND 'enc' = ANY(COALESCE(nalog.mobile_potvrde, ARRAY[]::text[]))
    OR 'enc:na' = ANY(COALESCE(nalog.mobile_potvrde, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'Upiši i potvrdi stanje ENC-a ili označi da nije primjenjivo.';
  END IF;

  IF NOT (
    nalog.mobile_km_na
    OR 'km_kraj:na' = ANY(COALESCE(nalog.mobile_potvrde, ARRAY[]::text[]))
    OR (
      nalog.km_pocetak IS NOT NULL AND nalog.km_kraj IS NOT NULL
      AND nalog.km_kraj >= nalog.km_pocetak
      AND 'km_kraj' = ANY(COALESCE(nalog.mobile_potvrde, ARRAY[]::text[]))
    )
  ) THEN
    RAISE EXCEPTION 'Upiši i potvrdi kilometre povratka (ne smiju biti manji od početnih) ili označi da nisu primjenjivi.';
  END IF;

  UPDATE public.radni_nalozi SET mobile_status = 'predan' WHERE id = p_nalog_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mobile_submit_nalog(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_submit_nalog(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_mobile_work_order_confirmation_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.mobile_potvrde IS DISTINCT FROM NEW.mobile_potvrde THEN
    PERFORM public.write_mobile_work_order_audit(
      NEW.id,
      'report_confirmations_updated',
      jsonb_build_object(
        'old_potvrde', COALESCE(OLD.mobile_potvrde, ARRAY[]::text[]),
        'new_potvrde', COALESCE(NEW.mobile_potvrde, ARRAY[]::text[])
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_mobile_work_order_confirmation_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mobile_audit_order_confirmation_changes ON public.radni_nalozi;
CREATE TRIGGER mobile_audit_order_confirmation_changes
AFTER UPDATE OF mobile_potvrde ON public.radni_nalozi
FOR EACH ROW EXECUTE FUNCTION public.audit_mobile_work_order_confirmation_change();

NOTIFY pgrst, 'reload schema';
