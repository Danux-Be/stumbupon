const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const middleware = require('i18next-http-middleware');
const path = require('path');

i18next
  .use(Backend)
  .init({
    initImmediate: false,
    backend: {
      loadPath: path.join(__dirname, '../locales/{{lng}}/translation.json'),
    },
    fallbackLng: 'fr',
    supportedLngs: ['fr', 'en', 'nl', 'de'],
    preload: ['fr', 'en', 'nl', 'de'],
    interpolation: { escapeValue: false },
  });

module.exports = { i18next, middleware };
