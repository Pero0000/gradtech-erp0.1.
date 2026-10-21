CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE public.tvrtke (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naziv text NOT NULL CHECK (btrim(naziv) <> ''),
  oib text NOT NULL UNIQUE CHECK (oib ~ '^[0-9]{11}$'),
  adresa text NOT NULL,
  aktivna boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_profiles
  ADD COLUMN company_id uuid REFERENCES public.tvrtke(id),
  ADD COLUMN is_platform_owner boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.app_current_company_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT profile.company_id
  FROM public.app_profiles profile
  JOIN public.tvrtke company ON company.id = profile.company_id
  WHERE profile.id = auth.uid() AND profile.approved AND company.aktivna;
$$;
REVOKE ALL ON FUNCTION public.app_current_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_current_company_id() TO authenticated, service_role;

CREATE FUNCTION private.tenant_tables()
RETURNS SETOF text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT name FROM (VALUES
    ('app_profiles'), ('app_user_permissions'), ('app_push_tokens'),
    ('gradilista'), ('rokovi'), ('ugovoreni_radovi'), ('gradiliste_zadaci'),
    ('gradiliste_dokumenti'), ('gradiliste_stavke'), ('radnici'),
    ('radnici_dokumenti'), ('radnici_odsustva'), ('radnici_povijest'),
    ('vozila'), ('vozila_dokumenti'), ('raspored'), ('raspored_radnici'),
    ('raspored_vozila'), ('dnevni_raspored_gradilista'), ('dnevni_raspored_radnici'),
    ('dnevni_raspored_ostalo'), ('troskovi'), ('radno_vrijeme'),
    ('radni_nalozi'), ('radni_nalozi_radnici'), ('radni_nalozi_foto'),
    ('radni_nalozi_stavke'), ('radni_nalozi_dokumenti'), ('nalog_gradiliste_dokumenti'),
    ('fakture'), ('investitori'), ('objekti'), ('kooperanti'), ('stavke'),
    ('stavke_cijene_log'), ('ponude'), ('ponude_stavke'), ('ponude_postavke'),
    ('oprema'), ('oprema_dokumenti'), ('mobile_work_order_audit'), ('gradiliste_board_layout')
  ) tables(name)
  WHERE name <> 'radnici_odsustva' OR to_regclass('public.radnici_odsustva') IS NOT NULL;
$$;

DO $$
DECLARE
  target text;
BEGIN
  FOR target IN SELECT private.tenant_tables() LOOP
    IF to_regclass(format('public.%I', target)) IS NULL THEN
      RAISE EXCEPTION 'Nedostaje tablica %. Najprije primijenite prethodne migracije.', target;
    END IF;
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.tvrtke(id)',
      target
    );
  END LOOP;
END;
$$;

CREATE FUNCTION private.assign_existing_data(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  target text;
  original_triggers jsonb;
  item jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tvrtke WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Početna tvrtka ne postoji.';
  END IF;
  FOR target IN SELECT private.tenant_tables() LOOP
    SELECT coalesce(jsonb_agg(jsonb_build_object('name', tgname, 'mode', tgenabled)), '[]'::jsonb)
      INTO original_triggers FROM pg_trigger
      WHERE tgrelid = to_regclass(format('public.%I', target)) AND NOT tgisinternal AND tgenabled <> 'D';
    FOR item IN SELECT * FROM jsonb_array_elements(original_triggers) LOOP
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', target, item ->> 'name');
    END LOOP;
    EXECUTE format('UPDATE public.%I SET company_id = $1 WHERE company_id IS NULL', target)
      USING p_company_id;
    FOR item IN SELECT * FROM jsonb_array_elements(original_triggers) LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE %s TRIGGER %I', target,
        CASE item ->> 'mode' WHEN 'A' THEN 'ALWAYS' WHEN 'R' THEN 'REPLICA' ELSE '' END, item ->> 'name');
    END LOOP;
  END LOOP;
END;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  initial_company uuid;
BEGIN
  INSERT INTO public.tvrtke (naziv, oib, adresa)
  VALUES ('Tm-color d.o.o.', '29191529726', 'Karlovačka cesta 60, 47280 Ozalj')
  RETURNING id INTO initial_company;
  PERFORM private.assign_existing_data(initial_company);

  IF (SELECT count(*) FROM public.app_profiles WHERE lower(email) = 'ivan.pericak@gmail.com') <> 1 THEN
    RAISE EXCEPTION 'Mora postojati točno jedan profil vlasnika ivan.pericak@gmail.com.';
  END IF;
  UPDATE public.app_profiles SET is_platform_owner = true
  WHERE lower(email) = 'ivan.pericak@gmail.com';
