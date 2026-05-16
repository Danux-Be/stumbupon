const express = require('express');
const db = require('../db/database');
const { requireCurator } = require('../middleware/auth');
const { verifyToken } = require('../middleware/csrf');

const router = express.Router();

const PAGE_SIZE = 20;

const allCategoriesStmt = db.prepare('SELECT id, slug, name, emoji FROM categories ORDER BY name');

const queryCatsForSites = db.prepare(`
  SELECT sc.site_id, c.id AS category_id, c.emoji, COALESCE(ct.name, c.name) AS localName
  FROM site_categories sc
  JOIN categories c ON c.id = sc.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  WHERE sc.site_id IN (SELECT value FROM json_each(?))
  ORDER BY localName
`);

router.get('/curate', requireCurator, (req, res) => {
  const lang  = res.locals.currentLang;
  const page  = Math.max(1, parseInt(req.query.page || '1', 10));
  const offset = (page - 1) * PAGE_SIZE;

  const total = db.prepare(`
    SELECT COUNT(DISTINCT s.id) AS n
    FROM sites s
    WHERE s.status = 'approved'
      AND (SELECT COUNT(*) FROM site_categories sc WHERE sc.site_id = s.id) <= 1
  `).get().n;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const sites = db.prepare(`
    SELECT s.id, s.url, s.title, s.description, s.language,
           (SELECT COUNT(*) FROM site_categories sc WHERE sc.site_id = s.id) AS cat_count
    FROM sites s
    WHERE s.status = 'approved'
      AND (SELECT COUNT(*) FROM site_categories sc WHERE sc.site_id = s.id) <= 1
    ORDER BY s.approved_at DESC
    LIMIT ? OFFSET ?
  `).all(PAGE_SIZE, offset);

  const allCategories = allCategoriesStmt.all();

  let catsBySite = {};
  let catIdsBySite = {};
  if (sites.length) {
    const ids = JSON.stringify(sites.map(s => s.id));
    const rows = queryCatsForSites.all(lang, ids);
    for (const row of rows) {
      if (!catsBySite[row.site_id]) catsBySite[row.site_id] = [];
      catsBySite[row.site_id].push({ emoji: row.emoji, localName: row.localName });
      if (!catIdsBySite[row.site_id]) catIdsBySite[row.site_id] = [];
      catIdsBySite[row.site_id].push(row.category_id);
    }
  }

  res.render('curate', {
    title: 'Curation des catégories',
    sites,
    catsBySite,
    catIdsBySite,
    allCategories,
    total,
    page,
    totalPages,
  });
});

router.post('/curate/site/:id/update-json', requireCurator, verifyToken, (req, res) => {
  const id   = parseInt(req.params.id, 10);
  const lang = req.body.language || null;
  const cats = [].concat(req.body.categories || []).map(Number).filter(Boolean);

  db.prepare('UPDATE sites SET language = ? WHERE id = ?').run(lang, id);
  db.prepare('DELETE FROM site_categories WHERE site_id = ?').run(id);
  const ins = db.prepare('INSERT OR IGNORE INTO site_categories (site_id, category_id) VALUES (?, ?)');
  db.transaction((ids) => { for (const cid of ids) ins.run(id, cid); })(cats);

  res.json({ ok: true });
});

router.post('/curate/site/:id/categories', requireCurator, verifyToken, (req, res) => {
  const id   = parseInt(req.params.id, 10);
  const cats = [].concat(req.body.categories || []).map(Number).filter(Boolean);
  const page = parseInt(req.body._page || '1', 10);

  db.prepare('DELETE FROM site_categories WHERE site_id = ?').run(id);
  const ins = db.prepare('INSERT OR IGNORE INTO site_categories (site_id, category_id) VALUES (?, ?)');
  const tx  = db.transaction((ids) => { for (const cid of ids) ins.run(id, cid); });
  tx(cats);

  res.redirect(`/curate?page=${page}`);
});

module.exports = router;
