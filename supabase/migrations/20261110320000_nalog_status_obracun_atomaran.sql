CREATE OR REPLACE FUNCTION public.set_work_order_status_with_settlement(
  p_nalog_id uuid,
  p_zavrsen boolean,
  p_bez_potvrde_djelatnika boolean,
  p_bez_izvrsenja boolean,
  p_spremi_izvrsenje boolean,
  p_km_pocetak numeric,
  p_km_kraj numeric,
  p_napomena text,
  p_entries jsonb,
  p_costs jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  company uuid := public.app_current_company_id();
  order_row public.radni_nalozi%ROWTYPE;
  next_mobile_status text;
  operation_id uuid;
BEGIN
  IF NOT public.app_has_module_permission('radni_nalozi', 'edit') THEN
    RAISE EXCEPTION 'Nedostaje pravo uređivanja radnih naloga.' USING ERRCODE = '42501';
  END IF;
  IF p_zavrsen IS NULL OR p_bez_potvrde_djelatnika IS NULL OR p_bez_izvrsenja IS NULL
    OR p_spremi_izvrsenje IS NULL THEN
    RAISE EXCEPTION 'Nedostaju podaci zaključivanja naloga.' USING ERRCODE = '22023';
  END IF;
  IF p_spremi_izvrsenje AND (
    (p_km_pocetak IS NOT NULL AND (p_km_pocetak::text IN ('NaN', 'Infinity', '-Infinity') OR p_km_pocetak < 0))
    OR (p_km_kraj IS NOT NULL AND (p_km_kraj::text IN ('NaN', 'Infinity', '-Infinity') OR p_km_kraj < 0))
    OR (p_km_pocetak IS NOT NULL AND p_km_kraj IS NOT NULL AND p_km_kraj < p_km_pocetak)
  ) THEN
    RAISE EXCEPTION 'Kilometraža naloga nije ispravna.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO order_row FROM public.radni_nalozi
  WHERE id = p_nalog_id AND company_id = company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nalog nije dostupan u vašoj tvrtki.' USING ERRCODE = '42501'; END IF;
  IF p_bez_izvrsenja AND (
    NOT p_zavrsen OR order_row.status IN ('zavrsen', 'otkazan')
  ) THEN
    RAISE EXCEPTION 'Bez izvršenja može se završiti samo otvoren nalog koji još nije zaključen ili otkazan.'
      USING ERRCODE = '22023';
  END IF;
  IF p_zavrsen AND NOT p_bez_potvrde_djelatnika AND NOT p_bez_izvrsenja
    AND order_row.mobile_status IN ('dodijeljen', 'u_tijeku') THEN
    RAISE EXCEPTION 'Djelatnici još rade na nalogu. Zaključivanje je moguće tek nakon predaje završnog izvještaja.'
      USING ERRCODE = '55000';
  END IF;

  next_mobile_status := CASE
    WHEN order_row.mobile_status IN ('predan', 'odobren')
      THEN CASE WHEN p_zavrsen THEN 'odobren' ELSE 'predan' END
    WHEN p_bez_potvrde_djelatnika AND p_zavrsen THEN 'zakljucen_bez_potvrde'
    WHEN NOT p_zavrsen AND order_row.mobile_status = 'zakljucen_bez_potvrde' THEN 'u_tijeku'
    ELSE order_row.mobile_status
  END;

  UPDATE public.radni_nalozi
  SET status = CASE WHEN p_zavrsen THEN 'zavrsen' ELSE 'u_tijeku' END,
      mobile_status = CASE WHEN p_zavrsen AND p_bez_izvrsenja THEN 'nije_poslan' ELSE next_mobile_status END,
      zakljucen_at = CASE WHEN p_zavrsen AND p_bez_izvrsenja THEN NULL ELSE zakljucen_at END,
      bez_izvrsenja = p_zavrsen AND p_bez_izvrsenja,
      km_pocetak = CASE WHEN p_spremi_izvrsenje THEN p_km_pocetak ELSE km_pocetak END,
      km_kraj = CASE WHEN p_spremi_izvrsenje THEN p_km_kraj ELSE km_kraj END,
      napomena = CASE WHEN p_spremi_izvrsenje THEN p_napomena ELSE napomena END
  WHERE id = p_nalog_id AND company_id = company;

  operation_id := public.replace_work_order_settlement(p_nalog_id, p_entries, p_costs);
  RETURN operation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_work_order_status_with_settlement(uuid, boolean, boolean, boolean, boolean, numeric, numeric, text, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_work_order_status_with_settlement(uuid, boolean, boolean, boolean, boolean, numeric, numeric, text, jsonb, jsonb)
  TO authenticated;
NOTIFY pgrst, 'reload schema';
