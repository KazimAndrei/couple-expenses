-- =============================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- Adds support for anonymous auth + invite code login
-- =============================================

-- 1. Replace broad invite-code SELECT policy with secure RPC flow
DROP POLICY IF EXISTS "Find couple by invite code" ON public.couples;

CREATE OR REPLACE FUNCTION public.join_couple_by_invite(p_invite_code text, p_display_name text default 'User')
RETURNS public.couples
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_couple public.couples;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT *
    INTO v_couple
  FROM public.couples
  WHERE invite_code = p_invite_code
  LIMIT 1;

  IF v_couple.id IS NULL THEN
    RAISE EXCEPTION 'invite code not found';
  END IF;

  UPDATE public.profiles
  SET couple_id = v_couple.id,
      display_name = COALESCE(NULLIF(p_display_name, ''), display_name)
  WHERE id = v_user_id;

  RETURN v_couple;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_couple_by_invite(text, text) TO authenticated;

-- 2. Allow authenticated users to create couples  
CREATE POLICY "Create couple"
  ON public.couples FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- 3. Allow users to insert their own profile
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- 4. Update handle_new_user trigger to work with anonymous users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'display_name', 'User'),
    new.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;
