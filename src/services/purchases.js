import { Capacitor } from '@capacitor/core';
import { Purchases } from '@revenuecat/purchases-capacitor';
import { supabase } from '../lib/supabase.js';
import { getState } from '../lib/store.js';
import { diagError, diagStep } from './diagnostics.js';
// diagStep/diagError пишут только в dev-сборках — в релиз ничего не попадает

// RevenueCat: подписку покупает владелец пары, партнёр пользуется бесплатно.
// appUserID = id пользователя Supabase, чтобы покупка следовала за аккаунтом, а не за устройством.
const API_KEY = import.meta.env.VITE_REVENUECAT_IOS_KEY;
export const ENTITLEMENT = 'premium';

let configuredUserId = null;
let initError = null;

// ВАЖНО: Purchases — это Proxy Capacitor, у которого ЛЮБОЕ свойство (включая `then`)
// возвращает функцию. Поэтому он выглядит как thenable: любой await над ним или возврат
// из async-функции заставляет движок звать Purchases.then(resolve, reject), мост не находит
// метод `then` и не вызывает ни resolve, ни reject — промис висит вечно.
// Используем импортированный объект напрямую, без обёрток и без await.

export function purchasesAvailable() {
  return Capacitor.isNativePlatform() && Boolean(API_KEY);
}

