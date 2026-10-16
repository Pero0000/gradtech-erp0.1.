CREATE TABLE IF NOT EXISTS public.app_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  approved boolean NOT NULL DEFAULT false,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_user_permissions (
  user_id uuid NOT NULL REFERENCES public.app_profiles(id) ON DELETE CASCADE,
  module text NOT NULL CHECK (module IN (
    'dashboard', 'gradilista', 'radnici', 'vozila', 'alat', 'strojevi',
    'investitori', 'objekti', 'kooperanti', 'stavke', 'ponude', 'raspored',
    'radni_nalozi', 'troskovi', 'fakture', 'radno_vrijeme', 'rekapitulacija',
    'obavijesti', 'asistent', 'postavke'
  )),
  can_view boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, module),
  CHECK (NOT can_edit OR can_view)
);

CREATE OR REPLACE FUNCTION public.app_create_profile_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.app_profiles (id, email)
  VALUES (NEW.id, COALESCE(NEW.email, ''))
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_auth_user_created ON auth.users;
CREATE TRIGGER app_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.app_create_profile_for_new_user();

INSERT INTO public.app_profiles (id, email)
SELECT id, COALESCE(email, '')
FROM auth.users
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

CREATE OR REPLACE FUNCTION public.app_is_approved()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_profiles
    WHERE id = auth.uid() AND approved
  );
$$;

CREATE OR REPLACE FUNCTION public.app_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_profiles
    WHERE id = auth.uid() AND approved AND is_admin
  );
$$;

CREATE OR REPLACE FUNCTION public.app_has_module_permission(p_module text, p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.app_is_admin()
    OR (
      public.app_is_approved()
      AND EXISTS (
        SELECT 1
        FROM public.app_user_permissions permission
        WHERE permission.user_id = auth.uid()
          AND permission.module = p_module
          AND (
            (p_action = 'view' AND (permission.can_view OR permission.can_edit))
            OR (p_action = 'edit' AND permission.can_edit)
          )
      )
    );
$$;

ALTER TABLE public.app_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_user_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_profiles_select ON public.app_profiles;
CREATE POLICY app_profiles_select ON public.app_profiles
  FOR SELECT TO authenticated USING (id = auth.uid() OR public.app_is_admin());
DROP POLICY IF EXISTS app_profiles_admin_update ON public.app_profiles;
CREATE POLICY app_profiles_admin_update ON public.app_profiles
  FOR UPDATE TO authenticated USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS app_permissions_select ON public.app_user_permissions;
CREATE POLICY app_permissions_select ON public.app_user_permissions
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.app_is_admin());
DROP POLICY IF EXISTS app_permissions_admin_insert ON public.app_user_permissions;
CREATE POLICY app_permissions_admin_insert ON public.app_user_permissions
  FOR INSERT TO authenticated WITH CHECK (public.app_is_admin());
DROP POLICY IF EXISTS app_permissions_admin_update ON public.app_user_permissions;
CREATE POLICY app_permissions_admin_update ON public.app_user_permissions
  FOR UPDATE TO authenticated USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
DROP POLICY IF EXISTS app_permissions_admin_delete ON public.app_user_permissions;
CREATE POLICY app_permissions_admin_delete ON public.app_user_permissions
  FOR DELETE TO authenticated USING (public.app_is_admin());

