-- Приложение ориентировано на США: дефолтные категории засеваем по-английски.
-- В интерфейсе они переводятся по названию (categoryLabel в src/lib/i18n.js),
-- поэтому русскоязычные пользователи и старые пары видят русские названия.
create or replace function public.seed_default_categories(p_couple_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.categories (couple_id, name, icon, color, sort_order) values
    (p_couple_id, 'Groceries',     'shopping-cart',   '#EF9F27', 1),
    (p_couple_id, 'Restaurants',   'utensils',        '#E24B4A', 2),
    (p_couple_id, 'Housing',       'home',            '#7F77DD', 3),
    (p_couple_id, 'Transport',     'car',             '#378ADD', 4),
    (p_couple_id, 'Health',        'heart',           '#D4537E', 5),
    (p_couple_id, 'Entertainment', 'gamepad',         '#1D9E75', 6),
    (p_couple_id, 'Clothing',      'shirt',           '#D85A30', 7),
    (p_couple_id, 'Subscriptions', 'credit-card',     '#534AB7', 8),
    (p_couple_id, 'Other',         'more-horizontal', '#888780', 9);
end;
$$;
