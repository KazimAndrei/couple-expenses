-- === Закрытие путей злоупотребления, найденных при аудите ===

-- 1. Пейволл жил только в клиенте: один POST на /rpc/create_couple давал бессрочный
--    бесплатный доступ, а в веб-сборке пейволла не было вовсе.
create or replace function public.create_couple(p_name text default 'Our Budget', p_currency text default 'USD')
returns public.couples language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_couple public.couples;
  v_access jsonb;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.profiles where id = v_user_id and couple_id is not null) then
    raise exception 'already in a couple';
  end if;
  v_access := public.couple_access();
  if not coalesce((v_access->>'has_access')::boolean, false) then
    raise exception 'subscription required';
  end if;
  insert into public.couples (name, currency, owner_id)
  values (coalesce(nullif(p_name, ''), 'Our Budget'), coalesce(nullif(p_currency, ''), 'USD'), v_user_id)
  returning * into v_couple;
  update public.profiles set couple_id = v_couple.id where id = v_user_id;
  perform public.seed_default_categories(v_couple.id);
  return v_couple;
end;
$$;

revoke insert on public.couples from anon, authenticated;
drop policy if exists "Create couple" on public.couples;
revoke insert, update, delete on public.subscriptions from anon, authenticated;
revoke execute on function public.generate_recurring_expenses() from anon, authenticated, public;

-- 2. Функция пушей была открыта миру: любой мог слать чужие уведомления и жечь вызовы.
--    Секрет храним в приватной схеме — pg_proc.prosrc читается любым пользователем.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.fn_secrets (name text primary key, value text not null);
revoke all on private.fn_secrets from public, anon, authenticated;
-- значение задаётся вручную и совпадает с секретом PUSH_FN_SECRET у Edge Function
create or replace function private.push_secret()
returns text language sql security definer stable set search_path = private
as $$ select value from private.fn_secrets where name = 'push_fn' $$;
revoke all on function private.push_secret() from public, anon, authenticated;

-- 3. Хранилище без лимитов: можно было залить терабайт любых файлов
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif']
 where id in ('receipts','avatars');
update storage.buckets set public = false where id = 'avatars';

-- 4. Триггер подстановки имени работал с повышенными правами и не проверял членство:
--    так утекало имя любого пользователя сервиса.
create or replace function public.set_paid_by_snapshot_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.paid_by is not null then
    if not exists (select 1 from public.profiles where id = new.paid_by and couple_id = new.couple_id) then
      raise exception 'payer not in couple';
    end if;
    if tg_op = 'INSERT' or new.paid_by is distinct from old.paid_by or new.paid_by_snapshot_name is null then
      select display_name into new.paid_by_snapshot_name from public.profiles where id = new.paid_by;
    end if;
  end if;
  return new;
end;
$$;

-- 5. Ни одно поле не имело предела длины, суммы, даты или процента
alter table public.expenses  add constraint expenses_description_len check (length(description) <= 300) not valid;
alter table public.categories add constraint categories_name_len   check (length(name) <= 60) not valid;
alter table public.goals      add constraint goals_name_len        check (length(name) <= 100) not valid;
alter table public.profiles   add constraint profiles_name_len     check (length(display_name) <= 60) not valid;
alter table public.profiles   add constraint profiles_avatar_len   check (avatar_url is null or length(avatar_url) <= 500) not valid;
alter table public.couples    add constraint couples_name_len      check (length(name) <= 100) not valid;
alter table public.couples    add constraint couples_currency_len  check (length(currency) = 3) not valid;
alter table public.expenses add constraint expenses_amount_max check (amount <= 100000000) not valid;
alter table public.goals    add constraint goals_amount_max    check (target_amount <= 100000000) not valid;
alter table public.expenses add constraint expenses_date_sane
  check (expense_date >= date '2000-01-01' and expense_date <= date '2100-01-01') not valid;
alter table public.expenses add constraint expenses_split_pct_range
  check (split_payer_pct is null or (split_payer_pct >= 0 and split_payer_pct <= 100)) not valid;

-- 6. Аудит вебхуков рос без ограничений
create or replace function public.prune_rc_webhook_events()
returns integer language plpgsql security definer set search_path = public as $$
declare v_deleted integer;
begin
  delete from public.rc_webhook_events where received_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke execute on function public.prune_rc_webhook_events() from anon, authenticated, public;
