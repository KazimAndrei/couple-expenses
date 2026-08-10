-- Пуш при прямом пополнении цели (не через расход — те приходят через триггер expenses)
create or replace function public.notify_goal_contribution_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.expense_id is null then
    perform net.http_post(
      url := 'https://qhmuzogvxaqvlrewcpee.supabase.co/functions/v1/expense-push',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('contribution_id', new.id)
    );
  end if;
  return new;
end;
$$;
drop trigger if exists trg_goal_contribution_push on public.goal_contributions;
create trigger trg_goal_contribution_push
  after insert on public.goal_contributions
  for each row execute function public.notify_goal_contribution_push();
revoke execute on function public.notify_goal_contribution_push() from public, anon, authenticated;
revoke execute on function public.notify_expense_push() from public, anon, authenticated;
