const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken } = require('../middleware/csrf');

const router = express.Router();

const getVote = db.prepare('SELECT direction FROM votes WHERE user_id = ? AND site_id = ?');
const deleteVote = db.prepare('DELETE FROM votes WHERE user_id = ? AND site_id = ?');
const upsertVote = db.prepare(
  'INSERT OR REPLACE INTO votes (user_id, site_id, direction) VALUES (?, ?, ?)'
);

router.post('/vote', requireLogin, verifyToken, (req, res) => {
  const userId = req.session.userId;
  const siteId = parseInt(req.body.site_id, 10);
  const direction = parseInt(req.body.direction, 10);

  if (!siteId || (direction !== 1 && direction !== -1)) {
    return res.redirect('/stumble');
  }

  const existing = getVote.get(userId, siteId);

  if (existing && existing.direction === direction) {
    deleteVote.run(userId, siteId);
  } else {
    upsertVote.run(userId, siteId, direction);
  }

  res.json({ ok: true });
});

module.exports = router;
