CREATE TABLE IF NOT EXISTS public.couple_income_entries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  month date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_couple_income_entries_couple_month
  ON public.couple_income_entries (couple_id, month);
ALTER TABLE public.couple_income_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View income entries" ON public.couple_income_entries;
CREATE POLICY "View income entries" ON public.couple_income_entries FOR SELECT USING (couple_id = public.my_couple_id());
DROP POLICY IF EXISTS "Insert income entries" ON public.couple_income_entries;
CREATE POLICY "Insert income entries" ON public.couple_income_entries FOR INSERT WITH CHECK (couple_id = public.my_couple_id());
