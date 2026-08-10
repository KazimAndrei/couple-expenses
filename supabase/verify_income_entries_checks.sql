-- Запросы для ручной проверки в Supabase SQL Editor (план: RLS и SUM vs UI)
-- Подставьте свой couple_id и нужный месяц.

-- 1) Есть ли таблица и строки журнала
SELECT id, couple_id, month, amount, created_by, created_at
FROM public.couple_income_entries
WHERE couple_id = '00000000-0000-0000-0000-000000000000'::uuid  -- заменить
  AND month = '2026-04-01'::date
ORDER BY created_at DESC;

-- 2) Сумма журнала за месяц (должна совпадать с «Доход за месяц» в приложении,
--    если есть хотя бы одна запись в couple_income_entries)
SELECT COALESCE(SUM(amount), 0) AS sum_entries
FROM public.couple_income_entries
WHERE couple_id = '00000000-0000-0000-0000-000000000000'::uuid
  AND month = '2026-04-01'::date;

-- 3) Сравнение с legacy couple_income (если таблица ещё используется)
SELECT c.amount AS legacy_row
FROM public.couple_income c
WHERE c.couple_id = '00000000-0000-0000-0000-000000000000'::uuid
  AND c.month = '2026-04-01'::date;

-- 4) Политики RLS на журнале (Supabase / Postgres)
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'couple_income_entries';
