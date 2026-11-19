-- Исправления по итогам проверки платежей:
-- 1) напоминание приходит в 9 утра по часам пользователя (пояс телефона хранится рядом с токеном пуша);
-- 2) срок считается вперёд от сегодняшнего дня, поэтому «завтра» работает и для платежей 1-го числа;
-- 3) «оплачено» — это расход рядом со сроком, а не в том же календарном месяце;
-- 4) один сбойный платёж не срывает создание расходов для остальных.
alter table public.device_push_tokens add column if not exists tz text check (char_length(tz) <= 64);

-- Таблица пустая: ограничения расходов переносим на шаблоны, чтобы платёж нельзя было завести таким,
-- каким расход по нему потом не создастся
alter table public.recurring_expenses drop constraint if exists recurring_expenses_description_len;
alter table public.recurring_expenses add constraint recurring_expenses_description_len check (char_length(description) between 1 and 300);
alter table public.recurring_expenses drop constraint if exists recurring_expenses_amount_max;
alter table public.recurring_expenses add constraint recurring_expenses_amount_max check (amount <= 100000000);

-- Ближайший срок платежа не раньше заданного дня
create or replace function public.bill_next_due(p_period text, p_day integer, p_month integer, p_from date)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  v_start date;
  v_due date;
begin
  if p_period = 'year' then
    v_start := make_date(extract(year from p_from)::int, coalesce(p_month, 1), 1);
  else
    v_start := date_trunc('month', p_from)::date;
  end if;
  v_due := least(v_start + (greatest(p_day, 1) - 1), (v_start + interval '1 month' - interval '1 day')::date);
  if v_due < p_from then
    v_start := (v_start + case when p_period = 'year' then interval '1 year' else interval '1 month' end)::date;
    v_due := least(v_start + (greatest(p_day, 1) - 1), (v_start + interval '1 month' - interval '1 day')::date);
  end if;
  return v_due;
end;
$$;
revoke execute on function public.bill_next_due(text, integer, integer, date) from public, anon, authenticated;

create or replace function public.send_bill_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
  v_count integer := 0;
  v_tz text;
  v_local timestamp;
  v_today date;
  v_due date;
  v_window integer;
begin
  for v_rec in
    select r.id, r.couple_id, r.paid_by, r.split, r.period, r.day_of_month, r.month_of_year
    from public.recurring_expenses r
    where r.active = true and r.remind = true and r.auto_add = false
  loop
    begin
      -- Пояс того, кто отвечает за платёж; для общего — любого из пары; неизвестен — Бангкок, как у первых пользователей
      select t.tz into v_tz
      from public.device_push_tokens t
      join public.profiles p on p.id = t.user_id
      where p.couple_id = v_rec.couple_id and t.tz is not null
        and exists (select 1 from pg_timezone_names n where n.name = t.tz)
      order by (t.user_id = v_rec.paid_by) desc, t.updated_at desc
      limit 1;
      v_local := now() at time zone coalesce(v_tz, 'Asia/Bangkok');
      -- Задание идёт каждый час; шлём только тем, у кого сейчас девять утра
      if extract(hour from v_local)::int <> 9 then continue; end if;
      v_today := v_local::date;
      v_due := public.bill_next_due(v_rec.period, v_rec.day_of_month, v_rec.month_of_year, v_today);
      if v_due <> v_today and v_due <> v_today + 1 then continue; end if;
      -- Оплата «рядом со сроком»: полмесяца для ежемесячного, полгода для годового
      v_window := case when v_rec.period = 'year' then 180 else 15 end;
      if exists (
        select 1 from public.expenses e
        where e.recurring_id = v_rec.id and e.couple_id = v_rec.couple_id
          and e.expense_date between v_due - v_window and v_due + v_window
      ) then continue; end if;
      perform net.http_post(
        url := 'https://xijqzhpqaqmqqerhxmwl.supabase.co/functions/v1/expense-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', private.push_secret()),
        body := jsonb_build_object('bill_reminder_id', v_rec.id, 'due', v_due, 'today', v_due = v_today)
      );
      v_count := v_count + 1;
    exception when others then
      raise warning 'bill reminder % failed: %', v_rec.id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.send_bill_reminders() from public, anon, authenticated;

create or replace function public.generate_recurring_expenses()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_rec record;
  v_month_start date := date_trunc('month', current_date)::date;
begin
  for v_rec in
    select r.*
    from public.recurring_expenses r
    where r.active = true
      and r.auto_add = true
      and (r.period = 'month' or coalesce(r.month_of_year, 1) = extract(month from current_date)::int)
      and not exists (
        select 1 from public.expenses e
        where e.couple_id = r.couple_id
          and (e.recurring_id = r.id or (e.description = r.description and e.amount = r.amount and e.paid_by = r.paid_by))
          and e.expense_date >= v_month_start
          and e.expense_date < v_month_start + interval '1 month'
      )
  loop
    begin
      insert into public.expenses (couple_id, category_id, paid_by, amount, currency, description, split, split_payer_pct, expense_date, recurring_id)
      values (
        v_rec.couple_id, v_rec.category_id, v_rec.paid_by, v_rec.amount, v_rec.currency,
        v_rec.description, v_rec.split, v_rec.split_payer_pct,
        least(v_month_start + (v_rec.day_of_month - 1) * interval '1 day', (v_month_start + interval '1 month' - interval '1 day'))::date,
        v_rec.id
      );
      v_count := v_count + 1;
    exception when others then
      -- Один платёж с негодными данными не должен оставить без расходов все остальные пары
      raise warning 'recurring expense % failed: %', v_rec.id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.generate_recurring_expenses() from public, anon, authenticated;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'bill-reminders') then
    perform cron.unschedule('bill-reminders');
  end if;
  perform cron.schedule('bill-reminders', '0 * * * *', 'select public.send_bill_reminders()');
end
$do$;
