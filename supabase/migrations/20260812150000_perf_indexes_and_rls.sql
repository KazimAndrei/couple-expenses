-- Внешние ключи без покрывающих индексов: при росте данных JOIN и каскадные удаления
-- превращались бы в полное сканирование таблицы.
create index if not exists idx_budgets_category_id on public.budgets(category_id);
create index if not exists idx_categories_couple_id on public.categories(couple_id);
create index if not exists idx_couple_income_entries_created_by on public.couple_income_entries(created_by);
create index if not exists idx_couples_owner_id on public.couples(owner_id);
create index if not exists idx_goal_contributions_contributed_by on public.goal_contributions(contributed_by);
create index if not exists idx_goal_contributions_expense_id on public.goal_contributions(expense_id);
create index if not exists idx_profiles_couple_id on public.profiles(couple_id);
create index if not exists idx_recurring_expenses_category_id on public.recurring_expenses(category_id);
create index if not exists idx_recurring_expenses_paid_by on public.recurring_expenses(paid_by);
create index if not exists idx_settlements_couple_id on public.settlements(couple_id);
create index if not exists idx_settlements_settled_by on public.settlements(settled_by);

-- auth.uid() внутри политики вычисляется для КАЖДОЙ строки; (select ...) — один раз на запрос
drop policy if exists "Create couple" on public.couples;
create policy "Create couple" on public.couples for insert
  with check ((select auth.uid()) is not null);

drop policy if exists "Manage own device tokens" on public.device_push_tokens;
create policy "Manage own device tokens" on public.device_push_tokens for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert
  with check (id = (select auth.uid()));

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update
  using (id = (select auth.uid()));

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles for select
  using (id = (select auth.uid()));

drop policy if exists "Manage own push" on public.push_subscriptions;
create policy "Manage own push" on public.push_subscriptions for all
  using (user_id = (select auth.uid()));
