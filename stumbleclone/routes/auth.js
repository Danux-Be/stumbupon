const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { verifyToken } = require('../middleware/csrf');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: 'Trop de tentatives, réessaie dans 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Inscription ──────────────────────────────────────────────────────────────

router.get('/signup', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('signup', { title: 'Inscription', error: null, fields: {} });
});

router.post('/signup', authLimiter, verifyToken, async (req, res) => {
  const { username, email, password, confirm } = req.body;
  const fields = { username, email };

  const fail = (msg) => res.render('signup', { title: 'Inscription', error: msg, fields });

  if (!username || !email || !password || !confirm) return fail('Tous les champs sont obligatoires.');
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) return fail('Pseudo : 3 à 20 caractères (lettres, chiffres, _ -).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Adresse email invalide.');
  if (password.length < 8) return fail('Le mot de passe doit faire au moins 8 caractères.');
  if (password !== confirm) return fail('Les mots de passe ne correspondent pas.');

  const exists = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
  if (exists) return fail('Ce pseudo ou cet email est déjà utilisé.');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = db.prepare(
    'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
  ).run(username, email, passwordHash);

  // Connexion automatique après inscription
  req.session.regenerate((err) => {
    if (err) return fail('Erreur interne, réessaie.');
    req.session.userId   = result.lastInsertRowid;
    req.session.username = username;
    req.session.isAdmin  = 0;
    res.redirect('/');
  });
});

// ── Connexion ────────────────────────────────────────────────────────────────

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { title: 'Connexion', error: null });
});

router.post('/login', authLimiter, verifyToken, async (req, res) => {
  const { email, password } = req.body;

  const fail = (msg) => res.render('login', { title: 'Connexion', error: msg });

  if (!email || !password) return fail('Email et mot de passe requis.');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // On compare même si l'utilisateur n'existe pas (anti-timing attack)
  const match = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !match) return fail('Email ou mot de passe incorrect.');

  req.session.regenerate((err) => {
    if (err) return fail('Erreur interne, réessaie.');
    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.isAdmin  = user.is_admin;
    res.redirect('/');
  });
});

// ── Déconnexion ──────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
