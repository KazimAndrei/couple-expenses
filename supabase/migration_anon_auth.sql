-- =============================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- Adds support for anonymous auth + invite code login
-- =============================================

-- 1. Allow anyone authenticated (including anon) to find couple by invite_code
CREATE POLICY "Find couple by invite code" 
  ON public.couples FOR SELECT 
  USING (auth.uid() IS NOT NULL);

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
