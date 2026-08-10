# Supabase

## Актуальная схема БД — `migrations/`

`supabase/migrations/` — **источник истины** по схеме базы. Файлы выгружены 10 августа 2026 года
напрямую из истории применённых миграций проекта Supabase `qhmuzogvxaqvlrewcpee`
(таблица `supabase_migrations.schema_migrations`) и точно соответствуют тому, что реально
применено на проде.

14 миграций, применяются по порядку версии (имя файла = `<version>_<name>.sql`):

| Версия | Название |
| --- | --- |
| 20260810062710 | initial_schema |
| 20260810062725 | income |
| 20260810062729 | income_entries |
| 20260810062735 | recurring_cron_fn |
| 20260810064215 | device_push_tokens_and_expense_trigger |
| 20260810072553 | handle_new_user_null_email_fallback |
| 20260810073233 | create_couple_rpc |
| 20260810073928 | get_my_income_rpc |
| 20260810080013 | create_couple_with_currency |
| 20260810081528 | expense_to_goal |
| 20260810085154 | analytics_cron_security_hardening |
| 20260810085415 | goal_contribution_push_trigger |
| 20260810085511 | delete_my_account |
| 20260810093303 | receipts_and_monthly_summary |

Чтобы поднять базу с нуля, примените файлы из `migrations/` в порядке возрастания версии
(например, `supabase db push` или прогон файлов по очереди в SQL-редакторе).

Новые изменения схемы добавляйте **новой миграцией** в `migrations/`, а не правкой уже
применённых файлов.

## Историческая справка — `schema.sql`, `migration_*.sql`, `verify_*.sql`

Файлы `schema.sql`, `migration_*.sql` и `verify_*.sql` в корне `supabase/` остались от
предыдущего проекта и **не являются актуальной схемой**. Они сохранены только как
историческая справка: местами они расходятся с тем, что применено в текущем проекте.
Ориентироваться при работе с базой нужно на `migrations/`.

## `functions/`

`supabase/functions/` — исходники Edge Functions, деплоятся отдельно от миграций.
