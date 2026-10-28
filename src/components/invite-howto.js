import { t } from '../lib/i18n.js';
import { icon } from '../lib/utils.js';

// Анимированная инструкция «как добавить партнёра»: три сцены по кругу, как GIF,
// но текст берётся из i18n — поэтому она сама на языке приложения и чёткая на Retina.
export function inviteHowtoHtml() {
  const steps = [1, 2, 3];
  return `
    <div class="howto" aria-label="${t('howto.title')}">
      <div class="howto-title">${t('howto.title')}</div>
      <div class="howto-stage">
        <div class="howto-scene s1">
          <div class="howto-phone">
            <div class="howto-bubble">${icon('link', 13, '#fff', 2.4)}<span>couple-expenses…</span></div>
            <div class="howto-share">${icon('share', 18, '#fff', 2.4)}</div>
            <i class="howto-tap"></i>
          </div>
        </div>
        <div class="howto-scene s2">
          <div class="howto-phone">
            <div class="howto-appicon">${icon('heart', 24, '#fff', 2.6)}</div>
            <div class="howto-apple"><span class="howto-apple-logo"></span>${t('howto.signIn')}</div>
            <i class="howto-tap"></i>
          </div>
        </div>
        <div class="howto-scene s3">
          <div class="howto-phone">
            <div class="howto-code">${['A', '7', 'K', '2', 'Q', '9'].map((ch, i) => `<b style="--i:${i}">${ch}</b>`).join('')}</div>
            <div class="howto-pair"><i class="a"></i><span>${icon('heart', 14, '#e8735a', 2.8)}</span><i class="b"></i></div>
          </div>
        </div>
      </div>
      <div class="howto-steps">
        ${steps.map((n) => `<div class="howto-step st${n}"><span class="howto-num">${n}</span><span>${t(`howto.step${n}`)}</span></div>`).join('')}
      </div>
    </div>`;
}
