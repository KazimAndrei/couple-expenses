-- У политики UPDATE на categories был только USING: он проверяет строку ДО изменения,
-- но не после. Из-за этого участник пары мог сменить couple_id категории и перебросить
-- её в чужую пару. WITH CHECK требует, чтобы и результат остался внутри своей пары.
drop policy if exists "Update categories" on public.categories;
create policy "Update categories" on public.categories
  for update to authenticated
  using (couple_id = my_couple_id())
  with check (couple_id = my_couple_id());
