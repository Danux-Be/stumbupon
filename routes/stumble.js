const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken }  = require('../middleware/csrf');
const { extractVideoId, toEmbedUrl } = require('../lib/youtube');
const siteConfig         = require('../lib/config');
const { checkAndGrant }  = require('../lib/achievements');
const { stmtUserColsForSite } = require('./collections');
const { createNotification } = require('../lib/notify');

const router = express.Router();

const GUEST_LIMIT = 5;

const getUserPrefs = db.prepare('SELECT content_languages, include_videos FROM users WHERE id = ?');

// Candidats pondérés par centres d'intérêt, non encore vus, non rejetés
const queryCandidates = db.prepare(`
  SELECT s.id, s.url, s.title, s.description, s.language, s.type,
         SUM(ui.weight) AS total_weight
  FROM sites s
  JOIN site_categories sc ON sc.site_id = s.id
  JOIN user_interests ui ON ui.category_id = sc.category_id AND ui.user_id = ?
  WHERE s.status = 'approved'
    AND s.id NOT IN (SELECT site_id FROM views WHERE user_id = ?)
    AND s.id NOT IN (SELECT site_id FROM votes WHERE user_id = ? AND direction = -1)
    AND (? = 'all' OR INSTR(',' || ? || ',', ',' || s.language || ',') > 0)
    AND (? = 1 OR s.type != 'video')
  GROUP BY s.id
  ORDER BY RANDOM()
  LIMIT 50
`);

// Fallback : plus de non-vus → reprend tout sauf les rejetés
const queryCandidatesAny = db.prepare(`
  SELECT s.id, s.url, s.title, s.description, s.language, s.type,
         SUM(ui.weight) AS total_weight
  FROM sites s
  JOIN site_categories sc ON sc.site_id = s.id
  JOIN user_interests ui ON ui.category_id = sc.category_id AND ui.user_id = ?
  WHERE s.status = 'approved'
    AND s.id NOT IN (SELECT site_id FROM votes WHERE user_id = ? AND direction = -1)
    AND (? = 'all' OR INSTR(',' || ? || ',', ',' || s.language || ',') > 0)
    AND (? = 1 OR s.type != 'video')
  GROUP BY s.id
  ORDER BY RANDOM()
  LIMIT 50
`);

// Filtrage collaboratif : sites aimés par des utilisateurs au goût similaire
const queryCollabCandidates = db.prepare(`
  SELECT s.id, s.url, s.title, s.description, s.language, s.type,
         COUNT(DISTINCT v2.user_id) AS collab_score
  FROM votes v2
  JOIN sites s ON s.id = v2.site_id
  WHERE v2.direction = 1
    AND v2.user_id IN (
      SELECT v1.user_id
      FROM votes v1
      WHERE v1.site_id IN (
        SELECT site_id FROM votes WHERE user_id = ? AND direction = 1 LIMIT 100
      )
        AND v1.direction = 1
        AND v1.user_id != ?
      GROUP BY v1.user_id
      ORDER BY COUNT(*) DESC
      LIMIT 30
    )
    AND s.status = 'approved'
    AND s.id NOT IN (SELECT site_id FROM views WHERE user_id = ?)
    AND s.id NOT IN (SELECT site_id FROM votes WHERE user_id = ? AND direction = -1)
    AND (? = 'all' OR INSTR(',' || ? || ',', ',' || s.language || ',') > 0)
    AND (? = 1 OR s.type != 'video')
  GROUP BY s.id
  ORDER BY collab_score DESC
  LIMIT 30
`);

const countUserUpvotes = db.prepare(
  'SELECT COUNT(*) AS n FROM votes WHERE user_id = ? AND direction = 1'
);

// Sélection aléatoire pour les invités (pas de jointure user_interests)
const queryGuestCandidates = db.prepare(`
  SELECT id, url, title, description, language, can_embed
  FROM sites
  WHERE status = 'approved'
    AND id NOT IN (SELECT value FROM json_each(?))
  ORDER BY RANDOM()
  LIMIT 20
`);

const querySiteById = db.prepare(`
  SELECT s.id, s.url, s.title, s.description, s.language, s.quality_score, s.can_embed, s.type,
         s.submitted_by, u.username AS submitted_by_name, s.imported_by
  FROM sites s
  LEFT JOIN users u ON u.id = s.submitted_by
  WHERE s.id = ? AND s.status = 'approved'
`);

// Catégories + poids utilisateur (pour affichage "Pourquoi ce site?")
const queryCats = db.prepare(`
  SELECT c.id AS category_id, c.emoji,
         COALESCE(ct.name, c.name) AS localName,
         COALESCE(ui.weight, 1.0) AS weight,
         (ui.category_id IS NOT NULL) AS in_interests
  FROM site_categories sc
  JOIN categories c ON c.id = sc.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  LEFT JOIN user_interests ui ON ui.category_id = sc.category_id AND ui.user_id = ?
  WHERE sc.site_id = ?
  ORDER BY localName
`);

