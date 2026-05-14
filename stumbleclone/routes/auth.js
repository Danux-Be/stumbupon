const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { verifyToken } = require('../middleware/csrf');
const { SUPPORTED } = require('../middleware/lang');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../lib/mailer');
const { verifyTurnstile } = require('../lib/turnstile');

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
  const siteKey = process.env.TURNSTILE_SITE_KEY || null;
  res.render('signup', { title: req.t('signup_title'), error: null, fields: {}, turnstileSiteKey: siteKey });
});

router.post('/signup', authLimiter, verifyToken, async (req, res) => {
  const { username, email, password, confirm } = req.body;
  const fields = { username, email };
  const t = req.t.bind(req);
  const lang = res.locals.currentLang || 'fr';
  const siteKey = process.env.TURNSTILE_SITE_KEY || null;

  const fail = (key) => res.render('signup', {
    title: t('signup_title'), error: t(key), fields, turnstileSiteKey: siteKey,
  });

  if (!username || !email || !password || !confirm) return fail('error_fields_required');
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username))     return fail('error_username_invalid');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))   return fail('error_email_invalid');
  if (password.length < 8)                          return fail('error_password_short');
  if (password !== confirm)                         return fail('error_passwords_mismatch');

  // Vérification Turnstile (uniquement en production si clé configurée)
  const turnstileToken = req.body['cf-turnstile-response'];
  const turnstileOk = await verifyTurnstile(turnstileToken);
  if (!turnstileOk) return fail('error_captcha');

  const exists = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
  if (exists) return fail('error_user_exists');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const verificationToken = crypto.randomBytes(32).toString('hex');

  const result = db.prepare(
    `INSERT INTO users (username, email, password_hash, language, email_verified, email_verification_token)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(username, email, passwordHash, lang, verificationToken);

  // Envoyer l'email de vérification (non bloquant)
  sendVerificationEmail(email, username, verificationToken, lang).catch(err => {
    console.error('Erreur envoi email de vérification :', err.message);
  });

  req.session.regenerate((err) => {
    if (err) return fail('error_internal');
    req.session.userId   = result.lastInsertRowid;
    req.session.username = username;
    req.session.isAdmin  = 0;
    req.session.userLang = lang;
    res.redirect('/interests');
  });
});

// ── Vérification email ───────────────────────────────────────────────────────

router.get('/verify-email/:token', (req, res) => {
  const token = req.params.token;
  const user = db.prepare('SELECT id FROM users WHERE email_verification_token = ?').get(token);

  if (!user) {
    return res.render('verify-email', {
      title: req.t('verify_title'),
      success: false,
      error: req.t('verify_invalid'),
    });
  }

  db.prepare(
    'UPDATE users SET email_verified = 1, email_verification_token = NULL WHERE id = ?'
  ).run(user.id);

  // Mettre à jour la session si c'est l'utilisateur connecté
  if (req.session.userId === user.id) {
    req.session.emailVerified = true;
  }

  res.render('verify-email', {
    title: req.t('verify_title'),
    success: true,
    error: null,
  });
});

// ── Renvoi de l'email de vérification ────────────────────────────────────────

router.post('/resend-verification', authLimiter, (req, res) => {
  if (!req.session.userId) return res.redirect('/login');

  const user = db.prepare(
    'SELECT email, username, language, email_verified FROM users WHERE id = ?'
  ).get(req.session.userId);

  if (!user || user.email_verified) return res.redirect('/');

  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE users SET email_verification_token = ? WHERE id = ?').run(token, req.session.userId);

  sendVerificationEmail(user.email, user.username, token, user.language || 'fr').catch(err => {
    console.error('Erreur renvoi email :', err.message);
  });

  res.redirect('/interests?success=email-resent');
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
    req.session.userId        = user.id;
    req.session.username      = user.username;
    req.session.isAdmin       = user.is_admin;
    req.session.userLang      = user.language || 'fr';
    req.session.emailVerified = !!user.email_verified;
    res.redirect('/');
  });
});

// ── Mot de passe oublié ───────────────────────────────────────────────────────

const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: (req) => req.t('error_too_many'),
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/forgot-password', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('forgot-password', { title: req.t('forgot_title'), sent: false, error: null, prefill: null });
});

router.post('/forgot-password', forgotLimiter, verifyToken, (req, res) => {
  const { email } = req.body;
  const t = req.t.bind(req);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.render('forgot-password', {
      title: t('forgot_title'), sent: false, error: t('error_email_invalid'), prefill: email || '',
    });
  }

  const user = db.prepare('SELECT id, username, language FROM users WHERE email = ?').get(email);

  // Toujours afficher "envoyé" même si l'email n'existe pas (anti-énumération)
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h
    db.prepare('UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?')
      .run(token, expires, user.id);
    sendPasswordResetEmail(email, user.username, token, user.language || 'fr').catch(err => {
      console.error('Erreur envoi reset email :', err.message);
    });
  }

  res.render('forgot-password', { title: t('forgot_title'), sent: true, error: null, prefill: null });
});

// ── Réinitialisation du mot de passe ─────────────────────────────────────────

router.get('/reset-password/:token', (req, res) => {
  const { token } = req.params;
  const user = db.prepare(
    "SELECT id FROM users WHERE password_reset_token = ? AND password_reset_expires > datetime('now')"
  ).get(token);

  if (!user) {
    return res.render('reset-password', {
      title: req.t('reset_title'), invalid: true, success: false, error: null, token,
    });
  }

  res.render('reset-password', {
    title: req.t('reset_title'), invalid: false, success: false, error: null, token,
  });
});

router.post('/reset-password/:token', authLimiter, verifyToken, async (req, res) => {
  const { token } = req.params;
  const { newpass, confirm } = req.body;
  const t = req.t.bind(req);

  const fail = (key) => res.render('reset-password', {
    title: t('reset_title'), invalid: false, success: false, error: t(key), token,
  });

  const user = db.prepare(
    "SELECT id FROM users WHERE password_reset_token = ? AND password_reset_expires > datetime('now')"
  ).get(token);

  if (!user) {
    return res.render('reset-password', {
      title: t('reset_title'), invalid: true, success: false, error: null, token,
    });
  }

  if (!newpass || !confirm)    return fail('error_password_fields');
  if (newpass.length < 8)      return fail('error_new_password_short');
  if (newpass !== confirm)      return fail('error_passwords_mismatch');

  const hash = await bcrypt.hash(newpass, BCRYPT_ROUNDS);
  db.prepare(
    'UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?'
  ).run(hash, user.id);

  res.render('reset-password', {
    title: t('reset_title'), invalid: false, success: true, error: null, token,
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
