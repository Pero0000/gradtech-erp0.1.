-- Portal djelatnika: smjena preko ponoći (npr. 22:00–06:00) prikazivala je negativne sate.
CREATE OR REPLACE FUNCTION public.get_my_radno_vrijeme(p_od date, p_do date)
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
          THEN round(
            (((extract(epoch FROM (assignment.vrijeme_do - assignment.vrijeme_od)) + 86400)::numeric % 86400) / 3600.0),
            1
          )
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

NOTIFY pgrst, 'reload schema';