const queryCatsGuest = db.prepare(`
  SELECT c.id AS category_id, c.emoji,
         COALESCE(ct.name, c.name) AS localName
  FROM site_categories sc
  JOIN categories c ON c.id = sc.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  WHERE sc.site_id = ?
  ORDER BY localName
`);

const recordView = db.prepare(`
  INSERT OR REPLACE INTO views (user_id, site_id, viewed_at)
  VALUES (?, ?, CURRENT_TIMESTAMP)
`);

const clearViews = db.prepare('DELETE FROM views WHERE user_id = ?');

const queryComments = db.prepare(`
  SELECT c.id, c.body, c.created_at, u.username, c.user_id
  FROM comments c
  JOIN users u ON u.id = c.user_id
  WHERE c.site_id = ?
  ORDER BY c.created_at ASC
  LIMIT 100
`);
const insertComment = db.prepare(
  'INSERT INTO comments (user_id, site_id, body) VALUES (?, ?, ?)'
);
const deleteOwnComment = db.prepare(
  'DELETE FROM comments WHERE id = ? AND (user_id = ? OR ? = 1)'
);

const queryVote = db.prepare(
  'SELECT direction FROM votes WHERE user_id = ? AND site_id = ?'
);
const queryScore = db.prepare(
  'SELECT COALESCE(SUM(direction), 0) AS score FROM votes WHERE site_id = ?'
);

