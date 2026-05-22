const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken }  = require('../middleware/csrf');

const router = express.Router();

function toSlug(title) {
  return title.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim()
    .replace(/\s+/g, '-').replace(/-+/g, '-')
    .slice(0, 60) || 'collection';
}

function uniqueSlug(userId, base) {
  let slug = base, n = 2;
  while (db.prepare('SELECT 1 FROM collections WHERE user_id=? AND slug=?').get(userId, slug)) {
    slug = base + '-' + n++;
  }
  return slug;
}

const stmtUserCols = db.prepare(`
  SELECT c.id, c.title, c.slug, c.is_public, c.description,
    (SELECT COUNT(*) FROM collection_sites cs WHERE cs.collection_id = c.id) AS site_count
  FROM collections c WHERE c.user_id = ? ORDER BY c.created_at DESC
`);

const stmtUserColsForSite = db.prepare(`
  SELECT c.id, c.title, c.slug,
    CASE WHEN cs.site_id IS NOT NULL THEN 1 ELSE 0 END AS has_site
  FROM collections c
  LEFT JOIN collection_sites cs ON cs.collection_id = c.id AND cs.site_id = ?
  WHERE c.user_id = ?
  ORDER BY c.created_at DESC
`);

// ── Mes collections ────────────────────────────────────────────────────────────
router.get('/collections', requireLogin, (req, res) => {
  const collections = stmtUserCols.all(req.session.userId);
  res.render('my-collections', {
    title: req.t('collections_title'),
    collections,
    currentUsername: req.session.username,
    success: req.query.success || null,
  });
});

// ── Créer ──────────────────────────────────────────────────────────────────────
router.post('/collections', requireLogin, verifyToken, (req, res) => {
  const title = (req.body.title || '').trim().slice(0, 80);
  if (!title) return res.redirect('/collections');
  const desc     = (req.body.description || '').trim().slice(0, 300) || null;
  const isPublic = req.body.is_public === '1' ? 1 : 0;
  const slug     = uniqueSlug(req.session.userId, toSlug(title));
  db.prepare('INSERT INTO collections (user_id,title,slug,description,is_public) VALUES (?,?,?,?,?)')
    .run(req.session.userId, title, slug, desc, isPublic);
  res.redirect('/collections?success=created');
});

// ── Modifier ───────────────────────────────────────────────────────────────────
router.post('/collections/:id/edit', requireLogin, verifyToken, (req, res) => {
  const col = db.prepare('SELECT * FROM collections WHERE id=? AND user_id=?').get(req.params.id, req.session.userId);
  if (!col) return res.redirect('/collections');
  const title    = (req.body.title || '').trim().slice(0, 80) || col.title;
  const desc     = (req.body.description || '').trim().slice(0, 300) || null;
  const isPublic = req.body.is_public === '1' ? 1 : 0;
  db.prepare('UPDATE collections SET title=?,description=?,is_public=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(title, desc, isPublic, col.id);
  res.redirect('/collections');
});

// ── Supprimer ──────────────────────────────────────────────────────────────────
router.post('/collections/:id/delete', requireLogin, verifyToken, (req, res) => {
  db.prepare('DELETE FROM collections WHERE id=? AND user_id=?').run(req.params.id, req.session.userId);
  res.redirect('/collections');
});

// ── Créer rapidement + ajouter un site (AJAX depuis stumble) ──────────────────
router.post('/collections/quick-create', requireLogin, verifyToken, (req, res) => {
  const title  = (req.body.title || '').trim().slice(0, 80);
  const siteId = parseInt(req.body.site_id, 10);
  if (!title || !siteId) return res.status(400).json({ ok: false });
  const slug   = uniqueSlug(req.session.userId, toSlug(title));
  const result = db.prepare('INSERT INTO collections (user_id,title,slug,description,is_public) VALUES (?,?,?,NULL,1)')
    .run(req.session.userId, title, slug);
  const newId  = result.lastInsertRowid;
  db.prepare('INSERT OR IGNORE INTO collection_sites (collection_id,site_id) VALUES (?,?)').run(newId, siteId);
  return res.json({ ok: true, id: newId, title, slug, added: true });
});

// ── Toggle site dans une collection (AJAX) ─────────────────────────────────────
router.post('/collections/:id/toggle-site', requireLogin, verifyToken, (req, res) => {
  const col    = db.prepare('SELECT id,title FROM collections WHERE id=? AND user_id=?').get(req.params.id, req.session.userId);
  if (!col) return res.status(404).json({ ok: false });
  const siteId = parseInt(req.body.site_id, 10);
  if (!siteId) return res.status(400).json({ ok: false });
  const exists = db.prepare('SELECT 1 FROM collection_sites WHERE collection_id=? AND site_id=?').get(col.id, siteId);
  if (exists) {
    db.prepare('DELETE FROM collection_sites WHERE collection_id=? AND site_id=?').run(col.id, siteId);
    return res.json({ ok: true, added: false, title: col.title });
  }
  db.prepare('INSERT OR IGNORE INTO collection_sites (collection_id,site_id) VALUES (?,?)').run(col.id, siteId);
  return res.json({ ok: true, added: true, title: col.title });
});

// ── Page publique d'une collection ────────────────────────────────────────────
router.get('/c/:username/:slug', (req, res) => {
  const owner = db.prepare('SELECT id,username,avatar FROM users WHERE username=? AND is_banned=0').get(req.params.username);
  const notFound = (extra = {}) => res.status(404).render('collection', {
    notFound: true, collection: null, sites: [], owner: owner || null,
    title: '404', isOwner: false, avatarUrl: null,
    ogTitle: 'StumbUpon.com', ogDescription: '', canonicalUrl: null, ...extra,
  });
  if (!owner) return notFound();

  const col = db.prepare('SELECT * FROM collections WHERE user_id=? AND slug=?').get(owner.id, req.params.slug);
  if (!col || (!col.is_public && req.session.userId !== owner.id)) return notFound();

  const lang  = res.locals.currentLang;
  const sites = db.prepare(`
    SELECT s.id, s.title, s.url, s.description, cs.added_at,
      GROUP_CONCAT(c.emoji || ' ' || COALESCE(ct.name, c.name)) AS cats
    FROM collection_sites cs
    JOIN sites s ON s.id = cs.site_id
    LEFT JOIN site_categories sc ON sc.site_id = s.id
    LEFT JOIN categories c ON c.id = sc.category_id
    LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
    WHERE cs.collection_id = ?
    GROUP BY s.id ORDER BY cs.added_at DESC
  `).all(lang, col.id);

  const base    = res.locals.baseUrl;
  const isOwner = req.session.userId === owner.id;
  const ogUrl   = `${base}/c/${owner.username}/${col.slug}`;

  res.render('collection', {
    title: col.title,
    notFound: false,
    collection: col,
    sites,
    owner,
    isOwner,
    avatarUrl: owner.avatar ? `${base}/avatars/${owner.avatar}` : null,
    ogTitle: col.title + ' — ' + owner.username,
    ogDescription: req.t('collection_og_desc', { count: sites.length, username: owner.username }),
    ogUrl,
    canonicalUrl: ogUrl,
    noindex: !col.is_public,
  });
});

module.exports = { router, stmtUserColsForSite };
