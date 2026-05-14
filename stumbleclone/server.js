require('dotenv').config();
const express     = require('express');
const path        = require('path');
const session     = require('express-session');
const cookieParser = require('cookie-parser');

// Initialise la BDD et applique le schéma + migrations au démarrage
require('./db/database');
const BetterSQLiteStore = require('./db/session-store');
const { generateToken } = require('./middleware/csrf');
const { i18next, middleware: i18nMiddleware } = require('./lib/i18n');
const { applyLang } = require('./middleware/lang');

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

const app  = express();
const PORT = process.env.PORT || 3000;

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

// i18n — doit être après cookieParser et session
app.use(i18nMiddleware.handle(i18next));
app.use(applyLang);

// Rend l'utilisateur, le token CSRF et l'URL de base disponibles dans tous les templates
app.use((req, res, next) => {
  res.locals.user = req.session.userId
    ? { id: req.session.userId, username: req.session.username, isAdmin: req.session.isAdmin }
    : null;
  res.locals.baseUrl = process.env.BASE_URL || 'https://stumble.danux.be';
  next();
});
app.use(generateToken);

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

app.get('/', (req, res) => {
  const stats = stmtStats.get();
  const userId = req.session?.userId;

  if (userId) {
    const userStats = stmtUserStats.get(userId, userId);
    return res.render('home', { title: 'StumbleClone', stats, userStats, recentSites: null });
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

  res.render('home', { title: 'StumbleClone', stats, userStats: null, recentSites });
});

app.get('/offline', (req, res) => res.render('offline'));

app.listen(PORT, () => {
  console.log(`StumbleClone lancé sur http://localhost:${PORT}`);
});