// Любой вызов через мост Capacitor может не вернуть ответ — тогда UI висит навсегда.
// Всё, что уходит в нативный плагин, оборачиваем в таймаут.
function withTimeout(label, promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}: нет ответа ${ms / 1000}с`)), ms)),
  ]);
}

// id пользователя берём из состояния приложения: supabase.auth.getUser()/getSession()
// в Capacitor WebView могут не вернуть управление (внутренний лок supabase-js),
// а это подвешивало весь пейволл ещё до первого обращения к стору.
function currentUserId() {
  const stateUser = getState()?.user?.id;
  if (stateUser) return stateUser;
  try {
    const raw = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    return raw ? JSON.parse(localStorage.getItem(raw))?.user?.id || null : null;
  } catch { return null; }
}

export async function initPurchases() {
  if (!purchasesAvailable()) return;
  const userId = currentUserId();
  if (!userId) { diagError('purchases init', new Error('no user id')); return; }
  // Сравниваем с тем, под кем SDK сконфигурирован: раньше флаг был булевым и после
  // смены пользователя покупка уходила на предыдущий аккаунт.
  if (configuredUserId === userId) return;
  try {
    if (configuredUserId) {
      await withTimeout('logIn', Purchases.logIn({ appUserID: userId }), 6000);
    } else {
      await withTimeout('configure', Purchases.configure({ apiKey: API_KEY, appUserID: userId }), 6000);
    }
    configuredUserId = userId;
    diagStep('purchases: configured');
    // Ссылку активации открыли до входа — активируем сразу, как появился пользователь
    const pending = takePendingRedemption();
    if (pending) redeemWebPurchaseUrl(pending).catch(() => {});
  } catch (err) {
    // Не бросаем: вызывающие ждут обычного продолжения, а отклонённый промис
    // без обработчика оставлял пейволл в бесконечной загрузке.
    diagError('purchases init failed', err);
    initError = err?.message || String(err);
  }
}


// Последняя ошибка загрузки тарифов — для диагностики в UI
let lastOfferingsError = null;
export function getLastOfferingsError() {
  return lastOfferingsError;
}

// Цены и периоды тянем из App Store через RevenueCat — не хардкодим в UI
export async function getOfferingPackages() {
  if (!purchasesAvailable()) return null;
  await initPurchases();
  try {
    // Стор иногда не отвечает вовсе — без таймаута пейволл навсегда остался бы с фолбэк-ценами
    const { current, all } = await withTimeout('getOfferings', Purchases.getOfferings(), 8000);
    if (!current) {
      const offeringsCount = Object.keys(all || {}).length;
      lastOfferingsError = initError || (offeringsCount === 0
        ? 'RC: no offerings returned'
        : 'App Store returned no products (storefront/availability?)');
      return null;
    }
    lastOfferingsError = null;
    return {
      monthly: current.monthly || current.availablePackages?.find((p) => p.packageType === 'MONTHLY') || null,
      yearly: current.annual || current.availablePackages?.find((p) => p.packageType === 'ANNUAL') || null,
    };
  } catch (err) {
    lastOfferingsError = err?.message || String(err);
    diagError('getOfferings failed', err);
    return null;
  }
}

function hasEntitlement(customerInfo) {
  return Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT]);
}

export async function purchasePackage(pkg) {
  // Покупка долгая (окно Apple), но не бесконечная: без потолка зависший мост
  // навсегда блокировал кнопку оплаты
  const { customerInfo } = await withTimeout('purchase', Purchases.purchasePackage({ aPackage: pkg }), 180000);
  return hasEntitlement(customerInfo);
}

export async function restorePurchases() {
  const { customerInfo } = await withTimeout('restore', Purchases.restorePurchases(), 30000);
  return hasEntitlement(customerInfo);
}

// При выходе отвязываем покупателя, иначе следующий пользователь этого телефона
// покупал бы под чужим идентификатором
export async function logOutPurchases() {
  if (!purchasesAvailable() || !configuredUserId) return;
  try {
    await withTimeout('logOut', Purchases.logOut(), 6000);
  } catch (err) {
    diagError('purchases logout failed', err);
  } finally {
    configuredUserId = null;
  }
}

// Активен ли премиум по данным стора (источник истины для UI до прихода вебхука).
// Никогда не висит и не бросает: сбой стора не должен блокировать интерфейс.
export async function isPremiumActive({ timeoutMs = 5000 } = {}) {
  if (!purchasesAvailable()) return false;
  const check = (async () => {
    await initPurchases();
    const { customerInfo } = await withTimeout('getCustomerInfo', Purchases.getCustomerInfo(), 6000);
    return hasEntitlement(customerInfo);
  })();
  try {
    return await Promise.race([
      check,
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]).then((v) => (v === null ? (diagStep('purchases: check timed out'), false) : v));
  } catch (err) {
    diagError('getCustomerInfo failed', err);
    return false;
  }
}

// Доступ пары по данным нашей БД (учитывает партнёра, который не платит)
export async function coupleHasAccess() {
  const { data, error } = await supabase.rpc('couple_access');
  if (error) {
    diagError('couple_access failed', error);
    return { has_access: false, reason: 'error' };
  }
  return data || { has_access: false, reason: 'unknown' };
}

// --- Покупка на сайте (RevenueCat Web Billing) ---
// После оплаты на coupleexpenses.com/try человек получает ссылку активации rc-…://redeem_web_purchase.
// Она переносит анонимную веб-покупку на аккаунт Supabase. До входа ссылку держим и активируем после.
const PENDING_REDEEM_KEY = 'ce_pending_web_redeem';

export const isRedemptionUrl = (url) => /^rc-[a-z0-9]+:\/\/redeem_web_purchase/i.test(String(url || ''));

function takePendingRedemption() {
  try {
    const url = localStorage.getItem(PENDING_REDEEM_KEY);
    localStorage.removeItem(PENDING_REDEEM_KEY);
    return url;
  } catch { return null; }
}

// Результат: 'success' | 'pending' (ждём входа) | 'other_user' | 'expired' | 'invalid' | 'error'
export async function redeemWebPurchaseUrl(url) {
  if (!purchasesAvailable()) return { result: 'error' };
  if (!currentUserId()) {
    try { localStorage.setItem(PENDING_REDEEM_KEY, url); } catch { /* приватный режим */ }
    return { result: 'pending' };
  }
  await initPurchases();
  if (!configuredUserId) {
    try { localStorage.setItem(PENDING_REDEEM_KEY, url); } catch { /* приватный режим */ }
    return { result: 'error' };
  }
  try {
    const { webPurchaseRedemption } = await withTimeout('parseRedemption', Purchases.parseAsWebPurchaseRedemption({ urlString: url }), 6000);
    if (!webPurchaseRedemption) return { result: 'invalid' };
    const res = await withTimeout('redeemWebPurchase', Purchases.redeemWebPurchase({ webPurchaseRedemption }), 30000);
    const outcome = {
      SUCCESS: hasEntitlement(res.customerInfo) ? 'success' : 'error',
      PURCHASE_BELONGS_TO_OTHER_USER: 'other_user',
      EXPIRED: 'expired',
      INVALID_TOKEN: 'invalid',
    }[res.result] || 'error';
    const out = { result: outcome, email: res.obfuscatedEmail || null };
    window.dispatchEvent(new CustomEvent('ce:web-redemption', { detail: out }));
    return out;
  } catch (err) {
    diagError('web redemption failed', err);
    window.dispatchEvent(new CustomEvent('ce:web-redemption', { detail: { result: 'error' } }));
    return { result: 'error' };
  }
}
