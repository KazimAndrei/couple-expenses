Pages Functions для coupleexpenses.com (проект `coupleexpenses-com`).

`functions/api/capi.js` — Conversions API для пикселя лендинга `/try`. Токен лежит в секрете Pages `META_CAPI_TOKEN`.

Деплой сайта вместе с функциями — из этой папки:

    cd landing-functions && npx wrangler pages deploy ../landing --project-name coupleexpenses-com --branch main
