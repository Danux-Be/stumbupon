const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken } = require('../middleware/csrf');

const router = express.Router();

router.get('/interests', requireLogin, (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  const existing = db.prepare(
    'SELECT category_id FROM user_interests WHERE user_id = ?'
  ).all(req.session.userId).map(r => r.category_id);

  res.render('interests', {
    title: 'Mes centres d\'intérêt',
    categories,
    selected: existing,
    error: null,
  });
});

router.post('/interests', requireLogin, verifyToken, (req, res) => {
  // Les cases cochées arrivent comme tableau ou valeur unique
  let chosen = req.body.categories || [];
  if (!Array.isArray(chosen)) chosen = [chosen];
  chosen = chosen.map(Number).filter(Boolean);

  if (chosen.length < 3) {
    const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
    return res.render('interests', {
      title: 'Mes centres d\'intérêt',
      categories,
      selected: chosen,
      error: 'Choisis au moins 3 centres d\'intérêt.',
    });
  }

  // Remplacement atomique des intérêts
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

module.exports = router;
