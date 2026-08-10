create or replace function public.get_my_income(p_month text)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum(amount), 0)
  from public.couple_income_entries
  where couple_id = public.my_couple_id()
    and month = (p_month || '-01')::date
$$;
grant execute on function public.get_my_income(text) to authenticated;
