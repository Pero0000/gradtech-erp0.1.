CREATE TABLE IF NOT EXISTS public.gradiliste_board_layout (
  id boolean PRIMARY KEY DEFAULT true CHECK (id IS TRUE),
  columns jsonb NOT NULL DEFAULT '[[], [], []]'::jsonb
    CHECK (CASE WHEN jsonb_typeof(columns) = 'array' THEN jsonb_array_length(columns) = 3 ELSE false END),
  sort_modes jsonb NOT NULL DEFAULT '["manual", "manual", "manual"]'::jsonb
    CHECK (CASE WHEN jsonb_typeof(sort_modes) = 'array' THEN jsonb_array_length(sort_modes) = 3 ELSE false END),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gradiliste_board_layout ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gradiliste_board_layout_select ON public.gradiliste_board_layout;
CREATE POLICY gradiliste_board_layout_select ON public.gradiliste_board_layout
  FOR SELECT TO authenticated
  USING (public.app_has_module_permission('gradilista', 'view'));

DROP POLICY IF EXISTS gradiliste_board_layout_insert ON public.gradiliste_board_layout;
CREATE POLICY gradiliste_board_layout_insert ON public.gradiliste_board_layout
  FOR INSERT TO authenticated
  WITH CHECK (public.app_has_module_permission('gradilista', 'edit'));

DROP POLICY IF EXISTS gradiliste_board_layout_update ON public.gradiliste_board_layout;
CREATE POLICY gradiliste_board_layout_update ON public.gradiliste_board_layout
  FOR UPDATE TO authenticated
  USING (public.app_has_module_permission('gradilista', 'edit'))
  WITH CHECK (public.app_has_module_permission('gradilista', 'edit'));

GRANT SELECT, INSERT, UPDATE ON public.gradiliste_board_layout TO authenticated;
REVOKE ALL ON public.gradiliste_board_layout FROM anon;

INSERT INTO public.gradiliste_board_layout (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;