const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

const PER_PAGE = 20;

const countFavorites = db.prepare(
  'SELECT COUNT(*) AS n FROM votes WHERE user_id = ? AND direction = 1'
);

const queryFavorites = db.prepare(`
  SELECT s.id, s.url, s.title, s.description, s.language, v.created_at AS liked_at
  FROM votes v
  JOIN sites s ON s.id = v.site_id
  WHERE v.user_id = ? AND v.direction = 1
  ORDER BY v.created_at DESC
  LIMIT ? OFFSET ?
`);

const queryCatsForSites = db.prepare(`
  SELECT sc.site_id, c.emoji, COALESCE(ct.name, c.name) AS localName
  FROM site_categories sc
  JOIN categories c ON c.id = sc.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  WHERE sc.site_id IN (SELECT value FROM json_each(?))
  ORDER BY localName
`);

router.get('/favorites', requireLogin, (req, res) => {
  const userId = req.session.userId;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * PER_PAGE;
  const lang = res.locals.currentLang;

  const total = countFavorites.get(userId).n;
  const totalPages = Math.ceil(total / PER_PAGE);
  const sites = queryFavorites.all(userId, PER_PAGE, offset);

  let catsBySite = {};
  if (sites.length) {
    const ids = JSON.stringify(sites.map(s => s.id));
    const rows = queryCatsForSites.all(lang, ids);
    for (const row of rows) {
      if (!catsBySite[row.site_id]) catsBySite[row.site_id] = [];
      catsBySite[row.site_id].push({ emoji: row.emoji, localName: row.localName });
    }
  }

  res.render('favorites', {
    title: req.t('favorites_title'),
    sites,
    catsBySite,
    page,
    totalPages,
    total,
  });
});

module.exports = router;
