-- Исправить «Личное» и похожие заглушки в display_name профилей на нормальные имена для пары из 2 человек.
-- Правило (как в приложении): кто раньше по created_at → «Андрей», второй участник → «Полина».
-- Выполнить: Supabase → SQL Editor → Run.
--
-- Если порядок регистрации не совпадает с реальными именами, после миграции один раз поменяйте
-- display_name вручную в Table Editor → profiles (или раскомментируйте блок внизу с вашими UUID).

WITH member_rank AS (
  SELECT
    p.id,
    p.couple_id,
    p.display_name,
    row_number() OVER (PARTITION BY p.couple_id ORDER BY p.created_at ASC NULLS LAST, p.id) AS rn_in_couple,
    count(*) OVER (PARTITION BY p.couple_id) AS members_in_couple
  FROM public.profiles p
  WHERE p.couple_id IS NOT NULL
),
needs_fix AS (
  SELECT id, rn_in_couple
  FROM member_rank
  WHERE members_in_couple = 2
    AND (
      lower(trim(coalesce(display_name, ''))) LIKE 'личн%'
      OR lower(trim(coalesce(display_name, ''))) IN ('личный', 'personal', 'private', 'я')
    )
)
UPDATE public.profiles p
SET display_name = CASE n.rn_in_couple
  WHEN 1 THEN 'Андрей'
  ELSE 'Полина'
END
FROM needs_fix n
WHERE p.id = n.id;

-- Ручная подстановка (раскомментируйте и подставьте uuid из auth.users / profiles):
-- UPDATE public.profiles SET display_name = 'Андрей'  WHERE id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'::uuid;
-- UPDATE public.profiles SET display_name = 'Полина' WHERE id = 'yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy'::uuid;
