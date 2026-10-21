-- Dnevni raspored koristi isti zajednički redoslijed gradilišta kao pregled Gradilišta,
-- pa ga smiju čitati i mijenjati i korisnici s pravom na modul Raspored.
DROP POLICY IF EXISTS gradiliste_board_layout_select ON public.gradiliste_board_layout;
CREATE POLICY gradiliste_board_layout_select ON public.gradiliste_board_layout
  FOR SELECT TO authenticated
  USING (
    public.app_has_module_permission('gradilista', 'view')
    OR public.app_has_module_permission('raspored', 'view')
  );

DROP POLICY IF EXISTS gradiliste_board_layout_insert ON public.gradiliste_board_layout;
CREATE POLICY gradiliste_board_layout_insert ON public.gradiliste_board_layout
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_has_module_permission('gradilista', 'edit')
    OR public.app_has_module_permission('raspored', 'edit')
  );

DROP POLICY IF EXISTS gradiliste_board_layout_update ON public.gradiliste_board_layout;
CREATE POLICY gradiliste_board_layout_update ON public.gradiliste_board_layout
  FOR UPDATE TO authenticated
  USING (
    public.app_has_module_permission('gradilista', 'edit')
    OR public.app_has_module_permission('raspored', 'edit')
  )
  WITH CHECK (
    public.app_has_module_permission('gradilista', 'edit')
    OR public.app_has_module_permission('raspored', 'edit')
  );

INSERT INTO public.gradiliste_board_layout (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;
