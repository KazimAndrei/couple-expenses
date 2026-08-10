import { addExpense } from '../lib/supabase.js';
import { diagError, diagStep } from './diagnostics.js';

// Очередь расходов, созданных без сети: реплей при появлении соединения.
const QUEUE_KEY = 'ce_pending_expenses_v1';

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeQueue(items) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export function enqueueExpense(expense) {
  const items = readQueue();
  items.push({ ...expense, _queued_at: Date.now() });
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
  const items = readQueue();
  if (!items.length || !navigator.onLine) return 0;
  let sent = 0;
  const remaining = [];
  for (const item of items) {
    const { _queued_at, ...expense } = item;
    try {
      await addExpense(expense);
      sent += 1;
    } catch (err) {
      if (isNetworkError(err)) {
        remaining.push(item); // сети всё ещё нет — вернём в очередь
      } else {
        diagError('offline flush: server rejected expense', err); // невалидную запись не гоняем вечно
      }
    }
  }
  writeQueue(remaining);
  if (sent) diagStep(`offline queue: sent ${sent}`);
  return sent;
}

export function clearQueue() {
  localStorage.removeItem(QUEUE_KEY);
}
