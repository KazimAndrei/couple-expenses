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

  if (!couple) {
    // Юзер оплатил до создания пары — сохраним, привяжем при создании (couple_id проставит create_couple flow)
    return new Response(JSON.stringify({ ok: true, pending: true, reason: "no_couple_for_owner" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { status, willRenew } = mapStatus(type, expiresAtMs);
  const { error } = await db.from("subscriptions").upsert({
    couple_id: couple.id,
    owner_id: couple.owner_id,
    rc_app_user_id: appUserId,
    product_id: productId,
    status,
    is_trial: periodType === "TRIAL",
    will_renew: willRenew,
    expires_at: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    store,
    updated_at: new Date().toISOString(),
  }, { onConflict: "couple_id" });

  if (error) {
    console.error("subscription upsert failed", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, couple_id: couple.id, status, type }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
