-- Журнал доходов по месяцам: дата добавления и автор записи
-- Выполнение: Supabase Dashboard → SQL Editor → вставить весь файл → Run
-- Требуется расширение uuid-ossp (обычно уже есть в проекте CoupleExpenses)

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
CREATE POLICY "View income entries" ON public.couple_income_entries FOR SELECT
  USING (couple_id = public.my_couple_id());

DROP POLICY IF EXISTS "Insert income entries" ON public.couple_income_entries;
CREATE POLICY "Insert income entries" ON public.couple_income_entries FOR INSERT
  WITH CHECK (couple_id = public.my_couple_id());

-- Перенос уже сохранённых сумм из couple_income (только amount > 0 — иначе нарушится CHECK)
INSERT INTO public.couple_income_entries (couple_id, month, amount, created_by, created_at)
SELECT c.couple_id, c.month, c.amount,
  (SELECT p.id FROM public.profiles p WHERE p.couple_id = c.couple_id ORDER BY p.created_at ASC LIMIT 1),
  c.created_at
FROM public.couple_income c
WHERE c.amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.couple_income_entries e
    WHERE e.couple_id = c.couple_id AND e.month = c.month
  );