END;
$$;

CREATE OR REPLACE FUNCTION public.app_is_approved()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT public.app_current_company_id() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION public.app_is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_profiles
    WHERE id = auth.uid() AND is_admin AND company_id = public.app_current_company_id()
  );
$$;

CREATE FUNCTION public.app_is_platform_owner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_profiles
    WHERE id = auth.uid() AND approved AND is_platform_owner
      AND company_id = public.app_current_company_id()
  );
$$;
REVOKE ALL ON FUNCTION public.app_is_platform_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_is_platform_owner() TO authenticated;

CREATE OR REPLACE FUNCTION public.app_mobile_radnik_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT profile.radnik_id
  FROM public.app_profiles profile
  JOIN public.radnici worker ON worker.id = profile.radnik_id AND worker.company_id = profile.company_id
  WHERE profile.id = auth.uid() AND NOT profile.is_admin
    AND profile.company_id = public.app_current_company_id();
$$;

CREATE OR REPLACE FUNCTION public.app_mobile_assigned_nalog(p_nalog_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.radni_nalozi nalog
    JOIN public.radni_nalozi_radnici assignment ON assignment.nalog_id = nalog.id
      AND assignment.company_id = nalog.company_id
    WHERE nalog.id = p_nalog_id AND nalog.company_id = public.app_current_company_id()
      AND assignment.radnik_id = public.app_mobile_radnik_id()
      AND nalog.zakljucen_at IS NOT NULL AND nalog.status <> 'otkazan'
  );
$$;

-- Profiles must remain readable for pending/disabled accounts so AuthGate can explain the refusal.
CREATE FUNCTION public.app_profile_company_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT company_id FROM public.app_profiles WHERE id = auth.uid(); $$;
REVOKE ALL ON FUNCTION public.app_profile_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_profile_company_id() TO authenticated;

DO $$
DECLARE
  target text;
BEGIN
  FOR target IN SELECT private.tenant_tables() LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET NOT NULL', target);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET DEFAULT public.app_current_company_id()', target);
    EXECUTE format('CREATE INDEX %I ON public.%I (company_id)', 'tenant_' || target, target);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    IF target = 'app_profiles' THEN
      EXECUTE 'CREATE POLICY tenant_scope ON public.app_profiles AS RESTRICTIVE FOR ALL TO authenticated
        USING (company_id = public.app_profile_company_id())
        WITH CHECK (company_id = public.app_current_company_id())';
    ELSE
      EXECUTE format('CREATE POLICY tenant_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
        USING (company_id = public.app_current_company_id())
        WITH CHECK (company_id = public.app_current_company_id())', target);
    END IF;
  END LOOP;
END;
$$;

-- Keep existing foreign keys (and their delete semantics). Check every business FK's company too.
CREATE FUNCTION private.enforce_company_integrity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  relation record;
  referenced_company uuid;
  reference_value text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Tvrtka postojećeg zapisa ne može se promijeniti.' USING ERRCODE = '23514';
  END IF;
  FOR relation IN
    SELECT parent.relname AS parent_table, child_key.attname AS child_column,
      parent_key.attname AS parent_column, format_type(parent_key.atttypid, parent_key.atttypmod) AS parent_type
    FROM pg_constraint fk
    JOIN pg_class parent ON parent.oid = fk.confrelid
    JOIN pg_namespace ns ON ns.oid = parent.relnamespace AND ns.nspname = 'public'
    JOIN pg_attribute child_key ON child_key.attrelid = fk.conrelid AND child_key.attnum = fk.conkey[1]
    JOIN pg_attribute parent_key ON parent_key.attrelid = fk.confrelid AND parent_key.attnum = fk.confkey[1]
    WHERE fk.conrelid = TG_RELID AND fk.contype = 'f' AND array_length(fk.conkey, 1) = 1
      AND parent.relname IN (SELECT private.tenant_tables())
  LOOP
    reference_value := to_jsonb(NEW) ->> relation.child_column;
    IF reference_value IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT company_id FROM public.%I WHERE %I = $1::%s',
      relation.parent_table, relation.parent_column, relation.parent_type)
      INTO referenced_company USING reference_value;
    IF referenced_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Povezani zapis ne pripada istoj tvrtki.' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_company_integrity() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  target text;
  invalid boolean;
  relation record;
