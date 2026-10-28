-- Режим «Я сам по себе»: пара из одного человека без партнёрского интерфейса.
-- Обновляет флаг сам владелец через существующую политику "Update own couple".
alter table public.couples add column if not exists solo boolean not null default false;
-- Обновление couples разрешено по колонкам (security_hardening): без этого запись solo молча отклоняется
grant update (solo) on public.couples to authenticated;
