-- Obračun sati: ured po radniku odobrava (pravo) noćni rad, teren, praznik, godišnji i bolovanje.
-- Neodobrene kategorije se ne obračunavaju; noćni rad i teren tada ne idu ni u trošak gradilišta.

ALTER TABLE public.radnici
  ADD COLUMN IF NOT EXISTS pravo_nocni boolean,
  ADD COLUMN IF NOT EXISTS pravo_teren boolean,
  ADD COLUMN IF NOT EXISTS pravo_praznik boolean,
  ADD COLUMN IF NOT EXISTS pravo_godisnji boolean,
  ADD COLUMN IF NOT EXISTS pravo_bolovanje boolean;

-- Postojeće ponašanje ostaje: tko već ima unesenu cijenu, ima i pravo na tu kategoriju.
UPDATE public.radnici SET
  pravo_nocni = COALESCE(pravo_nocni, COALESCE(nocni_dodatak, 0) > 0),
  pravo_teren = COALESCE(pravo_teren, COALESCE(teren_dnevnica, 0) > 0),
  pravo_praznik = COALESCE(pravo_praznik, COALESCE(cijena_praznik, 0) > 0),
  pravo_godisnji = COALESCE(pravo_godisnji, COALESCE(cijena_godisnji, 0) > 0),
  pravo_bolovanje = COALESCE(pravo_bolovanje, COALESCE(cijena_bolovanje, 0) > 0)
WHERE pravo_nocni IS NULL OR pravo_teren IS NULL OR pravo_praznik IS NULL
  OR pravo_godisnji IS NULL OR pravo_bolovanje IS NULL;

ALTER TABLE public.radnici
  ALTER COLUMN pravo_nocni SET DEFAULT false, ALTER COLUMN pravo_nocni SET NOT NULL,
  ALTER COLUMN pravo_teren SET DEFAULT false, ALTER COLUMN pravo_teren SET NOT NULL,
  ALTER COLUMN pravo_praznik SET DEFAULT false, ALTER COLUMN pravo_praznik SET NOT NULL,
  ALTER COLUMN pravo_godisnji SET DEFAULT false, ALTER COLUMN pravo_godisnji SET NOT NULL,
  ALTER COLUMN pravo_bolovanje SET DEFAULT false, ALTER COLUMN pravo_bolovanje SET NOT NULL;

-- Noćni sati dosad su bili zapisani samo u napomeni ("Noćni rad 2.5 h").
ALTER TABLE public.radno_vrijeme ADD COLUMN IF NOT EXISTS nocni_sati numeric(4,1) NOT NULL DEFAULT 0;
UPDATE public.radno_vrijeme
SET nocni_sati = LEAST(sati, (substring(napomena FROM 'Noćni rad ([0-9]+(?:\.[0-9]+)?) h'))::numeric)
WHERE nocni_sati = 0 AND napomena ~ 'Noćni rad [0-9]+(\.[0-9]+)? h';

-- Odsustva (godišnji, bolovanje, praznik); tablica možda nije postojala u svakoj instalaciji.
DO $$
DECLARE
  operation text;
  permission_action text;
  policy_name text;
BEGIN
  IF to_regclass('public.radnici_odsustva') IS NULL THEN
    CREATE TABLE public.radnici_odsustva (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL DEFAULT public.app_current_company_id() REFERENCES public.tvrtke(id),
      radnik_id uuid NOT NULL REFERENCES public.radnici(id) ON DELETE CASCADE,
      vrsta text NOT NULL CHECK (vrsta IN ('praznik', 'godisnji', 'bolovanje')),
      datum_od date NOT NULL,
      datum_do date NOT NULL,
      napomena text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (datum_do >= datum_od)
    );
    CREATE INDEX tenant_radnici_odsustva ON public.radnici_odsustva (company_id);
    CREATE INDEX radnici_odsustva_radnik_datum ON public.radnici_odsustva (radnik_id, datum_od);
    ALTER TABLE public.radnici_odsustva ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.radnici_odsustva FROM anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.radnici_odsustva TO authenticated;
    CREATE POLICY tenant_scope ON public.radnici_odsustva AS RESTRICTIVE FOR ALL TO authenticated
      USING (company_id = public.app_current_company_id())
      WITH CHECK (company_id = public.app_current_company_id());
    FOR operation, permission_action IN
      SELECT * FROM (VALUES ('SELECT', 'view'), ('INSERT', 'edit'), ('UPDATE', 'edit'), ('DELETE', 'edit')) p(o, a)
    LOOP
      policy_name := format('app_radnici_odsustva_%s', lower(operation));
      IF operation = 'SELECT' OR operation = 'DELETE' THEN
        EXECUTE format('CREATE POLICY %I ON public.radnici_odsustva FOR %s TO authenticated USING (public.app_has_module_permission(%L, %L))',
          policy_name, operation, 'radnici', permission_action);
      ELSIF operation = 'INSERT' THEN
        EXECUTE format('CREATE POLICY %I ON public.radnici_odsustva FOR INSERT TO authenticated WITH CHECK (public.app_has_module_permission(%L, %L))',
          policy_name, 'radnici', permission_action);
      ELSE
        EXECUTE format('CREATE POLICY %I ON public.radnici_odsustva FOR UPDATE TO authenticated USING (public.app_has_module_permission(%L, %L)) WITH CHECK (public.app_has_module_permission(%L, %L))',
          policy_name, 'radnici', permission_action, 'radnici', permission_action);
      END IF;
    END LOOP;
    CREATE TRIGGER tenant_integrity BEFORE INSERT OR UPDATE ON public.radnici_odsustva
      FOR EACH ROW EXECUTE FUNCTION private.enforce_company_integrity();
  END IF;