BEGIN
  -- Validate legacy relationships before installing the triggers.
  FOR relation IN
    SELECT child.relname AS child_table, parent.relname AS parent_table,
      child_key.attname AS child_column, parent_key.attname AS parent_column
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid = fk.conrelid
    JOIN pg_class parent ON parent.oid = fk.confrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace AND ns.nspname = 'public'
    JOIN pg_attribute child_key ON child_key.attrelid = fk.conrelid AND child_key.attnum = fk.conkey[1]
    JOIN pg_attribute parent_key ON parent_key.attrelid = fk.confrelid AND parent_key.attnum = fk.confkey[1]
    WHERE fk.contype = 'f' AND array_length(fk.conkey, 1) = 1
      AND child.relname IN (SELECT private.tenant_tables())
      AND parent.relname IN (SELECT private.tenant_tables())
  LOOP
    EXECUTE format('SELECT EXISTS (
      SELECT 1 FROM public.%I child JOIN public.%I parent ON child.%I = parent.%I
      WHERE child.company_id <> parent.company_id)',
      relation.child_table, relation.parent_table, relation.child_column, relation.parent_column)
      INTO invalid;
    IF invalid THEN RAISE EXCEPTION 'Neispravna veza između % i %.', relation.child_table, relation.parent_table; END IF;
  END LOOP;
  FOR target IN SELECT private.tenant_tables() LOOP
    EXECUTE format('CREATE TRIGGER tenant_integrity BEFORE INSERT OR UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION private.enforce_company_integrity()', target);
  END LOOP;
END;
$$;

-- These tables used to have exactly one row for the whole installation.
ALTER TABLE public.ponude_postavke DROP CONSTRAINT ponude_postavke_pkey;
ALTER TABLE public.ponude_postavke ADD PRIMARY KEY (company_id, id);
ALTER TABLE public.gradiliste_board_layout DROP CONSTRAINT gradiliste_board_layout_pkey;
ALTER TABLE public.gradiliste_board_layout ADD PRIMARY KEY (company_id, id);

DO $$
DECLARE
  unique_key record;
  keys text;
BEGIN
  FOR unique_key IN
    SELECT constraint_row.oid, constraint_row.conname, constraint_row.conrelid, table_row.relname
    FROM pg_constraint constraint_row
    JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
    WHERE constraint_row.contype = 'u'
      AND constraint_row.conrelid IN (
        'public.ponude'::regclass, 'public.radni_nalozi'::regclass,
        'public.vozila'::regclass, 'public.investitori'::regclass
      )
  LOOP
    SELECT string_agg(quote_ident(attribute.attname), ', ' ORDER BY key.ordinality)
    INTO keys FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality)
    JOIN pg_attribute attribute ON attribute.attrelid = c.conrelid AND attribute.attnum = key.attnum
    WHERE c.oid = unique_key.oid;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', unique_key.relname, unique_key.conname);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (company_id, %s)',
      unique_key.relname, unique_key.conname, keys);
  END LOOP;
END;
$$;

ALTER TABLE public.tvrtke ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tvrtke FROM authenticated;
GRANT SELECT ON public.tvrtke TO authenticated;
REVOKE ALL ON public.tvrtke FROM anon;
CREATE POLICY company_read ON public.tvrtke FOR SELECT TO authenticated
  USING (id = public.app_profile_company_id() OR public.app_is_platform_owner());

CREATE TABLE public.company_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.tvrtke(id),
  email text NOT NULL CHECK (email = lower(btrim(email))),
  is_admin boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES public.app_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz
);
CREATE UNIQUE INDEX company_invitation_pending_email ON public.company_invitations(email) WHERE accepted_at IS NULL;
ALTER TABLE public.company_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_invitations FROM anon, authenticated;
GRANT SELECT ON public.company_invitations TO authenticated;
CREATE POLICY invitation_read ON public.company_invitations FOR SELECT TO authenticated
  USING ((company_id = public.app_current_company_id() AND public.app_is_admin()) OR public.app_is_platform_owner());

