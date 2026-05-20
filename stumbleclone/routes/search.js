const express = require('express');
const db = require('../db/database');

const router = express.Router();

const searchSites = db.prepare(`
  SELECT s.id, s.url, s.title, s.description, s.language,
         snippet(sites_fts, 0, '<mark>', '</mark>', '…', 10) AS title_snippet,
         snippet(sites_fts, 1, '<mark>', '</mark>', '…', 25) AS desc_snippet,
         bm25(sites_fts) AS rank
  FROM sites_fts
  JOIN sites s ON s.id = sites_fts.rowid
  WHERE sites_fts MATCH ?
    AND s.status = 'approved'
  ORDER BY rank
  LIMIT 30
`);

const getCategories = db.prepare(`
  SELECT sc.site_id, c.emoji,
         COALESCE(ct.name, c.name) AS localName
  FROM site_categories sc
  JOIN categories c ON c.id = sc.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  WHERE sc.site_id IN (SELECT value FROM json_each(?))
  ORDER BY localName
`);

function toFtsQuery(raw) {
  const clean = raw.trim().replace(/["""''()]/g, '').slice(0, 200);
  if (!clean) return null;
  return clean.split(/\s+/)
    .filter(Boolean)
    .map(w => `"${w}"*`)
    .join(' ');
}

router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const lang = res.locals.currentLang;
  const searchDesc = req.t('search_title') + ' — ' + req.t('home_hero_desc').slice(0, 100);

  if (!q) {
    return res.render('search', {
      title: req.t('search_title'),
      ogDescription: searchDesc,
      q: '',
      results: [],
      error: null,
    });
  }

  const ftsQuery = toFtsQuery(q);
  if (!ftsQuery) {
    return res.render('search', {
      title: req.t('search_title'),
      ogDescription: searchDesc,
      q,
      results: [],
      error: null,
    });
  }

  let results = [];
  try {
    results = searchSites.all(ftsQuery);
  } catch {
    return res.render('search', {
      title: req.t('search_title'),
      ogDescription: searchDesc,
      q,
      results: [],
      error: req.t('search_error'),
    });
  }

  // Catégories pour chaque résultat
  if (results.length) {
    const ids = JSON.stringify(results.map(r => r.id));
    const cats = getCategories.all(lang, ids);
    const catsBySite = {};
    for (const c of cats) {
      if (!catsBySite[c.site_id]) catsBySite[c.site_id] = [];
      catsBySite[c.site_id].push(c);
    }
    results = results.map(r => ({ ...r, categories: catsBySite[r.id] || [] }));
  }

  res.render('search', {
    title: req.t('search_title'),
    ogDescription: searchDesc,
    q,
    results,
    error: null,
  });
});

module.exports = router;