GRANT SELECT ON public.app_profiles, public.app_user_permissions TO authenticated;
GRANT UPDATE (approved) ON public.app_profiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.app_user_permissions TO authenticated;
REVOKE ALL ON public.app_profiles, public.app_user_permissions FROM anon;
REVOKE ALL ON FUNCTION public.app_create_profile_for_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_is_approved() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_has_module_permission(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_is_approved() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_has_module_permission(text, text) TO authenticated;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;

DO $$
DECLARE
  table_module record;
  operation text;
  permission_action text;
  policy_name text;
  policy_sql text;
BEGIN
  FOR table_module IN
    SELECT * FROM (VALUES
      ('gradilista', 'gradilista'),
      ('rokovi', 'gradilista'),
      ('ugovoreni_radovi', 'gradilista'),
      ('gradiliste_zadaci', 'gradilista'),
      ('gradiliste_dokumenti', 'gradilista'),
      ('gradiliste_stavke', 'gradilista'),
      ('radnici', 'radnici'),
      ('radnici_dokumenti', 'radnici'),
      ('radnici_odsustva', 'radnici'),
      ('radnici_povijest', 'radnici'),
      ('vozila', 'vozila'),
      ('vozila_dokumenti', 'vozila'),
      ('raspored', 'raspored'),
      ('raspored_radnici', 'raspored'),
      ('raspored_vozila', 'raspored'),
      ('dnevni_raspored_gradilista', 'raspored'),
      ('dnevni_raspored_radnici', 'raspored'),
      ('dnevni_raspored_ostalo', 'raspored'),
      ('troskovi', 'troskovi'),
      ('radno_vrijeme', 'radno_vrijeme'),
      ('radni_nalozi', 'radni_nalozi'),
      ('radni_nalozi_radnici', 'radni_nalozi'),
      ('radni_nalozi_foto', 'radni_nalozi'),
      ('radni_nalozi_stavke', 'radni_nalozi'),
      ('radni_nalozi_dokumenti', 'radni_nalozi'),
      ('nalog_gradiliste_dokumenti', 'radni_nalozi'),
      ('fakture', 'fakture'),
      ('investitori', 'investitori'),
      ('objekti', 'objekti'),
      ('kooperanti', 'kooperanti'),
      ('stavke', 'stavke'),
      ('stavke_cijene_log', 'stavke'),
      ('ponude', 'ponude'),
      ('ponude_stavke', 'ponude'),
      ('ponude_postavke', 'ponude')
    ) AS modules(table_name, module_name)
  LOOP
    IF to_regclass(format('public.%I', table_module.table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_module.table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', table_module.table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', table_module.table_name);

    FOR policy_name IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_module.table_name
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_name, table_module.table_name);
    END LOOP;

    FOR operation, permission_action IN
      SELECT * FROM (VALUES
        ('SELECT', 'view'),
        ('INSERT', 'edit'),
        ('UPDATE', 'edit'),
        ('DELETE', 'edit')
      ) AS permissions(operation_name, action_name)
    LOOP
      policy_name := format('app_%s_%s', table_module.table_name, lower(operation));
      IF operation = 'SELECT' THEN
        policy_sql := format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.app_has_module_permission(%L, %L))',
          policy_name, table_module.table_name, table_module.module_name, permission_action
        );
      ELSIF operation = 'INSERT' THEN
        policy_sql := format(
          'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_has_module_permission(%L, %L))',
          policy_name, table_module.table_name, table_module.module_name, permission_action
        );
      ELSIF operation = 'UPDATE' THEN
        policy_sql := format(
          'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.app_has_module_permission(%L, %L)) WITH CHECK (public.app_has_module_permission(%L, %L))',
          policy_name, table_module.table_name, table_module.module_name, permission_action, table_module.module_name, permission_action
        );
      ELSE
        policy_sql := format(
          'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.app_has_module_permission(%L, %L))',
          policy_name, table_module.table_name, table_module.module_name, permission_action
        );
      END IF;
      EXECUTE policy_sql;
    END LOOP;
  END LOOP;
END;
$$;

ALTER TABLE public.oprema ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oprema_dokumenti ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.oprema, public.oprema_dokumenti FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oprema, public.oprema_dokumenti TO authenticated;

DROP POLICY IF EXISTS app_oprema_select ON public.oprema;
DROP POLICY IF EXISTS app_oprema_insert ON public.oprema;
DROP POLICY IF EXISTS app_oprema_update ON public.oprema;
DROP POLICY IF EXISTS app_oprema_delete ON public.oprema;
CREATE POLICY app_oprema_select ON public.oprema FOR SELECT TO authenticated
  USING (public.app_has_module_permission(CASE kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'view'));
CREATE POLICY app_oprema_insert ON public.oprema FOR INSERT TO authenticated
  WITH CHECK (public.app_has_module_permission(CASE kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'edit'));
CREATE POLICY app_oprema_update ON public.oprema FOR UPDATE TO authenticated
  USING (public.app_has_module_permission(CASE kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'edit'))
  WITH CHECK (public.app_has_module_permission(CASE kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'edit'));
CREATE POLICY app_oprema_delete ON public.oprema FOR DELETE TO authenticated
  USING (public.app_has_module_permission(CASE kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'edit'));

DROP POLICY IF EXISTS app_oprema_dokumenti_select ON public.oprema_dokumenti;
DROP POLICY IF EXISTS app_oprema_dokumenti_insert ON public.oprema_dokumenti;
DROP POLICY IF EXISTS app_oprema_dokumenti_update ON public.oprema_dokumenti;
DROP POLICY IF EXISTS app_oprema_dokumenti_delete ON public.oprema_dokumenti;
CREATE POLICY app_oprema_dokumenti_select ON public.oprema_dokumenti FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.oprema item
    WHERE item.id = oprema_id AND public.app_has_module_permission(CASE item.kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'view')
  ));
CREATE POLICY app_oprema_dokumenti_insert ON public.oprema_dokumenti FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.oprema item
    WHERE item.id = oprema_id AND public.app_has_module_permission(CASE item.kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'edit')
  ));
CREATE POLICY app_oprema_dokumenti_update ON public.oprema_dokumenti FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.oprema item
    WHERE item.id = oprema_id AND public.app_has_module_permission(CASE item.kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'edit')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.oprema item
    WHERE item.id = oprema_id AND public.app_has_module_permission(CASE item.kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'edit')
  ));
