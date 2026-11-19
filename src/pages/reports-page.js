// «Отчёты»: траты за 3, 6 или 12 месяцев — по месяцам, в сравнении с предыдущим таким же отрезком и по категориям.
// Расчёты — lib/reports.js.
import { route, navigate } from '../lib/router.js';
import { getState } from '../lib/store.js';
import { getExpensesInRange } from '../lib/supabase.js';
import { buildReport, reportRange } from '../lib/reports.js';
import { catTile, currentMonth, escapeHtml, formatMoney, icon, moneyHtml } from '../lib/utils.js';
import { categoryLabel, getLang, t } from '../lib/i18n.js';
import { renderTabBar } from '../components/tab-bar.js';
import { showToast } from '../services/toast.js';
import { getReadableError } from '../services/errors.js';
import { hapticSelect } from '../services/haptics.js';

const e = escapeHtml;
const PERIODS = [3, 6, 12];
let period = 6;

const locale = () => (getLang() === 'en' ? 'en-US' : 'ru-RU');
const monthLabel = (key, opts) => {
  const [y, m] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(), opts).format(new Date(y, m - 1, 1)).replace(/\./g, '').replace(/\s*г$/, '');
};
const compact = (value) => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const deltaPill = (pct, { small = false } = {}) => {
  if (pct === null || pct === 0) return '';
  // Рост трат — тревожный цвет, снижение — спокойный
  // «+4290%» ничего не говорит — после десятикратного роста пишем «10×+»
  const text = Math.abs(pct) >= 1000 ? '10×+' : `${Math.abs(pct)}%`;
  return `<span class="delta ${pct > 0 ? 'up' : 'down'}${small ? ' small' : ''}">${icon(pct > 0 ? 'trending-up' : 'trending-down', small ? 11 : 13, 'currentColor', 2.6)}${text}</span>`;
};

export function registerReportsRoute() {
  route('/reports', async (app) => {
    const state = getState();
    if (!state.couple) { navigate('/'); return; }
    const cur = state.couple.currency;
    const range = { ...reportRange(currentMonth(), period), partialMonth: currentMonth() };
    let report = buildReport([], range);
    try {
      report = buildReport(await getExpensesInRange(state.couple.id, range.from, range.to), range);
    } catch (err) {
      showToast(t('common.error', { msg: getReadableError(err) }));
    }
    const max = Math.max(1, ...report.byMonth.map((m) => m.total));
    const changeRow = (c) => `
      <div class="report-change">
        ${catTile(c.icon, c.color, 34)}
        <span class="report-change-name">${e(categoryLabel(c.name) || t('common.other'))}</span>
        <b class="${c.change > 0 ? 'up' : 'down'}">${c.change > 0 ? '+' : '−'}${formatMoney(Math.abs(c.change), cur)}</b>
      </div>`;

    app.innerHTML = `
      <div class="page-enter">
        <div class="header">
          <div class="header-row">
            <button class="header-action" id="btn-reports-back" aria-label="${t('common.back')}">${icon('chevron-left', 20)}</button>
            <div class="header-title" style="flex:1;">${t('reports.title')}</div>
          </div>
        </div>
        <div class="segc segc-page">
          ${PERIODS.map((n) => `<button type="button" class="segc-btn ${period === n ? 'on' : ''}" data-period="${n}">${t('reports.months', { n })}</button>`).join('')}
        </div>
        ${report.empty ? `<div class="empty-state">${catTile('pie-chart', '#378add', 64)}<p style="margin-top:14px;">${t('reports.empty')}</p></div>` : `
        <div class="card report-summary">
          <div class="card-title"><span>${e(monthLabel(report.months[0], { month: 'short', year: 'numeric' }))} – ${e(monthLabel(report.months[report.months.length - 1], { month: 'short', year: 'numeric' }))}</span>${deltaPill(report.deltaPct)}</div>
          <div class="report-total num">${moneyHtml(report.total, cur)}</div>
          <div class="report-sub">${report.deltaPct === null ? t('reports.noPrev') : t('reports.vsPrev', { amount: formatMoney(report.prevTotal, cur) })}</div>
          <div class="stat-row">
            <div><span>${t('reports.average')}</span><b>${formatMoney(report.average, cur)}</b></div>
            <div><span>${t('reports.saved')}</span><b>${formatMoney(report.saved, cur)}</b></div>
            <div><span>${t('reports.count')}</span><b>${report.count}</b></div>
          </div>
        </div>
        <div class="card">
          <div class="card-title"><span>${t('reports.byMonth')}</span></div>
          <div class="report-bars" style="--n:${report.byMonth.length}">
            ${report.byMonth.map((m) => `
            <div class="report-bar ${report.peak?.month === m.month ? 'peak' : ''}">
              <span class="report-bar-value">${m.total > 0 && (report.byMonth.length <= 6 || report.peak?.month === m.month) ? compact(m.total) : ''}</span>
              <span class="report-bar-track"><i style="height:${Math.max(m.total > 0 ? 4 : 0, Math.round((m.total / max) * 100))}%"></i></span>
              <span class="report-bar-label">${e(report.byMonth.length > 6 ? monthLabel(m.month, { month: 'short' }).slice(0, 3) : monthLabel(m.month, { month: 'short' }))}</span>
            </div>`).join('')}
          </div>
          ${report.peak && report.lowest ? `<div class="report-note">${t('reports.peakNote', { peak: monthLabel(report.peak.month, { month: 'long' }), low: monthLabel(report.lowest.month, { month: 'long' }) })}</div>` : ''}
        </div>
        ${report.grew.length || report.shrank.length ? `
        <div class="card">
          <div class="card-title"><span>${t('reports.changes')}</span></div>
          ${report.grew.length ? `<div class="report-change-head">${t('reports.grew')}</div>${report.grew.map(changeRow).join('')}` : ''}
          ${report.shrank.length ? `<div class="report-change-head">${t('reports.shrank')}</div>${report.shrank.map(changeRow).join('')}` : ''}
        </div>` : ''}
        <div class="section-header"><span class="section-title">${t('reports.categories')}</span></div>
        <div class="card report-cats">
          ${report.categories.filter((c) => c.total > 0).map((c) => {
            const top = Math.max(1, ...c.byMonth);
            return `
            <div class="report-cat">
              ${catTile(c.icon, c.color, 38)}
              <div class="report-cat-main">
                <div class="report-cat-row"><b>${e(categoryLabel(c.name) || t('common.other'))}</b><span class="num">${formatMoney(c.total, cur)}</span></div>
                <div class="report-cat-row dim"><span>${Math.round(c.share * 100)}% · ${t('reports.perMonth', { amount: formatMoney(c.average, cur) })}</span>${deltaPill(c.deltaPct, { small: true })}</div>
              </div>
              <div class="spark" style="--c:${e(c.color)}">${c.byMonth.map((v) => `<i style="height:${Math.max(v > 0 ? 8 : 3, Math.round((v / top) * 100))}%"></i>`).join('')}</div>
            </div>`;
          }).join('')}
        </div>`}
      </div>
      ${renderTabBar()}`;

    document.getElementById('btn-reports-back').addEventListener('click', () => navigate('/analytics'));
    app.querySelectorAll('.segc-btn[data-period]').forEach((btn) => btn.addEventListener('click', () => {
      period = Number(btn.dataset.period);
      hapticSelect();
      navigate('/reports');
    }));
  });
}
