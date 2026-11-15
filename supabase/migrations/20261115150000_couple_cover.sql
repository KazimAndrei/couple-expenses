-- Общая обложка пары: путь к фото в бакете avatars (<user_id>/cover-*.jpg), его видит только своя пара.
alter table public.couples add column if not exists cover_url text check (char_length(cover_url) <= 500);
-- Обновление couples разрешено по колонкам (security_hardening)
grant update (cover_url) on public.couples to authenticated;
