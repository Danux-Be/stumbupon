const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');
const { verifyToken }  = require('../middleware/csrf');

const router = express.Router();

const PER_PAGE = 20;

// ── Toggle follow/unfollow ─────────────────────────────────────────────────────
router.post('/u/:username/follow', requireLogin, verifyToken, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE username=? AND is_banned=0').get(req.params.username);
  if (!target || target.id === req.session.userId) return res.status(400).json({ ok: false });

  const exists = db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?')
    .get(req.session.userId, target.id);
  if (exists) {
    db.prepare('DELETE FROM follows WHERE follower_id=? AND followed_id=?').run(req.session.userId, target.id);
  } else {
    db.prepare('INSERT OR IGNORE INTO follows (follower_id,followed_id) VALUES (?,?)').run(req.session.userId, target.id);
  }

  const followerCount = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followed_id=?').get(target.id).n;
  res.json({ ok: true, following: !exists, followerCount });
});

// ── Feed des abonnements ───────────────────────────────────────────────────────
router.get('/following', requireLogin, (req, res) => {
  const userId = req.session.userId;
  const lang   = res.locals.currentLang;
  const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * PER_PAGE;

  const followingCount = db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id=?').get(userId).n;

  if (!followingCount) {
    return res.render('following', {
      title: req.t('following_title'),
      items: [], page: 1, totalPages: 0, total: 0, followingCount: 0,
    });
  }

  const total = db.prepare(`
    SELECT COUNT(DISTINCT v.site_id || '-' || v.user_id) AS n
    FROM views v
    JOIN follows f ON f.followed_id = v.user_id
    JOIN sites s ON s.id = v.site_id
    WHERE f.follower_id = ? AND v.user_id != ? AND s.status = 'approved'
  `).get(userId, userId).n;

  const items = db.prepare(`
    SELECT s.id, s.title, s.url, s.description, v.viewed_at,
      u.username AS discovered_by, u.avatar AS discovered_by_avatar,
      GROUP_CONCAT(DISTINCT c.emoji || ' ' || COALESCE(ct.name, c.name)) AS cats
    FROM views v
    JOIN follows f ON f.followed_id = v.user_id
    JOIN sites s ON s.id = v.site_id
    JOIN users u ON u.id = v.user_id
    LEFT JOIN site_categories sc ON sc.site_id = s.id
    LEFT JOIN categories c ON c.id = sc.category_id
    LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
    WHERE f.follower_id = ? AND v.user_id != ? AND s.status = 'approved'
    GROUP BY v.site_id, v.user_id
    ORDER BY v.viewed_at DESC
    LIMIT ? OFFSET ?
  `).all(lang, userId, userId, PER_PAGE, offset);

  res.render('following', {
    title: req.t('following_title'),
    items, page,
    totalPages: Math.ceil(total / PER_PAGE),
    total, followingCount,
  });
});

module.exports = router;
