create or replace function public.create_couple(p_name text default 'Our Budget')
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
  insert into public.couples (name)
  values (coalesce(nullif(p_name, ''), 'Our Budget'))
  returning * into v_couple;
  update public.profiles set couple_id = v_couple.id where id = v_user_id;
  perform public.seed_default_categories(v_couple.id);
  return v_couple;
end;
$$;
grant execute on function public.create_couple(text) to authenticated;
