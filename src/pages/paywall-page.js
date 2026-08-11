import { route, navigate } from '../lib/router.js';
import { icon } from '../lib/utils.js';
import { t } from '../lib/i18n.js';
import { WEB_APP_ORIGIN } from '../lib/supabase.js';

// Пейволл показывается только тому, кто СОЗДАЁТ пару (владелец платит).
// Приглашённый по ссылке партнёр сюда не попадает — у него доступ бесплатный.
export const PLANS = {
  yearly: { id: 'ce_premium_yearly', price: '$29.99', period: 'year', perMonth: '$2.50' },
  monthly: { id: 'ce_premium_monthly', price: '$4.99', period: 'month', perMonth: null },
};

const FEATURES = ['paywall.f1', 'paywall.f2', 'paywall.f3', 'paywall.f4', 'paywall.f5'];

export function renderPaywall(app, { onPurchase, onClose } = {}) {
  let selected = 'yearly';

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
          ${Object.entries(PLANS).map(([key, p]) => `
            <button class="paywall-plan ${selected === key ? 'selected' : ''}" data-plan="${key}">
              ${key === 'yearly' ? `<span class="paywall-badge">${t('paywall.save')}</span>` : ''}
              <div class="paywall-plan-name">${t(`paywall.${key}`)}</div>
              <div class="paywall-plan-price">${p.price}<span>/${t(`paywall.per_${p.period}`)}</span></div>
              ${p.perMonth ? `<div class="paywall-plan-note">${t('paywall.perMonth', { price: p.perMonth })}</div>` : ''}
            </button>
          `).join('')}
        </div>

        <button class="btn btn-primary paywall-cta" id="pw-buy">${t('paywall.cta')}</button>
        <p class="paywall-terms">${t('paywall.legal')}</p>
        <div class="paywall-links">
          <button class="paywall-link" id="pw-restore">${t('paywall.restore')}</button>
          <a class="paywall-link" href="${WEB_APP_ORIGIN.replace('couple-expenses.pages.dev', 'coupleexpenses.com')}/terms" target="_blank" rel="noopener">${t('paywall.terms')}</a>
          <a class="paywall-link" href="${WEB_APP_ORIGIN.replace('couple-expenses.pages.dev', 'coupleexpenses.com')}/privacy" target="_blank" rel="noopener">${t('paywall.privacy')}</a>
        </div>
      </div>
    `;

    app.querySelectorAll('[data-plan]').forEach((el) => {
      el.addEventListener('click', () => { selected = el.dataset.plan; draw(); });
    });
    document.getElementById('pw-close').onclick = () => (onClose ? onClose() : navigate('/setup'));
    document.getElementById('pw-buy').onclick = () => onPurchase?.(PLANS[selected].id);
    document.getElementById('pw-restore').onclick = () => onPurchase?.('restore');
  };

  draw();
}

export function registerPaywallRoute() {
  route('/paywall', async (app) => {
    renderPaywall(app, {
      onPurchase: () => { /* подключается вместе с RevenueCat SDK */ },
      onClose: () => navigate('/setup'),
    });
  });
}
