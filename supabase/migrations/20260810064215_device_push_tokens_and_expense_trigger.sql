create table public.device_push_tokens (
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text not null default 'ios',
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);
alter table public.device_push_tokens enable row level security;
create policy "Manage own device tokens" on public.device_push_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create extension if not exists pg_net;

create or replace function public.notify_expense_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://qhmuzogvxaqvlrewcpee.supabase.co/functions/v1/expense-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('expense_id', new.id)
  );
  return new;
end;
$$;

create trigger trg_expense_push
  after insert on public.expenses
  for each row execute function public.notify_expense_push();
