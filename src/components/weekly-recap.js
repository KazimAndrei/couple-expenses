// Итог недели: полноэкранная «история» из нескольких карточек и картинка, которой можно поделиться.
// Цифры считает lib/weekly-recap.js; здесь — показ, листание и отрисовка картинки на canvas.
import { getState, isSolo } from '../lib/store.js';
import { getExpensesInRange } from '../lib/supabase.js';
import { buildRecap, lastWeekRange } from '../lib/weekly-recap.js';
import { catTile, escapeHtml, formatMoney, icon, moneyHtml } from '../lib/utils.js';
import { categoryLabel, getLang, t } from '../lib/i18n.js';
import { expenseJoinedProfileName, memberDisplayLabel, resolveMemberSides, resolvePayerSide } from '../lib/member-filters.js';
import { hapticSelect, hapticSuccess } from '../services/haptics.js';
import { showToast } from '../services/toast.js';
import { getReadableError } from '../services/errors.js';

const e = escapeHtml;
const SEEN_KEY = 'ce_recap_seen_week';
const SLIDE_MS = 6000;

export const recapSeenWeek = () => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };
const markSeen = (from) => { try { localStorage.setItem(SEEN_KEY, from); } catch { /* не критично */ } };

const dayMonth = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat(getLang() === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
};
const weekday = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat(getLang() === 'en' ? 'en-US' : 'ru-RU', { weekday: 'long' }).format(new Date(y, m - 1, d));
};

export async function openWeeklyRecap({ now = new Date() } = {}) {
  const { couple, members } = getState();
  if (!couple) return;
  const range = lastWeekRange(now);
  let expenses;
  try {
    expenses = await getExpensesInRange(couple.id, range.prevFrom, range.to);
  } catch (err) {
    showToast(t('common.error', { msg: getReadableError(err) }));
    return;
  }
  const sides = resolveMemberSides(members);
  const solo = isSolo();
  const sideOf = (x) => {
    if (x.split === 'equal' && !solo) return 'shared';
    return resolvePayerSide(x.paid_by, sides, expenseJoinedProfileName(x)) === 'b' ? 'b' : 'a';
  };
  const recap = buildRecap(expenses, range, sideOf);
  markSeen(range.from);
  if (recap.empty) { showToast(t('recap.empty')); return; }

  const cur = couple.currency;
  const nameA = sides.memberA ? memberDisplayLabel(sides.memberA) : '';
  const nameB = sides.memberB ? memberDisplayLabel(sides.memberB) : '';
  const dates = `${dayMonth(recap.from)} – ${dayMonth(recap.to)}`;
  const delta = recap.deltaPct === null ? ''
    : `<div class="recap-pill ${recap.deltaPct > 0 ? 'up' : 'down'}">${icon(recap.deltaPct > 0 ? 'trending-up' : 'trending-down', 15, 'currentColor', 2.4)}${t(recap.deltaPct > 0 ? 'recap.more' : 'recap.less', { pct: Math.abs(recap.deltaPct) })}</div>`;
  const top = recap.categories.slice(0, 4);
  const splitSum = recap.split.a + recap.split.b + recap.split.shared;

  const slides = [
    `<div class="recap-kicker">${t(solo ? 'recap.titleSolo' : 'recap.title')}</div>
     <div class="recap-dates">${e(dates)}</div>
     <div class="recap-total">${moneyHtml(recap.total, cur)}</div>
     <div class="recap-sub">${t('recap.count', { count: recap.count })}</div>
     ${delta}`,
    `<div class="recap-kicker">${t('recap.whereTitle')}</div>
     <div class="recap-cats">
       ${top.map((c, i) => `
       <div class="recap-cat" style="--i:${i}">
         ${catTile(c.icon, c.color, 44)}
         <div class="recap-cat-main">
           <div class="recap-cat-row"><b>${e(categoryLabel(c.name) || t('common.other'))}</b><span>${formatMoney(c.amount, cur)}</span></div>
           <div class="recap-bar"><i style="width:${Math.max(4, Math.round(c.share * 100))}%"></i></div>
         </div>
       </div>`).join('')}
     </div>`,
    `<div class="recap-kicker">${t('recap.momentsTitle')}</div>
     ${!solo && splitSum > 0 ? `
     <div class="recap-card">
       <div class="split-bar">
         ${recap.split.a > 0 ? `<i class="a" style="flex-grow:${recap.split.a}"></i>` : ''}
         ${recap.split.shared > 0 ? `<i class="shared" style="flex-grow:${recap.split.shared}"></i>` : ''}
         ${recap.split.b > 0 ? `<i class="b" style="flex-grow:${recap.split.b}"></i>` : ''}
       </div>
       <div class="recap-split">
         <span>${e(nameA)} <b>${formatMoney(recap.split.a, cur)}</b></span>
         ${recap.split.shared > 0 ? `<span>${t('common.shared')} <b>${formatMoney(recap.split.shared, cur)}</b></span>` : ''}
         ${nameB ? `<span>${e(nameB)} <b>${formatMoney(recap.split.b, cur)}</b></span>` : ''}
       </div>
     </div>` : ''}
     ${recap.biggest ? `<div class="recap-card"><span>${t('recap.biggest')}</span><b>${e(recap.biggest.description)}</b><em>${formatMoney(recap.biggest.amount, cur)}</em></div>` : ''}
     ${recap.busiestDay ? `<div class="recap-card"><span>${t('recap.busiest')}</span><b>${e(weekday(recap.busiestDay.date))}</b><em>${formatMoney(recap.busiestDay.amount, cur)}</em></div>` : ''}`,
    `<div class="recap-kicker">${t(recap.saved > 0 ? 'recap.savedTitle' : 'recap.doneTitle')}</div>
     ${recap.saved > 0 ? `<div class="recap-total saved">+${moneyHtml(recap.saved, cur)}</div><div class="recap-sub">${t('recap.savedSub')}</div>` : `<div class="recap-sub">${t('recap.doneSub')}</div>`}
     <canvas class="recap-preview" id="recap-canvas" width="1080" height="1350"></canvas>
     <label class="recap-toggle"><input type="checkbox" id="recap-hide" checked><span>${t('recap.hideAmounts')}</span></label>
     <button type="button" class="btn recap-share" id="recap-share">${icon('share', 18, 'currentColor', 2.2)}${t('recap.share')}</button>`,
  ];

  const layer = document.createElement('div');
  layer.className = 'recap-layer';
  layer.innerHTML = `
    <div class="recap-progress">${slides.map(() => '<i><b></b></i>').join('')}</div>
    <button type="button" class="recap-close" aria-label="${t('common.close')}">${icon('x', 20, '#fff', 2.4)}</button>
    ${slides.map((html, i) => `<section class="recap-slide" data-slide="${i}" hidden>${html}</section>`).join('')}
    <div class="recap-brand">CoupleExpenses</div>`;
  document.body.appendChild(layer);

  let index = -1;
  let timer = null;
  const close = () => { clearTimeout(timer); layer.remove(); };
  const show = (next) => {
    if (next >= slides.length) { close(); return; }
    index = Math.max(0, next);
    clearTimeout(timer);
    layer.querySelectorAll('.recap-slide').forEach((s, i) => { s.hidden = i !== index; });
    layer.querySelectorAll('.recap-progress i').forEach((bar, i) => {
      bar.className = i < index ? 'done' : (i === index ? 'active' : '');
    });
    // Последняя карточка ждёт человека: там переключатель и кнопка
    const last = index === slides.length - 1;
    layer.classList.toggle('paused', last);
    if (!last) timer = setTimeout(() => show(index + 1), SLIDE_MS);
  };
  layer.querySelector('.recap-close').addEventListener('click', close);
  layer.addEventListener('click', (ev) => {
    if (ev.target.closest('button, label, canvas, input')) return;
    hapticSelect();
    show(ev.clientX < window.innerWidth * 0.3 ? index - 1 : index + 1);
  });

  const canvas = layer.querySelector('#recap-canvas');
  const hide = layer.querySelector('#recap-hide');
  const paint = () => drawShareCard(canvas, recap, { cur, dates, solo, hideAmounts: hide.checked });
  hide.addEventListener('change', paint);
  // Шрифт приложения может догружаться — картинку рисуем, когда он готов
  (document.fonts?.ready || Promise.resolve()).then(paint);

  layer.querySelector('#recap-share').addEventListener('click', async () => {
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'week.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        hapticSuccess();
      } else {
        // Без системного «Поделиться» отдаём картинку файлом
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'week.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') showToast(t('common.error', { msg: getReadableError(err) }));
    }
  });

  show(0);
}

