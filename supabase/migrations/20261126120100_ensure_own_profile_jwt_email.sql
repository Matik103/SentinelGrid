-- ensure_own_profile must not SELECT auth.users as authenticated (no table grant).
-- Use JWT email claims instead so Command profile upsert works under RLS.

CREATE OR REPLACE FUNCTION public.ensure_own_profile(
  p_display_name text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := NULLIF(btrim(COALESCE(auth.jwt() ->> 'email', '')), '');
  v_row public.profiles;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.profiles (user_id, email, display_name, status)
  VALUES (
    v_uid,
    v_email,
    NULLIF(btrim(COALESCE(p_display_name, '')), ''),
    'active'
  )
  ON CONFLICT (user_id) DO UPDATE
  SET email = COALESCE(EXCLUDED.email, public.profiles.email),
      display_name = COALESCE(
        NULLIF(btrim(COALESCE(p_display_name, '')), ''),
        public.profiles.display_name
      ),
      updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_own_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_own_profile(text) TO authenticated;
