-- Run this in Supabase SQL Editor to enable auto-generation of recurring expenses.
-- This function creates expenses from active recurring templates for the current month.
-- Call it manually or schedule via pg_cron.

CREATE OR REPLACE FUNCTION public.generate_recurring_expenses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_rec record;
  v_today date := current_date;
  v_month_start date := date_trunc('month', current_date)::date;
BEGIN
  FOR v_rec IN
    SELECT r.*
    FROM public.recurring_expenses r
    WHERE r.active = true
      AND NOT EXISTS (
        SELECT 1 FROM public.expenses e
        WHERE e.couple_id = r.couple_id
          AND e.description = r.description
          AND e.amount = r.amount
          AND e.paid_by = r.paid_by
          AND e.expense_date >= v_month_start
          AND e.expense_date < v_month_start + interval '1 month'
      )
  LOOP
    INSERT INTO public.expenses (couple_id, category_id, paid_by, amount, currency, description, split, split_payer_pct, expense_date)
    VALUES (
      v_rec.couple_id,
      v_rec.category_id,
      v_rec.paid_by,
      v_rec.amount,
      v_rec.currency,
      v_rec.description,
      v_rec.split,
      v_rec.split_payer_pct,
      LEAST(v_month_start + (v_rec.day_of_month - 1) * interval '1 day', (v_month_start + interval '1 month' - interval '1 day'))::date
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_recurring_expenses() TO authenticated;

-- To schedule automatic execution (requires pg_cron extension):
-- SELECT cron.schedule('generate-recurring', '0 6 1 * *', 'SELECT public.generate_recurring_expenses()');