function weightedPick(candidates) {
  const total = candidates.reduce((s, c) => s + (c.total_weight || 0), 0);
  if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)];
  let r = Math.random() * total;
  for (const c of candidates) {
    r -= (c.total_weight || 0);
    if (r <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

function mergeWithCollab(interestCandidates, collabCandidates) {
  if (!collabCandidates.length) return interestCandidates;

  const maxCollab = Math.max(...collabCandidates.map(c => c.collab_score));
  const collabMap = new Map(collabCandidates.map(c => [c.id, c.collab_score]));
  const maxInterest = Math.max(...interestCandidates.map(c => c.total_weight), 1);

  const boostFactor = maxInterest * 0.3;
  const result = interestCandidates.map(c => ({
    ...c,
    total_weight: c.total_weight + (collabMap.get(c.id) || 0) / maxCollab * boostFactor,
  }));

  const interestIds = new Set(interestCandidates.map(c => c.id));
  for (const c of collabCandidates) {
    if (!interestIds.has(c.id)) {
      result.push({ ...c, total_weight: (c.collab_score / maxCollab) * boostFactor * 0.7 });
    }
  }

  return result;
}

// ── Route invité : mur d'inscription après GUEST_LIMIT stumbles ──────────
router.get('/stumble/join', (req, res) => {
  if (req.session.userId) return res.redirect('/stumble');
  const limitCount = parseInt(siteConfig.get('guest_limit_count') || '5', 10);
  res.render('stumble-join', {
    title: req.t('guest_join_title', { limit: limitCount }),
    guestLimit: limitCount,
  });
});

router.get('/stumble/join/skip', (req, res) => {
  if (req.session.userId) return res.redirect('/stumble');
  req.session.guestCount = 0;
  res.redirect('/stumble');
});

// ── Route principale ─────────────────────────────────────────────────────
router.get('/stumble', (req, res) => {
  const userId = req.session.userId;

  // Invité
  if (!userId) {
    const count        = req.session.guestCount || 0;
    const limitEnabled = siteConfig.get('guest_limit_enabled') === '1';
    const limitCount   = parseInt(siteConfig.get('guest_limit_count') || '5', 10);
    if (limitEnabled && count >= limitCount) return res.redirect('/stumble/join');
    const seen = req.session.guestSeen || [];
    let candidates = queryGuestCandidates.all(JSON.stringify(seen));

    if (!candidates.length) {
      req.session.guestSeen = [];
      candidates = queryGuestCandidates.all('[]');
    }
    if (!candidates.length) return res.redirect('/');

    const site = candidates[Math.floor(Math.random() * candidates.length)];
    req.session.guestSeen  = [...seen, site.id];
    req.session.guestCount = count + 1;
    return res.redirect(`/stumble/${site.id}`);
  }

  // Utilisateur connecté
  const prefs = getUserPrefs.get(userId);
  const langPref = prefs?.content_languages || 'all';
  const includeVideos = prefs?.include_videos !== 0 ? 1 : 0;

  let candidates = queryCandidates.all(userId, userId, userId, langPref, langPref, includeVideos);

  if (!candidates.length) {
    clearViews.run(userId);
    candidates = queryCandidatesAny.all(userId, userId, langPref, langPref, includeVideos);
  }

  if (!candidates.length) return res.redirect('/settings?error=no-sites');

  const upvoteCount = countUserUpvotes.get(userId).n;
  if (upvoteCount >= 5) {
    const collabCandidates = queryCollabCandidates.all(
      userId, userId, userId, userId, langPref, langPref, includeVideos
    );
    candidates = mergeWithCollab(candidates, collabCandidates);
  }

  const site = weightedPick(candidates);
  recordView.run(userId, site.id);
  const newAch = checkAndGrant(userId);
  if (newAch.length) req.session._achievements_flash = newAch;
  res.redirect(`/stumble/${site.id}`);
});

router.get('/stumble/:id', (req, res) => {
  const site = querySiteById.get(req.params.id);
  if (!site) return res.redirect('/stumble');

  const lang = res.locals.currentLang;
  const userId = req.session.userId;
  const isGuest = !userId;

  const categories = isGuest
    ? queryCatsGuest.all(lang, site.id).map(c => ({ ...c, weight: 1, in_interests: 0 }))
    : queryCats.all(lang, userId, site.id);

  const userVote = isGuest ? null : (queryVote.get(userId, site.id)?.direction ?? null);
  const score    = queryScore.get(site.id).score;
  const isVideo  = site.type === 'video';
  const canEmbed = isVideo ? true : site.can_embed !== 0;

  let embedUrl = null;
  if (isVideo) {
    const videoId = extractVideoId(site.url);
    embedUrl = videoId ? toEmbedUrl(videoId) : null;
  }

  const guestCount  = isGuest ? (req.session.guestCount || 0) : null;
  const comments    = queryComments.all(site.id);
  const submittedBy = site.submitted_by_name
    || (site.imported_by === 'referer' ? null : site.imported_by ? 'Bot' : null);

  const isCurator = !isGuest && (req.session.isCurator || req.session.isAdmin);
  const allCategories = isCurator
    ? db.prepare('SELECT id, slug, name, emoji FROM categories ORDER BY name').all()
    : null;
  const currentCatIds = isCurator ? categories.map(c => c.category_id) : null;
  const userCollections = (!isGuest && userId) ? stmtUserColsForSite.all(site.id, userId) : [];

  res.render('stumble', {
    title: site.title,
    site,
    categories,
    userVote,
    score,
    canEmbed,
    isVideo,
    embedUrl,
    isGuest,
    guestCount,
    guestLimitEnabled: siteConfig.get('guest_limit_enabled') === '1',
    guestLimit: parseInt(siteConfig.get('guest_limit_count') || '5', 10),
    currentUserId: userId || null,
    comments,
    submittedBy,
    isCurator,
    allCategories,
    currentCatIds,
    userCollections,
    flashLessOfThis: req.query.lessofthis === '1',
    flashReported: req.query.reported || null,
    ogTitle: site.title,
    ogDescription: site.description || '',
    ogUrl: `${res.locals.baseUrl}/stumble/${site.id}`,
  });
});

router.post('/stumble/:id/cant-embed', verifyToken, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare("UPDATE sites SET can_embed=0, status='rejected' WHERE id=?").run(id);
  res.json({ ok: true });
});

router.post('/stumble/:id/comment', requireLogin, verifyToken, (req, res) => {
  const site = querySiteById.get(req.params.id);
  if (!site) return res.status(404).json({ error: 'not found' });

  const body = (req.body.body || '').trim().slice(0, 500);
  if (!body) return res.status(400).json({ error: 'empty' });

  const result  = insertComment.run(req.session.userId, site.id, body);
  const newAch  = checkAndGrant(req.session.userId);
  const user    = db.prepare('SELECT username FROM users WHERE id = ?').get(req.session.userId);
  if (site.submitted_by && site.submitted_by !== req.session.userId) {
    createNotification(site.submitted_by, 'comment', req.session.userId, site.id);
  }

  res.json({
    comment: {
      id: result.lastInsertRowid,
      body,
      username: user.username,
      user_id: req.session.userId,
      created_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
    },
    newAchievements: newAch.map(a => ({ id: a.id, icon: a.icon, rarity: a.rarity, name: req.t('achievement_' + a.id + '_name') })),
  });
});

router.post('/stumble/:id/share', requireLogin, (req, res) => {
  db.prepare('UPDATE users SET shares_count = COALESCE(shares_count, 0) + 1 WHERE id = ?')
    .run(req.session.userId);
  const newAch = checkAndGrant(req.session.userId);
  res.json({
    ok: true,
    newAchievements: newAch.map(a => ({ id: a.id, icon: a.icon, rarity: a.rarity, name: req.t('achievement_' + a.id + '_name') })),
  });
});

router.post('/comment/:id/delete', requireLogin, verifyToken, (req, res) => {
  const isAdmin = req.session.isAdmin ? 1 : 0;
  const changes = deleteOwnComment.run(
    parseInt(req.params.id), req.session.userId, isAdmin
  ).changes;
  res.json({ ok: changes > 0 });
});

module.exports = router;
