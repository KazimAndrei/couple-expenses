import { addExpense } from '../lib/supabase.js';
import { diagError, diagStep } from './diagnostics.js';

// Очередь расходов, созданных без сети: реплей при появлении соединения.
const QUEUE_KEY = 'ce_pending_expenses_v1';

// Флаг защищает от параллельного слива: flushQueue дёргается и при старте приложения,
// и по событию online — два одновременных прохода отправляли одни и те же записи дважды.
let flushing = false;

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeQueue(items) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch (err) {
    // Переполнение квоты не должно ронять обработчик клика
    diagError('offline queue: write failed', err);
  }
}

export function enqueueExpense(expense) {
  const items = readQueue();
  // client_id переживает ретраи: если ответ сервера потерялся, повтор не создаст дубль
  items.push({ ...expense, _queued_at: Date.now(), client_id: crypto.randomUUID() });
  writeQueue(items);
}

export function pendingCount() {
  return readQueue().length;
}

// Ошибка сети (fetch failed) — а не отказ сервера: серверные ошибки не ставим в очередь
export function isNetworkError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return !navigator.onLine || msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed');
}

export async function flushQueue() {
  if (flushing) return 0;
  const items = readQueue();
  if (!items.length || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  const failed = [];
  const processed = new Set();
  try {
    for (const item of items) {
      const { _queued_at, client_id, ...expense } = item;
      processed.add(client_id || _queued_at);
      try {
        await addExpense(expense);
        sent += 1;
      } catch (err) {
        if (isNetworkError(err)) {
          failed.push(item); // сети всё ещё нет — вернём в очередь
        } else {
          diagError('offline flush: server rejected expense', err); // невалидную запись не гоняем вечно
        }
      }
    }
  } finally {
    // Перечитываем очередь: пока шла отправка, пользователь мог добавить новые записи,
    // и запись целиком затирала бы их
    const current = readQueue();
    const added = current.filter((i) => !processed.has(i.client_id || i._queued_at));
    writeQueue([...failed, ...added]);
    flushing = false;
  }
  if (sent) diagStep(`offline queue: sent ${sent}`);
  return sent;
}

export function clearQueue() {
  localStorage.removeItem(QUEUE_KEY);
}
