// Удаление аккаунта целиком: файлы в Storage + все записи в БД.
//
// Отдельная функция нужна из-за Storage: объекты бакета живут не в Postgres, и DELETE
// по storage.objects стирает только строку метаданных, оставляя сам файл в хранилище.
// Снести байты можно лишь Storage API и только service-ключом, поэтому чеки и аватар
// удаляются здесь, а записи БД — в SQL-функции delete_my_account(), вызываемой от
// имени самого пользователя (её логика опирается на auth.uid()).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Функцию дёргает WKWebView с origin capacitor://localhost, то есть кросс-доменно.
// Без этих заголовков и без ответа на OPTIONS браузер не пропускает даже preflight,
// запрос до функции не доходит, и кнопка удаления выглядит мёртвой.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return json({ ok: false, error: 'unauthorized' }, 401);

  // Клиент от имени пользователя: и подтверждает его личность, и даёт delete_my_account()
  // правильный auth.uid()
  const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) return json({ ok: false, error: 'unauthorized' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Пару и её чеки удаляем, только если человек уходит последним: иначе история трат
  // остаётся партнёру, для которого это его собственные данные
  const { data: profile } = await admin
    .from('profiles').select('couple_id').eq('id', user.id).maybeSingle();
  const coupleId = profile?.couple_id ?? null;

  let partners = 0;
  if (coupleId) {
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('couple_id', coupleId)
      .neq('id', user.id);
    partners = count ?? 0;
  }

  const removed: Record<string, number> = { receipts: 0, avatars: 0 };

  if (coupleId && partners === 0) {
    const { data: files } = await admin.storage.from('receipts').list(coupleId, { limit: 1000 });
    const paths = (files || []).map((f) => `${coupleId}/${f.name}`);
    if (paths.length) {
      const { error } = await admin.storage.from('receipts').remove(paths);
      if (error) return json({ ok: false, error: `receipts: ${error.message}` }, 500);
      removed.receipts = paths.length;
    }
  }

  const { data: avatarFiles } = await admin.storage.from('avatars').list(user.id, { limit: 100 });
  const avatarPaths = (avatarFiles || []).map((f) => `${user.id}/${f.name}`);
  if (avatarPaths.length) {
    const { error } = await admin.storage.from('avatars').remove(avatarPaths);
    if (error) return json({ ok: false, error: `avatars: ${error.message}` }, 500);
    removed.avatars = avatarPaths.length;
  }

  // Записи БД удаляем последними: если что-то упадёт раньше, аккаунт останется живым
  // и пользователь сможет повторить, а не зависнет с наполовину снесёнными данными
  const { error: rpcErr } = await asUser.rpc('delete_my_account');
  if (rpcErr) return json({ ok: false, error: rpcErr.message }, 500);

  return json({ ok: true, removed, coupleDeleted: Boolean(coupleId) && partners === 0 });
});
