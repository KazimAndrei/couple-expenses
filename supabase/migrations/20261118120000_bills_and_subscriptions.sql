-- Регулярные платежи становятся счетами и подписками: тип, период (месяц/год), напоминание,
-- и выбор — добавлять расход автоматически или ждать отметки «оплачено».
-- Значения по умолчанию повторяют прежнее поведение, поэтому старые версии приложения работают как раньше.
alter table public.recurring_expenses add column if not exists kind text not null default 'bill' check (kind in ('bill', 'subscription'));
alter table public.recurring_expenses add column if not exists period text not null default 'month' check (period in ('month', 'year'));
alter table public.recurring_expenses add column if not exists month_of_year integer check (month_of_year between 1 and 12);
alter table public.recurring_expenses add column if not exists auto_add boolean not null default true;
alter table public.recurring_expenses add column if not exists remind boolean not null default true;

-- Какой платёж закрыл этот расход: по нему видно «оплачено в этом месяце»
alter table public.expenses add column if not exists recurring_id uuid references public.recurring_expenses(id) on delete set null;
create index if not exists expenses_recurring_idx on public.expenses (recurring_id) where recurring_id is not null;

-- 1-го числа: только платежи с автодобавлением, годовые — в свой месяц
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
      and (r.period = 'month' or r.month_of_year = extract(month from current_date)::int)
      and not exists (
        select 1 from public.expenses e
        where e.couple_id = r.couple_id
          and (e.recurring_id = r.id or (e.description = r.description and e.amount = r.amount and e.paid_by = r.paid_by))
          and e.expense_date >= v_month_start
          and e.expense_date < v_month_start + interval '1 month'
      )
  loop
    insert into public.expenses (couple_id, category_id, paid_by, amount, currency, description, split, split_payer_pct, expense_date, recurring_id)
    values (
      v_rec.couple_id, v_rec.category_id, v_rec.paid_by, v_rec.amount, v_rec.currency,
      v_rec.description, v_rec.split, v_rec.split_payer_pct,
      least(v_month_start + (v_rec.day_of_month - 1) * interval '1 day', (v_month_start + interval '1 month' - interval '1 day'))::date,
      v_rec.id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.generate_recurring_expenses() from public, anon, authenticated;

-- Каждый день: напомнить о платежах на завтра и на сегодня, если их ещё не отметили оплаченными.
-- Платежи с автодобавлением не напоминаем — расход по ним создаётся сам.
create or replace function public.send_bill_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec record;
  v_count integer := 0;
  v_month_start date := date_trunc('month', current_date)::date;
  v_due date;
begin
  for v_rec in
    select r.id, r.day_of_month
    from public.recurring_expenses r
    where r.active = true and r.remind = true and r.auto_add = false
      and (r.period = 'month' or r.month_of_year = extract(month from current_date)::int)
      and not exists (
        select 1 from public.expenses e
        where e.recurring_id = r.id
          and e.expense_date >= v_month_start
          and e.expense_date < v_month_start + interval '1 month'
      )
  loop
    v_due := least(v_month_start + (v_rec.day_of_month - 1) * interval '1 day', (v_month_start + interval '1 month' - interval '1 day'))::date;
    if v_due = current_date or v_due = current_date + 1 then
      perform net.http_post(
        url := 'https://xijqzhpqaqmqqerhxmwl.supabase.co/functions/v1/expense-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', private.push_secret()),
        body := jsonb_build_object('bill_reminder_id', v_rec.id, 'due', v_due, 'today', v_due = current_date)
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.send_bill_reminders() from public, anon, authenticated;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'bill-reminders') then
    perform cron.unschedule('bill-reminders');
  end if;
  -- 02:00 UTC — утро в Азии и Европе. Напоминания получают только платежи без автодобавления,
  -- а такие создаёт лишь версия приложения с экраном платежей.
  perform cron.schedule('bill-reminders', '0 2 * * *', 'select public.send_bill_reminders()');
end
$do$;
