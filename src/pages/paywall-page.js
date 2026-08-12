import { route, navigate } from '../lib/router.js';
import { escapeHtml, icon } from '../lib/utils.js';
import { t } from '../lib/i18n.js';
import { showToast } from '../services/toast.js';
import { getReadableError } from '../services/errors.js';
import { getOfferingPackages, getLastOfferingsError, purchasePackage, restorePurchases, purchasesAvailable } from '../services/purchases.js';

const e = escapeHtml;
const SITE = 'https://coupleexpenses.com';

// Фолбэк-цены: показываются в вебе и если стор недоступен. В нативе цены приходят из App Store.
const FALLBACK = {
  yearly: { price: '$29.99', perMonth: '$2.50' },
  monthly: { price: '$4.99', perMonth: null },
};

const FEATURES = ['paywall.f1', 'paywall.f2', 'paywall.f3', 'paywall.f4', 'paywall.f5'];

export function renderPaywall(app, { onSuccess, onClose } = {}) {
  let selected = 'yearly';
  let packages = null;
  let busy = false;

  const priceOf = (key) => {
    const pkg = packages?.[key];
    return pkg?.product?.priceString || FALLBACK[key].price;
  };
  const perMonthOf = (key) => {
    if (key !== 'yearly') return null;
    const pkg = packages?.yearly;
    if (!pkg?.product?.price) return FALLBACK.yearly.perMonth;
    const monthly = pkg.product.price / 12;
    const currency = pkg.product.priceString?.replace(/[\d.,\s]/g, '') || '$';
    return `${currency}${monthly.toFixed(2)}`;
  };

  const draw = () => {
    app.innerHTML = `
      <div class="paywall page-enter">
        <button class="paywall-close" id="pw-close" aria-label="${t('common.cancel')}">${icon('x', 20)}</button>
        <div class="paywall-hero">
          <div class="paywall-icon">${icon('heart', 34, '#fff')}</div>
          <h1 class="paywall-title">${t('paywall.title')}</h1>
          <p class="paywall-sub">${t('paywall.subtitle')}</p>
        </div>

        <div class="paywall-features">
          ${FEATURES.map((k) => `
            <div class="paywall-feature">
              <span class="paywall-check">${icon('check', 14, 'var(--c-accent)')}</span>
              <span>${t(k)}</span>
            </div>
          `).join('')}
        </div>

        <div class="paywall-plans">
          ${['yearly', 'monthly'].map((key) => `
            <button class="paywall-plan ${selected === key ? 'selected' : ''}" data-plan="${key}">
              ${key === 'yearly' ? `<span class="paywall-badge">${t('paywall.save')}</span>` : ''}
              <div class="paywall-plan-name">${t(`paywall.${key}`)}</div>
              <div class="paywall-plan-price">${e(priceOf(key))}<span>/${t(key === 'yearly' ? 'paywall.per_year' : 'paywall.per_month')}</span></div>
              ${perMonthOf(key) ? `<div class="paywall-plan-note">${t('paywall.perMonth', { price: e(perMonthOf(key)) })}</div>` : ''}
            </button>
          `).join('')}
        </div>

        <button class="btn btn-primary paywall-cta" id="pw-buy" ${busy ? 'disabled' : ''}>${busy ? t('paywall.processing') : t('paywall.cta')}</button>
        <p class="paywall-terms">${t('paywall.legal')}</p>
        <div class="paywall-links">
          <button class="paywall-link" id="pw-restore">${t('paywall.restore')}</button>
          <a class="paywall-link" href="${SITE}/terms" target="_blank" rel="noopener">${t('paywall.terms')}</a>
          <a class="paywall-link" href="${SITE}/privacy" target="_blank" rel="noopener">${t('paywall.privacy')}</a>
        </div>
      </div>
    `;

    app.querySelectorAll('[data-plan]').forEach((el) => {
      el.addEventListener('click', () => { selected = el.dataset.plan; draw(); });
    });
    document.getElementById('pw-close').onclick = () => (onClose ? onClose() : navigate('/setup'));

    document.getElementById('pw-buy').onclick = async () => {
      if (busy) return;
      if (!purchasesAvailable()) { showToast(t('paywall.iosOnly')); return; }
      const pkg = packages?.[selected];
      if (!pkg) {
        const detail = getLastOfferingsError();
        showToast(detail ? `${t('paywall.noProducts')}\n${detail}` : t('paywall.noProducts'));
        return;
      }
      busy = true; draw();
      try {
        const ok = await purchasePackage(pkg);
        if (ok) { showToast(t('paywall.purchased')); onSuccess?.(); return; }
        showToast(t('paywall.notActive'));
      } catch (err) {
        // Отмена покупки пользователем — не ошибка
        if (!String(err?.message || '').toLowerCase().includes('cancel')) {
          showToast(t('common.error', { msg: getReadableError(err) }));
        }
      } finally {
        busy = false; draw();
      }
    };

    document.getElementById('pw-restore').onclick = async () => {
      if (!purchasesAvailable()) { showToast(t('paywall.iosOnly')); return; }
      try {
        const ok = await restorePurchases();
        if (ok) { showToast(t('paywall.restored')); onSuccess?.(); }
        else showToast(t('paywall.nothingToRestore'));
      } catch (err) {
        showToast(t('common.error', { msg: getReadableError(err) }));
      }
    };
  };

  draw();
  // Цены из стора приходят асинхронно — перерисовываем, когда получим.
  // Жёсткий внешний предел: что бы ни случилось внутри SDK, пейволл не остаётся в загрузке.
  Promise.race([
    getOfferingPackages(),
    new Promise((resolve) => setTimeout(() => resolve(null), 20000)),
  ]).then((pkgs) => {
    if (pkgs) { packages = pkgs; draw(); }
  }).catch(() => { /* цены не пришли — на экране остаются фолбэк-значения */ });
}

export function registerPaywallRoute() {
  route('/paywall', async (app) => {
    renderPaywall(app, {
      onSuccess: () => navigate('/setup'),
      onClose: () => navigate('/setup'),
    });
  });
}
