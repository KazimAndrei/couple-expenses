-- Пуш «Итог недели готов»: по понедельникам, за прошедшие пн–вс, только парам с устройствами для пушей.
create or replace function public.send_weekly_recaps()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_couple record;
  v_count integer := 0;
  v_from date := (date_trunc('week', current_date) - interval '7 days')::date;
begin
  for v_couple in
    select distinct p.couple_id as id
    from public.profiles p
    join public.device_push_tokens t on t.user_id = p.id
    where p.couple_id is not null
  loop
    perform net.http_post(
      url := 'https://xijqzhpqaqmqqerhxmwl.supabase.co/functions/v1/expense-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', private.push_secret()),
      body := jsonb_build_object('weekly_recap_couple_id', v_couple.id, 'from', v_from, 'to', v_from + 6)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.send_weekly_recaps() from public, anon, authenticated;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'weekly-recaps') then
    perform cron.unschedule('weekly-recaps');
  end if;
  -- Расписание включаем, когда версия с итогом недели выйдет в App Store: иначе пуш придёт тем,
  -- у кого открыть итог ещё нечем. 02:00 UTC понедельника — утро в Азии и Европе.
  -- perform cron.schedule('weekly-recaps', '0 2 * * 1', 'select public.send_weekly_recaps()');
end
$do$;
