# CoupleExpenses

Совместный учёт расходов для пар. PWA + Vanilla JS + Supabase + Cloudflare Pages.

## Quick Start

```bash
# 1. Создай проект на supabase.com
# 2. Запусти supabase/schema.sql в SQL Editor
# 3. Скопируй URL и anon key

cp .env.example .env
# Заполни VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY

npm install
npm run dev
```

## Deploy

```bash
npm run build
npx wrangler pages deploy dist --project-name couple-expenses
```

## Features
- Добавление расходов с категориями и делением (50/50, кастом)
- Аналитика по категориям с визуальными барами
- Бюджеты с лимитами и предупреждениями (80%/100%)
- Общие цели/копилки с трекингом прогресса
- Realtime синхронизация через Supabase
- Push-уведомления, PWA, Dark mode
- RLS — данные видны только вашей паре
