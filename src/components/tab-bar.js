import { getCurrentPath } from '../lib/router.js';
import { t } from '../lib/i18n.js';
import { icon } from '../lib/utils.js';

export function renderTabBar() {
  const path = getCurrentPath();
  return `
    <nav class="tab-bar">
      <button class="tab ${path === '/' ? 'active' : ''}" onclick="location.hash='/'">
        ${icon('home', 22)}<span>${t('tabs.home')}</span>
      </button>
      <button class="tab ${path === '/analytics' ? 'active' : ''}" onclick="location.hash='/analytics'">
        ${icon('pie-chart', 22)}<span>${t('tabs.analytics')}</span>
      </button>
      <button class="tab ${path === '/goals' ? 'active' : ''}" onclick="location.hash='/goals'">
        ${icon('target', 22)}<span>${t('tabs.goals')}</span>
      </button>
      <button class="tab ${path === '/profile' ? 'active' : ''}" onclick="location.hash='/profile'">
        ${icon('user', 22)}<span>${t('tabs.profile')}</span>
      </button>
    </nav>
  `;
}
