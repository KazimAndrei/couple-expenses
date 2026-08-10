-- 1) Фото чека у расхода
alter table public.expenses add column if not exists receipt_url text;

-- 2) Storage bucket для чеков (и аватаров — код уже пытается их грузить)
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true), ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "receipts_rw" on storage.objects;
create policy "receipts_rw" on storage.objects
  for all to authenticated
  using (bucket_id in ('receipts', 'avatars'))
  with check (bucket_id in ('receipts', 'avatars'));

-- 3) Ежемесячные итоги: 1-го числа для каждой пары с пуш-токенами дёргаем Edge Function
create or replace function public.send_monthly_summaries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_couple record;
  v_count integer := 0;
begin
  for v_couple in
    select distinct c.id
    from public.couples c
    join public.profiles p on p.couple_id = c.id
    join public.device_push_tokens t on t.user_id = p.id
  loop
    perform net.http_post(
      url := 'https://qhmuzogvxaqvlrewcpee.supabase.co/functions/v1/expense-push',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'monthly_summary_couple_id', v_couple.id,
        'month', to_char(date_trunc('month', current_date - interval '1 month'), 'YYYY-MM')
      )
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.send_monthly_summaries() from public, anon, authenticated;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'monthly-summaries') then
    perform cron.unschedule('monthly-summaries');
  end if;
  perform cron.schedule('monthly-summaries', '0 7 1 * *', 'select public.send_monthly_summaries()');
end
$do$;
