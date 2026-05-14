const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

const getUserLangPref = db.prepare('SELECT content_languages FROM users WHERE id = ?');

// 50 candidats pondérés, non encore vus, non rejetés, filtrés par langue
const queryCandidates = db.prepare(`
  SELECT s.id, s.url, s.title, s.description, s.language,
         SUM(ui.weight) AS total_weight
  FROM sites s
  JOIN site_categories sc ON sc.site_id = s.id
  JOIN user_interests ui ON ui.category_id = sc.category_id AND ui.user_id = ?
  WHERE s.status = 'approved'
    AND s.id NOT IN (SELECT site_id FROM views WHERE user_id = ?)
    AND s.id NOT IN (SELECT site_id FROM votes WHERE user_id = ? AND direction = -1)
    AND (? = 'all' OR INSTR(',' || ? || ',', ',' || s.language || ',') > 0)
  GROUP BY s.id
  ORDER BY RANDOM()
  LIMIT 50
`);

// Fallback : plus de non-vus → reprend tout sauf les rejetés
const queryCandidatesAny = db.prepare(`
  SELECT s.id, s.url, s.title, s.description, s.language,
         SUM(ui.weight) AS total_weight
  FROM sites s
  JOIN site_categories sc ON sc.site_id = s.id
  JOIN user_interests ui ON ui.category_id = sc.category_id AND ui.user_id = ?
  WHERE s.status = 'approved'
    AND s.id NOT IN (SELECT site_id FROM votes WHERE user_id = ? AND direction = -1)
    AND (? = 'all' OR INSTR(',' || ? || ',', ',' || s.language || ',') > 0)
  GROUP BY s.id
  ORDER BY RANDOM()
  LIMIT 50
`);

const querySiteById = db.prepare(`
  SELECT s.id, s.url, s.title, s.description, s.language, s.quality_score, s.can_embed
  FROM sites s WHERE s.id = ? AND s.status = 'approved'
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

const recordView = db.prepare(`
  INSERT OR REPLACE INTO views (user_id, site_id, viewed_at)
  VALUES (?, ?, CURRENT_TIMESTAMP)
`);

const clearViews = db.prepare('DELETE FROM views WHERE user_id = ?');

const queryVote = db.prepare(
  'SELECT direction FROM votes WHERE user_id = ? AND site_id = ?'
);
const queryScore = db.prepare(
  'SELECT COALESCE(SUM(direction), 0) AS score FROM votes WHERE site_id = ?'
);

function weightedPick(candidates) {
  const total = candidates.reduce((s, c) => s + c.total_weight, 0);
  let r = Math.random() * total;
  for (const c of candidates) {
    r -= c.total_weight;
    if (r <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

router.get('/stumble', requireLogin, (req, res) => {
  const userId = req.session.userId;
  const langPref = getUserLangPref.get(userId)?.content_languages || 'all';

  let candidates = queryCandidates.all(userId, userId, userId, langPref, langPref);

  if (!candidates.length) {
    clearViews.run(userId);
    candidates = queryCandidatesAny.all(userId, userId, langPref, langPref);
  }

  if (!candidates.length) {
    return res.redirect('/settings?error=no-sites');
  }

  const site = weightedPick(candidates);
  recordView.run(userId, site.id);
  res.redirect(`/stumble/${site.id}`);
});

router.get('/stumble/:id', requireLogin, (req, res) => {
  const site = querySiteById.get(req.params.id);
  if (!site) return res.redirect('/stumble');

  const lang = res.locals.currentLang;
  const userId = req.session.userId;
  const categories = queryCats.all(lang, userId, site.id);
  const voteRow = queryVote.get(userId, site.id);
  const userVote = voteRow ? voteRow.direction : null;
  const score = queryScore.get(site.id).score;

  // can_embed : NULL = inconnu (JS fallback), 1 = OK, 0 = bloqué/inaccessible
  const canEmbed = site.can_embed !== 0;

  res.render('stumble', {
    title: site.title,
    site,
    categories,
    userVote,
    score,
    canEmbed,
    flashLessOfThis: req.query.lessofthis === '1',
    flashReported: req.query.reported || null,
  });
});

module.exports = router;
