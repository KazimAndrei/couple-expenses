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

let configured = false;
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
const DEBUG = import.meta.env.VITE_RC_DEBUG === '1';
function withTimeout(label, promise, ms = 8000) {
  if (DEBUG) console.error(`[rc] → ${label}`);
  return Promise.race([
    Promise.resolve(promise).then((v) => { if (DEBUG) console.error(`[rc] ← ${label} ok`); return v; }),
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
  if (!purchasesAvailable() || configured) return;
  const userId = currentUserId();
  if (!userId) { diagError('purchases init', new Error('нет пользователя')); return; }
  try {
    await withTimeout('configure', Purchases.configure({ apiKey: API_KEY, appUserID: userId }), 6000);
    configured = true;
    diagStep('purchases: configured');
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

// Диагностика: прямой запрос продуктов у StoreKit, минуя offerings
export async function probeProducts() {
  try {
    await initPurchases();
    const t0 = Date.now();
    const res = await withTimeout('getProducts',
      Purchases.getProducts({ productIdentifiers: ['ce_premium_monthly', 'ce_premium_yearly'] }), 8000);
    const list = res?.products?.map((p) => `${p.identifier} ${p.priceString}`).join(', ') || 'ПУСТО';
    return `SK за ${Date.now() - t0}мс: ${list}`;
  } catch (err) {
    return `SK ошибка: ${err?.message || err}`;
  }
}

function hasEntitlement(customerInfo) {
  return Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT]);
}

export async function purchasePackage(pkg) {
  const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
  return hasEntitlement(customerInfo);
}

export async function restorePurchases() {
  const { customerInfo } = await Purchases.restorePurchases();
  return hasEntitlement(customerInfo);
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
