const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken } = require('../middleware/csrf');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

function getCategories(lang) {
  return db.prepare(`
    SELECT c.id, c.emoji, COALESCE(ct.name, c.name) AS localName
    FROM categories c
    LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
    ORDER BY localName
  `).all(lang);
}

router.get('/settings', requireLogin, (req, res) => {
  const lang = res.locals.currentLang;
  const categories = getCategories(lang);
  const selected = db.prepare(
    'SELECT category_id FROM user_interests WHERE user_id = ?'
  ).all(req.session.userId).map(r => r.category_id);

  res.render('settings', {
    title: req.t('settings_title'),
    categories,
    selected,
    success: req.query.success || null,
    error: req.query.error || null,
  });
});

router.post('/settings/interests', requireLogin, verifyToken, (req, res) => {
  let chosen = req.body.categories || [];
  if (!Array.isArray(chosen)) chosen = [chosen];
  chosen = chosen.map(Number).filter(Boolean);

  if (chosen.length < 3) return res.redirect('/settings?error=interests-min');

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

router.post('/settings/password', requireLogin, verifyToken, async (req, res) => {
  const { current, newpass, confirm } = req.body;
  const t = req.t.bind(req);

  const fail = (key) => res.redirect(`/settings?error=${encodeURIComponent(t(key))}`);

  if (!current || !newpass || !confirm) return fail('error_password_fields');
  if (newpass.length < 8)              return fail('error_new_password_short');
  if (newpass !== confirm)             return fail('error_passwords_mismatch');

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
  const match = await bcrypt.compare(current, user.password_hash);
  if (!match) return fail('error_current_password_wrong');

  const hash = await bcrypt.hash(newpass, BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
  res.redirect('/settings?success=password');
});

module.exports = router;
