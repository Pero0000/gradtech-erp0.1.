ALTER TABLE public.gradiliste_board_layout
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.advance_gradiliste_board_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS advance_gradiliste_board_revision ON public.gradiliste_board_layout;
CREATE TRIGGER advance_gradiliste_board_revision
  BEFORE UPDATE ON public.gradiliste_board_layout
  FOR EACH ROW EXECUTE FUNCTION public.advance_gradiliste_board_revision();
