import { getCurrentPath } from '../lib/router.js';
import { t } from '../lib/i18n.js';
import { icon } from '../lib/utils.js';

// Кнопка «+» живёт в центре таб-бара и работает с любого экрана. Сам лист расхода
// принадлежит главной (home-page.js слушает событие) — так таб-бар не тянет к себе
// модуль главной и не появляется циклический импорт.
export function renderTabBar() {
  const path = getCurrentPath();
  const tab = (target, iconName, label) => `
      <button class="tab ${path === target ? 'active' : ''}" onclick="location.hash='${target}'">
        ${icon(iconName, 22)}<span>${label}</span>
      </button>`;
  return `
    <nav class="tab-bar">
      ${tab('/', 'home', t('tabs.home'))}
      ${tab('/analytics', 'pie-chart', t('tabs.analytics'))}
      <div class="tab-add-slot">
        <button class="tab-add" id="tab-add" aria-label="${t('home.addExpense')}" onclick="window.dispatchEvent(new CustomEvent('ce:add-expense'))">
          ${icon('plus', 26, '#fff', 2.4)}
        </button>
      </div>
      ${tab('/goals', 'target', t('tabs.goals'))}
      ${tab('/profile', 'user', t('tabs.profile'))}
    </nav>
  `;
}