-- invited_at is set by GoTrue's admin invitation API, not by user-editable metadata.
CREATE OR REPLACE FUNCTION public.app_create_profile_for_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  invitation public.company_invitations;
BEGIN
  SELECT * INTO invitation FROM public.company_invitations
  WHERE email = lower(NEW.email) AND accepted_at IS NULL AND expires_at > now()
  FOR UPDATE;
  IF NEW.invited_at IS NULL OR invitation.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tvrtke WHERE id = invitation.company_id AND aktivna
  ) THEN
    RAISE EXCEPTION 'Za otvaranje računa potrebna je važeća pozivnica administratora.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.app_profiles (id, email, company_id, approved, is_admin)
  VALUES (NEW.id, NEW.email, invitation.company_id, true, invitation.is_admin);
  UPDATE public.company_invitations SET accepted_at = now() WHERE id = invitation.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.write_mobile_work_order_audit(
  p_nalog_id uuid, p_action text, p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_company uuid;
  actor_worker uuid;
  actor_label text;
BEGIN
  SELECT company_id INTO target_company FROM public.radni_nalozi WHERE id = p_nalog_id;
  IF target_company IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND target_company IS DISTINCT FROM public.app_current_company_id() THEN
    RAISE EXCEPTION 'Nalog nije dostupan.' USING ERRCODE = '42501';
  END IF;
  SELECT profile.radnik_id, nullif(btrim(concat_ws(' ', worker.ime, worker.prezime)), '')
  INTO actor_worker, actor_label
  FROM public.app_profiles profile
  LEFT JOIN public.radnici worker ON worker.id = profile.radnik_id AND worker.company_id = target_company
  WHERE profile.id = auth.uid() AND profile.company_id = target_company;
  INSERT INTO public.mobile_work_order_audit(
    company_id, nalog_id, actor_user_id, actor_radnik_id, actor_name, action, details
  ) VALUES (
    target_company, p_nalog_id, auth.uid(), actor_worker, coalesce(actor_label, 'Korisnik'),
    p_action, coalesce(p_details, '{}'::jsonb)
  );
END;
$$;

-- Storage paths already contain the owning entity ID. Keep existing paths and enforce ownership
-- in addition to (not instead of) the module/worker policies.
CREATE FUNCTION public.app_storage_in_company(p_name text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  entity_table text;
  entity_id text;
  matches boolean;
BEGIN
  entity_table := CASE split_part(p_name, '/', 1)
    WHEN 'radnici' THEN 'radnici'
    WHEN 'vozila' THEN 'vozila'
    WHEN 'oprema' THEN 'oprema'
    WHEN 'gradiliste' THEN 'gradilista'
    ELSE 'radni_nalozi' END;
  entity_id := CASE WHEN entity_table = 'radni_nalozi'
    THEN split_part(p_name, '/', 1) ELSE split_part(p_name, '/', 2) END;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id::text = $1 AND company_id = $2)', entity_table)
    INTO matches USING entity_id, public.app_current_company_id();
  RETURN matches;
END;
$$;
REVOKE ALL ON FUNCTION public.app_storage_in_company(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_storage_in_company(text) TO authenticated;
CREATE POLICY tenant_file_scope ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (bucket_id <> 'nalozi-foto' OR public.app_storage_in_company(name))
  WITH CHECK (bucket_id <> 'nalozi-foto' OR public.app_storage_in_company(name));

-- Preserve mature mobile workflow bodies, but make every exposed definer RPC pass a tenant gate.
-- The original implementations move to a non-exposed schema with no client execution grants.
DO $$
DECLARE
  rpc record;
  args text;
  guard text;
  body text;
BEGIN
  FOR rpc IN
    SELECT p.oid, p.proname, p.proretset, p.prorettype, p.proargnames, p.pronargs,
      pg_get_function_arguments(p.oid) AS declaration,
      pg_get_function_identity_arguments(p.oid) AS identity,
      pg_get_function_result(p.oid) AS result
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND (
      p.proname LIKE 'mobile_%' OR p.proname LIKE 'get_mobile_%'
      OR p.proname IN ('get_nalog_radnici_imena', 'record_nalog_inventory_tool', 'record_nalog_inventory_machine')
    )
  LOOP
    SELECT string_agg(format('$%s', position), ', ' ORDER BY position) INTO args
    FROM generate_series(1, rpc.pronargs) position;
    args := coalesce(args, '');
    guard := 'IF public.app_current_company_id() IS NULL THEN RAISE EXCEPTION ''Pristup tvrtki nije odobren.'' USING ERRCODE = ''42501''; END IF;';
    IF 'p_nalog_id' = ANY(rpc.proargnames) THEN
      guard := guard || '
        IF NOT EXISTS (SELECT 1 FROM public.radni_nalozi n WHERE n.id = p_nalog_id AND n.company_id = public.app_current_company_id())
        THEN RAISE EXCEPTION ''Nalog nije dostupan.'' USING ERRCODE = ''42501''; END IF;';
    END IF;
    IF 'p_radnik_id' = ANY(rpc.proargnames) THEN
      guard := guard || '
        IF p_radnik_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.radnici r WHERE r.id = p_radnik_id AND r.company_id = public.app_current_company_id())
        THEN RAISE EXCEPTION ''Radnik nije dostupan.'' USING ERRCODE = ''42501''; END IF;';
    END IF;
    IF 'p_oprema_id' = ANY(rpc.proargnames) THEN
      guard := guard || '
        IF NOT EXISTS (SELECT 1 FROM public.oprema o WHERE o.id = p_oprema_id AND o.company_id = public.app_current_company_id())
        THEN RAISE EXCEPTION ''Oprema nije dostupna.'' USING ERRCODE = ''42501''; END IF;
        IF NOT (public.app_has_module_permission(''radni_nalozi'', ''edit'') OR public.app_mobile_editable_nalog(p_nalog_id))
        THEN RAISE EXCEPTION ''Uređivanje naloga nije dopušteno.'' USING ERRCODE = ''42501''; END IF;';
    END IF;
    IF 'p_nalog_ids' = ANY(rpc.proargnames) THEN
      guard := guard || '
        IF EXISTS (SELECT 1 FROM unnest(p_nalog_ids) requested(id)
          WHERE NOT EXISTS (SELECT 1 FROM public.radni_nalozi n WHERE n.id = requested.id AND n.company_id = public.app_current_company_id()))
        THEN RAISE EXCEPTION ''Nalog nije dostupan.'' USING ERRCODE = ''42501''; END IF;';
    END IF;
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET SCHEMA private', rpc.proname, rpc.identity);
    EXECUTE format('REVOKE ALL ON FUNCTION private.%I(%s) FROM PUBLIC, anon, authenticated', rpc.proname, rpc.identity);
    IF rpc.proretset THEN
      body := format('RETURN QUERY SELECT * FROM private.%I(%s);', rpc.proname, args);
    ELSIF rpc.prorettype = 'void'::regtype THEN
      body := format('PERFORM private.%I(%s); RETURN;', rpc.proname, args);
    ELSE
      body := format('RETURN private.%I(%s);', rpc.proname, args);
    END IF;
    EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = public, pg_temp AS %L', rpc.proname, rpc.declaration, rpc.result, 'BEGIN ' || guard || body || ' END;');
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', rpc.proname, rpc.identity);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', rpc.proname, rpc.identity);
  END LOOP;
