// Быстрый ввод расходов: слипы из Фото, «Поделиться», QR оплаты, скан чека, голос.
// Нативная часть — плагин Capture (ios/App/App/SlipScannerPlugin.swift), смысл — в lib/slips.js и lib/voice.js.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { parseSlip } from '../lib/slips.js';
import { getLang } from '../lib/i18n.js';

// Один экземпляр на всё приложение: повторный registerPlugin Капаситор отклоняет с предупреждением
export const Capture = registerPlugin('Capture');
const SETTINGS_KEY = 'ce_slip_import_v1';
const SEEN_LIMIT = 400;

export const isCaptureAvailable = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

export function readSlipSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      enabled: s.enabled ?? null,
      since: s.since || 0,
      seen: Array.isArray(s.seen) ? s.seen : [],
      // Найденные в Фото, но ещё не показанные (открыта форма, приложение закрыли) — не теряем
      pending: Array.isArray(s.pending) ? s.pending : [],
    };
  } catch {
    return { enabled: null, since: 0, seen: [], pending: [] };
  }
}

export function writeSlipSettings(patch) {
  const next = { ...readSlipSettings(), ...patch };
  next.seen = next.seen.slice(-SEEN_LIMIT);
  next.pending = next.pending.slice(-50);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* приватный режим */ }
  return next;
}

export function markSeen(keys) {
  const s = readSlipSettings();
  const seen = new Set([...s.seen, ...keys.filter(Boolean)]);
  writeSlipSettings({
    seen: [...seen],
    pending: s.pending.filter((p) => !seen.has(`asset:${p.assetId}`) && !(p.slip?.key && seen.has(p.slip.key))),
  });
}

export async function photoAccess(request = false) {
  if (!isCaptureAvailable()) return 'unavailable';
  try {
    return (await Capture.photoAccess({ request })).status;
  } catch {
    return 'unavailable';
  }
}

// Нативный вызов не должен навсегда занять проверку — после тайм-аута считаем, что ничего не нашли
const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('capture timeout')), ms)),
]);

const b64ToBlob = (b64, type = 'image/jpeg') => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',').pop());
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

export async function photoBlob(assetId) {
  const { data } = await Capture.getPhoto({ id: assetId, maxSide: 1600 });
  return b64ToBlob(data);
}

// Найденные оплаты: входящие из «Поделиться» (всё, где есть сумма) и новые слипы в Фото.
// scanPhotos: false — только входящие (быстро, при каждом возврате в приложение)
export async function collectPayments({ now = new Date(), scanPhotos = true } = {}) {
  if (!isCaptureAvailable()) return [];
  const items = [];
  const settings = readSlipSettings();
  const seen = new Set(settings.seen);
  const isSeen = (assetId, key) => seen.has(`asset:${assetId}`) || (key && seen.has(key));

  try {
    const { items: inbox = [] } = await withTimeout(Capture.takeInbox(), 30000);
    for (const it of inbox) {
      const slip = parseSlip(it, now);
      // Присланный слип, который уже добавляли, — показываем, но помечаем (по умолчанию не добавляется)
      items.push({ source: 'inbox', inboxId: it.id, created: it.created, blob: b64ToBlob(it.data), slip, alreadyAdded: !!slip.key && seen.has(slip.key) });
    }
  } catch { /* расширения может не быть в старой сборке */ }

  // Прислали через «Поделиться» — показываем сразу, Фото досмотрим в следующий раз
  if (settings.enabled && !items.length) {
    const pending = settings.pending.filter((p) => !isSeen(p.assetId, p.slip?.key));
    if (scanPhotos) {
      // Первый запуск — смотрим последние 3 дня, дальше — только новое с прошлой проверки
      const sinceMs = settings.since || now.getTime() - 3 * 86400000;
      try {
        const res = await withTimeout(Capture.scanPhotos({ sinceMs, limit: 60 }), 40000);
        if (res.status === 'denied') writeSlipSettings({ enabled: false });
        for (const it of res.items || []) {
          const slip = parseSlip(it, now);
          if (!slip.isSlip || isSeen(it.id, slip.key) || pending.some((p) => p.assetId === it.id)) continue;
          pending.push({ source: 'photo', assetId: it.id, created: it.created, slip: { ...slip, text: slip.text.slice(0, 2000) } });
        }
        // since двигаем только до последнего реально просмотренного фото
        if (res.processedUntil) writeSlipSettings({ since: Math.max(res.processedUntil, sinceMs) });
      } catch { /* нет доступа или Vision не справился — просто ничего не нашли */ }
    }
    writeSlipSettings({ pending });
    items.push(...pending);
  }

  // Один и тот же слип мог прийти и из Фото, и через «Поделиться» (или прислан дважды)
  const byKey = new Map();
  for (const it of items) {
    const k = it.slip.key || `${it.source}:${it.inboxId || it.assetId}`;
    const kept = byKey.get(k);
    if (!kept) byKey.set(k, { ...it, inboxIds: it.inboxId ? [it.inboxId] : [] });
    else if (it.inboxId) kept.inboxIds.push(it.inboxId); // копии тоже уберём из входящих
  }
  return [...byKey.values()].sort((a, b) => (b.created || 0) - (a.created || 0));
}

export const seenKeys = (item) => [item.slip?.key, item.assetId ? `asset:${item.assetId}` : null];

export async function clearInbox(items) {
  const ids = items.flatMap((i) => i.inboxIds || (i.inboxId ? [i.inboxId] : []));
  if (ids.length) await Capture.clearInbox({ ids }).catch(() => {});
}

export async function scanPaymentQr() {
  return Capture.scanQr({ lang: getLang() });
}

export async function recognizeFile(file) {
  const data = await fileToBase64(file);
  return parseSlip(await Capture.recognize({ data }));
}

export async function listenForExpense() {
  const locale = getLang() === 'ru' ? 'ru-RU' : 'en-US';
  return Capture.listen({ locale });
}
