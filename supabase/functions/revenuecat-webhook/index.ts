import { createClient } from "jsr:@supabase/supabase-js@2";

// Вебхук RevenueCat → состояние подписки пары.
// Модель: платит владелец пары (couples.owner_id), партнёр пользуется бесплатно.
// app_user_id в RevenueCat = auth.users.id (задаётся в SDK при логине).

const WEBHOOK_SECRET = Deno.env.get("RC_WEBHOOK_SECRET") ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Служебные события RevenueCat без состояния подписки
const NON_SUBSCRIPTION = ["TRANSFER", "PURCHASE_REDEEMED", "INVOICE_ISSUANCE", "TEST"];

const ok = (body: Record<string, unknown>) =>
  new Response(JSON.stringify({ ok: true, ...body }), { status: 200, headers: { "Content-Type": "application/json" } });

// Событие RevenueCat → статус подписки в нашей БД
function mapStatus(type: string, expiresAtMs: number | null): { status: string; willRenew: boolean } {
  const future = expiresAtMs !== null && expiresAtMs > Date.now();
  switch (type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
    case "SUBSCRIPTION_EXTENDED":
      return { status: "active", willRenew: true };
    case "CANCELLATION":
      // Отменена автопролонгация — доступ остаётся до конца оплаченного периода
      return { status: future ? "active" : "expired", willRenew: false };
    case "BILLING_ISSUE":
      return { status: "grace", willRenew: true };
    case "SUBSCRIPTION_PAUSED":
    case "EXPIRATION":
      return { status: "expired", willRenew: false };
    default:
      return { status: future ? "active" : "expired", willRenew: future };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  // RevenueCat шлёт заданный в дашборде заголовок Authorization
  if (!WEBHOOK_SECRET || req.headers.get("authorization") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: { event?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const ev = payload.event ?? {};
  let type = String(ev.type ?? "");
  let appUserId = String(ev.app_user_id ?? "");
  let productId = ev.product_id ? String(ev.product_id) : null;
  let periodType = String(ev.period_type ?? "");
  let expiresAtMs = typeof ev.expiration_at_ms === "number" ? ev.expiration_at_ms : null;
  let store = ev.store ? String(ev.store) : null;
  let environment = ev.environment ? String(ev.environment) : null;

  // TEST-события RevenueCat приходят с фиктивным юзером — подтверждаем 200, ничего не пишем
  if (type === "TEST") return new Response(JSON.stringify({ ok: true, test: true }), { status: 200 });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Журнал событий: по нему переносим веб-покупку, когда её активируют в приложении
  await db.from("rc_webhook_events").insert({
    event_type: type,
    app_user_id: appUserId || null,
    payload: ev,
  }).then(({ error }) => { if (error) console.error("event log failed", error); });

  // Оплата на сайте приходит от анонимного покупателя ($RCAnonymousID:…): пользователя Supabase
  // у него ещё нет. Подписку запишем, когда покупку активируют в приложении: RevenueCat шлёт
  // PURCHASE_REDEEMED (покупатель склеен с аккаунтом, redeemed_by) или TRANSFER (перенесён).
  if (type === "TRANSFER" || type === "PURCHASE_REDEEMED") {
    const ids = (v: unknown) => (Array.isArray(v) ? v : []).map(String);
    const people = type === "TRANSFER" ? ids(ev.transferred_to) : ids(ev.redeemed_by);
    const to = people.filter((id) => UUID.test(id));
    const from = type === "TRANSFER"
      ? ids(ev.transferred_from)
      : [...people, ...ids(ev.redeemed_from)].filter((id) => !UUID.test(id));
    if (!to.length || !from.length) return ok({ skipped: "redeem_without_user", type });
    const { data: last } = await db
      .from("rc_webhook_events")
      .select("payload")
      .in("app_user_id", from)
      .not("event_type", "in", `(${NON_SUBSCRIPTION.join(",")})`)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const src = (last?.payload ?? {}) as Record<string, unknown>;
    if (!src.type) return ok({ skipped: "redeem_source_unknown", type });
    type = String(src.type);
    appUserId = to[0];
    productId = src.product_id ? String(src.product_id) : null;
    periodType = String(src.period_type ?? "");
    expiresAtMs = typeof src.expiration_at_ms === "number" ? src.expiration_at_ms : null;
    store = src.store ? String(src.store) : null;
    environment = src.environment ? String(src.environment) : environment;
  } else if (NON_SUBSCRIPTION.includes(type)) {
    return ok({ skipped: "not_subscription_event", type });
  }

  // Продления веб-подписки после активации могут прийти на анонимный id — аккаунт есть в aliases
  if (appUserId && !UUID.test(appUserId)) {
    const known = [ev.original_app_user_id, ...(Array.isArray(ev.aliases) ? ev.aliases : [])].map(String);
    appUserId = known.find((id) => UUID.test(id)) ?? appUserId;
  }

  if (!appUserId) return new Response("no app_user_id", { status: 400 });
  if (!UUID.test(appUserId)) return ok({ skipped: "anonymous_buyer", type });

  // Пара, которой владеет плательщик
  const { data: couple } = await db
    .from("couples")
    .select("id, owner_id")
    .eq("owner_id", appUserId)
    .maybeSingle();

  // Пары может ещё не быть: пейволл стоит ДО её создания. Подписку пишем за пользователем,
  // а couple_id проставит триггер couples_link_subscription, когда пара появится.
  //
  // На пользователя приходится одна строка, поэтому событие по обычной подписке способно
  // затереть выданный вручную бессрочный доступ: отменил человек триал — и через неделю
  // EXPIRATION поставил бы expired поверх lifetime. Промо-грант гасим только событием по
  // тому же продукту, то есть настоящим отзывом самого гранта.
  const { data: current } = await db
    .from("subscriptions")
    .select("product_id, store, status, expires_at")
    .eq("owner_id", appUserId)
    .maybeSingle();

  const lifetimeGrant = current?.store === "PROMOTIONAL"
    && current?.expires_at === null
    && current?.status === "active";

  if (lifetimeGrant && current?.product_id !== productId) {
    return new Response(
      JSON.stringify({ ok: true, skipped: "lifetime_grant_kept", owner_id: appUserId, type }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const { status, willRenew } = mapStatus(type, expiresAtMs);
  const { error } = await db.from("subscriptions").upsert({
    couple_id: couple?.id ?? null,
    owner_id: appUserId,
    rc_app_user_id: appUserId,
    product_id: productId,
    status,
    is_trial: periodType === "TRIAL",
    will_renew: willRenew,
    expires_at: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    store,
    ...(environment ? { environment } : {}),
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner_id" });

  if (error) {
    console.error("subscription upsert failed", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, couple_id: couple?.id ?? null, owner_id: appUserId, status, type }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
