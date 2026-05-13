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

const app  = express();
const PORT = process.env.PORT || 3000;

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

// Rend l'utilisateur et le token CSRF disponibles dans tous les templates
app.use((req, res, next) => {
  res.locals.user = req.session.userId
    ? { id: req.session.userId, username: req.session.username, isAdmin: req.session.isAdmin }
    : null;
  next();
});
app.use(generateToken);

// Routes
app.use(authRoutes);
app.use(interestsRoutes);
app.use(settingsRoutes);

app.get('/', (req, res) => {
  res.render('home', { title: 'StumbleClone' });
});

app.listen(PORT, () => {
  console.log(`StumbleClone lancé sur http://localhost:${PORT}`);
});
