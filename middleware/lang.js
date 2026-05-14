const { i18next, middleware: i18nMiddleware } = require('../lib/i18n');

const SUPPORTED = ['fr', 'en', 'nl', 'de', 'es', 'it', 'pt', 'da', 'pl', 'ru', 'el', 'zh', 'ja', 'ar'];

const LANG_LABELS = {
  fr: 'Français',
  en: 'English',
  nl: 'Nederlands',
  de: 'Deutsch',
  es: 'Español',
  it: 'Italiano',
  pt: 'Português',
  da: 'Dansk',
  pl: 'Polski',
  ru: 'Русский',
  el: 'Ελληνικά',
  zh: '中文',
  ja: '日本語',
  ar: 'العربية',
};

function detectLang(req) {
  // 1. Préférence utilisateur connecté (session)
  if (req.session?.userLang && SUPPORTED.includes(req.session.userLang)) {
    return req.session.userLang;
  }

  // 2. Cookie explicite
  const cookie = req.cookies?.lang;
  if (cookie && SUPPORTED.includes(cookie)) return cookie;

  // 3. Accept-Language header
  const header = req.headers['accept-language'] || '';
  for (const part of header.split(',')) {
    const code = part.trim().split(';')[0].trim().slice(0, 2).toLowerCase();
    if (SUPPORTED.includes(code)) return code;
  }

  return 'fr';
}

// Middleware principal : détecte la langue et expose t() dans les templates
function applyLang(req, res, next) {
  const lang = detectLang(req);
  req.i18n.changeLanguage(lang);
  res.locals.t          = (key, opts) => req.i18n.t(key, opts);
  res.locals.currentLang = lang;
  res.locals.langLabels  = LANG_LABELS;
  next();
}

module.exports = { i18nMiddleware, applyLang, SUPPORTED };