END;
$$;

-- Moje radno vrijeme sada vraća i noćne sate te oznaku terena.
DROP FUNCTION IF EXISTS public.get_my_radno_vrijeme(date, date);
CREATE FUNCTION public.get_my_radno_vrijeme(p_od date, p_do date)
RETURNS TABLE (
  izvor text,
  nalog_id uuid,
  nalog_broj text,
  gradiliste_naziv text,
  datum date,
  vrijeme_od time,
  vrijeme_do time,
  sati numeric,
  napomena text,
  nocni_sati numeric,
  teren boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT public.app_mobile_radnik_id() AS radnik_id)
  SELECT * FROM (
    SELECT
      'nalog'::text,
      nalog.id,
      nalog.broj,
      site.naziv,
      COALESCE(timezone('Europe/Zagreb', assignment.mobile_started_at)::date, nalog.rok, nalog.datum_kreiranja),
      assignment.vrijeme_od,
      assignment.vrijeme_do,
      CASE
        WHEN assignment.vrijeme_od IS NOT NULL AND assignment.vrijeme_do IS NOT NULL
          THEN round((extract(epoch FROM (assignment.vrijeme_do - assignment.vrijeme_od)) / 3600.0)::numeric, 1)
        ELSE NULL
      END,
      NULL::text,
      COALESCE((
        SELECT sum(entry.nocni_sati) FROM public.radno_vrijeme entry
        WHERE entry.nalog_id = nalog.id AND entry.radnik_id = me.radnik_id
      ), 0),
      COALESCE(nalog.teren, false)
    FROM me
    JOIN public.radni_nalozi_radnici assignment ON assignment.radnik_id = me.radnik_id
    JOIN public.radni_nalozi nalog ON nalog.id = assignment.nalog_id
    LEFT JOIN public.gradilista site ON site.id = nalog.gradiliste_id
    WHERE assignment.vrijeme_od IS NOT NULL OR assignment.mobile_started_at IS NOT NULL
    UNION ALL
    SELECT
      'evidencija'::text,
      entry.nalog_id,
      nalog.broj,
      site.naziv,
      entry.datum,
      NULL::time,
      NULL::time,
      entry.sati,
      entry.napomena,
      entry.nocni_sati,
      false
    FROM me
    JOIN public.radno_vrijeme entry ON entry.radnik_id = me.radnik_id
    LEFT JOIN public.radni_nalozi nalog ON nalog.id = entry.nalog_id
    LEFT JOIN public.gradilista site ON site.id = entry.gradiliste_id
    -- Vrijeme s naloga već je prikazano iz dodjele naloga.
    WHERE entry.nalog_id IS NULL
  ) entries (izvor, nalog_id, nalog_broj, gradiliste_naziv, datum, vrijeme_od, vrijeme_do, sati, napomena, nocni_sati, teren)
  WHERE (p_od IS NULL OR entries.datum >= p_od)
    AND (p_do IS NULL OR entries.datum <= p_do)
  ORDER BY entries.datum DESC, entries.nalog_broj;
$$;
REVOKE ALL ON FUNCTION public.get_my_radno_vrijeme(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_radno_vrijeme(date, date) TO authenticated;

-- Portal djelatnika: vlastita prava i odsustva (bez iznosa u eurima).
CREATE OR REPLACE FUNCTION public.get_my_obracun_podaci(p_od date, p_do date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'prava', (
      SELECT jsonb_build_object(
        'nocni', worker.pravo_nocni,
        'teren', worker.pravo_teren,
        'praznik', worker.pravo_praznik,
        'godisnji', worker.pravo_godisnji,
        'bolovanje', worker.pravo_bolovanje
      )
      FROM public.radnici worker
      WHERE worker.id = public.app_mobile_radnik_id()
        AND worker.company_id = public.app_current_company_id()
    ),
    'odsustva', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', absence.id, 'vrsta', absence.vrsta,
        'datum_od', absence.datum_od, 'datum_do', absence.datum_do, 'napomena', absence.napomena
      ) ORDER BY absence.datum_od)
      FROM public.radnici_odsustva absence
      WHERE absence.radnik_id = public.app_mobile_radnik_id()
        AND absence.company_id = public.app_current_company_id()
        AND (p_do IS NULL OR absence.datum_od <= p_do)
        AND (p_od IS NULL OR absence.datum_do >= p_od)
    ), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.get_my_obracun_podaci(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_obracun_podaci(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
