export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/notify' && request.method === 'POST') {
      return handleNotify(request, env);
    }
    return new Response('CoupleExpenses Push Worker', { status: 200 });
  },
  async scheduled(event, env) {
    console.log('Daily summary cron triggered');
  },
};

async function handleNotify(request, env) {
  try {
    const { title, body, subscriptions } = await request.json();
    const results = await Promise.allSettled(
      subscriptions.map(sub =>
        fetch(sub.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'TTL': '86400' },
          body: JSON.stringify({ title, body }),
        })
      )
    );
    const sent = results.filter(r => r.status === 'fulfilled').length;
    return Response.json({ sent, total: subscriptions.length });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
