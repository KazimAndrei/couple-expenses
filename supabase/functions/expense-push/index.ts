import { createClient } from "jsr:@supabase/supabase-js@2";

const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "";
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY") ?? "";
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID") ?? "com.kazimandrei.coupleexpenses";
const APNS_HOST = Deno.env.get("APNS_HOST") ?? "https://api.push.apple.com";

const b64url = (data: Uint8Array | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function apnsJwt(): Promise<string> {
  const pem = APNS_PRIVATE_KEY.replace(/-----[A-Z ]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  const header = b64url(JSON.stringify({ alg: "ES256", kid: APNS_KEY_ID }));
  const claims = b64url(JSON.stringify({ iss: APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const unsigned = `${header}.${claims}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

function formatAmount(amount: number, currency: string): string {
  const symbols: Record<string, string> = { THB: "฿", USD: "$", EUR: "€", RUB: "₽" };
  const num = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount);
  return `${num} ${symbols[currency] ?? currency}`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  let expenseId: string | undefined;
  try {
    const body = await req.json();
    expenseId = body?.expense_id;
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!expenseId) return new Response("expense_id required", { status: 400 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Данные берём из базы по id, а не из тела запроса — payload подделать нельзя
  const { data: expense } = await supabase
    .from("expenses")
    .select("id, couple_id, paid_by, paid_by_snapshot_name, amount, currency, description, created_at, categories(name)")
    .eq("id", expenseId)
    .maybeSingle();
  if (!expense) return new Response("expense not found", { status: 404 });

  const ageMs = Date.now() - new Date(expense.created_at).getTime();
  if (ageMs > 5 * 60 * 1000) return new Response("stale", { status: 200 });

  const { data: partners } = await supabase
    .from("profiles")
    .select("id")
    .eq("couple_id", expense.couple_id)
    .neq("id", expense.paid_by ?? "00000000-0000-0000-0000-000000000000");
  const partnerIds = (partners ?? []).map((p) => p.id);
  if (!partnerIds.length) return new Response("no partner", { status: 200 });

  const { data: tokens } = await supabase
    .from("device_push_tokens")
    .select("user_id, token")
    .in("user_id", partnerIds);
  if (!tokens?.length) return new Response("no tokens", { status: 200 });

  const payer = expense.paid_by_snapshot_name || "Партнёр";
  const category = (expense.categories as { name?: string } | null)?.name;
  const title = `−${formatAmount(Number(expense.amount), expense.currency)}`;
  const body = [payer, category, expense.description].filter(Boolean).join(" · ");

  const jwt = await apnsJwt();
  const results = await Promise.all(tokens.map(async ({ user_id, token }) => {
    const res = await fetch(`${APNS_HOST}/3/device/${token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": APNS_BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
      },
      body: JSON.stringify({
        aps: { alert: { title, body }, sound: "default" },
        expense_id: expense.id,
      }),
    });
    if (res.status === 410 || res.status === 400) {
      const reason = (await res.json().catch(() => null))?.reason;
      if (reason === "BadDeviceToken" || reason === "Unregistered") {
        await supabase.from("device_push_tokens").delete().eq("user_id", user_id).eq("token", token);
      }
      return { token, status: res.status, reason };
    }
    return { token, status: res.status };
  }));

  return new Response(JSON.stringify({ sent: results }), {
    headers: { "Content-Type": "application/json" },
  });
});
