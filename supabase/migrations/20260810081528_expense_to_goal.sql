-- Расход можно отложить в цель: contribution связывается с расходом,
-- удаление расхода каскадно снимает contribution и пересчитывает цель.
alter table public.goal_contributions
  add column if not exists expense_id uuid references public.expenses(id) on delete cascade;

create or replace function public.update_goal_amount_on_delete()
returns trigger language plpgsql security definer as $$
begin
  update public.goals
  set current_amount = (select coalesce(sum(amount), 0) from public.goal_contributions where goal_id = old.goal_id)
  where id = old.goal_id;
  return old;
end;
$$;
drop trigger if exists on_goal_contribution_delete on public.goal_contributions;
create trigger on_goal_contribution_delete
  after delete on public.goal_contributions
  for each row execute procedure public.update_goal_amount_on_delete();

create or replace function public.add_expense_to_goal(
  p_goal_id uuid,
  p_amount numeric,
  p_paid_by uuid,
  p_split split_type default 'equal',
  p_expense_date date default current_date,
  p_description text default null
)
returns public.expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_couple_id uuid := public.my_couple_id();
  v_goal public.goals;
  v_expense public.expenses;
begin
  if auth.uid() is null or v_couple_id is null then
    raise exception 'not authenticated';
  end if;
  select * into v_goal from public.goals where id = p_goal_id and couple_id = v_couple_id;
  if v_goal.id is null then
    raise exception 'goal not found';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if not exists (select 1 from public.profiles where id = p_paid_by and couple_id = v_couple_id) then
    raise exception 'payer not in couple';
  end if;

  insert into public.expenses (couple_id, category_id, paid_by, amount, currency, description, split, expense_date)
  select v_couple_id, null, p_paid_by, p_amount, c.currency,
         coalesce(nullif(p_description, ''), v_goal.name), p_split, p_expense_date
  from public.couples c where c.id = v_couple_id
  returning * into v_expense;

  insert into public.goal_contributions (goal_id, contributed_by, amount, expense_id)
  values (p_goal_id, auth.uid(), p_amount, v_expense.id);

  return v_expense;
end;
$$;
grant execute on function public.add_expense_to_goal(uuid, numeric, uuid, split_type, date, text) to authenticated;
