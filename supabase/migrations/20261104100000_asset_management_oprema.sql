ALTER TABLE public.oprema
  ADD COLUMN IF NOT EXISTS podkategorija text,
  ADD COLUMN IF NOT EXISTS radnik_id uuid REFERENCES public.radnici(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_oprema_radnik ON public.oprema(radnik_id);

CREATE OR REPLACE FUNCTION private.validate_oprema_radnik_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.radnik_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.radnici r
    WHERE r.id = NEW.radnik_id
      AND r.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Radnik mora pripadati istoj tvrtki kao oprema.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oprema_radnik_company_check ON public.oprema;
CREATE TRIGGER oprema_radnik_company_check
  BEFORE INSERT OR UPDATE OF radnik_id, company_id ON public.oprema
  FOR EACH ROW EXECUTE FUNCTION private.validate_oprema_radnik_company();

CREATE OR REPLACE FUNCTION private.record_nalog_inventory_tool(
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
  korisnik_id uuid;
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

  IF EXISTS (
    SELECT 1
    FROM public.radni_nalozi_stavke
    WHERE nalog_id = p_nalog_id
      AND tip = 'alat'
      AND oprema_id = p_oprema_id
  ) THEN
    RAISE EXCEPTION 'Alat je već dodan na ovaj radni nalog.';
  END IF;

  INSERT INTO public.radni_nalozi_stavke (nalog_id, tip, naziv, oprema_id)
  VALUES (p_nalog_id, 'alat', alat.naziv, p_oprema_id);

  SELECT COALESCE(
    public.app_mobile_radnik_id(),
    (SELECT assignment.radnik_id
     FROM public.radni_nalozi_radnici assignment
     WHERE assignment.nalog_id = p_nalog_id
     ORDER BY assignment.radnik_id
     LIMIT 1)
  ) INTO korisnik_id;

  UPDATE public.oprema
  SET gradiliste_id = nalog.gradiliste_id,
      radnik_id = korisnik_id,
      status = 'na_gradilistu',
      updated_at = now()
  WHERE id = p_oprema_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_oprema_koristenja(p_oprema_ids uuid[])
RETURNS TABLE (
  oprema_id uuid,
  zapis_id uuid,
  datum timestamptz,
  radnik_id uuid,
  ime text,
  prezime text,
  gradiliste text,
  broj_naloga text,
  naslov_naloga text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.app_current_company_id() IS NULL THEN
    RAISE EXCEPTION 'Pristup tvrtki nije odobren.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT item.id, line.id, line.created_at, worker.id, worker.ime, worker.prezime,
         site.naziv, order_row.broj, order_row.naslov
  FROM public.radni_nalozi_stavke line
  JOIN public.oprema item ON item.id = line.oprema_id
  JOIN public.radni_nalozi order_row ON order_row.id = line.nalog_id
  LEFT JOIN public.gradilista site ON site.id = order_row.gradiliste_id
  LEFT JOIN public.radni_nalozi_radnici assignment ON assignment.nalog_id = order_row.id
  LEFT JOIN public.radnici worker ON worker.id = assignment.radnik_id
  WHERE item.id = ANY(p_oprema_ids)
    AND item.company_id = public.app_current_company_id()
    AND order_row.company_id = public.app_current_company_id()
    AND line.tip IN ('alat', 'stroj')
    AND public.app_has_module_permission(CASE item.kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'view')
  ORDER BY line.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_oprema_koristenja(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_oprema_koristenja(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
