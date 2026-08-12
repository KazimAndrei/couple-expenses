-- === Закрытие дыр доступа, найденных при QA-аудите ===

-- 1. UPDATE на profiles не имел WITH CHECK: проверялся только id, а couple_id можно было
--    переписать на чужую пару и получить полный доступ к её данным.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- 2. Участник пары мог переписать couples.owner_id на владельца чужой подписки
--    и получить премиум за чужой счёт; заодно подменить invite_code.
revoke update on public.couples from anon, authenticated;
grant update (name, currency) on public.couples to authenticated;

-- 3. INSERT в couples не проверял owner_id — можно было создать пару «от имени» жертвы,
--    и триггер привязал бы к ней её ещё не привязанную подписку.
drop policy if exists "Create couple" on public.couples;
create policy "Create couple" on public.couples
  for insert to authenticated
  with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));

-- 4. Чеки: одна политика открывала все пары всем авторизованным, бакет был публичным.
update storage.buckets set public = false where id = 'receipts';
drop policy if exists "receipts_rw" on storage.objects;
create policy "receipts_own_couple" on storage.objects for all to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.my_couple_id()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.my_couple_id()::text);
create policy "avatars_read" on storage.objects for select to authenticated, anon
  using (bucket_id = 'avatars');
create policy "avatars_write_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name like (select auth.uid())::text || '%');
create policy "avatars_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and name like (select auth.uid())::text || '%');
create policy "avatars_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and name like (select auth.uid())::text || '%');

-- 5. Лимит «в паре двое» держался только на проверке внутри RPC — гонка давала третьего.
create or replace function public.enforce_couple_capacity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.couple_id is not null
     and (select count(*) from profiles where couple_id = new.couple_id and id <> new.id) >= 2 then
    raise exception 'couple is full';
  end if;
  return new;
end $$;
revoke execute on function public.enforce_couple_capacity() from anon, authenticated, public;
drop trigger if exists trg_couple_capacity on public.profiles;
create trigger trg_couple_capacity before insert or update of couple_id on public.profiles
  for each row execute function public.enforce_couple_capacity();

-- 6. Повторный create_couple бросал старую пару со всеми данными и делал её неудаляемой.
create or replace function public.create_couple(p_name text default 'Our Budget', p_currency text default 'USD')
returns public.couples language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_couple public.couples;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.profiles where id = v_user_id and couple_id is not null) then
    raise exception 'already in a couple';
  end if;
  insert into public.couples (name, currency, owner_id)
  values (coalesce(nullif(p_name, ''), 'Our Budget'), coalesce(nullif(p_currency, ''), 'USD'), v_user_id)
  returning * into v_couple;
  update public.profiles set couple_id = v_couple.id where id = v_user_id;
  perform public.seed_default_categories(v_couple.id);
  return v_couple;
end;
$$;
