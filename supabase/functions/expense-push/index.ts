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
  const symbols: Record<string, string> = { THB: "฿", USD: "$", EUR: "€", RUB: "₽", KZT: "₸", GBP: "£", JPY: "¥" };
  const num = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount);
  return `${num} ${symbols[currency] ?? currency}`;
}

// deno-lint-ignore no-explicit-any
type Db = ReturnType<typeof createClient<any>>;

async function sendToUsers(db: Db, userIds: string[], title: string, body: string, extra: Record<string, unknown>) {
  if (!userIds.length) return [];
  const { data: tokens } = await db
    .from("device_push_tokens")
    .select("user_id, token")
    .in("user_id", userIds);
  if (!tokens?.length) return [];
  const jwt = await apnsJwt();
  return await Promise.all(tokens.map(async ({ user_id, token }) => {
    const res = await fetch(`${APNS_HOST}/3/device/${token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": APNS_BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
      },
      body: JSON.stringify({ aps: { alert: { title, body }, sound: "default" }, ...extra }),
    });
    if (res.status === 410 || res.status === 400) {
      const reason = (await res.json().catch(() => null))?.reason;
      if (reason === "BadDeviceToken" || reason === "Unregistered") {
        await db.from("device_push_tokens").delete().eq("user_id", user_id).eq("token", token);
      }
      return { token, status: res.status, reason };
    }
    return { token, status: res.status };
  }));
}

async function coupleMembers(db: Db, coupleId: string): Promise<{ id: string; display_name: string }[]> {
  const { data } = await db.from("profiles").select("id, display_name").eq("couple_id", coupleId);
  return data ?? [];
}

// Пуш о достижении цели — всем участникам пары
async function maybeGoalReachedPush(db: Db, goalId: string, coupleId: string, currency: string) {
  const { data: goal } = await db
    .from("goals").select("id, name, target_amount, current_amount").eq("id", goalId).maybeSingle();
  if (!goal || Number(goal.current_amount) < Number(goal.target_amount)) return [];
  const members = await coupleMembers(db, coupleId);
  return await sendToUsers(
    db, members.map((m) => m.id),
    "Цель достигнута 🎉",
    `«${goal.name}» — ${formatAmount(Number(goal.target_amount), currency)} собраны!`,
    { goal_id: goal.id },
  );
}

const MONTHS_RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

function monthRange(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split("-").map(Number);
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start: `${monthKey}-01`, end };
}

// Сумма обычных трат пары за месяц (накопления в цели не считаются)
async function monthSpend(db: Db, coupleId: string, monthKey: string, categoryId?: string): Promise<number> {
  const { start, end } = monthRange(monthKey);
  let q = db.from("expenses")
    .select("id, amount, goal_contributions(goal_id)")
    .eq("couple_id", coupleId)
    .gte("expense_date", start)
    .lt("expense_date", end);
  if (categoryId) q = q.eq("category_id", categoryId);
  const { data } = await q;
  return (data ?? [])
    .filter((r) => !(r.goal_contributions as unknown[] | null)?.length)
    .reduce((s, r) => s + Number(r.amount), 0);
}

// Пуш при пересечении 80%/100% бюджета категории этим расходом
async function maybeBudgetAlert(db: Db, expense: { couple_id: string; category_id: string | null; amount: number; expense_date: string; currency: string }, categoryName?: string) {
  if (!expense.category_id) return [];
  const monthKey = String(expense.expense_date).slice(0, 7);
  const { data: budget } = await db
    .from("budgets").select("limit_amount")
    .eq("couple_id", expense.couple_id)
    .eq("category_id", expense.category_id)
    .eq("month", `${monthKey}-01`)
    .maybeSingle();
  if (!budget) return [];
  const limit = Number(budget.limit_amount);
  if (!limit) return [];
  const spent = await monthSpend(db, expense.couple_id, monthKey, expense.category_id);
  const before = (spent - Number(expense.amount)) / limit;
  const after = spent / limit;
  let title = "";
  if (before < 1 && after >= 1) title = `Бюджет «${categoryName ?? "категория"}» исчерпан`;
  else if (before < 0.8 && after >= 0.8) title = `Бюджет «${categoryName ?? "категория"}»: 80%`;
  else return [];
  const members = await coupleMembers(db, expense.couple_id);
  return await sendToUsers(
    db, members.map((m) => m.id),
    title,
    `Потрачено ${formatAmount(spent, expense.currency)} из ${formatAmount(limit, expense.currency)}`,
    { budget_category_id: expense.category_id },
  );
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  let body: { expense_id?: string; contribution_id?: string; monthly_summary_couple_id?: string; month?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---- Итоги месяца (pg_cron, 1-го числа за прошлый месяц) ----
  if (body.monthly_summary_couple_id && body.month) {
    const coupleId = body.monthly_summary_couple_id;
    const monthKey = body.month;
    const { data: couple } = await db.from("couples").select("currency").eq("id", coupleId).maybeSingle();
    if (!couple) return new Response("couple not found", { status: 404 });

    const [y, m] = monthKey.split("-").map(Number);
    const prevKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const spent = await monthSpend(db, coupleId, monthKey);
    const prevSpent = await monthSpend(db, coupleId, prevKey);

    const { start, end } = monthRange(monthKey);
    const { data: contribs } = await db
      .from("goal_contributions")
      .select("amount, created_at, goals!inner(couple_id)")
      .eq("goals.couple_id", coupleId)
      .gte("created_at", start)
      .lt("created_at", end);
    const saved = (contribs ?? []).reduce((s, r) => s + Number(r.amount), 0);

    if (spent === 0 && saved === 0) return new Response("nothing to report", { status: 200 });

    const monthName = MONTHS_RU[m - 1] ?? monthKey;
    const trend = prevSpent > 0
      ? ` (${spent >= prevSpent ? "+" : "−"}${Math.abs(Math.round((spent / prevSpent - 1) * 100))}% к прошлому)`
      : "";
    const parts = [`потрачено ${formatAmount(spent, couple.currency)}${trend}`];
    if (saved > 0) parts.push(`отложено ${formatAmount(saved, couple.currency)}`);

    const members = await coupleMembers(db, coupleId);
    const sent = await sendToUsers(
      db, members.map((mm) => mm.id),
      `Итоги: ${monthName}`,
      parts.join(" · "),
      { monthly_summary: monthKey },
    );
    return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
  }

  // ---- Пополнение цели напрямую (без расхода) ----
  if (body.contribution_id) {
    const { data: contrib } = await db
      .from("goal_contributions")
      .select("id, amount, created_at, contributed_by, goal_id, goals(id, name, couple_id)")
      .eq("id", body.contribution_id)
      .maybeSingle();
    const goal = contrib?.goals as { id: string; name: string; couple_id: string } | null;
    if (!contrib || !goal) return new Response("contribution not found", { status: 404 });
    if (Date.now() - new Date(contrib.created_at).getTime() > 5 * 60 * 1000) return new Response("stale", { status: 200 });

    const { data: couple } = await db.from("couples").select("currency").eq("id", goal.couple_id).maybeSingle();
    const currency = couple?.currency ?? "THB";
    const members = await coupleMembers(db, goal.couple_id);
    const author = members.find((m) => m.id === contrib.contributed_by)?.display_name || "Партнёр";
    const partnerIds = members.filter((m) => m.id !== contrib.contributed_by).map((m) => m.id);

    const sent = await sendToUsers(
      db, partnerIds,
      "Пополнение цели",
      `${author} · +${formatAmount(Number(contrib.amount), currency)} · «${goal.name}»`,
      { goal_id: goal.id },
    );
    const reached = await maybeGoalReachedPush(db, goal.id, goal.couple_id, currency);
    return new Response(JSON.stringify({ sent, reached }), { headers: { "Content-Type": "application/json" } });
  }

  // ---- Расход (обычный или «отложено в цель») ----
  if (!body.expense_id) return new Response("expense_id or contribution_id required", { status: 400 });

  const { data: expense } = await db
    .from("expenses")
    .select("id, couple_id, paid_by, paid_by_snapshot_name, amount, currency, description, created_at, category_id, expense_date, categories(name), goal_contributions(goal_id, goals(id, name))")
    .eq("id", body.expense_id)
    .maybeSingle();
  if (!expense) return new Response("expense not found", { status: 404 });
  if (Date.now() - new Date(expense.created_at).getTime() > 5 * 60 * 1000) return new Response("stale", { status: 200 });

  const members = await coupleMembers(db, expense.couple_id);
  const partnerIds = members.filter((m) => m.id !== expense.paid_by).map((m) => m.id);
  const payer = expense.paid_by_snapshot_name || "Партнёр";

  const linked = (expense.goal_contributions as { goal_id: string; goals: { id: string; name: string } | null }[] | null)?.[0];
  if (linked?.goals) {
    // Накопление, не трата
    const sent = await sendToUsers(
      db, partnerIds,
      "Накопление",
      `${payer} отложил ${formatAmount(Number(expense.amount), expense.currency)} на «${linked.goals.name}»`,
      { expense_id: expense.id, goal_id: linked.goals.id },
    );
    const reached = await maybeGoalReachedPush(db, linked.goals.id, expense.couple_id, expense.currency);
    return new Response(JSON.stringify({ sent, reached }), { headers: { "Content-Type": "application/json" } });
  }

  const category = (expense.categories as { name?: string } | null)?.name;
  const sent = await sendToUsers(
    db, partnerIds,
    `−${formatAmount(Number(expense.amount), expense.currency)}`,
    [payer, category, expense.description].filter(Boolean).join(" · "),
    { expense_id: expense.id },
  );
  const budgetAlert = await maybeBudgetAlert(db, expense as never, category);
  return new Response(JSON.stringify({ sent, budgetAlert }), { headers: { "Content-Type": "application/json" } });
});
