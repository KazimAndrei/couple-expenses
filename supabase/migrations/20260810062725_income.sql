CREATE TABLE IF NOT EXISTS public.couple_income (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  month date NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(couple_id, month)
);
ALTER TABLE public.couple_income ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View own income" ON public.couple_income FOR SELECT USING (couple_id = public.my_couple_id());
CREATE POLICY "Manage own income" ON public.couple_income FOR ALL USING (couple_id = public.my_couple_id());
