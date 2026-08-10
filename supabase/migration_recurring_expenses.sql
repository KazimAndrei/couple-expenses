-- Adds recurring expense templates support

create table if not exists public.recurring_expenses (
  id uuid primary key default uuid_generate_v4(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  paid_by uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'THB',
  description text not null,
  split split_type not null default 'equal',
  split_payer_pct numeric(5,2) not null default 50.00,
  day_of_month int not null check (day_of_month between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_recurring_expenses_couple on public.recurring_expenses(couple_id);
alter table public.recurring_expenses enable row level security;

drop policy if exists "View recurring expenses" on public.recurring_expenses;
create policy "View recurring expenses" on public.recurring_expenses for select using (couple_id = public.my_couple_id());

drop policy if exists "Manage recurring expenses" on public.recurring_expenses;
create policy "Manage recurring expenses" on public.recurring_expenses for all using (couple_id = public.my_couple_id());
