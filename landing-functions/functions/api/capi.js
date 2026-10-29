// Conversions API для лендинга: браузер шлёт сюда то же событие, что и пиксель (с тем же event_id),
// а мы отправляем его в Meta с сервера. Токен — секрет Pages META_CAPI_TOKEN, в коде его нет.
const PIXEL_ID = '2939131276448532';
const GRAPH = 'https://graph.facebook.com/v24.0';
const ALLOWED = new Set(['PageView', 'InitiateCheckout', 'StartTrial']);

const cookie = (header, name) => {
  const m = (header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
};

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
      fbc: cookie(cookies, '_fbc'),
    },
  };
  if (event_name === 'StartTrial') {
    event.custom_data = { value: 0.99, currency: 'USD', predicted_ltv: 39.99, content_name: 'trial_3d' };
  }
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
