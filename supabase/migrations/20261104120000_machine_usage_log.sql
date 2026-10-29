ALTER TABLE public.radni_nalozi_stavke
  ADD COLUMN IF NOT EXISTS cijena_sata numeric(12,2) NOT NULL DEFAULT 0
  CHECK (cijena_sata >= 0),
  ADD COLUMN IF NOT EXISTS koristenje_at timestamptz;

UPDATE public.radni_nalozi_stavke line
SET cijena_sata = item.cijena_sata,
    koristenje_at = COALESCE(line.koristenje_at, line.created_at)
FROM public.oprema item
WHERE line.oprema_id = item.id
  AND line.tip = 'stroj'
  AND line.nalog_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.snapshot_machine_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  machine_rate numeric(12,2);
BEGIN
  IF NEW.tip = 'stroj'
     AND NEW.nalog_id IS NOT NULL
     AND NEW.oprema_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR OLD.nalog_id IS DISTINCT FROM NEW.nalog_id
       OR OLD.oprema_id IS DISTINCT FROM NEW.oprema_id
     ) THEN
    SELECT item.cijena_sata
    INTO machine_rate
    FROM public.oprema item
    WHERE item.id = NEW.oprema_id
      AND item.kategorija = 'stroj'
      AND item.company_id = NEW.company_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stroj nije dostupan u tvrtki radnog naloga.';
    END IF;

    NEW.cijena_sata := machine_rate;
    NEW.koristenje_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snapshot_machine_usage_before_link ON public.radni_nalozi_stavke;
CREATE TRIGGER snapshot_machine_usage_before_link
  BEFORE INSERT OR UPDATE OF nalog_id, oprema_id, tip ON public.radni_nalozi_stavke
  FOR EACH ROW EXECUTE FUNCTION private.snapshot_machine_usage();

CREATE OR REPLACE FUNCTION private.record_nalog_inventory_machine(
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
  stroj record;
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
    RAISE EXCEPTION 'Za evidentiranje stroja nalog mora imati odabrano gradilište.';
  END IF;

  SELECT id, naziv, status, cijena_sata
  INTO stroj
  FROM public.oprema
  WHERE id = p_oprema_id
    AND kategorija = 'stroj'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Odabrani stroj nije pronađen u popisu strojeva.';
  END IF;

  IF stroj.status IN ('servis', 'neaktivno') THEN
    RAISE EXCEPTION 'Stroj na servisu ili neaktivan stroj nije moguće dodati na radni nalog.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.radni_nalozi_stavke
    WHERE nalog_id = p_nalog_id
      AND tip = 'stroj'
      AND oprema_id = p_oprema_id
  ) THEN
    RAISE EXCEPTION 'Stroj je već dodan na ovaj radni nalog.';
  END IF;

  INSERT INTO public.radni_nalozi_stavke (nalog_id, tip, naziv, oprema_id, cijena_sata)
  VALUES (p_nalog_id, 'stroj', stroj.naziv, p_oprema_id, stroj.cijena_sata);

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

CREATE OR REPLACE FUNCTION public.get_stroj_koristenja(p_oprema_ids uuid[])
RETURNS TABLE (
  oprema_id uuid,
  zapis_id uuid,
  datum timestamptz,
  radnik_id uuid,
  ime text,
  prezime text,
  gradiliste text,
  broj_naloga text,
  naslov_naloga text,
  radni_sati numeric,
  cijena_sata numeric,
  ukupan_obracun numeric,
  napomena text
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
  SELECT item.id, line.id, COALESCE(line.koristenje_at, line.created_at), worker.id, worker.ime, worker.prezime,
         site.naziv, order_row.broj, order_row.naslov, line.sati, line.cijena_sata,
         COALESCE(line.sati, 0) * line.cijena_sata, order_row.opis
  FROM public.radni_nalozi_stavke line
  JOIN public.oprema item ON item.id = line.oprema_id
  JOIN public.radni_nalozi order_row ON order_row.id = line.nalog_id
  LEFT JOIN public.gradilista site ON site.id = order_row.gradiliste_id
  LEFT JOIN public.radni_nalozi_radnici assignment ON assignment.nalog_id = order_row.id
  LEFT JOIN public.radnici worker ON worker.id = assignment.radnik_id
  WHERE item.id = ANY(p_oprema_ids)
    AND item.kategorija = 'stroj'
    AND item.company_id = public.app_current_company_id()
    AND order_row.company_id = public.app_current_company_id()
    AND line.tip = 'stroj'
    AND public.app_has_module_permission('strojevi', 'view')
  ORDER BY COALESCE(line.koristenje_at, line.created_at) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_stroj_koristenja(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stroj_koristenja(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
