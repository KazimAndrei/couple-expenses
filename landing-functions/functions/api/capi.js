// Conversions API для лендинга: браузер шлёт сюда то же событие, что и пиксель (с тем же event_id),
// а мы отправляем его в Meta с сервера. Токен — секрет Pages META_CAPI_TOKEN, в коде его нет.
// StartTrial сюда не приходит: его шлёт функция Supabase meta-start-trial с email из покупки.
const PIXEL_ID = '2939131276448532';
const GRAPH = 'https://graph.facebook.com/v24.0';
const ALLOWED = new Set(['PageView', 'InitiateCheckout']);

const cookie = (header, name) => {
  const m = (header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
};

// Meta принимает ключи совпадения хешированными SHA-256 после нормализации
const sha256 = async (value) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
};
const hashed = async (value) => (value ? [await sha256(value)] : undefined);

export async function onRequestPost({ request, env }) {
  if (!env.META_CAPI_TOKEN) return new Response('not configured', { status: 503 });
  let body;
  try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
  const { event_name, event_id, event_source_url, custom_data } = body || {};
  if (!ALLOWED.has(event_name) || typeof event_id !== 'string' || event_id.length > 64) {
    return new Response('bad event', { status: 400 });
  }
  // Принимаем события только со своего сайта
  let url;
  try { url = new URL(event_source_url); } catch { return new Response('bad url', { status: 400 }); }
  if (url.hostname !== 'coupleexpenses.com') return new Response('bad origin', { status: 400 });

  const cookies = request.headers.get('Cookie');
  // fbc из fbclid в адресе, если cookie ещё не успела записаться
  const fbclid = url.searchParams.get('fbclid');
  const fbc = cookie(cookies, '_fbc') || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined);
  const eid = cookie(cookies, 'ce_eid');
  // Гео по IP от Cloudflare: страна, регион, город, индекс
  const cf = request.cf || {};
  const norm = (v) => (v ? String(v).toLowerCase().replace(/[^a-z0-9]/g, '') : '');
  const event = {
    event_name,
    event_id,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    event_source_url: url.toString(),
    user_data: {
      client_ip_address: request.headers.get('CF-Connecting-IP') || undefined,
      client_user_agent: request.headers.get('User-Agent') || undefined,
      fbp: cookie(cookies, '_fbp'),
      fbc,
      external_id: eid && /^[0-9a-f-]{32,36}$/.test(eid) ? await hashed(eid) : undefined,
      country: await hashed(norm(cf.country)),
      st: await hashed(norm(cf.regionCode)),
      ct: await hashed(norm(cf.city)),
      zp: await hashed(norm(cf.postalCode)),
    },
  };
  if (event_name === 'InitiateCheckout') {
    event.custom_data = {
      value: 0.99,
      currency: 'USD',
      content_name: 'trial_3d',
      content_category: typeof custom_data?.content_category === 'string' ? custom_data.content_category.slice(0, 8) : undefined,
    };
  }

  const res = await fetch(`${GRAPH}/${PIXEL_ID}/events?access_token=${encodeURIComponent(env.META_CAPI_TOKEN)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [event] }),
  });
  return new Response(res.ok ? 'ok' : 'meta error', { status: res.ok ? 200 : 502 });
}
