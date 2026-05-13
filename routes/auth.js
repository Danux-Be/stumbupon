const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { verifyToken } = require('../middleware/csrf');
const { SUPPORTED } = require('../middleware/lang');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: (req) => req.t('error_too_many'),
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Inscription ──────────────────────────────────────────────────────────────

router.get('/signup', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('signup', { title: req.t('signup_title'), error: null, fields: {} });
});

router.post('/signup', authLimiter, verifyToken, async (req, res) => {
  const { username, email, password, confirm } = req.body;
  const fields = { username, email };
  const t = req.t.bind(req);

  const fail = (key) => res.render('signup', { title: t('signup_title'), error: t(key), fields });

  if (!username || !email || !password || !confirm) return fail('error_fields_required');
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username))     return fail('error_username_invalid');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))   return fail('error_email_invalid');
  if (password.length < 8)                          return fail('error_password_short');
  if (password !== confirm)                         return fail('error_passwords_mismatch');

  const exists = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
  if (exists) return fail('error_user_exists');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const lang = res.locals.currentLang || 'fr';

  const result = db.prepare(
    'INSERT INTO users (username, email, password_hash, language) VALUES (?, ?, ?, ?)'
  ).run(username, email, passwordHash, lang);

  req.session.regenerate((err) => {
    if (err) return fail('error_internal');
    req.session.userId   = result.lastInsertRowid;
    req.session.username = username;
    req.session.isAdmin  = 0;
    req.session.userLang = lang;
    res.redirect('/interests');
  });
});

// ── Connexion ────────────────────────────────────────────────────────────────

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { title: req.t('login_title'), error: null });
});

router.post('/login', authLimiter, verifyToken, async (req, res) => {
  const { email, password } = req.body;
  const t = req.t.bind(req);

  const fail = (key) => res.render('login', { title: t('login_title'), error: t(key) });

  if (!email || !password) return fail('error_login_required');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const match = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !match) return fail('error_login_invalid');

  req.session.regenerate((err) => {
    if (err) return fail('error_internal');
    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.isAdmin  = user.is_admin;
    req.session.userLang = user.language || 'fr';
    res.redirect('/');
  });
});

// ── Déconnexion ──────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ── Changement de langue rapide ───────────────────────────────────────────────

router.get('/lang/:code', (req, res) => {
  const code = req.params.code;
  if (!SUPPORTED.includes(code)) return res.redirect('/');

  res.cookie('lang', code, {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: false,
  });

  if (req.session.userId) {
    req.session.userLang = code;
    db.prepare('UPDATE users SET language = ? WHERE id = ?').run(code, req.session.userId);
  }

  const back = req.get('Referer') || '/';
  res.redirect(back);
});

module.exports = router;
