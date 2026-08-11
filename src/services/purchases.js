import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase.js';
import { diagError, diagStep } from './diagnostics.js';

// RevenueCat: подписку покупает владелец пары, партнёр пользуется бесплатно.
// appUserID = id пользователя Supabase, чтобы покупка следовала за аккаунтом, а не за устройством.
const API_KEY = import.meta.env.VITE_REVENUECAT_IOS_KEY;
export const ENTITLEMENT = 'premium';

let configured = false;

async function plugin() {
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  return Purchases;
}

export function purchasesAvailable() {
  return Capacitor.isNativePlatform() && Boolean(API_KEY);
}

export async function initPurchases() {
  if (!purchasesAvailable() || configured) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  try {
    const Purchases = await plugin();
    await Purchases.configure({ apiKey: API_KEY, appUserID: user.id });
    configured = true;
    diagStep('purchases: configured');
  } catch (err) {
    diagError('purchases init failed', err);
  }
}

// Цены и периоды тянем из App Store через RevenueCat — не хардкодим в UI
export async function getOfferingPackages() {
  if (!purchasesAvailable()) return null;
  await initPurchases();
  try {
    const Purchases = await plugin();
    const { current } = await Purchases.getOfferings();
    if (!current) return null;
    return {
      monthly: current.monthly || current.availablePackages?.find((p) => p.packageType === 'MONTHLY') || null,
      yearly: current.annual || current.availablePackages?.find((p) => p.packageType === 'ANNUAL') || null,
    };
  } catch (err) {
    diagError('getOfferings failed', err);
    return null;
  }
}

function hasEntitlement(customerInfo) {
  return Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT]);
}

export async function purchasePackage(pkg) {
  const Purchases = await plugin();
  const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
  return hasEntitlement(customerInfo);
}

export async function restorePurchases() {
  const Purchases = await plugin();
  const { customerInfo } = await Purchases.restorePurchases();
  return hasEntitlement(customerInfo);
}

// Активен ли премиум по данным стора (источник истины для UI до прихода вебхука)
export async function isPremiumActive() {
  if (!purchasesAvailable()) return false;
  await initPurchases();
  try {
    const Purchases = await plugin();
    const { customerInfo } = await Purchases.getCustomerInfo();
    return hasEntitlement(customerInfo);
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