// Картинка 4:5 для сторис и мессенджеров. По умолчанию без сумм — только доли: её увидят посторонние.
export function drawShareCard(canvas, recap, { cur, dates, solo, hideAmounts }) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const font = (weight, size) => `${weight} ${size}px Onest, -apple-system, sans-serif`;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f6e56');
  bg.addColorStop(0.55, '#1d9e75');
  bg.addColorStop(1, '#e8735a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath(); ctx.arc(W - 120, 160, 300, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(80, H - 60, 220, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = font(600, 44);
  ctx.fillText(t(solo ? 'recap.titleSolo' : 'recap.title'), 90, 170);
  ctx.font = font(500, 36);
  ctx.fillText(dates, 90, 228);

  ctx.fillStyle = '#fff';
  ctx.font = font(700, 150);
  const headline = hideAmounts ? t('recap.count', { count: recap.count }) : formatMoney(recap.total, cur);
  // Длинная строка ужимается, чтобы не вылезти за край
  const fit = Math.min(1, (W - 180) / ctx.measureText(headline).width);
  ctx.font = font(700, Math.floor(150 * fit));
  ctx.fillText(headline, 90, 440);
  if (recap.deltaPct !== null) {
    ctx.font = font(600, 40);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(t(recap.deltaPct > 0 ? 'recap.more' : 'recap.less', { pct: Math.abs(recap.deltaPct) }), 90, 520);
  }

  recap.categories.slice(0, 3).forEach((c, i) => {
    const y = 660 + i * 170;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, 90, y, W - 180, 130, 34); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    roundRect(ctx, 90, y, Math.max(70, (W - 180) * c.share), 130, 34); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = font(600, 46);
    ctx.fillText(categoryLabel(c.name) || t('common.other'), 130, y + 82);
    const right = hideAmounts ? `${Math.round(c.share * 100)}%` : formatMoney(c.amount, cur);
    ctx.textAlign = 'right';
    ctx.fillText(right, W - 130, y + 82);
    ctx.textAlign = 'left';
  });

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = font(600, 38);
  ctx.fillText('CoupleExpenses', 90, H - 90);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
