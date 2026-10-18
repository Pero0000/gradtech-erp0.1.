CREATE OR REPLACE FUNCTION public.record_nalog_inventory_tool(
  p_nalog_id uuid,
  p_oprema_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  nalog record;
  alat record;
BEGIN
  IF public.app_mobile_radnik_id() IS NOT NULL
     AND NOT public.app_mobile_editable_nalog(p_nalog_id) THEN
    RAISE EXCEPTION 'Nalog nije dodijeljen prijavljenom djelatniku ili se više ne može uređivati.';
  END IF;

  SELECT id, gradiliste_id
  INTO nalog
  FROM public.radni_nalozi
  WHERE id = p_nalog_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Radni nalog nije pronađen.';
  END IF;

  IF nalog.gradiliste_id IS NULL THEN
    RAISE EXCEPTION 'Za evidentiranje lokacije alata nalog mora imati odabrano gradilište.';
  END IF;

  SELECT id, naziv, status
  INTO alat
  FROM public.oprema
  WHERE id = p_oprema_id
    AND kategorija = 'alat'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Odabrani alat nije pronađen u popisu opreme.';
  END IF;

  IF alat.status IN ('servis', 'neaktivno') THEN
    RAISE EXCEPTION 'Alat na servisu ili neaktivan alat nije moguće dodati na radni nalog.';
  END IF;

  INSERT INTO public.radni_nalozi_stavke (nalog_id, tip, naziv)
  VALUES (p_nalog_id, 'alat', alat.naziv);

  UPDATE public.oprema
  SET gradiliste_id = nalog.gradiliste_id,
      status = 'na_gradilistu',
      updated_at = now()
  WHERE id = p_oprema_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_nalog_inventory_tool(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_nalog_inventory_tool(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
