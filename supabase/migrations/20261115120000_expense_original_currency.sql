-- Трата в чужой валюте: amount остаётся в валюте пары (все суммы и бюджеты считаются по нему),
-- а исходная сумма и её валюта хранятся рядом — чтобы показать «฿110» под пересчитанным числом.
alter table public.expenses add column if not exists original_amount numeric(12,2) check (original_amount > 0);
alter table public.expenses add column if not exists original_currency text;
