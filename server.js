require('dotenv').config();
const express     = require('express');
const path        = require('path');
const session     = require('express-session');
const cookieParser = require('cookie-parser');
const passport    = require('passport');

// Initialise la BDD et applique le schéma + migrations au démarrage
require('./db/database');
const BetterSQLiteStore = require('./db/session-store');
const { generateToken } = require('./middleware/csrf');
const { i18next, middleware: i18nMiddleware } = require('./lib/i18n');
const { applyLang } = require('./middleware/lang');

const { captureReferer } = require('./middleware/referer');
const siteConfig = require('./lib/config');
const authRoutes      = require('./routes/auth');
const interestsRoutes = require('./routes/interests');
const settingsRoutes  = require('./routes/settings');
const stumbleRoutes   = require('./routes/stumble');
const voteRoutes      = require('./routes/votes');
const favoritesRoutes = require('./routes/favorites');
const submitRoutes    = require('./routes/submit');
const adminRoutes     = require('./routes/admin');
const reportRoutes    = require('./routes/report');
const tastesRoutes    = require('./routes/tastes');
const legalRoutes     = require('./routes/legal');
const accountRoutes   = require('./routes/account');
const searchRoutes    = require('./routes/search');
const curateRoutes    = require('./routes/curate');
const seoRoutes       = require('./routes/seo');
const profileRoutes   = require('./routes/profile');
const { router: collectionsRoutes } = require('./routes/collections');
const followsRoutes   = require('./routes/follows');

const fs   = require('fs');
const { version: APP_VERSION } = require('./package.json');
const app  = express();
const PORT = process.env.PORT || 3000;

// Version du CSS basée sur sa date de modification (cache-busting automatique)
const CSS_VERSION = (() => {
  try {
    return fs.statSync(path.join(__dirname, 'public/style.css')).mtimeMs.toString(36);
  } catch { return '1'; }
})();

// Caddy termine TLS et proxifie en HTTP → Express doit faire confiance au proxy
app.set('trust proxy', 1);

// Moteur de templates EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Fichiers statiques (CSS, JS, images)
app.use(express.static(path.join(__dirname, 'public')));

// Cookies (nécessaire pour la détection de langue)
app.use(cookieParser());

// Sessions persistantes dans SQLite
app.use(session({
  store: new BetterSQLiteStore(),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

// Parsing des formulaires
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(passport.initialize());

// i18n — doit être après cookieParser et session
app.use(i18nMiddleware.handle(i18next));
app.use(applyLang);

// Rend l'utilisateur, le token CSRF et l'URL de base disponibles dans tous les templates
app.use((req, res, next) => {
  res.locals.user = req.session.userId
    ? { id: req.session.userId, username: req.session.username, isAdmin: req.session.isAdmin, isCurator: req.session.isCurator }
    : null;
  res.locals.baseUrl    = process.env.BASE_URL || 'https://stumbupon.com';
  res.locals.cssVersion = CSS_VERSION;
  res.locals.appVersion = APP_VERSION;
  res.locals.siteConfig = siteConfig.getAll();

  // Empêche tout cache (navigateur + CDN) pour les pages personnalisées
  if (req.session.userId) {
    res.set('Cache-Control', 'private, no-store');
  }

  next();
});
app.use(generateToken);

// Flash succès — lit et vide la session à chaque rendu
app.use((req, res, next) => {
  res.locals.achievementFlash = req.session._achievements_flash || [];
  delete req.session._achievements_flash;
  next();
});

// URL canonique automatique pour toutes les pages
app.use((req, res, next) => {
  res.locals.canonicalUrl = res.locals.baseUrl + req.path;
  next();
});

// noindex sur les pages privées / sans valeur SEO
const _NOINDEX_EXACT = new Set([
  '/stumble', '/stumble/join', '/stumble/join/skip',
  '/login', '/signup', '/forgot-password',
  '/settings', '/favorites', '/interests', '/tastes', '/curate', '/offline',
  '/collections', '/following',
]);
const _NOINDEX_PREFIX = ['/admin', '/account/', '/reset-password/', '/verify-email/'];
app.use((req, res, next) => {
  res.locals.noindex = _NOINDEX_EXACT.has(req.path)
    || _NOINDEX_PREFIX.some(p => req.path.startsWith(p));
  next();
});

// Capture des Referers entrants (avant les routes)
app.use(captureReferer);

// Routes
app.use(authRoutes);
app.use(interestsRoutes);
app.use(settingsRoutes);
app.use(stumbleRoutes);
app.use(voteRoutes);
app.use(favoritesRoutes);
app.use(submitRoutes);
app.use(adminRoutes);
app.use(reportRoutes);
app.use(tastesRoutes);
app.use(legalRoutes);
app.use(accountRoutes);
app.use(searchRoutes);
app.use(curateRoutes);
app.use(seoRoutes);
app.use(profileRoutes);
app.use(collectionsRoutes);
app.use(followsRoutes);

const db = require('./db/database');
const stmtRecentSites = db.prepare(`
  SELECT s.id, s.url, s.title, s.description, s.language
  FROM sites s
  WHERE s.status = 'approved'
  ORDER BY s.approved_at DESC
  LIMIT 6
`);
const stmtSiteCategories = db.prepare(`
  SELECT sc.site_id, c.emoji,
         COALESCE(ct.name, c.name) AS localName
  FROM site_categories sc
  JOIN categories c ON c.id = sc.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  WHERE sc.site_id IN (SELECT value FROM json_each(?))
  ORDER BY localName
`);
const stmtStats = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM sites WHERE status = 'approved') AS site_count,
    (SELECT COUNT(*) FROM users) AS user_count
`);
const stmtUserStats = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM votes WHERE user_id = ? AND direction = 1) AS favorites,
    (SELECT COUNT(*) FROM views WHERE user_id = ?) AS discovered
`);

const HOME_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'StumbUpon.com',
  url: 'https://stumbupon.com',
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: 'https://stumbupon.com/search?q={search_term_string}' },
    'query-input': 'required name=search_term_string',
  },
};

app.get('/', (req, res) => {
  const stats = stmtStats.get();
  const userId = req.session?.userId;

  if (userId) {
    const userStats = stmtUserStats.get(userId, userId);
    return res.render('home', { title: 'StumbUpon.com', stats, userStats, recentSites: null, jsonLd: null });
  }

  const lang = res.locals.currentLang || 'fr';
  const recent = stmtRecentSites.all();
  const ids = JSON.stringify(recent.map(s => s.id));
  const cats = stmtSiteCategories.all(lang, ids);
  const catsBySite = {};
  for (const c of cats) {
    if (!catsBySite[c.site_id]) catsBySite[c.site_id] = [];
    catsBySite[c.site_id].push(c);
  }
  const recentSites = recent.map(s => ({ ...s, categories: catsBySite[s.id] || [] }));

  res.render('home', { title: 'StumbUpon.com', stats, userStats: null, recentSites, jsonLd: HOME_JSON_LD });
});

app.get('/offline', (req, res) => res.render('offline'));

app.listen(PORT, () => {
  console.log(`StumbUpon.com lancé sur http://localhost:${PORT}`);
});