END;
$$;

CREATE TABLE private.company_counters (
  company_id uuid NOT NULL REFERENCES public.tvrtke(id),
  kind text NOT NULL CHECK (kind IN ('nalog', 'ponuda')),
  year integer NOT NULL,
  value integer NOT NULL,
  PRIMARY KEY (company_id, kind, year)
);
INSERT INTO private.company_counters
SELECT company_id, 'ponuda', godina, max(redni_broj) FROM public.ponude GROUP BY company_id, godina;
INSERT INTO private.company_counters
SELECT company_id, 'nalog', split_part(broj, '-', 2)::integer, max(split_part(broj, '-', 3)::integer)
FROM public.radni_nalozi WHERE broj ~ '^RN-[0-9]{4}-[0-9]+$'
GROUP BY company_id, split_part(broj, '-', 2)::integer;

CREATE FUNCTION public.next_company_number(p_kind text, p_year integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  next_number integer;
  existing_number integer;
BEGIN
  IF public.app_current_company_id() IS NULL
    OR p_kind IS NULL OR p_kind NOT IN ('nalog', 'ponuda')
    OR p_year IS NULL OR p_year NOT BETWEEN 1900 AND 9999
    OR NOT public.app_has_module_permission(CASE p_kind WHEN 'nalog' THEN 'radni_nalozi' ELSE 'ponude' END, 'edit')
  THEN RAISE EXCEPTION 'Dodjela broja nije dopuštena.' USING ERRCODE = '42501'; END IF;
  IF p_kind = 'ponuda' THEN
    SELECT coalesce(max(redni_broj), 0) INTO existing_number FROM public.ponude
    WHERE company_id = public.app_current_company_id() AND godina = p_year;
  ELSE
    SELECT coalesce(max(split_part(broj, '-', 3)::integer), 0) INTO existing_number
    FROM public.radni_nalozi WHERE company_id = public.app_current_company_id()
      AND broj ~ ('^RN-' || p_year::text || '-[0-9]+$');
  END IF;
  INSERT INTO private.company_counters(company_id, kind, year, value)
  VALUES (public.app_current_company_id(), p_kind, p_year, existing_number + 1)
  ON CONFLICT (company_id, kind, year) DO UPDATE SET value = greatest(company_counters.value + 1, existing_number + 1)
  RETURNING value INTO next_number;
  RETURN next_number;
END;
$$;
REVOKE ALL ON FUNCTION public.next_company_number(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_company_number(text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
