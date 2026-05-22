const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken } = require('../middleware/csrf');

const { checkAndGrant } = require('../lib/achievements');

const router = express.Router();

const VOTE_DELTA = 0.15;

const getVote    = db.prepare('SELECT direction FROM votes WHERE user_id = ? AND site_id = ?');
const deleteVote = db.prepare('DELETE FROM votes WHERE user_id = ? AND site_id = ?');
const upsertVote = db.prepare(
  'INSERT OR REPLACE INTO votes (user_id, site_id, direction) VALUES (?, ?, ?)'
);
const getSiteCats = db.prepare('SELECT category_id FROM site_categories WHERE site_id = ?');
const upsertInterest = db.prepare(`
  INSERT INTO user_interests (user_id, category_id, weight)
  VALUES (@userId, @catId, MAX(0.1, MIN(2.0, 1.0 + @delta)))
  ON CONFLICT (user_id, category_id) DO UPDATE SET
    weight = MAX(0.1, MIN(2.0, weight + @delta))
`);

function adjustInterests(userId, siteId, delta) {
  const cats = getSiteCats.all(siteId);
  for (const { category_id } of cats) {
    upsertInterest.run({ userId, catId: category_id, delta });
  }
}

router.post('/vote', requireLogin, verifyToken, (req, res) => {
  const userId    = req.session.userId;
  const siteId    = parseInt(req.body.site_id, 10);
  const direction = parseInt(req.body.direction, 10);

  if (!siteId || (direction !== 1 && direction !== -1)) {
    return res.redirect('/stumble');
  }

  const existing = getVote.get(userId, siteId);

  if (existing && existing.direction === direction) {
    // Même direction → annulation du vote
    deleteVote.run(userId, siteId);
    adjustInterests(userId, siteId, -direction * VOTE_DELTA);
  } else {
    upsertVote.run(userId, siteId, direction);
    if (existing) {
      // Changement de direction → undo ancien + appliquer nouveau
      adjustInterests(userId, siteId, direction * VOTE_DELTA * 2);
    } else {
      adjustInterests(userId, siteId, direction * VOTE_DELTA);
    }
  }

  // Si c'est un upvote, vérifier les succès du soumetteur
  if (direction === 1) {
    const site = db.prepare('SELECT submitted_by FROM sites WHERE id = ?').get(siteId);
    if (site?.submitted_by) checkAndGrant(site.submitted_by);
  }

  res.json({ ok: true });
});

module.exports = router;
