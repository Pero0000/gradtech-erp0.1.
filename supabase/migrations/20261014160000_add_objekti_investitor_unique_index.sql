CREATE UNIQUE INDEX IF NOT EXISTS idx_objekti_investitor_naziv
  ON public.objekti (investitor_id, naziv);