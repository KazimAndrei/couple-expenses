import { describe, expect, it } from 'vitest';

/**
 * Smoke: экранные модули и регистрация маршрутов грузятся без ошибки.
 * Полный UI-поток (расход, доход, смена месяца) — ручная проверка в браузере по чеклисту плана.
 */
describe('route modules', () => {
  it('exports register*Route for all app screens', async () => {
    const auth = await import('./auth-setup-page.js');
    const home = await import('./home-page.js');
    const analytics = await import('./analytics-page.js');
    const goals = await import('./goals-page.js');
    const profile = await import('./profile-page.js');

    expect(typeof auth.registerAuthSetupRoutes).toBe('function');
    expect(typeof home.registerHomeRoute).toBe('function');
    expect(typeof analytics.registerAnalyticsRoute).toBe('function');
    expect(typeof goals.registerGoalsRoute).toBe('function');
    expect(typeof profile.registerProfileRoute).toBe('function');
  });
});
