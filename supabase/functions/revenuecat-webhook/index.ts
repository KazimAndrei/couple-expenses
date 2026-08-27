import { createClient } from "jsr:@supabase/supabase-js@2";

// Вебхук RevenueCat → состояние подписки пары.
// Модель: платит владелец пары (couples.owner_id), партнёр пользуется бесплатно.
// app_user_id в RevenueCat = auth.users.id (задаётся в SDK при логине).

const WEBHOOK_SECRET = Deno.env.get("RC_WEBHOOK_SECRET") ?? "";

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
  const type = String(ev.type ?? "");
  const appUserId = String(ev.app_user_id ?? "");
  const productId = ev.product_id ? String(ev.product_id) : null;
  const periodType = String(ev.period_type ?? "");
  const expiresAtMs = typeof ev.expiration_at_ms === "number" ? ev.expiration_at_ms : null;
  const store = ev.store ? String(ev.store) : null;

  // TEST-события RevenueCat приходят с фиктивным юзером — подтверждаем 200, ничего не пишем
  if (type === "TEST") return new Response(JSON.stringify({ ok: true, test: true }), { status: 200 });
  if (!appUserId) return new Response("no app_user_id", { status: 400 });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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
