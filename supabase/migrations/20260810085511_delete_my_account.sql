-- Требование App Store 5.1.1(v): удаление аккаунта из приложения.
-- Удаляет auth-пользователя; profiles каскадится по FK, contributions/expenses остаются
-- у пары (paid_by -> null, имя сохранено в paid_by_snapshot_name).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  delete from public.device_push_tokens where user_id = v_user_id;
  delete from auth.users where id = v_user_id;
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
