-- 1) Аналитика не считает накопления (расходы, привязанные к целям) тратами
create or replace view public.monthly_category_totals with (security_barrier) as
select e.couple_id, date_trunc('month', e.expense_date)::date as month, e.category_id,
  c.name as category_name, c.icon as category_icon, c.color as category_color,
  sum(e.amount) as total, count(*) as tx_count
from public.expenses e left join public.categories c on c.id = e.category_id
where e.couple_id = public.my_couple_id()
  and not exists (select 1 from public.goal_contributions gc where gc.expense_id = e.id)
group by e.couple_id, month, e.category_id, c.name, c.icon, c.color;

create or replace view public.monthly_payer_totals with (security_barrier) as
select e.couple_id, date_trunc('month', e.expense_date)::date as month, e.paid_by,
  p.display_name as payer_name, sum(e.amount) as total_paid, count(*) as tx_count
from public.expenses e
join public.profiles p on p.id = e.paid_by
join public.couples c  on c.id = e.couple_id
where e.couple_id = public.my_couple_id()
  and e.currency = c.currency
  and not exists (select 1 from public.goal_contributions gc where gc.expense_id = e.id)
group by e.couple_id, month, e.paid_by, p.display_name;

-- 2) Views исполняются с правами читающего (fix advisor: security_definer_view)
alter view public.monthly_category_totals set (security_invoker = true);
alter view public.monthly_payer_totals set (security_invoker = true);
alter view public.balance_between_partners set (security_invoker = true);

-- 3) Явный search_path у функций (fix advisor: function_search_path_mutable)
alter function public.handle_new_user() set search_path = public;
alter function public.update_modified_column() set search_path = public;
alter function public.update_goal_amount() set search_path = public;
alter function public.update_goal_amount_on_delete() set search_path = public;
alter function public.seed_default_categories(uuid) set search_path = public;
alter function public.my_couple_id() set search_path = public;

-- 4) Отзываем EXECUTE у ролей, которым функции не нужны (fix advisor: *_security_definer_function_executable)
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.update_modified_column() from public, anon, authenticated;
revoke execute on function public.update_goal_amount() from public, anon, authenticated;
revoke execute on function public.update_goal_amount_on_delete() from public, anon, authenticated;
revoke execute on function public.set_paid_by_snapshot_name() from public, anon, authenticated;
revoke execute on function public.seed_default_categories(uuid) from public, anon, authenticated;
revoke execute on function public.my_couple_id() from public, anon;
revoke execute on function public.check_invite_capacity(text) from public, anon;
revoke execute on function public.generate_recurring_expenses() from public, anon;
revoke execute on function public.create_couple(text, text) from public, anon;
revoke execute on function public.join_couple_by_invite(text, text) from public, anon;
revoke execute on function public.add_expense_to_goal(uuid, numeric, uuid, split_type, date, text) from public, anon;
revoke execute on function public.get_my_income(text) from public, anon;

-- 5) Ежемесячная генерация recurring-расходов
create extension if not exists pg_cron;
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'generate-recurring-monthly') then
    perform cron.unschedule('generate-recurring-monthly');
  end if;
  perform cron.schedule('generate-recurring-monthly', '0 6 1 * *', 'select public.generate_recurring_expenses()');
end
$do$;
