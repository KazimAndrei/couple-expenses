-- Migration: join_couple_by_invite stale-profile cleanup + security_barrier views scoped by my_couple_id()
-- Keep in sync with supabase/schema.sql

create or replace function public.join_couple_by_invite(p_invite_code text, p_display_name text default 'User')
returns public.couples
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_couple public.couples;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select *
    into v_couple
  from public.couples
  where invite_code = p_invite_code
  limit 1;

  if v_couple.id is null then
    raise exception 'invite code not found';
  end if;

  -- If already 2+ members, unlink the oldest non-current profile to make room
  if (select count(*)::int from public.profiles where couple_id = v_couple.id and id != v_user_id) >= 2 then
    update public.profiles set couple_id = null
    where id in (
      select id from public.profiles
      where couple_id = v_couple.id and id != v_user_id
      order by created_at asc
      limit 1
    );
  end if;

  update public.profiles
  set couple_id = v_couple.id,
      display_name = case
        when display_name in ('', 'User') then coalesce(nullif(p_display_name, ''), display_name)
        else display_name
      end
  where id = v_user_id;

  return v_couple;
end;
$$;

grant execute on function public.join_couple_by_invite(text, text) to authenticated;

create or replace view public.monthly_category_totals with (security_barrier) as
select e.couple_id, date_trunc('month', e.expense_date)::date as month, e.category_id,
  c.name as category_name, c.icon as category_icon, c.color as category_color,
  sum(e.amount) as total, count(*) as tx_count
from public.expenses e left join public.categories c on c.id = e.category_id
where e.couple_id = public.my_couple_id()
group by e.couple_id, month, e.category_id, c.name, c.icon, c.color;

create or replace view public.monthly_payer_totals with (security_barrier) as
select e.couple_id, date_trunc('month', e.expense_date)::date as month, e.paid_by,
  p.display_name as payer_name, sum(e.amount) as total_paid, count(*) as tx_count
from public.expenses e join public.profiles p on p.id = e.paid_by
where e.couple_id = public.my_couple_id()
group by e.couple_id, month, e.paid_by, p.display_name;

create or replace view public.balance_between_partners with (security_barrier) as
select e.couple_id, e.paid_by, p.display_name as payer_name,
  sum(case e.split
    when 'equal' then e.amount / 2
    when 'full_payer' then 0
    when 'full_other' then e.amount
    when 'custom' then e.amount * (100 - e.split_payer_pct) / 100
  end) as amount_owed_to_payer
from public.expenses e join public.profiles p on p.id = e.paid_by
where e.couple_id = public.my_couple_id()
group by e.couple_id, e.paid_by, p.display_name;
