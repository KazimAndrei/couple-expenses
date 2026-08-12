-- Подписка покупается ДО создания пары (пейволл стоит на шаге «Создать пару»),
-- поэтому храним её за пользователем, а couple_id проставляется, когда пара появится.
alter table public.subscriptions drop constraint if exists subscriptions_pkey cascade;
alter table public.subscriptions alter column couple_id drop not null;
update public.subscriptions set owner_id = coalesce(owner_id, rc_app_user_id::uuid) where owner_id is null;
alter table public.subscriptions alter column owner_id set not null;
alter table public.subscriptions add primary key (owner_id);
create index if not exists subscriptions_couple_id_idx on public.subscriptions(couple_id);

-- Доступ: подписка владельца ищется по owner_id, даже если пары ещё нет
create or replace function public.couple_access(p_couple_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_couple_id uuid;
  v_owner_id uuid;
  v_sub record;
  v_has boolean;
begin
  if v_uid is null then
    return jsonb_build_object('has_access', false, 'reason', 'no_auth');
  end if;

  v_couple_id := coalesce(p_couple_id, (select couple_id from profiles where id = v_uid));

  if v_couple_id is null then
    select * into v_sub from subscriptions where owner_id = v_uid;
    if not found then
      return jsonb_build_object('has_access', false, 'reason', 'no_subscription', 'is_owner', true);
    end if;
    v_has := v_sub.status <> 'expired'
             and (v_sub.expires_at is null or v_sub.expires_at > now() - interval '2 days');
    return jsonb_build_object(
      'has_access', v_has, 'reason', case when v_has then 'ok' else 'expired' end,
      'status', v_sub.status, 'is_trial', v_sub.is_trial, 'will_renew', v_sub.will_renew,
      'expires_at', v_sub.expires_at, 'is_owner', true);
  end if;

  select owner_id into v_owner_id from couples where id = v_couple_id;
  select * into v_sub from subscriptions
   where couple_id = v_couple_id or owner_id = v_owner_id
   order by (couple_id = v_couple_id) desc limit 1;

  if not found then
    return jsonb_build_object('has_access', false, 'reason', 'no_subscription',
                              'is_owner', v_owner_id = v_uid);
  end if;

  v_has := v_sub.status <> 'expired'
           and (v_sub.expires_at is null or v_sub.expires_at > now() - interval '2 days');

  return jsonb_build_object(
    'has_access', v_has, 'reason', case when v_has then 'ok' else 'expired' end,
    'status', v_sub.status, 'is_trial', v_sub.is_trial, 'will_renew', v_sub.will_renew,
    'expires_at', v_sub.expires_at, 'is_owner', v_owner_id = v_uid);
end;
$$;

-- При создании пары подхватываем подписку, купленную до неё
create or replace function public.link_subscription_to_couple()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.subscriptions
     set couple_id = new.id, updated_at = now()
   where owner_id = new.owner_id and couple_id is null;
  return new;
end;
$$;
revoke execute on function public.link_subscription_to_couple() from anon, authenticated, public;

drop trigger if exists couples_link_subscription on public.couples;
create trigger couples_link_subscription
  after insert on public.couples
  for each row execute function public.link_subscription_to_couple();

-- Аудит событий RevenueCat: без него нельзя разобрать, что прислал стор
create table if not exists public.rc_webhook_events (
  id bigserial primary key,
  received_at timestamptz not null default now(),
  event_type text,
  app_user_id text,
  payload jsonb not null
);
alter table public.rc_webhook_events enable row level security;
revoke all on table public.rc_webhook_events from anon, authenticated;
create index if not exists rc_webhook_events_received_idx on public.rc_webhook_events(received_at desc);

-- owner_id стал NOT NULL и первичным ключом, поэтому ON DELETE SET NULL ломал удаление аккаунта
alter table public.subscriptions drop constraint if exists subscriptions_owner_id_fkey;
alter table public.subscriptions
  add constraint subscriptions_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete cascade;
