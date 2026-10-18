-- Strojevi na radnom nalogu: cijena radnog sata stroja, sati rada po nalogu i evidencija lokacije stroja.

ALTER TABLE public.oprema
  ADD COLUMN IF NOT EXISTS cijena_sata numeric(12,2) NOT NULL DEFAULT 0 CHECK (cijena_sata >= 0);

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.radni_nalozi_stavke'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%tip%'
  LOOP
    EXECUTE format('ALTER TABLE public.radni_nalozi_stavke DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.radni_nalozi_stavke
  ADD CONSTRAINT radni_nalozi_stavke_tip_check CHECK (tip IN ('materijal', 'alat', 'stroj'));

ALTER TABLE public.radni_nalozi_stavke
  ADD COLUMN IF NOT EXISTS oprema_id uuid REFERENCES public.oprema(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sati numeric(8,2) CHECK (sati IS NULL OR sati >= 0);

CREATE INDEX IF NOT EXISTS idx_radni_nalozi_stavke_oprema ON public.radni_nalozi_stavke(oprema_id);

CREATE OR REPLACE FUNCTION public.record_nalog_inventory_machine(
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

  SELECT id, naziv, status
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
    SELECT 1 FROM public.radni_nalozi_stavke
    WHERE nalog_id = p_nalog_id AND tip = 'stroj' AND oprema_id = p_oprema_id
  ) THEN
    RAISE EXCEPTION 'Stroj je već dodan na ovaj radni nalog.';
  END IF;

  INSERT INTO public.radni_nalozi_stavke (nalog_id, tip, naziv, oprema_id)
  VALUES (p_nalog_id, 'stroj', stroj.naziv, p_oprema_id);

  UPDATE public.oprema
  SET gradiliste_id = nalog.gradiliste_id,
      status = 'na_gradilistu',
      updated_at = now()
  WHERE id = p_oprema_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_nalog_inventory_machine(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_nalog_inventory_machine(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
