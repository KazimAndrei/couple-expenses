-- Реакции и короткие реплики под тратой: строка — либо эмодзи, либо комментарий.
create table if not exists public.expense_reactions (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  couple_id uuid not null references public.couples(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  emoji text check (char_length(emoji) between 1 and 16),
  comment text check (char_length(comment) between 1 and 280),
  created_at timestamptz not null default now(),
  check ((emoji is null) <> (comment is null))
);
create index if not exists expense_reactions_expense_idx on public.expense_reactions (expense_id);
create index if not exists expense_reactions_couple_idx on public.expense_reactions (couple_id);
-- Одна эмодзи-реакция от человека на трату: новая заменяет прежнюю
create unique index if not exists expense_reactions_one_emoji on public.expense_reactions (expense_id, author_id) where emoji is not null;

alter table public.expense_reactions enable row level security;
drop policy if exists "View reactions" on public.expense_reactions;
create policy "View reactions" on public.expense_reactions for select to authenticated
  using (couple_id = public.my_couple_id());
drop policy if exists "Add reactions" on public.expense_reactions;
create policy "Add reactions" on public.expense_reactions for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and couple_id = public.my_couple_id()
    and expense_id in (select id from public.expenses where couple_id = public.my_couple_id())
  );
drop policy if exists "Delete own reactions" on public.expense_reactions;
create policy "Delete own reactions" on public.expense_reactions for delete to authenticated
  using (author_id = (select auth.uid()));

revoke all on public.expense_reactions from anon;
revoke all on public.expense_reactions from authenticated;
grant select, delete on public.expense_reactions to authenticated;
grant insert (expense_id, couple_id, emoji, comment) on public.expense_reactions to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.expense_reactions;
exception when duplicate_object then null; end $$;

-- Пуш партнёру о реакции или реплике
create or replace function public.notify_expense_reaction_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://xijqzhpqaqmqqerhxmwl.supabase.co/functions/v1/expense-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', private.push_secret()),
    body := jsonb_build_object('reaction_id', new.id)
  );
  return new;
end;
$$;
drop trigger if exists trg_expense_reaction_push on public.expense_reactions;
create trigger trg_expense_reaction_push
  after insert on public.expense_reactions
  for each row execute function public.notify_expense_reaction_push();
revoke execute on function public.notify_expense_reaction_push() from public, anon, authenticated;

-- Удаление реакции должно дойти до партнёра по realtime: фильтру по couple_id нужна вся старая строка
alter table public.expense_reactions replica identity full;
