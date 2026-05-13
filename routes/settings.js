const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken } = require('../middleware/csrf');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

router.get('/settings', requireLogin, (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  const selected = db.prepare(
    'SELECT category_id FROM user_interests WHERE user_id = ?'
  ).all(req.session.userId).map(r => r.category_id);

  res.render('settings', {
    title: 'Paramètres',
    categories,
    selected,
    success: req.query.success || null,
    error: req.query.error || null,
  });
});

// Mise à jour des centres d'intérêt
router.post('/settings/interests', requireLogin, verifyToken, (req, res) => {
  let chosen = req.body.categories || [];
  if (!Array.isArray(chosen)) chosen = [chosen];
  chosen = chosen.map(Number).filter(Boolean);

  if (chosen.length < 3) {
    return res.redirect('/settings?error=interests-min');
  }

  const replace = db.transaction((userId, ids) => {
    db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(userId);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO user_interests (user_id, category_id) VALUES (?, ?)'
    );
    for (const id of ids) insert.run(userId, id);
  });

  replace(req.session.userId, chosen);
  res.redirect('/settings?success=interests');
});

// Changement de mot de passe
router.post('/settings/password', requireLogin, verifyToken, async (req, res) => {
  const { current, newpass, confirm } = req.body;

  const fail = (msg) => res.redirect(`/settings?error=${encodeURIComponent(msg)}`);

  if (!current || !newpass || !confirm) return fail('Tous les champs sont requis.');
  if (newpass.length < 8) return fail('Le nouveau mot de passe doit faire au moins 8 caractères.');
  if (newpass !== confirm) return fail('Les mots de passe ne correspondent pas.');

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
  const match = await bcrypt.compare(current, user.password_hash);
  if (!match) return fail('Mot de passe actuel incorrect.');

  const hash = await bcrypt.hash(newpass, BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
  res.redirect('/settings?success=password');
});

module.exports = router;
