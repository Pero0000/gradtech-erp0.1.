CREATE FUNCTION public.save_work_order_preparation(
  p_nalog_id uuid,
  p_gradiliste_id uuid,
  p_naslov text,
  p_opis text,
  p_status text,
  p_prioritet text,
  p_rok date,
  p_radnik_ids uuid[],
  p_zakljucen boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  nalog public.radni_nalozi;
  leader_id uuid;
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja radnih naloga.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO nalog FROM public.radni_nalozi
  WHERE id = p_nalog_id AND company_id = public.app_current_company_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nalog nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501';
  END IF;
  IF nalog.status IN ('u_tijeku', 'zavrsen', 'otkazan')
    OR nalog.mobile_status IN ('u_tijeku', 'predan', 'odobren', 'zakljucen_bez_potvrde')
    OR EXISTS (
      SELECT 1 FROM public.radni_nalozi_radnici
      WHERE nalog_id = p_nalog_id AND (mobile_started_at IS NOT NULL OR mobile_finished_at IS NOT NULL)
    ) OR EXISTS (SELECT 1 FROM public.radno_vrijeme WHERE nalog_id = p_nalog_id) THEN
    RAISE EXCEPTION 'Ekipa se ne može mijenjati nakon početka rada ili evidentiranja sati.' USING ERRCODE = '55000';
  END IF;
  IF p_status IN ('u_tijeku', 'zavrsen', 'otkazan') OR p_status IS NULL THEN
    RAISE EXCEPTION 'Za pripremu naloga odaberi otvoreni status.' USING ERRCODE = '22023';
  END IF;
  IF p_radnik_ids IS NULL OR EXISTS (
    SELECT 1 FROM unnest(p_radnik_ids) worker_id
    WHERE worker_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.radnici WHERE id = worker_id AND company_id = nalog.company_id
    )
  ) THEN
    RAISE EXCEPTION 'Odabrani djelatnik nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501';
  END IF;
  IF p_zakljucen IS TRUE AND cardinality(p_radnik_ids) = 0 THEN
    RAISE EXCEPTION 'Dodijeli barem jednog djelatnika prije zaključivanja naloga.' USING ERRCODE = '22023';
  END IF;
  IF p_gradiliste_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.gradilista WHERE id = p_gradiliste_id AND company_id = nalog.company_id
  ) THEN
    RAISE EXCEPTION 'Gradilište nije dostupno u vašoj tvrtki.' USING ERRCODE = '42501';
  END IF;
  leader_id := CASE
    WHEN cardinality(p_radnik_ids) = 1 THEN p_radnik_ids[1]
    WHEN nalog.poslovodja_id = ANY(p_radnik_ids) THEN nalog.poslovodja_id
    ELSE NULL
  END;
  IF p_zakljucen IS TRUE AND leader_id IS NULL THEN
    RAISE EXCEPTION 'Prije zaključivanja odaberi dodijeljenog poslovođu u detaljima naloga.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.radni_nalozi_radnici
  WHERE nalog_id = p_nalog_id AND NOT (radnik_id = ANY(p_radnik_ids));
  INSERT INTO public.radni_nalozi_radnici (nalog_id, radnik_id)
  SELECT p_nalog_id, worker_id FROM (SELECT DISTINCT unnest(p_radnik_ids) AS worker_id) workers
  WHERE NOT EXISTS (
    SELECT 1 FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND radnik_id = worker_id
  );

  IF EXISTS (
    SELECT 1 FROM public.radni_nalozi_radnici
    WHERE nalog_id = p_nalog_id AND NOT (radnik_id = ANY(p_radnik_ids))
  ) OR EXISTS (
    SELECT 1 FROM unnest(p_radnik_ids) worker_id WHERE NOT EXISTS (
      SELECT 1 FROM public.radni_nalozi_radnici WHERE nalog_id = p_nalog_id AND radnik_id = worker_id
    )
  ) THEN
    RAISE EXCEPTION 'Ekipa nije spremljena. Provjeri prava za uređivanje naloga.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.radni_nalozi
  SET gradiliste_id = p_gradiliste_id, naslov = p_naslov, opis = p_opis,
      status = p_status, prioritet = p_prioritet, rok = p_rok,
      bez_izvrsenja = false,
      poslovodja_id = leader_id,
      vozac_id = CASE WHEN vozac_id = ANY(p_radnik_ids) THEN vozac_id ELSE NULL END,
      zakljucen_at = CASE WHEN p_zakljucen IS NULL THEN
          CASE WHEN zakljucen_at IS NOT NULL THEN clock_timestamp() ELSE NULL END
        WHEN p_zakljucen THEN clock_timestamp() ELSE NULL END,
      mobile_status = CASE WHEN p_zakljucen IS NULL THEN mobile_status
        WHEN p_zakljucen THEN 'dodijeljen' ELSE 'nije_poslan' END
  WHERE id = p_nalog_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nalog nije spremljen. Provjeri prava za uređivanje naloga.' USING ERRCODE = '42501';
  END IF;

  IF p_zakljucen IS FALSE THEN
    UPDATE public.radni_nalozi_radnici
    SET mobile_reviewed_sections = '{}', mobile_started_at = NULL, mobile_finished_at = NULL,
        vrijeme_od = NULL, vrijeme_do = NULL
    WHERE nalog_id = p_nalog_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_work_order_preparation(
  uuid, uuid, text, text, text, text, date, uuid[], boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_work_order_preparation(
  uuid, uuid, text, text, text, text, date, uuid[], boolean
) TO authenticated;

COMMENT ON FUNCTION public.save_work_order_preparation(
  uuid, uuid, text, text, text, text, date, uuid[], boolean
) IS 'Spremanje ekipe prije početka rada i ponovno slanje istog naloga u jednoj transakciji, uz postojeći RLS. Za više djelatnika potreban je odabrani poslovođa.';

DROP FUNCTION public.get_mobile_radni_nalozi();
CREATE FUNCTION public.get_mobile_radni_nalozi()
RETURNS TABLE (
  id uuid, broj text, gradiliste_naziv text, gradiliste_adresa text,
  naslov text, opis text, status text, prioritet text, rok date,
  mobile_status text, poslovodja_id uuid, mobile_reviewed_sections text[],
  mobile_started_at timestamptz, mobile_finished_at timestamptz,
  vrijeme_od time, vrijeme_do time, zakljucen_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT n.id, n.broj, g.naziv, g.adresa, n.naslov, n.opis,
    n.status, n.prioritet, n.rok, n.mobile_status, n.poslovodja_id,
    a.mobile_reviewed_sections, a.mobile_started_at, a.mobile_finished_at,
    a.vrijeme_od, a.vrijeme_do, n.zakljucen_at
  FROM public.radni_nalozi n
  JOIN public.radni_nalozi_radnici a ON a.nalog_id = n.id AND a.company_id = n.company_id
  LEFT JOIN public.gradilista g ON g.id = n.gradiliste_id AND g.company_id = n.company_id
  WHERE n.company_id = public.app_current_company_id()
    AND n.zakljucen_at IS NOT NULL AND n.status <> 'otkazan'
    AND a.radnik_id = public.app_mobile_radnik_id()
    AND public.app_mobile_radnik_id() IS NOT NULL
  ORDER BY n.rok NULLS LAST, n.datum_kreiranja DESC;
$$;
REVOKE ALL ON FUNCTION public.get_mobile_radni_nalozi() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mobile_radni_nalozi() TO authenticated;

NOTIFY pgrst, 'reload schema';