CREATE POLICY app_oprema_dokumenti_delete ON public.oprema_dokumenti FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.oprema item
    WHERE item.id = oprema_id AND public.app_has_module_permission(CASE item.kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'edit')
  ));

UPDATE storage.buckets SET public = false WHERE id = 'nalozi-foto';
DROP POLICY IF EXISTS nalozi_foto_select ON storage.objects;
DROP POLICY IF EXISTS nalozi_foto_insert ON storage.objects;
DROP POLICY IF EXISTS nalozi_foto_delete ON storage.objects;
DROP POLICY IF EXISTS app_nalozi_foto_select ON storage.objects;
DROP POLICY IF EXISTS app_nalozi_foto_insert ON storage.objects;
DROP POLICY IF EXISTS app_nalozi_foto_update ON storage.objects;
DROP POLICY IF EXISTS app_nalozi_foto_delete ON storage.objects;

DO $$
DECLARE
  storage_policy record;
BEGIN
  FOR storage_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        COALESCE(qual, '') ILIKE '%nalozi-foto%'
        OR COALESCE(with_check, '') ILIKE '%nalozi-foto%'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', storage_policy.policyname);
  END LOOP;
END;
$$;

CREATE POLICY app_nalozi_foto_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'nalozi-foto'
    AND CASE split_part(name, '/', 1)
      WHEN 'radnici' THEN public.app_has_module_permission('radnici', 'view')
      WHEN 'vozila' THEN public.app_has_module_permission('vozila', 'view')
      WHEN 'oprema' THEN EXISTS (
        SELECT 1 FROM public.oprema item
        WHERE item.id::text = split_part(name, '/', 2)
          AND public.app_has_module_permission(CASE item.kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'view')
      )
      WHEN 'gradiliste' THEN public.app_has_module_permission('gradilista', 'view')
      ELSE public.app_has_module_permission('radni_nalozi', 'view')
    END
  );
CREATE POLICY app_nalozi_foto_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'nalozi-foto'
    AND CASE split_part(name, '/', 1)
      WHEN 'radnici' THEN public.app_has_module_permission('radnici', 'edit')
      WHEN 'vozila' THEN public.app_has_module_permission('vozila', 'edit')
      WHEN 'oprema' THEN EXISTS (
        SELECT 1 FROM public.oprema item
        WHERE item.id::text = split_part(name, '/', 2)
          AND public.app_has_module_permission(CASE item.kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'edit')
      )
      WHEN 'gradiliste' THEN public.app_has_module_permission('gradilista', 'edit')
      ELSE public.app_has_module_permission('radni_nalozi', 'edit')
    END
  );
CREATE POLICY app_nalozi_foto_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'nalozi-foto'
    AND CASE split_part(name, '/', 1)
      WHEN 'radnici' THEN public.app_has_module_permission('radnici', 'edit')
      WHEN 'vozila' THEN public.app_has_module_permission('vozila', 'edit')
      WHEN 'oprema' THEN EXISTS (
        SELECT 1 FROM public.oprema item
        WHERE item.id::text = split_part(name, '/', 2)
          AND public.app_has_module_permission(CASE item.kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'edit')
      )
      WHEN 'gradiliste' THEN public.app_has_module_permission('gradilista', 'edit')
      ELSE public.app_has_module_permission('radni_nalozi', 'edit')
    END
  )
  WITH CHECK (
    bucket_id = 'nalozi-foto'
    AND CASE split_part(name, '/', 1)
      WHEN 'radnici' THEN public.app_has_module_permission('radnici', 'edit')
      WHEN 'vozila' THEN public.app_has_module_permission('vozila', 'edit')
      WHEN 'oprema' THEN EXISTS (
        SELECT 1 FROM public.oprema item
        WHERE item.id::text = split_part(name, '/', 2)
          AND public.app_has_module_permission(CASE item.kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'edit')
      )
      WHEN 'gradiliste' THEN public.app_has_module_permission('gradilista', 'edit')
      ELSE public.app_has_module_permission('radni_nalozi', 'edit')
    END
  );
CREATE POLICY app_nalozi_foto_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'nalozi-foto'
    AND CASE split_part(name, '/', 1)
      WHEN 'radnici' THEN public.app_has_module_permission('radnici', 'edit')
      WHEN 'vozila' THEN public.app_has_module_permission('vozila', 'edit')
      WHEN 'oprema' THEN EXISTS (
        SELECT 1 FROM public.oprema item
        WHERE item.id::text = split_part(name, '/', 2)
          AND public.app_has_module_permission(CASE item.kategorija WHEN 'stroj' THEN 'strojevi' ELSE 'alat' END, 'edit')
      )
      WHEN 'gradiliste' THEN public.app_has_module_permission('gradilista', 'edit')
      ELSE public.app_has_module_permission('radni_nalozi', 'edit')
    END
  );

NOTIFY pgrst, 'reload schema';
