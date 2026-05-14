const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken } = require('../middleware/csrf');

const router = express.Router();

const queryTastes = db.prepare(`
  SELECT c.id, c.slug, c.emoji,
         COALESCE(ct.name, c.name) AS localName,
         COALESCE(ui.weight, 1.0) AS weight
  FROM user_interests ui
  JOIN categories c ON c.id = ui.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  WHERE ui.user_id = ?
  ORDER BY localName
`);

const getSiteCatIds = db.prepare(
  'SELECT category_id FROM site_categories WHERE site_id = ?'
);

const decreaseWeight = db.prepare(`
  UPDATE user_interests
  SET weight = MAX(0.1, COALESCE(weight, 1.0) - 0.3)
  WHERE user_id = ? AND category_id = ?
`);

const adjustWeight = db.prepare(`
  UPDATE user_interests
  SET weight = MIN(2.0, MAX(0.1, COALESCE(weight, 1.0) + ?))
  WHERE user_id = ? AND category_id = ?
`);

router.get('/tastes', requireLogin, (req, res) => {
  const tastes = queryTastes.all(res.locals.currentLang, req.session.userId);
  res.render('tastes', {
    title: res.locals.t('tastes_title'),
    tastes,
    updated: req.query.updated === '1',
    lessofthis: req.query.lessofthis === '1',
  });
});

router.post('/less-of-this', requireLogin, verifyToken, (req, res) => {
  const siteId = parseInt(req.body.site_id, 10);
  if (!siteId) return res.redirect('/stumble');

  const userId = req.session.userId;
  const cats = getSiteCatIds.all(siteId);
  for (const { category_id } of cats) {
    decreaseWeight.run(userId, category_id);
  }

  res.redirect(`/stumble/${siteId}?lessofthis=1`);
});

router.post('/tastes/weight', requireLogin, verifyToken, (req, res) => {
  const userId = req.session.userId;
  const catId = parseInt(req.body.category_id, 10);
  const direction = req.body.direction === '+' ? 0.2 : -0.2;

  if (catId) adjustWeight.run(direction, userId, catId);

  res.redirect('/tastes?updated=1');
});

module.exports = router;
