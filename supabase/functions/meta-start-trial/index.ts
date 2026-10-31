import { createClient } from "jsr:@supabase/supabase-js@2";

// StartTrial в Meta Conversions API с сервера — для триала, оплаченного на сайте.
// Страница /try/success присылает id покупателя RevenueCat и свои _fbp/_fbc; email и страну берём
// из события покупки (вебхук RevenueCat пишет его в rc_webhook_events). event_id совпадает с
// браузерным пикселем — Meta склеивает дубль. Токен — секрет META_CAPI_TOKEN.

const PIXEL_ID = "2939131276448532";
const GRAPH = "https://graph.facebook.com/v24.0";
const ANON = /^\$RCAnonymousID:([0-9a-f]{32})$/;
const CORS = {
  "Access-Control-Allow-Origin": "https://coupleexpenses.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Meta принимает ключи совпадения хешированными SHA-256 после нормализации
async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const cookieValue = (v: unknown) => (typeof v === "string" && /^fb\.\d\.\d+\.[\w.-]{1,200}$/.test(v) ? v : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply(405, { ok: false });

  const token = Deno.env.get("META_CAPI_TOKEN");
  if (!token) return reply(503, { ok: false, error: "not configured" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(400, { ok: false });
  }
  const appUserId = String(body.app_user_id ?? "");
  const anon = appUserId.match(ANON);
  const eventId = `StartTrial.${anon?.[1]}`;
  if (!anon || body.event_id !== eventId) return reply(400, { ok: false });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Покупка подтверждается вебхуком; страница успеха может открыться раньше — ждём до ~15 с
  let purchase: Record<string, unknown> | null = null;
  for (let i = 0; i < 10 && !purchase; i++) {
    if (i) await sleep(1500);
    const { data } = await db
      .from("rc_webhook_events")
      .select("payload")
      .eq("app_user_id", appUserId)
      .eq("event_type", "INITIAL_PURCHASE")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    purchase = (data?.payload as Record<string, unknown>) ?? null;
  }
  if (!purchase) return reply(202, { ok: false, pending: true });
  if (purchase.store !== "RC_BILLING") return reply(200, { ok: true, skipped: "not_web_purchase" });
  // Тестовая (sandbox) покупка уходит в Meta только как тестовое событие — для проверки в Events Manager
  const testCode = typeof body.test_event_code === "string" && /^TEST\w{1,20}$/.test(body.test_event_code) ? body.test_event_code : null;
  if (purchase.environment !== "PRODUCTION" && !testCode) return reply(200, { ok: true, skipped: "sandbox" });

  // Одно событие на покупку: повторный вызов (перезагрузка, второе устройство) не шлём
  const { data: sent } = await db
    .from("rc_webhook_events")
    .select("id")
    .eq("app_user_id", appUserId)
    .eq("event_type", "META_START_TRIAL")
    .limit(1)
    .maybeSingle();
  if (sent && !testCode) return reply(200, { ok: true, skipped: "already_sent" });

  const attrs = (purchase.subscriber_attributes ?? {}) as Record<string, { value?: string }>;
  const email = attrs.$email?.value?.trim().toLowerCase();
  const country = typeof purchase.country_code === "string" ? purchase.country_code.toLowerCase() : "";
  const externalIds = [appUserId, typeof body.external_id === "string" && /^[0-9a-f-]{32,36}$/.test(body.external_id) ? body.external_id : ""]
    .filter(Boolean);

  let sourceUrl = "https://coupleexpenses.com/try/success";
  try {
    const u = new URL(String(body.event_source_url));
    if (u.hostname === "coupleexpenses.com") sourceUrl = u.origin + u.pathname;
  } catch { /* остаётся адрес по умолчанию */ }

  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "").trim();
  const price = Number(purchase.price);
  const event = {
    event_name: "StartTrial",
    event_id: eventId,
    event_time: Math.floor(Date.now() / 1000),
    action_source: "website",
    event_source_url: sourceUrl,
    user_data: {
      em: email ? [await sha256(email)] : undefined,
      external_id: await Promise.all(externalIds.map((id) => sha256(id))),
      country: country ? [await sha256(country)] : undefined,
      client_ip_address: ip || undefined,
      client_user_agent: req.headers.get("user-agent") || undefined,
      fbp: cookieValue(body.fbp),
      fbc: cookieValue(body.fbc),
    },
    custom_data: {
      value: Number.isFinite(price) && price > 0 ? price : 0.99,
      currency: typeof purchase.currency === "string" ? purchase.currency : "USD",
      predicted_ltv: 39.99,
      content_name: "trial_3d",
    },
  };

  const res = await fetch(`${GRAPH}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [event], ...(purchase.environment !== "PRODUCTION" && testCode ? { test_event_code: testCode } : {}) }),
  });
  const meta = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("meta capi failed", res.status, meta?.error?.message);
    return reply(502, { ok: false });
  }

  if (purchase.environment !== "PRODUCTION") return reply(200, { ok: true, test: true, events_received: meta?.events_received });
  await db.from("rc_webhook_events").insert({
    event_type: "META_START_TRIAL",
    app_user_id: appUserId,
    payload: { event_id: eventId, fbtrace_id: meta?.fbtrace_id ?? null, has_email: !!email, has_fbc: !!event.user_data.fbc },
  });
  return reply(200, { ok: true });
});
