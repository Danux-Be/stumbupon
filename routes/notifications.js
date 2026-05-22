const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

const stmtList = db.prepare(`
  SELECT n.id, n.type, n.site_id, n.read_at, n.created_at,
    u.username AS actor_username, u.avatar AS actor_avatar,
    s.title AS site_title
  FROM notifications n
  LEFT JOIN users u ON u.id = n.actor_id
  LEFT JOIN sites s ON s.id = n.site_id
  WHERE n.user_id = ?
  ORDER BY n.created_at DESC
  LIMIT 60
`);

const stmtMarkRead = db.prepare(
  "UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL"
);

router.get('/notifications', requireLogin, (req, res) => {
  const items = stmtList.all(req.session.userId);
  stmtMarkRead.run(req.session.userId);
  res.render('notifications', {
    title: req.t('notif_title'),
    items,
    noindex: true,
  });
});

router.post('/notifications/read-all', requireLogin, (req, res) => {
  stmtMarkRead.run(req.session.userId);
  res.json({ ok: true });
});

module.exports = router;
