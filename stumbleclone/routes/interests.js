const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken } = require('../middleware/csrf');

const router = express.Router();

function getCategories(lang) {
  return db.prepare(`
    SELECT c.id, c.emoji, COALESCE(ct.name, c.name) AS localName
    FROM categories c
    LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
    ORDER BY localName
  `).all(lang);
}

router.get('/interests', requireLogin, (req, res) => {
  const lang = res.locals.currentLang;
  const categories = getCategories(lang);
  const selected = db.prepare(
    'SELECT category_id FROM user_interests WHERE user_id = ?'
  ).all(req.session.userId).map(r => r.category_id);

  res.render('interests', {
    title: req.t('interests_title'),
    categories,
    selected,
    error: null,
  });
});

router.post('/interests', requireLogin, verifyToken, (req, res) => {
  let chosen = req.body.categories || [];
  if (!Array.isArray(chosen)) chosen = [chosen];
  chosen = chosen.map(Number).filter(Boolean);

  if (chosen.length < 3) {
    const lang = res.locals.currentLang;
    const categories = getCategories(lang);
    return res.render('interests', {
      title: req.t('interests_title'),
      categories,
      selected: chosen,
      error: req.t('error_interests_min'),
    });
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

module.exports = router;
