BEGIN;

-- Preflight only: do not remove or rewrite production token rows here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.app_push_tokens
    GROUP BY token
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'app_push_tokens contains duplicate tokens; reconcile them manually before applying this migration'
      USING ERRCODE = '23505';
  END IF;
END;
$$;

ALTER TABLE public.app_push_tokens
  ADD COLUMN IF NOT EXISTS installation_proof text;

CREATE UNIQUE INDEX IF NOT EXISTS app_push_tokens_token_unique
  ON public.app_push_tokens (token);

CREATE UNIQUE INDEX IF NOT EXISTS app_push_tokens_installation_platform_unique
  ON public.app_push_tokens (installation_proof, platform)
  WHERE installation_proof IS NOT NULL;

DROP POLICY IF EXISTS app_push_tokens_select ON public.app_push_tokens;
DROP POLICY IF EXISTS app_push_tokens_insert ON public.app_push_tokens;
DROP POLICY IF EXISTS app_push_tokens_update ON public.app_push_tokens;
DROP POLICY IF EXISTS app_push_tokens_delete ON public.app_push_tokens;

REVOKE ALL ON TABLE public.app_push_tokens FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.register_app_push_token(text, text);
DROP FUNCTION IF EXISTS public.register_app_push_token(text, text, text);
DROP FUNCTION IF EXISTS public.unregister_app_push_token(text);

CREATE OR REPLACE FUNCTION public.register_app_push_token(
  p_token text,
  p_platform text,
  p_previous_token text,
  p_installation_proof text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_profile public.app_profiles;
  installation_proof_value text;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'Push token je obavezan.' USING ERRCODE = '22023';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('android', 'ios') THEN
    RAISE EXCEPTION 'Platforma push uređaja nije podržana.' USING ERRCODE = '22023';
  END IF;
  IF p_installation_proof IS NULL
    OR p_installation_proof !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Tajna instalacije nije ispravna.' USING ERRCODE = '22023';
  END IF;

  SELECT profile.*
  INTO current_profile
  FROM public.app_profiles profile
  WHERE profile.id = auth.uid()
    AND profile.approved = true
    AND profile.company_id = public.app_current_company_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Korisnik nije ovlašten za registraciju push uređaja.' USING ERRCODE = '42501';
  END IF;

  installation_proof_value := p_installation_proof;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat('installation:', p_platform, ':', installation_proof_value), 0
  ));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat('token:', p_token), 0
  ));

  IF EXISTS (
    SELECT 1
    FROM public.app_push_tokens existing
    WHERE existing.token = p_token
      AND existing.installation_proof IS DISTINCT FROM installation_proof_value
      AND NOT (
        existing.installation_proof IS NULL
        AND existing.user_id = auth.uid()
        AND existing.company_id = current_profile.company_id
      )
  ) THEN
    RAISE EXCEPTION
      'Push token pripada drugom uređaju ili računu. Prijavite se na prethodni račun i uredno odjavite uređaj.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.app_push_tokens existing
  WHERE (
      existing.installation_proof = installation_proof_value
      AND existing.platform = p_platform
      AND (p_previous_token IS NULL OR existing.token = p_previous_token)
    )
    OR (
      existing.token = p_token
      AND (
        existing.installation_proof = installation_proof_value
        OR (
          existing.installation_proof IS NULL
          AND existing.user_id = auth.uid()
          AND existing.company_id = current_profile.company_id
        )
      )
    );

  INSERT INTO public.app_push_tokens (
    user_id, token, platform, company_id, installation_proof, updated_at
  )
  VALUES (
    auth.uid(), p_token, p_platform, current_profile.company_id,
    installation_proof_value, clock_timestamp()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_app_push_token(
  p_token text,
  p_platform text,
  p_installation_proof text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_profile public.app_profiles;
  installation_proof_value text;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = ''
    OR p_installation_proof IS NULL
    OR p_installation_proof !~ '^[0-9a-f]{64}$'
    OR p_platform IS NULL OR p_platform NOT IN ('android', 'ios') THEN
    RAISE EXCEPTION 'Neispravni podaci push registracije.' USING ERRCODE = '22023';
  END IF;

  SELECT profile.*
  INTO current_profile
  FROM public.app_profiles profile
  WHERE profile.id = auth.uid()
    AND profile.approved = true
    AND profile.company_id = public.app_current_company_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Korisnik nije ovlašten za uklanjanje push registracije.' USING ERRCODE = '42501';
  END IF;

  installation_proof_value := p_installation_proof;

  DELETE FROM public.app_push_tokens existing
  WHERE existing.user_id = auth.uid()
    AND existing.company_id = current_profile.company_id
    AND existing.token = p_token
    AND existing.platform = p_platform
    AND existing.installation_proof = installation_proof_value;
END;
$$;

REVOKE ALL ON FUNCTION public.register_app_push_token(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unregister_app_push_token(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_app_push_token(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_app_push_token(text, text, text) TO authenticated;

COMMIT;
