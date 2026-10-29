ALTER TABLE public.gradilista
  DROP CONSTRAINT IF EXISTS gradilista_status_check;

ALTER TABLE public.gradilista
  ADD CONSTRAINT gradilista_status_check
  CHECK (status IN ('ponuda', 'planirano', 'aktivno', 'pauzirano', 'neplaceno', 'zavrseno'));
