-- Полное удаление аккаунта (App Store Review Guideline 5.1.1(v)).
--
-- Прежняя версия сносила только device_push_tokens и auth.users. Из-за правил внешних
-- ключей это оставляло: расходы пары (expenses.paid_by → SET NULL) вместе с копией
-- имени в paid_by_snapshot_name, а также саму пару, у которой owner_id обнулялся, —
-- то есть данные удалившегося человека продолжали лежать в базе.
--
-- Логика теперь зависит от того, остаётся ли партнёр:
--   * последний участник — пара удаляется целиком, каскадом уходят расходы, категории,
--     цели, бюджеты и подписка;
--   * партнёр остаётся — общие финансовые записи ему нужны, поэтому они остаются,
--     но имя ушедшего из них вычищается.
--
-- Файлы в Storage отсюда не трогаем: DELETE по storage.objects убирает только строку
-- метаданных и оставляет объект в бакете. Их удаляет Edge Function delete-account,
-- которая вызывает эту функцию уже после очистки файлов.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_couple_id uuid;
  v_partners integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select couple_id into v_couple_id from public.profiles where id = v_user_id;

  if v_couple_id is not null then
    select count(*) into v_partners
    from public.profiles
    where couple_id = v_couple_id and id <> v_user_id;

    if v_partners = 0 then
      delete from public.couples where id = v_couple_id;
    else
      update public.expenses
      set paid_by_snapshot_name = null
      where couple_id = v_couple_id and paid_by = v_user_id;
    end if;
  end if;

  delete from public.device_push_tokens where user_id = v_user_id;
  delete from auth.users where id = v_user_id;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
