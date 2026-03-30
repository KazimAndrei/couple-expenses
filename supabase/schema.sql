-- CoupleExpenses — Supabase Schema
create extension if not exists "uuid-ossp";

-- COUPLES
create table public.couples (
  id uuid primary key default uuid_generate_v4(),
  name text not null default 'Our Budget',
  currency text not null default 'THB',
  invite_code text unique default encode(gen_random_bytes(6), 'hex'),
  created_at timestamptz not null default now()
);

-- PROFILES
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  couple_id uuid references public.couples(id) on delete set null,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

-- CATEGORIES
create table public.categories (
  id uuid primary key default uuid_generate_v4(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  name text not null,
  icon text not null default 'receipt',
  color text not null default '#888780',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- EXPENSES
create type split_type as enum ('equal', 'custom', 'full_payer', 'full_other');

create table public.expenses (
  id uuid primary key default uuid_generate_v4(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  paid_by uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'THB',
  description text not null,
  split split_type not null default 'equal',
  split_payer_pct numeric(5,2) not null default 50.00,
  expense_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- BUDGETS
create table public.budgets (
  id uuid primary key default uuid_generate_v4(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  month date not null,
  limit_amount numeric(12,2) not null check (limit_amount > 0),
  created_at timestamptz not null default now(),
  unique(couple_id, category_id, month)
);

-- GOALS
create table public.goals (
  id uuid primary key default uuid_generate_v4(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  name text not null,
  target_amount numeric(12,2) not null check (target_amount > 0),
  current_amount numeric(12,2) not null default 0 check (current_amount >= 0),
  icon text not null default 'target',
  deadline date,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

-- GOAL CONTRIBUTIONS
create table public.goal_contributions (
  id uuid primary key default uuid_generate_v4(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  contributed_by uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

-- PUSH SUBSCRIPTIONS
create table public.push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  keys_p256dh text not null,
  keys_auth text not null,
  created_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

-- SETTLEMENTS
create table public.settlements (
  id uuid primary key default uuid_generate_v4(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  settled_by uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  note text,
  settled_at timestamptz not null default now()
);

-- INDEXES
create index idx_expenses_couple_date on public.expenses(couple_id, expense_date desc);
create index idx_expenses_category on public.expenses(category_id);
create index idx_expenses_paid_by on public.expenses(paid_by);
create index idx_budgets_couple_month on public.budgets(couple_id, month);
create index idx_goals_couple on public.goals(couple_id);
create index idx_goal_contributions_goal on public.goal_contributions(goal_id);

-- ROW LEVEL SECURITY
alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.categories enable row level security;
alter table public.expenses enable row level security;
alter table public.budgets enable row level security;
alter table public.goals enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.settlements enable row level security;

-- Helper: get current user's couple_id
create or replace function public.my_couple_id()
returns uuid language sql security definer stable as $$
  select couple_id from public.profiles where id = auth.uid()
$$;

create or replace function public.join_couple_by_invite(p_invite_code text, p_display_name text default 'User')
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

  select *
    into v_couple
  from public.couples
  where invite_code = p_invite_code
  limit 1;

  if v_couple.id is null then
    raise exception 'invite code not found';
  end if;

  update public.profiles
  set couple_id = v_couple.id,
      display_name = coalesce(nullif(p_display_name, ''), display_name)
  where id = v_user_id;

  return v_couple;
end;
$$;
grant execute on function public.join_couple_by_invite(text, text) to authenticated;

-- PROFILES policies
create policy "Users can view own profile" on public.profiles for select using (id = auth.uid());
create policy "Users can view partner" on public.profiles for select using (couple_id = public.my_couple_id() and public.my_couple_id() is not null);
create policy "Users can update own profile" on public.profiles for update using (id = auth.uid());

-- COUPLES policies
create policy "View own couple" on public.couples for select using (id = public.my_couple_id());
create policy "Update own couple" on public.couples for update using (id = public.my_couple_id());

-- CATEGORIES policies
create policy "View categories" on public.categories for select using (couple_id = public.my_couple_id());
create policy "Insert categories" on public.categories for insert with check (couple_id = public.my_couple_id());
create policy "Update categories" on public.categories for update using (couple_id = public.my_couple_id());
create policy "Delete categories" on public.categories for delete using (couple_id = public.my_couple_id());

-- EXPENSES policies
create policy "View expenses" on public.expenses for select using (couple_id = public.my_couple_id());
create policy "Insert expenses" on public.expenses for insert with check (couple_id = public.my_couple_id());
create policy "Update expenses" on public.expenses for update using (couple_id = public.my_couple_id());
create policy "Delete expenses" on public.expenses for delete using (couple_id = public.my_couple_id());

-- BUDGETS policies
create policy "View budgets" on public.budgets for select using (couple_id = public.my_couple_id());
create policy "Manage budgets" on public.budgets for all using (couple_id = public.my_couple_id());

-- GOALS policies
create policy "View goals" on public.goals for select using (couple_id = public.my_couple_id());
create policy "Manage goals" on public.goals for all using (couple_id = public.my_couple_id());

-- GOAL CONTRIBUTIONS policies
create policy "View contributions" on public.goal_contributions for select using (goal_id in (select id from public.goals where couple_id = public.my_couple_id()));
create policy "Add contributions" on public.goal_contributions for insert with check (goal_id in (select id from public.goals where couple_id = public.my_couple_id()));

-- PUSH SUBSCRIPTIONS policies
create policy "Manage own push" on public.push_subscriptions for all using (user_id = auth.uid());

-- SETTLEMENTS policies
create policy "View settlements" on public.settlements for select using (couple_id = public.my_couple_id());
create policy "Insert settlements" on public.settlements for insert with check (couple_id = public.my_couple_id());

-- TRIGGERS
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.update_modified_column()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger set_expense_updated before update on public.expenses for each row execute procedure public.update_modified_column();

create or replace function public.update_goal_amount()
returns trigger language plpgsql security definer as $$
begin
  update public.goals set current_amount = (select coalesce(sum(amount), 0) from public.goal_contributions where goal_id = new.goal_id) where id = new.goal_id;
  return new;
end;
$$;
create trigger on_goal_contribution after insert on public.goal_contributions for each row execute procedure public.update_goal_amount();

-- SEED DEFAULT CATEGORIES
create or replace function public.seed_default_categories(p_couple_id uuid)
returns void language plpgsql security definer as $$
begin
  insert into public.categories (couple_id, name, icon, color, sort_order) values
    (p_couple_id, 'Продукты',    'shopping-cart', '#EF9F27', 1),
    (p_couple_id, 'Рестораны',   'utensils',      '#E24B4A', 2),
    (p_couple_id, 'Жильё',      'home',          '#7F77DD', 3),
    (p_couple_id, 'Транспорт',  'car',           '#378ADD', 4),
    (p_couple_id, 'Здоровье',   'heart',         '#D4537E', 5),
    (p_couple_id, 'Развлечения','gamepad',       '#1D9E75', 6),
    (p_couple_id, 'Одежда',     'shirt',         '#D85A30', 7),
    (p_couple_id, 'Подписки',   'credit-card',   '#534AB7', 8),
    (p_couple_id, 'Другое',     'more-horizontal','#888780', 9);
end;
$$;

-- REALTIME
alter publication supabase_realtime add table public.expenses;
alter publication supabase_realtime add table public.goals;
alter publication supabase_realtime add table public.settlements;

-- VIEWS
create or replace view public.monthly_category_totals as
select e.couple_id, date_trunc('month', e.expense_date)::date as month, e.category_id,
  c.name as category_name, c.icon as category_icon, c.color as category_color,
  sum(e.amount) as total, count(*) as tx_count
from public.expenses e left join public.categories c on c.id = e.category_id
group by e.couple_id, month, e.category_id, c.name, c.icon, c.color;

create or replace view public.monthly_payer_totals as
select e.couple_id, date_trunc('month', e.expense_date)::date as month, e.paid_by,
  p.display_name as payer_name, sum(e.amount) as total_paid, count(*) as tx_count
from public.expenses e join public.profiles p on p.id = e.paid_by
group by e.couple_id, month, e.paid_by, p.display_name;

create or replace view public.balance_between_partners as
select e.couple_id, e.paid_by, p.display_name as payer_name,
  sum(case e.split
    when 'equal' then e.amount / 2
    when 'full_payer' then 0
    when 'full_other' then e.amount
    when 'custom' then e.amount * (100 - e.split_payer_pct) / 100
  end) as amount_owed_to_payer
from public.expenses e join public.profiles p on p.id = e.paid_by
group by e.couple_id, e.paid_by, p.display_name;
