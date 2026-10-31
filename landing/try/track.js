// Meta Pixel + Conversions API для /try и /try/success.
// Каждое событие уходит из браузера и с сервера с одним event_id — Meta склеивает дубли.
// Для качества совпадения (EMQ) шлём: постоянный ID посетителя (external_id), _fbp, _fbc;
// сервер добавляет IP, браузер и гео из Cloudflare.
(function () {
  var PIXEL_ID = '2939131276448532';

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function setCookie(name, value, days) {
    document.cookie = name + '=' + encodeURIComponent(value) + '; Max-Age=' + days * 86400 + '; Path=/; SameSite=Lax; Secure';
  }

  // Постоянный ID посетителя: один и тот же на лендинге, при оплате и после неё
  var eid = getCookie('ce_eid');
  if (!/^[0-9a-f-]{32,36}$/.test(eid)) {
    eid = (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), function (b) { return b.toString(16).padStart(2, '0'); }).join(''));
  }
  setCookie('ce_eid', eid, 730);

  // Клик по рекламе: _fbc из fbclid сразу, не дожидаясь загрузки пикселя (иначе первое событие уйдёт без него)
  var fbclid = new URLSearchParams(location.search).get('fbclid');
  if (fbclid && getCookie('_fbc').split('.').pop() !== fbclid) setCookie('_fbc', 'fb.1.' + Date.now() + '.' + fbclid, 90);

  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', PIXEL_ID, { external_id: eid });

  window.ceTrack = {
    eid: eid,
    cookie: getCookie,
    // Браузерное событие + то же событие через /api/capi (сервер Pages)
    event: function (name, data, eventId) {
      var id = eventId || name + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 10);
      fbq('track', name, data || {}, { eventID: id });
      return id;
    },
    capi: function (name, id, data) {
      var payload = JSON.stringify({ event_name: name, event_id: id, event_source_url: location.href, custom_data: data || {} });
      try {
        if (!navigator.sendBeacon('/api/capi', new Blob([payload], { type: 'application/json' }))) throw 0;
      } catch (e) {
        fetch('/api/capi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
      }
    },
  };
  window.trackEvent = function (name, data, eventId) {
    var id = window.ceTrack.event(name, data, eventId);
    window.ceTrack.capi(name, id, data);
    return id;
  };
})();
